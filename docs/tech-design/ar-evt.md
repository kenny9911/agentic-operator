# Tech Design — Event Ledger

**Module ID:** AR-EVT
**Owner:** AI Software Architect
**Status:** V1.1 design
**Source catalog:** `docs/catalog/02-ai-runtime-catalog.md` § 7 (AR-EVT-01..04)

## 1. Purpose

Events are the **connective tissue of the manifest workflow**. Every agent invocation is fired by an event and emits one or more events on completion (per `triggered_event[]`). The event ledger is the **durable replay surface** — a per-day NDJSON file that holds the full payload of every event the runtime ever processed, while the `events` SQLite row stores a `payload_ref` pointer (a `<filePath>#<byteOffset>` string) so the DB stays small. The catalog endpoints (`/v1/events/*`) are how operators inspect the topology, replay a run from its trigger, and watch live event flow via SSE. Webhooks let external systems land HMAC-verified events on the namespaced bus. The big V1.1 change is **removing the `WEBHOOK_HMAC_SECRET_DEFAULT` fallback** — every subscription must have its own secret (closing AR-GAP-18 / UC-V11-27).

## 2. V1 state (citable)

- **NDJSON ledger** (AR-EVT-01) — `data/logs/<tenant>/events/<YYYY-MM-DD>.ndjson` (`packages/runtime/src/event-ledger.ts:23-27`). Each line is `LedgerRecord { id, name, subject?, data, ts }` (lines 30-36). `appendToLedger()` returns a `payload_ref` string of the form `"<filePath>#<byteOffset>"`. The `events.payload_ref` DB column stores this pointer; reads dereference via stat+open+seek+line-read. Replays produce a **new** event id (via `makeId("evt")` post-P0-API-01) with `__replayOf: <originalId>` in the payload for causality.
- **Event namespacing** (AR-EVT-02) — every event on the Inngest bus is `${tenantSlug}/${eventName}`. The transformation happens at three boundaries:
  1. Inbound from operator (`POST /v1/events`) — route prepends auth tenant slug.
  2. Outbound from a manifest run — `register.ts:emitTriggeredEvent` prepends before `step.sendEvent`.
  3. Inbound webhook (`POST /v1/webhooks/:source`) — after HMAC verify, prepend the subscription's tenant slug.
- **Catalog endpoints** (AR-EVT-03) — all at `apps/api/src/routes/v1/events.ts`:
  - `POST /v1/events` — ingest. Validates `{name, data}`, looks up catalog row for category, INSERTs into `events`, appends to ledger, calls `inngest.send`. Supports `test:true` (sets `__test:true`; propagates to `runs.is_test`) and `source:"<freeform>"`.
  - `POST /v1/events/:id/replay` — clones payload, stamps `__replayOf`, returns `{replayed, new_event_id}`.
  - `GET /v1/events` — legacy list (kept for SPA compat).
  - `GET /v1/events/catalog` — tenant's `event_types` rows.
  - `GET /v1/events/recent` — list with optional `?causality=1&seed=<id>` envelope.
  - `GET /v1/events/stream` — SSE live tail (FR-5), 30s keepalive ping, per-tenant scoping.
  - `GET /v1/events/causality` — explicit causality DAG endpoint.
- **Webhook subscriptions** (AR-EVT-04) — `webhook_subscriptions` table (`packages/db/src/schema.ts:540-566`) with `(tenant_id, source, secret_encrypted, signing_algo, enabled)`. Unique index `webhook_sub_tenant_source_uq` is partial (`WHERE enabled=1`) so a tenant has many disabled rows but only one enabled per source. Route `POST /v1/webhooks/:source` at `apps/api/src/routes/v1/webhooks.ts:1-309` is **unauthenticated by bearer** — HMAC verification *is* the auth. The flow:
  1. Read `X-Webhook-Signature` and `X-Webhook-Timestamp` headers.
  2. Look up active subscription. **V1 falls back to `WEBHOOK_HMAC_SECRET_DEFAULT` env var when no row exists.**
  3. HMAC-SHA256(secret, timestamp + "." + body) in constant time (`crypto.timingSafeEqual`).
  4. Reject if timestamp >5 min off (replay window).
  5. Stamp event name `{source}.{type_from_payload}`, namespace with tenant, append to ledger, `inngest.send`.

## 3. V1.1 changes

