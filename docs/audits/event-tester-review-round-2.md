# Round-2 Consolidated Review — Event Tester

**Reviewer:** Round-2 Consolidator
**Date:** 2026-05-20
**Inputs:** Round-1 reviews (AI Architect, Principal Engineer, AI Software Architect), consolidation memo, current code in `packages/runtime/src/register.ts`, `apps/api/src/routes/v1/events.ts`, `apps/api/src/queries/events.ts`, `packages/db/src/schema.ts`, migration `0013_confused_vertigo.sql`, `packages/contracts/src/events.ts`, `apps/api/test/event-tester.test.ts`, updated PRD / Design / Impl docs. Test run executed: **11/11 passing** under Node 26.1.0.

## TL;DR

**Ship.** All Round-1 blockers are fixed in code, the cross-tenant E2E test exists and the BFS load-helper genuinely prevents leakage, the audit fix correctly moves the trust signal off the body field, and the 11-test suite green. Two minor doc-vs-code drifts (operator role guard, `events.category` plumbing) should be cleaned up but are not ship-blocking.

## Verified fixes (Round-1 findings resolved)

1. **C1 — `__test` plumbed into manifest runtime.** `register.ts:95` reads `const isTest = data.__test === true;` *outside* the `step.run("init", …)` closure, then passes it into the `runs.insert(...).values({ ..., isTest, ... })` at line 138. Verified: the test `test:true adds __test to the inngest envelope; test:false omits it` asserts at the Inngest-send boundary (`first!.data.__test === true`, `second!.data.__test === undefined`). The route never injects `__test` when the caller didn't ask (events.ts:79–81), so production traffic can't accidentally flag itself. The agent-invoke back-fill path is left intact for the sync code-agent invoke and does not mask the manifest plumbing.

2. **C5 — Audit signal moved off the body field.** `events.ts:96` computes `auditedSource = parsed.source ?? "external"` and the audit fires on any non-`external` value. Crucially the **fields** logged are *keys only* (`Object.keys(parsed.payload ?? {})`) so PII never lands in `auditLog`. The `auth_via` field is recorded (`auth.via ?? null`), so a forensics pass can tell a real bearer-token publish from an `AUTH_MODE=dev` bypass. The test at lines 372–464 asserts both halves: `source:"operator"` writes one row; absent source writes zero (`expect(after).toBe(before2)`).

3. **`evt_tenant_received_idx` covering index.** `schema.ts:240-243` declares the index on `(tenantId, receivedAt)`; migration `0013_confused_vertigo.sql` ships exactly one `CREATE INDEX IF NOT EXISTS … (tenant_id, received_at)` statement. The comment in the migration explicitly calls out the pre-existing schema drift as a separate concern.

4. **Tenant scoping in `fetchCausality`.** Adversarial walkthrough: `loadEvent(id)` performs `WHERE events.id = id` then filters in JS via `row.tenantId !== tenantId → return null` (queries/events.ts:258). The child-event lookup at line 310 *only* feeds `nextFrontier` when `childEvent` is non-null. The runs query at line 289 has explicit `eq(runs.tenantId, tenantId)`. Test `causality lookup against a foreign event id returns an empty graph` proves the seed-load short-circuit. Cycle protection via `seenEventIds`/`seenRunIds` is present (lines 296, 309).

5. **Additive contracts.** `IngestEventBody` adds optional `test` + `source` only. `EventRow` is unchanged. `EventCatalogEntry`, `EventCatalogResponse`, `EventCausalityEdge`, `EventCausalityRun`, `EventRecentResponse` are new sibling shapes. Legacy `GET /v1/events` returns a bare array (test "legacy GET /v1/events shape is unchanged" pins this).

6. **Test coverage.** All 6 scenarios from Impl §2.4 land plus a real-socket SSE test (the 11th) that opens an HTTP listener and reads SSE frames over a live `fetch`. Suite runs 11/11 in ~1.5s.

## Concerns remaining

1. **Doc claims an `operator` role check; code has none. [medium]** Design §10 Rollout: "behind `operator` role check for the non-test publish." There is no `requireRole`-style guard in `events.ts` and no role-aware predicate in `plugins/auth.ts`. The consolidation memo doesn't flag this as a deferred item. Either delete the claim from §10 or open a follow-up ticket; right now the spec asserts a control that isn't implemented.

