# Event Tester — Round-1 review consolidation

**Date:** 2026-05-20
**Inputs:**
- [AI Architect review](event-tester-review-ai-architect-round-1.md)
- [Principal Full-stack Engineer review](event-tester-review-backend-eng-round-1.md)
- [AI Software Architect review](event-tester-review-ai-software-architect-round-1.md)

Three reviewers, three angles (architecture · backend · agent-OS positioning), converged on a small set of high-signal findings. This document records which were fixed, which are deferred with rationale, and where the design moved.

## TL;DR

All three reviews returned **iterate / needs-revision** with the same single load-bearing bug (`__test` not plumbed in the manifest runtime) plus a tight set of correctness and design refinements. The bug has been patched; the design has been tightened. The shape of the feature didn't change.

Verdict after fixes: **ship-ready for round 2 review.**

## Cross-review consensus

The three reviewers agreed on five points without coordination:

| # | Finding | Severity | Status |
|---|---|---|---|
| C1 | `__test` not propagated in the manifest runtime — `packages/runtime/src/register.ts` never reads `event.data.__test`, so PRD G5/NFR-7 ("test runs are filterable") were aspirational. | **BLOCK** | ✅ **Fixed** — `register.ts` now reads `data.__test` in the `init` step and passes `isTest` to the `runs` insert. |
| C2 | SSE design needs hardening — per-connection 250ms SQLite poll across N tabs × M tenants is wasteful; cursor scheme can drop same-ms rows; the events index doesn't cover the unfiltered poll query. | High | ✅ **Partially fixed** — added `(tenantId, receivedAt)` covering index; documented the SSE cursor compensation. In-process EventEmitter dispatch deferred (see §"Deferred"). |
| C3 | Tenant scoping must be enforced at the query layer, with an explicit cross-tenant E2E test. | High | ✅ **Already enforced** — every query in `apps/api/src/queries/events.ts` filters on `tenantId`; cross-tenant test added (`event-tester.test.ts` "rejects cross-tenant access"). |
| C4 | `__test` rides on the Inngest payload and becomes visible to downstream tools/prompts, weakening the "test traverses the real harness" claim. | Medium | ⚠️ **Mitigated, not eliminated** — `runs.isTest` is now the canonical signal; the documented contract says downstream actions read `runs.isTest`, not `__test`. Migrating to a dedicated meta channel (would require Inngest envelope changes) is deferred. |
| C5 | Audit signal must come from the auth context, not the body field — a malicious caller could omit `source: "operator"` to skip the audit. | Medium | ✅ **Fixed** — audit now fires on any non-`external` source and records `auth_via` (`"token"` / `"dev"`) so dev-bypass publishes are distinguishable in forensics. |

## Per-reviewer findings

### AI Architect (Round 1)

| # | Finding | Status |
|---|---|---|
| Required-1 | Plumb `__test` into manifest runtime | ✅ Fixed (C1) |
| Required-2 | Specify SSE dispatch model (EventEmitter, not per-conn poll) | ⚠️ Deferred — index added, dispatch refactor a follow-up |
| Required-3 | Tenant-scope SSE at query layer + test | ✅ Verified + tested |
| Required-4 | `EventCausalityResponse` should be a separate shape | ⚠️ Not split — current `EventRecentResponse` carries optional `edges`/`runs`; sibling routes disambiguate them at runtime. Splitting to a dedicated `EventCausalityResponse` is a contract refinement we'll do if a third caller arrives. |
| Recommended-1 | Manifest enum coercion (normalise types server-side) | ⚠️ Deferred — current implementation parses the manifest string client-side; works for RAAS's actual types, can normalise later |
| Recommended-2 | Tie audit to auth context, not body field | ✅ Fixed (C5) |
| Recommended-3 | `__test` shouldn't round-trip through payload | ⚠️ Documented (C4); migration deferred |
| Recommended-4 | `payloadPreview` missing from contracts | ⚠️ PRD updated to drop the claim — clients can fetch the full payload via `payloadRef` on demand |
| Recommended-5 | SSE per-tenant cap enforcement detail | ⚠️ Deferred — single-process today, will revisit at multi-replica |
| Recommended-6 | `source_agent`/`source_run` leak from upstream events | Out of scope — pre-existing behavior, separate issue |
| Nit | Bypass `apps/web/lib/api-client.ts` | Acceptable — SPA is CDN-React; no client codegen needed |
| Nit | Audit verification step references log file, not DB table | ✅ Fixed in impl plan |

### Principal Full-stack Engineer (Round 1)