### UC-V11-27 / AR-GAP-18 — Remove `WEBHOOK_HMAC_SECRET_DEFAULT` fallback
**Site:** `apps/api/src/routes/v1/webhooks.ts:1-309` (the resolution chain that today falls back to env). Settings → Integrations view at `/portal/[tenant]/settings/integrations` (the friendly-error surface).
**Bug:** The fallback to `WEBHOOK_HMAC_SECRET_DEFAULT` makes "ship a webhook subscription" frictionless but unsafe — every source uses the same default secret, which an attacker who reads the env file once can replay forever. The fallback was a V1 convenience that V1.1 removes.
**Fix:**
- **Server side.** Remove the env fallback from the webhook route. When no active `webhook_subscriptions` row exists for `(tenant, source)`, respond `404 { code: "subscription_not_found", message: "No active webhook subscription for source '<source>'. Configure one in Settings → Integrations.", hint: { settingsPath: "/portal/<tenant>/settings/integrations" } }`. The webhook source MUST be discoverable by tenant slug; today the route resolves tenant from the subscription row — V1.1 changes this to require a tenant hint in the path or header (see "Path change" below).
- **Path change (decision).** The current path `POST /v1/webhooks/:source` has no tenant in the URL — the subscription row is the de-facto tenant binding. With the fallback removed, an attacker who guesses a source name has nothing to send to. But for clarity and to make the multi-tenant case explicit, **add a tenant-scoped variant** `POST /v1/webhooks/:tenantSlug/:source` and keep the legacy `POST /v1/webhooks/:source` for backward compat (returns 404 when no subscription exists for any tenant, otherwise resolves to the single match).
- **UI side.** Add a "Webhook secret" field to Settings → Integrations → New subscription. On creation, the server generates a 32-byte random secret, encrypts it into the BYOK vault using the same machinery as provider keys (`apps/api/src/services/provider-keys.ts` shared crypto helpers), and **returns the plaintext once** in the response. The UI shows a "Reveal once" pattern matching token rotation (NFR-SEC-2).
- **Migration.** V1 tenants relying on the env default need to rotate. Provide a one-time migration script that, for every `enabled=1` subscription with `secret_encrypted IS NULL`, generates a fresh secret, encrypts it, writes the row, and logs the plaintext to stderr (the operator captures it once). After migration runs, the env var can be removed from `.env` and `.env.production`.

**New types:**
```ts
// packages/contracts/src/webhooks.ts
export const WebhookSubscriptionCreateBody = z.object({
  source: z.string().min(1).max(64),
  signingAlgo: z.literal("hmac-sha256").default("hmac-sha256"),
  enabled: z.boolean().default(true),
});
export const WebhookSubscriptionCreateResponse = z.object({
  id: z.string(),
  source: z.string(),
  secret: z.string(),     // plaintext — returned ONCE
  hint: z.literal("Save this secret — it cannot be retrieved later."),
});
```

**Tests:**
- `tc-webhook-no-fallback.test.ts` (new) — POST to `/v1/webhooks/:tenant/:source` with no matching subscription → 404 with `subscription_not_found`.
- `tc-webhook-create-secret-reveal.test.ts` (new) — POST to create subscription → response carries plaintext `secret` ONCE; subsequent GET masks it.
- `tc-webhook-migrate-defaults.test.ts` (new) — seed a subscription with NULL secret + `WEBHOOK_HMAC_SECRET_DEFAULT=xyz`; run migration; assert row now has encrypted secret, env can be removed.
- `tc-webhook-hmac.test.ts` (existing) — HMAC verify + 5-min replay window + timing-safe compare.
- `tc-webhook-source-namespacing.test.ts` (existing) — event arrives namespaced `${tenantSlug}/${source}.${type}`.

### V1.1-coupled: causality DAG endpoint productionization
**Site:** `packages/runtime/src/broadcast.ts` (the DAG computer) + `apps/api/src/routes/v1/events.ts` (`GET /v1/events/causality`).
**Issue:** `GET /v1/events/causality?seed=<id>` returns the DAG today (Phase 3 split from `/v1/events/recent`) but performance characteristics are not tested at scale. The DAG walk uses `correlation_id + __replayOf + __triggerEventId` chains.
**Fix:** Add an index on `events(correlation_id)` so the DAG walk is O(log N) per hop. Today the walk does a full table scan per hop in worst case. Add a depth limit (default 50) to prevent runaway walks; surface `{ truncated: true, depth: 50 }` in the response when hit.
**Tests:** `tc-events-causality-depth.test.ts` — synthesize a 100-hop causality chain, assert response is truncated at default depth.