2. **`events.category` is never populated by the publish route, yet `EventRow.category` exists. [low]** The `POST /v1/events` insert omits `category` (events.ts:60-69); both `listRecentEvents` and `fetchEventsSince` select `events.category` (not `eventTypes.category`). Result: SSE rows have `category: null` even when the catalog declares one. Minor UX nit, not a security concern.

3. **`listRecentEvents` does NOT filter `deletedAt IS NULL`; `fetchEventsSince` DOES. [low]** Inconsistent visibility of soft-deleted events between the catch-up GET and the live SSE tail. Round-1 AI Architect open-question #4 ("policy on deleted events") is essentially still open.

4. **SSE cursor compensation is acceptable for v1 but duplicate-on-reconnect is real.** Reconnect within the 1s span re-emits whatever was inserted at `floor(T_publish)`. For an operator tool this is correct: a missed event is worse than a duplicate (the UI dedupes by `id` trivially). The recommendation to upgrade to a `(receivedAt, id)` tuple cursor remains valid for v1.1 — won't matter until a high-throughput tenant arrives.

## Sound deferrals

1. **In-process per-tenant EventEmitter dispatch.** Single-process today; the new covering index keeps the 250 ms poll cheap. The refactor pays three surfaces (this stream + `/v1/stream` + run-logs SSE) when it lands.

2. **Recursive CTE for causality.** Depth=3 × fanout=50 = 7,500 row reads worst case. SQLite can do this in a few ms; visited-set already guards cycles. Premature optimisation right now.

3. **`EventCausalityResponse` split from `EventRecentResponse`.** Sibling routes disambiguate. The current `optional` `edges`/`runs` reads cleanly and only the SPA consumes it. Splitting before a third consumer arrives is over-engineering.

4. **Manifest enum coercion server-side.** RAAS's actual types parse correctly client-side; abstraction without a second consumer is speculative.

5. **`payloadPreview` field.** Dropped from PRD; `payloadRef` is the canonical pointer. The SPA can read the full payload on demand.

6. **`__test` meta-channel separation.** Inngest envelope reshape would touch every producer. `runs.isTest` is the canonical downstream signal; documented as such in PRD FR-8.

## Iffy deferrals

1. **Tuple cursor for SSE.** The `Date.now() - 1000` compensation is defensible, but the docstring "duplicate on reconnect" understates it: the duplicate window is at *every* reconnect, not just rare ones. A live operator tab that flaps will repeatedly resend the last second's events. The client dedupe by `id` is trivial to add in the SPA — and the consolidation memo doesn't say it's been done. **Action:** confirm the SPA dedupes by `id` (or accept double-rendering on flap).

2. **Cycle-construction test.** The visited sets are clearly correct, but no test actively constructs a cycle and proves the BFS terminates. Round-1 Principal flagged this; deferred. A 10-line synthetic-fixture test would close the loop and is cheap.

## Docs ↔ code drift

I picked three claims at random from the Design spec and verified each against code:

1. **Design §4.5 Audit shape** — claims meta has `{ name, subject, test, source, auth_via, fields }`. Code at `events.ts:104-112` writes exactly that set, plus `fields` is `Object.keys(parsed.payload ?? {})` (names only). **Match.**

2. **Design §4.2 SSE cursor compensation** — claims `Date.now() - 1000` default to span the `unixepoch()` second boundary. `events.ts:251` is `cursor = Number.isFinite(sinceParam) ? sinceParam : Date.now() - 1000`. **Match.**

3. **Design §10 Rollout — "behind `operator` role check for the non-test publish"** — code has no role guard whatsoever. The auth plugin doesn't expose a role-check primitive. **Drift.** Either the spec lies or the work is silently deferred. The PRD risk row R-1 ("operator publishes a destructive event") implicitly leans on this gate.

## Final verdict

**ship.** The blockers are fixed, the tests are honest (the cross-tenant leak test actually goes through the BFS path; the audit test asserts no-PII), and the deferred items have defensible rationales. The two minor drifts (operator role guard, `events.category` plumbing) and the iffy duplicate-on-reconnect behaviour should be tracked as follow-ups but do not justify another round of revision.

The harness claim holds: a tenant with a fresh `events_v1.json` declaration gets a working Event Tester for free — no per-tenant code anywhere in this PR. Acceptance criterion §11 is met.

Recommended follow-up tickets:
- Either implement or remove the "operator role check" claim from Design §10.
- Populate `events.category` from the catalog on publish (one-line change in the insert).
- Decide policy on soft-deleted events for both `listRecentEvents` and `fetchEventsSince` consistently.
- Tuple cursor + cycle test land together in the next polish pass.
