import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { jwtVerify } from "jose";
import { apiTokens, getDb, tenants } from "@agentic/db";

export interface AuthedContext {
  tenantId: string;
  tenantSlug: string;
  via: "token" | "dev" | "cookie";
}

const COOKIE_NAME = "agentic_session";

/**
 * UC-V11-29 / PF-GAP-05 — read the session JWT signing secret. Accepts
 * both `AUTH_SESSION_SECRET` (the canonical api-side name per
 * `.env.example`) and `SESSION_SECRET` (what `apps/web/lib/auth/session.ts`
 * sets today). Returns null when neither is configured — production
 * callers refuse cookie auth in that case and fall through to bearer.
 */
function getSessionSecret(): Uint8Array | null {
  const raw =
    process.env.AUTH_SESSION_SECRET ?? process.env.SESSION_SECRET ?? "";
  if (!raw) return null;
  return new TextEncoder().encode(raw);
}

/**
 * Single-cookie reader. Avoids `@fastify/cookie` because we only need
 * one well-known key and adding the plugin would force a plugin-order
 * change. RFC 6265 syntax: `name=value; name=value; ...`.
 */
function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k !== name) continue;
    let v = part.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    return v;
  }
  return null;
}

/**
 * Verify a session JWT (HS256, per `apps/web/lib/auth/session.ts`) and
 * resolve to an `AuthedContext`. Returns null when the token is malformed,
 * signature invalid, expired, or references a tenant slug that no longer
 * exists in `tenants`. Caller falls through to bearer in any null case.
 */
async function authenticateCookie(
  jwt: string,
): Promise<AuthedContext | null> {
  const secret = getSessionSecret();
  if (!secret) return null;
  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(jwt, secret, { algorithms: ["HS256"] });
    payload = verified.payload as unknown as Record<string, unknown>;
  } catch {
    return null;
  }
  const tenantSlug =
    typeof payload.tenant === "string" ? payload.tenant : null;
  if (!tenantSlug) return null;
  const t = getDb()
    .select()
    .from(tenants)
    .where(eq(tenants.slug, tenantSlug))
    .all()[0];
  if (!t) return null;
  return { tenantId: t.id, tenantSlug: t.slug, via: "cookie" };
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthedContext;
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function devTenant(): AuthedContext | null {
  const slug = process.env.AGENTIC_DEV_TENANT ?? "raas";
  const t = getDb().select().from(tenants).where(eq(tenants.slug, slug)).all()[0];
  return t ? { tenantId: t.id, tenantSlug: t.slug, via: "dev" } : null;
}

/**
 * Resolve an authenticated context for `req`, or `null` if no credential
 * matched.
 *
 * Dev-tenant unlock requires the EXPLICIT opt-in `AUTH_MODE=dev`. The earlier
 * implementation also fell back to "any non-production NODE_ENV", which meant
 * a staging build deployed with `NODE_ENV=staging` would silently bypass
 * bearer auth and resolve every request to the seeded admin tenant. P0-AUTH-01.
 */
export async function authenticate(req: FastifyRequest): Promise<AuthedContext | null> {
  if (process.env.AUTH_MODE === "dev") {
    return devTenant();
  }

  // UC-V11-29 / PF-GAP-05 — cookie auth precedes bearer in prod. The
  // Next.js web app sets an HttpOnly `agentic_session` JWT after sign-in
  // (`apps/web/lib/auth/session.ts`); without this branch the browser
  // session is invisible to the api and every /v1 call from /portal
  // 401s. Bearer remains the path for CLI + machine clients.
  const cookieHeader = req.headers.cookie;
  const sessionJwt = readCookie(cookieHeader, COOKIE_NAME);
  if (sessionJwt) {
    const cookieCtx = await authenticateCookie(sessionJwt);
    if (cookieCtx) return cookieCtx;
    // Cookie present but invalid (rotated secret, expired, bogus tenant)
    // — fall through to bearer so a CLI request carrying a stale browser
    // cookie can still authenticate via its bearer token.
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const hash = hashToken(token);

  const db = getDb();
  const row = db
    .select({ id: apiTokens.id, tenantId: apiTokens.tenantId })
    .from(apiTokens)
    .where(eq(apiTokens.hash, hash))
    .all()[0];
  if (!row) return null;

  db.update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiTokens.id, row.id))
    .run();

  const tenant = db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, row.tenantId))
    .all()[0];
  if (!tenant) return null;

  return { tenantId: row.tenantId, tenantSlug: tenant.slug, via: "token" };
}

/**
 * Boot-time guard: fail fast on env-var combinations that would silently
 * bypass auth in production.
 *
 * Refuses to return on:
 *   - `AUTH_MODE=dev` + `NODE_ENV=production` (deploy-time misconfig — would
 *     authenticate every unauthenticated request as the seeded admin tenant).
 *   - `AUTH_MODE=dev` + `AGENTIC_DEV_TENANT` pointing at a slug that doesn't
 *     exist in `tenants` (a typo silently making every dev request `null`).
 *
 * A silent prod auth bypass is worse than downtime, so this throws rather
 * than warning. P5-TEN-01 / tc-53.
 */
export function assertAuthModeSafe(): void {
  if (process.env.AUTH_MODE !== "dev") return; // bearer-only path is always safe

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_MODE=dev is incompatible with NODE_ENV=production — the dev-tenant " +
        "unlock would bypass bearer auth and authenticate every unauthenticated " +
        "request as the seeded admin tenant. Unset AUTH_MODE for prod or run with " +
        "NODE_ENV=development.",
    );
  }

  const slug = process.env.AGENTIC_DEV_TENANT ?? "raas";
  const row = getDb()
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .all()[0];
  if (!row) {
    throw new Error(
      `AUTH_MODE=dev requires AGENTIC_DEV_TENANT to match an existing tenant slug; ` +
        `'${slug}' was not found. Seed the tenant (e.g. \`pnpm db:seed\`) or set ` +
        `AGENTIC_DEV_TENANT to an existing slug.`,
    );
  }
}

/**
 * Decorate every request with an `auth` context. Routes that need it can read
 * `req.auth`; routes that don't (like /health) ignore it. Bearer auth happens
 * automatically — only fail explicitly inside the route.
 *
 * Also runs `assertAuthModeSafe()` at plugin-register time so an unsafe env
 * combination crashes boot rather than silently shipping a prod auth bypass.
 */
export async function registerAuth(app: FastifyInstance) {
  assertAuthModeSafe();
  app.addHook("onRequest", async (req) => {
    req.auth = (await authenticate(req)) ?? undefined;
  });
}

/** Convenience: require auth or fail with 401. */
export function requireAuth(req: FastifyRequest): AuthedContext {
  if (!req.auth) {
    const err: Error & { statusCode?: number; code?: string } = new Error(
      "unauthorized",
    );
    err.statusCode = 401;
    err.code = "unauthorized";
    throw err;
  }
  return req.auth;
}