### Replay event id collision (already shipped, document the discipline)
**Site:** `apps/api/src/routes/v1/events.ts` (the `POST /v1/events/:id/replay` handler).
**Doc only:** Document in this design that **`makeId("evt")` is the source of truth for replay ids** (P0-API-01 closed the same-millisecond-collision bug from the legacy `${id}-replay-${Date.now()}` pattern). Any future work that emits events programmatically must use `makeId`, never `Date.now()`-suffixed ids.

## 4. Interfaces (the contract)

**Ledger record (`packages/runtime/src/event-ledger.ts:30-36`):**
```ts
export interface LedgerRecord {
  id: string;        // `evt-...` from makeId("evt")
  name: string;       // un-namespaced (e.g. "RESUME_PROCESSED")
  subject?: string;
  data: unknown;
  ts: number;         // unix-ms
}
export async function appendToLedger(
  tenantSlug: string,
  rec: LedgerRecord,
): Promise<string>;   // returns "data/logs/<tenant>/events/<date>.ndjson#<byteOffset>"
```

**REST shapes (Zod in `packages/contracts/src/events.ts`):**
- `POST /v1/events` body `EventIngestBody = { name: string, data?: unknown, subject?: string, test?: boolean, source?: string }` → `200 { event: Event, queued: true }`.
- `POST /v1/events/:id/replay` → `200 { replayed: <originalId>, new_event_id: <newId> }`.
- `GET /v1/events/recent?since=&limit=&causality=&seed=` → `200 { events: Event[], dag?: { nodes, edges } }`.
- `GET /v1/events/stream` → `text/event-stream` with `EventStreamEvent` payloads.
- `GET /v1/events/causality?seed=<evtId>&depth=<n>` → `200 { dag: { nodes, edges }, truncated: boolean, depth: number }`.
- `GET /v1/events/catalog` → `200 EventType[]` (`event_types` rows).

**Webhook shapes (V1.1):**
- `POST /v1/webhooks/:tenantSlug/:source` (V1.1) — body is raw bytes; headers `X-Webhook-Signature`, `X-Webhook-Timestamp`. Returns `202 { ingested: true, eventId }` or `404 { code: "subscription_not_found", ... }` or `401 { code: "invalid_signature" }` or `400 { code: "replay_window_exceeded" }`.
- `POST /v1/webhooks/subscriptions` (Settings → Integrations create) — body `WebhookSubscriptionCreateBody` → `WebhookSubscriptionCreateResponse` (secret revealed once).
- `GET /v1/webhooks/subscriptions` — masked metadata.
- `POST /v1/webhooks/subscriptions/:id/rotate` — rotate secret, return plaintext once.
- `DELETE /v1/webhooks/subscriptions/:id` — disable (sets `enabled=0`, frees the unique-index slot).

## 5. Data flow

Operator-published event:

```
operator: POST /v1/events { name: "REQUIREMENT_LOGGED", data: {...}, subject: "REQ-2041", test: true }
                |
                v
   route validates body, looks up event_types row for category
                |
                v
   INSERT events(id=evt-AB12, tenant_id=ten-x, name=REQUIREMENT_LOGGED, payload_ref=null)
                |
                v
   appendToLedger(tenantSlug, { id:evt-AB12, name:..., subject:..., data:..., ts:Date.now() })
                |
                v
   payloadRef = "data/logs/raas/events/2026-05-21.ndjson#1234"
   UPDATE events SET payload_ref = ? WHERE id = ?
                |
                v
   inngest.send({ name: "raas/REQUIREMENT_LOGGED", data: { ..., __triggerEventId:evt-AB12, __test:true } })
                |
                v
   downstream Inngest function fires (AR-INN-01)


Webhook ingestion (V1.1 - tenant-scoped path):

external: POST /v1/webhooks/raas/slack { raw body }
   headers: X-Webhook-Signature: <hex>, X-Webhook-Timestamp: <unix-s>
                |
                v
   SELECT * FROM webhook_subscriptions WHERE tenant_id=? AND source='slack' AND enabled=1
                |
                +-- not found  ->  404 subscription_not_found  (V1.1; was: fall back to env)
                |
                +-- found
                v
   decrypt secret_encrypted via vault (AES-256-GCM)
                |
                v
   verify HMAC-SHA256(secret, timestamp + "." + body) === signature  (timing-safe)
   verify abs(now - timestamp) <= 300s
                |
                +-- fail -> 401 invalid_signature or 400 replay_window_exceeded
                |
                +-- pass
                v
   parse body to get type; eventName = "slack." + type
                |
                v
   INSERT events + appendToLedger + inngest.send (same as operator path)


Replay:

POST /v1/events/evt-AB12/replay
                |
                v
   SELECT * FROM events WHERE id='evt-AB12'
                |
                v
   read original payload from payload_ref
                |
                v
   newId = makeId("evt"); newPayload = { ...original, __replayOf: 'evt-AB12' }
                |
                v
   INSERT events(id=newId, ...) + appendToLedger + inngest.send
                |
                v
   return { replayed: 'evt-AB12', new_event_id: newId }
```

