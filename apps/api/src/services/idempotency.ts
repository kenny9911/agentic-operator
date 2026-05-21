/**
 * UC-V11-32 / PF-GAP-10 — Idempotency-Key helper.
 *
 * Wraps the `idempotency_keys` table introduced in migration 0014 so any
 * mutating route can replay a cached response in O(1):
 *
 *   const handler = withIdempotency(req, auth.tenantId, async () => {
 *     // do the actual side-effect; return { status, body } to cache.
 *   });
 *   if (handler.replayed) return reply.code(handler.status).send(handler.body);
 *
 * Contract notes:
 *   - The header name is the standard `Idempotency-Key` (case-insensitive,
 *     Fastify lowercases it).
 *   - The store is scoped per-tenant — same key in two tenants does NOT
 *     collide.
 *   - TTL is 24h from insert. The retention cron purges expired rows in
 *     bulk; the route does not pay an extra round-trip per call.
 *   - Concurrent first-time callers can both pass `lookup` then both run
 *     the handler — we INSERT … ON CONFLICT DO NOTHING and treat the
 *     loser as having no side-effect to cache (its response is dropped on
 *     the floor and the next retry will hit the winner's cache).
 *   - The header is OPTIONAL. Missing header → no caching, no INSERT.
 *
 * The original in-memory LRU in `apps/api/src/routes/v1/tenants.ts` is a
 * separate code path (mints bootstrap tokens, has its own correctness
 * profile). That route can migrate to this helper later; for V1 we leave
 * it intact and use this helper for `/v1/events` + `/v1/agents/:name/invoke`
 * where the contract was previously a no-op.
 */

import type { FastifyRequest } from "fastify";
import { and, eq, lt } from "drizzle-orm";
import { getDb, idempotencyKeys } from "@agentic/db";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24h per spec
const MAX_KEY_LEN = 255;

export interface CachedResponse {
  status: number;
  body: unknown;
}

/**
 * Read the `Idempotency-Key` header. Returns null when:
 *   - The header is absent.
 *   - The header is present but empty.
 *   - The header is longer than 255 characters (caller is doing something
 *     pathological; reject silently rather than blowing up the route).
 */
export function readIdempotencyKey(req: FastifyRequest): string | null {
  const raw = req.headers["idempotency-key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_KEY_LEN) return null;
  return trimmed;
}

/**
 * Look up a cached response for `(tenantId, key)`. Returns null when not
 * found OR found-but-expired. Expired rows are NOT eagerly deleted here —
 * the retention sweep handles bulk pruning — we just refuse to replay
 * stale entries.
 */
export function lookupIdempotency(
  tenantId: string,
  key: string,
): CachedResponse | null {
  const row = getDb()
    .select({
      responseJson: idempotencyKeys.responseJson,
      statusCode: idempotencyKeys.statusCode,
      expiresAt: idempotencyKeys.expiresAt,
    })
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.tenantId, tenantId),
        eq(idempotencyKeys.key, key),
      ),
    )
    .all()[0];
  if (!row) return null;
  const expiresAtMs =
    row.expiresAt instanceof Date ? row.expiresAt.getTime() : Number(row.expiresAt);
  if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) return null;
  try {
    return {
      status: row.statusCode ?? 200,
      body: JSON.parse(row.responseJson) as unknown,
    };
  } catch {
    // Malformed cache row — treat as miss; the route re-runs the side-
    // effect. Logging is the caller's job (we don't take a fastify logger).
    return null;
  }
}

/**
 * Persist a cached response. Caller does this AFTER its side-effect
 * succeeds so a failed run doesn't poison the cache. We use the SQLite
 * UPSERT (`ON CONFLICT DO UPDATE`) form so a retry that successfully
 * re-runs writes the freshest cache without complaining about the
 * collision.
 */
export function storeIdempotency(
  tenantId: string,
  key: string,
  res: CachedResponse,
): void {
  const responseJson = JSON.stringify(res.body);
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS);
  // drizzle's onConflictDoUpdate uses the PK index (tenant_id, key).
  getDb()
    .insert(idempotencyKeys)
    .values({
      tenantId,
      key,
      responseJson,
      statusCode: res.status,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [idempotencyKeys.tenantId, idempotencyKeys.key],
      set: {
        responseJson,
        statusCode: res.status,
        expiresAt,
      },
    })
    .run();
}

/**
 * Retention sweep. Called by the existing cron in
 * `packages/runtime/src/register.ts` (the `retentionSweepFn`) so we
 * piggyback on its schedule rather than spinning up a new one. Returns
 * the row count purged for observability.
 */
export function sweepExpiredIdempotency(now = Date.now()): number {
  const result = getDb()
    .delete(idempotencyKeys)
    .where(lt(idempotencyKeys.expiresAt, new Date(now)))
    .run();
  // drizzle-better-sqlite returns `{ changes, lastInsertRowid }` for run();
  // `changes` is the rowcount we care about. Cast through unknown because
  // the typed surface advertises a more conservative shape.
  return (result as unknown as { changes: number }).changes ?? 0;
}
