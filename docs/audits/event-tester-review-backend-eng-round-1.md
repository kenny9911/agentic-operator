# Principal Full-stack Engineer Review — Event Tester Backend (Round 1)

## TL;DR
The design is largely sound and additive, but it ships with one **load-bearing bug** (`__test` propagation does not exist in the manifest runtime; the spec asserts otherwise) and two **non-trivial correctness issues** (the SSE poll cursor will skip same-ms inserts; the events index does not cover the proposed poll query). Net: this is **not ready to merge as written**, but the fixes are small and local. Verdict: **needs-revision**.

## Pre-implementation BLOCKERS

1. **`__test` is NOT propagated to `runs.isTest` in the manifest path.** I read `packages/runtime/src/register.ts` end-to-end. The `init` `step.run` block (lines 93–140) writes `runs` with `triggerEventId`, `correlationId`, `subject`, `status` — but it never reads `event.data.__test` and never sets `isTest`. The design says "Downstream agents and the run engine treat `__test` as `runs.isTest = true` (already supported per schema)" — this is wrong. Only `apps/api/src/routes/v1/agent-invoke.ts:111-133` honors `testRun`, and only for the sync BaseAgent path. **Fix before coding:** add `const isTest = data.__test === true;` in the `init` step and persist it. Without this, FR-8 / NFR-7 / success-metric "5–20% test runs" are all dead on arrival. The implementer should not write the test in §2.4 ("honors test flag → runs.isTest") until this is patched.

2. **SSE cursor scheme will drop events on same-ms inserts.** `cursor = max(cursor, receivedAt + 1)` (impl §2.3) advances the cursor past `receivedAt` after delivery. If row B is inserted at the *same* `receivedAt` as row A but committed during the next tick, the `> cursor` predicate skips B forever. The schema default `(unixepoch() * 1000)` collides easily on a busy tenant. **Fix:** make the cursor `(receivedAt, id)` and order by `(receivedAt, id)`. Use `WHERE (received_at > ? OR (received_at = ? AND id > ?))` with the last `(ts, id)` seen. This is the same pattern Inngest uses and `runs-logs.ts` sidesteps it only because it watches a file rather than a table.

3. **`events` index does not cover the poll query.** The schema defines `evt_tenant_name_received_idx(tenantId, name, receivedAt)`. The SSE poll without a `names` filter is `WHERE tenantId = ? AND receivedAt > ? ORDER BY receivedAt`. Index prefix `(tenantId, name, …)` cannot serve a range on `receivedAt` without also constraining `name` — SQLite will fall back to a tenant-wide scan + sort. On 100k events, a 250ms-cadence poll across 5 connections = ~1200 scans/min. **Fix:** add `idx_evt_tenant_received(tenantId, receivedAt)` (covering index also including `id` would let it be a covering index). Migration is one line; the design's "no migrations" claim must be retracted.

4. **Causality query has no cycle protection and unbounded fanout.** Spec says "depth=3 + per-event fanout cap of 50 ⇒ 7,500 row reads." Two problems: (a) **cycles exist** — a run can re-emit an event of the same name that triggers itself on a different subject; the BFS will revisit nodes. (b) The BFS as described is a sequence of round-trips (2 per depth level: events→runs, runs→events), N+1 by depth level. **Fix:** track a `visited: Set<string>` keyed by node id, hard-cap total nodes at e.g. 500, and use a recursive CTE (`WITH RECURSIVE causality(...) AS …`) so the whole walk is one SQLite call. SQLite supports recursive CTEs cleanly and they will be 10–50× faster than the round-trip approach.

## Implementation NOTES (advisory)

1. **`source` default is back-compat fragile.** The contract makes `source` optional and the design says "default `external` for back-compat." But §2.3 conditionally writes the audit row only when `source === "operator"`. An external caller that omits `source` won't audit — fine — but an *internal* call that omits `source` also won't audit, which is silently insecure. **Recommend:** default to `external`, and audit any non-`external` value. The SPA must set `source: "operator"` explicitly.

2. **`source: "operator"` from a `via: "dev"` auth context.** When `AUTH_MODE=dev`, the SPA is unauthenticated yet posts `source: "operator"` and writes audit rows that *look* like a real operator action. The audit meta should include `auth_via: auth.via` (`"token"` | `"dev"`) so post-hoc forensics can distinguish dev-bypass writes. Otherwise a prod-incident review chasing an "operator publish" finds the dev tenant.

3. **`actorUserId` is always null.** `requireAuth()` returns `{ tenantId, tenantSlug, via }` — no user id. The audit row has no actor. This is a pre-existing gap (the replay route has the same problem), but it's worth calling out: the audit table can prove *what tenant* published, never *who*. Either drop the actor field from the spec's success criteria, or wire bearer-token-to-user resolution.

4. **`z.unknown()` for `raw_payload_schema` will round-trip fine on the wire** (it accepts anything) but **breaks no-input validation on the client**. The web SPA uses `apps/web/lib/api-client.ts` to parse responses with the same Zod schemas. `z.unknown().nullable()` parses to `unknown`, which TypeScript will not let you index without a narrow. Recommend `z.record(z.string(), z.unknown()).nullable()` or a structural `z.object({ event_data: z.array(...).optional(), …}).passthrough().nullable()`.