## 6. Failure modes

| Failure | What happens | Recovery |
|---|---|---|
| Ledger file write fails (disk full) | `appendToLedger` throws; route returns 500 | Operator clears disk; the `events` INSERT rolled back via tx; safe to retry |
| `payload_ref` stale (NDJSON file deleted by retention) | Read returns null/error; `GET /v1/events/recent` shows event but cannot expand payload | Operator widens `EVENT_RETENTION_DAYS`; old events purged are accepted as cost of retention |
| Inngest dev server down | `inngest.send` no-ops in tests / queues in dev; downstream agent never fires | Bring Inngest back up; replay via `/v1/events/:id/replay` |
| Webhook signature mismatch | 401 `invalid_signature`; no event ingested | External system fixes signing; subscription secret rotation available |
| Webhook timestamp >5 min off | 400 `replay_window_exceeded` | Clocks sync (NTP); attacker replay attempt blocked |
| Webhook no subscription (V1.1) | 404 `subscription_not_found` with hint to Settings → Integrations | Operator creates subscription |
| Replay of an already-replayed event | New ledger row + new event id; `__replayOf` chain extends | None — chains are intentional, replay-of-replay is allowed |
| Causality DAG depth >50 | Response truncated with `{ truncated: true, depth: 50 }` | Caller passes `?depth=<higher>` if needed; UI surfaces "Show more" |
| Event name collision across tenants | Namespacing prevents — Inngest function `raas.analyzeRequirement` vs `acme.analyzeRequirement` | None needed |

## 7. V2 roadmap

- **Per-tenant event TTL config.** Today `EVENT_RETENTION_DAYS` is process-wide. V2 stores per-tenant in `tenants.config_json.event_retention_days` so a regulated tenant can keep 7 years while a dev tenant keeps 7 days.
- **Live causality DAG in the SSE stream.** Today `GET /v1/events/stream` emits per-event. V2 emits incremental DAG deltas so the Event Tester DAG view doesn't re-fetch on every tick.
- **Webhook source allow-list per tenant.** Today any non-empty `source` is accepted as long as a subscription exists. V2 ticket: pre-register source names in `webhook_subscriptions` and reject unknown `:source` path params with a clear error.
- **Schema validation on inbound event payloads.** Today `POST /v1/events` validates `(name, data)` shape but does NOT validate `data` against the registered `event_types.schema`. V2 adds opt-in validation per tenant.

## 8. Acceptance tests

- `tc-webhook-no-fallback.test.ts` — UC-V11-27 server-side fallback removed.
- `tc-webhook-create-secret-reveal.test.ts` — UC-V11-27 secret revealed once.
- `tc-webhook-migrate-defaults.test.ts` — UC-V11-27 migration script runs.
- `tc-events-causality-depth.test.ts` — depth-limit truncation.
- `tc-21-operator-publish.test.ts` (existing) — ingest path writes ledger entry + Inngest send.
- `tc-21-replay.test.ts` (existing) — replay creates new id + `__replayOf` stamp.
- `tc-event-stream.test.ts` (existing) — SSE 30s keepalive + per-tenant scoping.
- `tc-event-causality.test.ts` (existing) — DAG via correlation_id chain.
- `tc-event-ledger.test.ts` (existing) — `payload_ref` round-trip, multi-line append, byte-offset correctness.
- `tc-event-namespacing.test.ts` (existing) — two tenants with same event name don't collide.
- `tc-webhook-hmac.test.ts` (existing) — HMAC verify + replay window + timing-safe.

Coverage gates: every UC-V11-* listed has a paired failing-then-passing test per the TDD mandate in `docs/USE_CASES.md` § 6.
