# Round-3 Final Sanity Review — Event Tester

**Reviewer:** Round-3 Sanity Pass
**Date:** 2026-05-20
**Inputs:** [R2 review](event-tester-review-round-2.md), [R1 consolidation](event-tester-review-consolidation.md), current code in `apps/api/src/routes/v1/events.ts`, `apps/api/src/queries/runs.ts`, `apps/api/src/queries/events.ts`, `apps/web/public/portal/views/event-tester.jsx`, `docs/design/event-tester.md`. Test run: **11/11 passing** under Node 26.1.0 in ~1.81s.

## TL;DR

**Ship.** All three R2 follow-ups are cleanly addressed in code, the doc-vs-code drift on the operator role check has also been resolved by an honest Design §10 rewrite, and the 11-test suite remains green.

## Verification

| Item | Status | Where verified |
|---|---|---|
| `events.category` on publish | OK | `apps/api/src/routes/v1/events.ts:66-75` (lookup) → `:82` (`category: catalogRow?.category ?? null` in insert) |
| Soft-delete consistency | OK | `apps/api/src/queries/runs.ts:218` (`isNull(events.deletedAt)` in `whereParts`); mirrors `apps/api/src/queries/events.ts:164` |
| Client SSE dedupe by `id` | OK | `apps/web/public/portal/views/event-tester.jsx:207-211` (`prev.some((r) => r.id === row.id)` short-circuits the `setRecent` updater) |
| 11/11 tests passing | OK | `vitest run test/event-tester.test.ts` → `Test Files 1 passed (1) / Tests 11 passed (11)` in 1.81s |

Implementation quality is consistent with the R2 fixes. The `events.category` change reuses the existing `eventTypes` import and a `.all()[0]` lookup — idiomatic with the rest of `events.ts`. The soft-delete filter is added inline to the `whereParts` array with a comment cross-referencing `fetchEventsSince` so the next maintainer can't accidentally drift them apart again. The SPA dedupe is a four-line addition inside the existing `setRecent` updater — minimally invasive, and the `prev.some(...)` scan over a ≤100-row buffer is O(100) per frame which is fine for an operator tool.

## Remaining concerns

None blocking. One was-blocking-now-resolved item worth calling out: the R2 review flagged Design §10 claiming an `operator` role guard that didn't exist in code. **Resolved by doc edit** (Design §10 line 322): the doc now explicitly states "A role-based guard for non-test publishes is desirable but **not implemented in v1** — the harness has no `requireRole` primitive yet" with the rationale and a forward pointer to post-Event-Tester RBAC work. This is the right resolution given `isPlatformAdmin()` is stubbed in the harness.

The consolidation memo at `docs/audits/event-tester-review-consolidation.md` remains accurate — every item it claims as "fixed" is still fixed in code, every "deferred" item is still deferred with the same rationale. The R2-flagged operator-role drift would justify a one-line update to the memo, but it's not load-bearing.

## Roadmap-grade items (not blocking)

These all remain explicitly deferred (per R1/R2) with defensible rationale, just listing them so we don't lose track:

1. Tuple `(receivedAt, id)` cursor for SSE — duplicate-on-reconnect now harmless thanks to the client dedupe just landed; matters more when a high-throughput tenant arrives.
2. Explicit cycle-construction test for the causality BFS — visited-set protection is present, just no test that *constructs* a cycle. ~10 lines whenever someone touches that file next.
3. In-process per-tenant `EventEmitter` SSE dispatch — covering index keeps the 250ms poll cheap for now.
4. Real RBAC + `requireRole` primitive — needed before the §10 "non-test publishes behind operator role" idea can land.
5. Recursive CTE for causality — premature until depth or fanout grows past current limits.

## Final verdict

**ship.**

The feature is complete: backend insert stamps `category` from the catalog, both `listRecentEvents` and `fetchEventsSince` exclude soft-deleted rows, the SPA dedupes SSE frames by `id` so reconnect-within-1s no longer double-renders, and the test suite confirms no regression. The harness claim still holds — a tenant with a fresh `events_v1.json` declaration gets a working Event Tester for free.