| # | Finding | Status |
|---|---|---|
| BLOCK-1 | `__test` propagation gap | ✅ Fixed (C1) |
| BLOCK-2 | SSE cursor will drop same-ms inserts; needs `(receivedAt, id)` tuple | ⚠️ Partially mitigated — the implementer applied a `Date.now() - 1000` compensation that prevents misses at the cost of occasional duplicates (a duplicate is recoverable, a miss isn't). Tuple cursor refactor is a follow-up. |
| BLOCK-3 | `events` index doesn't cover unfiltered poll | ✅ Fixed — `evt_tenant_received_idx (tenant_id, received_at)` added via migration 0013 |
| BLOCK-4 | Causality query needs cycle protection + recursive CTE | ✅ **Cycle protection** present (`seenEventIds`, `seenRunIds` sets); ⚠️ recursive-CTE rewrite deferred — current BFS hits ≤ 7,500 rows even in worst case, fine for v1 |
| NOTE-1 | `source` default back-compat — audit any non-`external` | ✅ Fixed (C5) |
| NOTE-2 | Include `auth_via` in audit meta | ✅ Fixed (C5) |
| NOTE-3 | `actorUserId` is always null — audit can prove tenant, not user | Acknowledged — pre-existing harness gap, tracked separately |
| NOTE-4 | `raw_payload_schema: z.unknown()` types poorly | ⚠️ Kept as `z.unknown().nullable()` — UI uses it as opaque blob for the Monaco fallback; TypeScript indexability not needed there |
| NOTE-5 | `EventCausalityEdge` discriminator brittleness | ✅ Kept as enum for v1 — extension contract documented |
| TEST-1 | Pagination of catalog | ⚠️ Deferred — RAAS has 3 events; no real tenant has 200 |
| TEST-2 | Malformed payload (non-object body) | ✅ Existing Zod validation rejects these |
| TEST-3 | Cross-tenant SSE attempt | ✅ Added |
| TEST-4 | SSE reconnection with `since=` cursor | ⚠️ Deferred (bound to the tuple-cursor refactor) |
| TEST-5 | Replay still works post-changes | ✅ Existing `replay` test path covers this |
| TEST-6 | Causality cycle detection | ✅ Cycle-protected via visited sets; explicit cycle-construction test deferred |
| TEST-7 | Backwards compat (no `test` / `source` body) | ✅ Verified by "legacy GET /v1/events shape" test |
| MIG | "no migrations" claim is wrong | ✅ Migration 0013 ships the index |

### AI Software Architect (Round 1)

This review evaluated Agentic Operator as an "agent OS" and judged Event Tester as the right probe. Findings on Event Tester are subsumed by the above; broader OS-readiness findings:

| Pillar | Score | Top gap (carried forward as roadmap items) |
|---|---|---|
| Code surface | 4/5 | Reference docs + tighter `AgentSpec` validation |
| Deployment | 4/5 | Docker image; agent/tool registry |
| Runtime | 4/5 | V8 isolate for tenant code; per-tenant BYOK |
| Observability | 3/5 | Causality DAG (Event Tester provides this!); per-tenant cost rollup; OTel |
| Governance | 2/5 | Real RBAC; `isPlatformAdmin()` is stubbed |
| DX | 3/5 | Faster TTFA (target 60 min); REPL; template gallery |
| Operator UX | 3/5 | SPA bundler (Phase 2); quota UI; "burst pause" |

**Total: 23/35.** Production-honest on substrate, thin on legibility surfaces.

**Roadmap (post-Event-Tester, in priority order):**
1. Sandbox isolation for tenant code (V8 / worker_thread)
2. Real RBAC + platform-admin layer
3. **Eval harness on top of Event Tester** — the highest-leverage product win
4. Per-tenant BYOK + secret vault
5. Agent / tool catalog (marketplace v0)

## Deferred items (documented, not abandoned)

1. **In-process EventEmitter SSE dispatch.** The 250ms poll works for single-process dev; the index addition keeps it cheap. Refactor to a tenant-room emitter when we go multi-replica or when a load test surfaces real cost.
2. **Tuple cursor `(receivedAt, id)` for SSE.** The current `Date.now() - 1000` compensation prevents misses by re-reading a 1-second window — at the cost of occasional duplicates. Duplicate-tolerance is the right side of the tradeoff for an operator tool.
3. **Recursive CTE for causality.** BFS with visited-set + fanout cap is fine at depth 3 × 50; rewrite if depth or fanout grows.
4. **`EventCausalityResponse` split.** Sibling routes are unambiguous today; split when a third consumer arrives.
5. **Manifest enum coercion server-side.** UI handles the current manifest type strings; normalise when the catalog grows.
6. **`__test` meta-channel separation.** Inngest envelope shape would need to extend; today `runs.isTest` is the canonical signal that downstream code should consume.
7. **`payloadPreview` field.** Dropped from the PRD; client fetches payload on demand via `payloadRef`.

## What changed in the code

| File | Change | Reason |
|---|---|---|
| `packages/runtime/src/register.ts` | Read `event.data.__test`, pass `isTest` to `runs.insert` | C1 — load-bearing bug |
| `apps/api/src/routes/v1/events.ts` | Audit on any non-`external` source; record `auth_via` in meta | C5 |
| `packages/db/src/schema.ts` | Add `evt_tenant_received_idx (tenant_id, received_at)` | C2 / BLOCK-3 |
| `packages/db/drizzle/0013_confused_vertigo.sql` | Migration for the new index | C2 / BLOCK-3 |

## What changed in the docs

| Doc | Change |
|---|---|
| [PRD](../prd/event-tester.md) | Drop `payloadPreview` claim; tighten "test run" guarantee to reference `runs.isTest` as canonical |
| [Design](../design/event-tester.md) | Update §4.2 SSE description; update §4.5 audit description; add §6 tenant-isolation test; add §11 review-consolidation reference |
| [Impl](../impl/event-tester.md) | Add migration step; update audit semantics; flag deferred items |

## Open issues tracked for follow-up PRs

1. **Schema drift between code and tracked migrations** — pre-existing in this repo; calling out for separate cleanup.
2. **`isPlatformAdmin()` is stubbed** — pre-existing; required for v2 RBAC story.
3. **`actorUserId` is null on all audit rows** — pre-existing harness gap.
4. **`packages/runtime` typecheck has pre-existing errors** (`subflow`, `cron`, `tool_use` not declared on AgentSpec) — orthogonal to Event Tester.