5. **`EventCausalityEdge` discriminator (`triggered_run` | `emitted_event`) will not extend cleanly** to future kinds like `task_created` or `subflow_parent`. The shape is fine for v1, but make the enum a `z.string()` with a doc comment that v1 only emits the two values; future additions don't break parsers.

## Code-level concerns

**Query correctness**
- `listRecentEvents` (existing) does a `leftJoin(eventTypes)` only on `(tenantId, name)` — both tables carry `tenantId`, so the join cannot cross tenants. The `agents` leftJoin (`eq(agents.id, events.sourceAgentId)`) is NOT tenant-filtered — but `agents.id` is a per-row PK and the `sourceAgentId` was written by the runtime under the same tenant, so this is safe by data-construction, not by query. Still, add `and(eq(agents.id, events.sourceAgentId), eq(agents.workflowId, …))` or a defensive `eq(...tenantId)` if `agents` ever grows a `tenantId` column. (Today, `agents` has no `tenant_id` column — it carries tenancy transitively via `workflow_id → workflows.tenant_id`. The implementer must NOT assume `agents.tenantId` exists.)
- The catalog query `SELECT … FROM eventTypes WHERE tenantId = ?` is safe and the unique PK is `(tenantId, name)` — fast.
- The proposed `fetchCausality` BFS must filter `runs.tenantId = ?` AND `events.tenantId = ?` on **every** hop, not just the seed lookup. Easy to forget mid-recursion.

**Tenant safety**
- `events.tenantId` is the source of truth; the design correctly derives it from `req.auth`. Verified.
- Tenant-cross failure mode: if the SSE `?names=` query is honored without checking that the named event exists in *this* tenant's catalog, an attacker probing tenant A could enumerate event names that exist in tenant B by timing the poll latency. Low severity; recommend filtering `names` against `eventTypes` for the auth'd tenant before applying.

**Resource exhaustion / load**
- "Max 5 concurrent SSE per tenant" is mentioned but the enforcement mechanism is absent. An in-memory `Map<tenantId, Set<connectionId>>` works in single-process dev, **does not work** across a clustered deploy. For v1-on-SQLite this is fine; flag it as a known limit when (if) we move to multi-process.
- Cleanup path on stuck connection: `req.raw.on("close", …)` (impl §2.3) covers happy-path. It does *not* fire if the connection silently half-closes (the LB drops without RST). Recommend a per-connection liveness check: every 5 ticks, if the last heartbeat write throws `EPIPE`, force-close. The reference impl in `runs-logs.ts` is file-watched and short-lived, so this pattern is new.
- Audit row volume at 1k publishes/min would add 1.44M rows/day per tenant. The `audit_tenant_at_idx(tenantId, at)` keeps reads cheap, but writes still cost a B-tree update. Make `writeAudit` best-effort (`try/catch`) — it already is in the replay route. Don't block the response on audit.

**Error handling**
- `reply.ok` / `reply.fail` exist (verified in `apps/api/src/plugins/error.ts:13-37`). The error handler also catches `ZodError` and returns a clean `invalid_input` envelope. Implementer should rely on Zod-throw + the global handler, not try/catch parses by hand.

## Test gaps

The 6 tests in impl §2.4 miss:
1. **Pagination of catalog** — a tenant with 200 event types should not OOM.
2. **Malformed payload** (non-object, oversize) — current `IngestEventBody.payload` is `z.record(…)`; a number or array body should 400, verify.
3. **Cross-tenant SSE attempt** — token from tenant A subscribes to stream; assert it sees zero of tenant B's events even if B publishes at high rate.
4. **SSE reconnection with `since=` cursor** — drop the connection at t=1s, reconnect with `since=t-500`, assert no events lost and none duplicated. This is where the cursor bug (BLOCKER #2) will surface.
5. **Replay still works post-changes** — `POST /v1/events/:id/replay` must still write a `runs` row tagged `__replayOf`. The contract additions touch the replay path indirectly through `IngestEventBody` (it doesn't, but the test guards regressions).
6. **Causality cycle detection** — construct a self-emitting agent (or fixture data), assert BFS terminates and reports `{ truncated: true }` rather than hanging.
7. **Backwards compat** — POST with **no** `test` / `source` fields, assert response shape and behavior is byte-identical to pre-change.

## Migration / deploy

- The design claims "no migrations" — **incorrect** given BLOCKER #3 (covering index). Add `idx_evt_tenant_received` via drizzle generate. One-line migration.
- No rollback risk for the additive routes. The `IngestEventBody` extension is additive (new optional fields) — existing clients omit them and the parser still accepts the body. Verified by reading the existing `IngestEventBody` (3 fields; new shape is 5 fields, both new optional).
- The audit-row volume change means the existing `data/audit/<date>.log` file rotation strategy (if any) needs review. I did not see a rotation hook for `auditLog`; it's a DB table only.

## Verdict

**needs-revision.** Three blockers (`__test` propagation; SSE cursor; index coverage) are required pre-implementation. The remaining items are tractable during coding. Once those three land — plus the recursive-CTE rewrite of the causality query — the rest of the design is well-scoped and the contract additions are clean.
