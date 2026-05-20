# AI Architect Review — Event Tester (Round 1)

**Reviewer:** AI Architect
**Date:** 2026-05-20
**Inputs:** [PRD](../prd/event-tester.md), [Design spec](../design/event-tester.md), [Implementation plan](../impl/event-tester.md), grounded against `CLAUDE.md`, `docs/DESIGN.md`, `packages/contracts/src/events.ts`, `apps/api/src/routes/v1/events.ts`, `packages/runtime/src/register.ts`, `packages/db/src/schema.ts`, `models/RAAS-v1/events_v1.json`.

## TL;DR

**Verdict: Iterate.** The architecture is sound and the layering is the right shape, but the spec asserts a behaviour the runtime does not actually implement: the manifest path in `packages/runtime/src/register.ts` never reads `__test` from `event.data` and never writes `runs.isTest`. Until that is plumbed (and the test verifies it through a real Inngest dispatch, not a back-fill update), G5/NFR-7 are aspirational. Fix that, tighten the SSE design (heartbeat-first + tenant-room dispatch instead of per-connection polling), and the rest is solid.

## Strengths

- **Layering is honest.** Event Tester is correctly placed in L4 and reuses the existing `POST /v1/events → appendToLedger → inngest.send` path. There is no per-tenant code, and the catalog is sourced from `eventTypes` (a table that already exists with `(tenantId, name)` PK), so the "harness, not per-customer code" claim holds (Design §1, §2).
- **Contracts are additive.** Extending `IngestEventBody` with optional `test` and `source` does not break the existing public ingest contract used by external producers — important because the route is "public ingest" per the existing comment (`events.ts:12`). `EventCatalogResponse` and `EventRecentResponse` are new sibling shapes; nothing mutates `EventRow`.
- **Replay & audit reuse is exemplary.** `event.publish` mirrors the existing `event.replay` audit shape (`events.ts:101-110`) and the `__triggerEventId` discipline is preserved, so Inngest dedupe still works.
- **CLAUDE.md SPA convention respected.** Internal components prefixed `EventTester*` — this directly addresses the global-scope shadowing footgun the codebase has already been bitten by.
- **Causality envelope is the right model.** Walking `runs.triggerEventId` outward and `runs.emittedEventId` inward exactly mirrors how the runtime wires parents and children (`register.ts:127, 410`). The depth cap is correctly identified.

## Required changes (BLOCK ship)

1. **Plumb `__test` into the manifest runtime.** Design §4.3 says "Downstream agents and the run engine treat `__test` as `runs.isTest = true` (already supported per schema)." That is only true for the `BaseAgent` code path (`agent-runtime/src/run-engine.ts:166`). The manifest path at `packages/runtime/src/register.ts:120-133` inserts the `runs` row without consulting `event.data.__test`; the column defaults to `false`. **Fix:** in the `init` `step.run`, read `typeof data.__test === "boolean" ? data.__test : false` and pass it into the `runs.insert(...).values({ isTest: … })`. Add a test that publishes a manifest-triggered event with `test: true` and asserts the resulting `runs.isTest === true` *without* the safety back-fill (currently `agent-invoke.ts:120-133` does a defensive update; that pattern would mask a missing plumb in the manifest path). **Where:** Design §4.3, Impl §2.3 (and a new sub-section listing the runtime edit), PRD G5/NFR-7.

2. **Specify the SSE dispatch model, not just the wire format.** Impl §2.3 sketches per-connection 250 ms polling. With the design's cap of 5 concurrent SSE per tenant × N tenants, you get 5N independent SQLite scans every 250 ms even when nothing is happening. **Fix:** introduce a single per-tenant in-process publisher (an `EventEmitter` keyed by `tenantId`) that the `POST /v1/events` handler `emit`s to *after* the DB insert; each SSE handler subscribes to that emitter and writes a frame on receipt. Fall back to a 1-second SQLite catch-up sweep for events written by *other* processes (multi-process inngest worker scenario), not the per-connection 250 ms scan. Specify behaviour on multi-API replica (today single-process, but the design should be honest about it). **Where:** Design §4.2, Impl §2.3.

3. **Tenant-scope the SSE stream at the *query* layer, not the route layer.** The proposed `fetchEventsSince(tenantSlug, cursor, names)` is correct in spirit, but the catch-up GET (the existing `GET /v1/events`) is consumed by another view. Add an explicit `tenantScope` constraint and an integration test that proves: tenant A's SSE never receives a row written under tenant B's tenantId, even when both have an event named `CLIENT_RULES_PASSED`. The bare-name lookup makes this a real risk. **Where:** Design §6, Impl §2.2/2.4.

4. **Causality response shape is wrong on the seed event.** §3 declares `EventRecentResponse` with `events: z.array(EventRow)` and an *optional* `edges`/`runs`. But the route at Impl §2.3 returns `out` directly from `fetchCausality(...)` which the impl plan describes as `{ events, runs, edges }` — and the contract field `events` only contains `EventRow`s. For causality, you want the seed event plus *descendant* events to be in `events`, with `edges` non-optional in the causality response. **Fix:** split into two shapes — `EventRecentResponse` (no causality) and `EventCausalityResponse` (required `events`, `runs`, `edges` plus the seed id). Sibling routes already disambiguate them. **Where:** Design §3, Impl §2.1.

## Recommended changes (would improve, not blocking)

1. **Manifest-enum coercion ambiguity.** §3 says `field.type` is the bare manifest string (`"String"`, `"Array<String>"`). The form renderer (Impl §3.1) parses `"Array<…>"` with `startsWith`. RAAS's `events_v1.json` has `"Array<String>"` (line 115). What about `Array<Object>` or nested generics? Spec a normalisation pass (server-side in `listEventCatalog`) that returns a structured `{kind: "scalar"|"array"|"object", inner?, enum?}` rather than letting the SPA re-parse the manifest string. This pushes one form of coupling into the contract and out of the UI.

2. **`source: "operator"` is the wrong audit signal.** A determined caller can set `source: "external"` to skip the audit row. Tie the audit decision to the auth context (operator session vs API token), not a body field. The body field can stay for informational purposes, but the **audit hot-path should fire whenever `req.auth.actorUserId` is present**, regardless of `source`.

3. **`test=true` should NOT round-trip through `payload`.** Stuffing `__test` into `data` makes it visible to every downstream tool and prompt — a tool author could see `__test: true` and behave differently, defeating the "tests traverse the real harness" goal (Open Q #3). Pass it as an Inngest event *meta* field (e.g. `__test: true` outside `data`, or in a sibling envelope). Today `inngest.send.data` is the only carrier, so this requires either a dedicated meta field on the Inngest payload (rename to a less collision-prone key like `__agentic_test`) AND a runtime read that strips it before forwarding to step actions. **Where:** Design §4.3 + Impl §2.3.

4. **`recent.events` deserves a `payloadPreview`.** FR-5 (PRD) declares "payloadPreview" as part of the frame, but the new contract still returns `EventRow` (which has only `payloadRef`). Either add a derived `payloadPreview` field or drop the PRD claim.

5. **30-min SSE timeout is fine; 5/tenant cap needs enforcement detail.** Design §4.2 declares the cap but doesn't say how it's enforced (in-process Map keyed by tenantId; what if the process restarts mid-connection — the client reconnect-storm will all hit fresh capacity). Add a sentence on how the cap is implemented and what happens to the 6th connection (refuse with 429, or evict oldest).

6. **`source_agent`/`source_run` injected into the emitted event payload (`register.ts:374-378`) means downstream agents see telemetry data in `last_result`.** Not introduced by this spec, but the Event Tester should preview what a downstream agent would actually receive — currently the form renders catalog fields but the *actual* emitted payload from upstream agents has `source_agent`, `source_run`, `subject`, `last_result`. Either document that the form is for *root* events only (manual publish from the UI never has those keys) or add them as read-only contextual fields.

## Nits

- Impl §3.1 sample fetches `/v1/events/catalog` directly; existing SPA views use the parsed Zod contract via a helper (`apps/web/lib/api-client.ts`). Mirror that pattern, or document why this view bypasses it.
- "alphabetically after `events.jsx`" (Impl §3.2) — script tag order is load order; loading after `events.jsx` is fine, but the rationale is alphabetic-by-coincidence, not by design. Pick one.
- Design §5.6: "lanes by depth" — BFS gives layers, not lanes; minor copy fix.
- PRD §5 user-story 4 says "audit-logged" for the non-test toggle but FR-8 doesn't restate that. Make it explicit in FR-8.
- Impl §4 step #10 says audit goes to `data/logs/<tenant>/audit/<date>.log` — but `writeAudit` (`apps/api/src/plugins/audit.ts:13-26`) writes to the SQLite `auditLog` table, not a log file. Fix the verification step.

## Cross-doc consistency check

- **PRD §6 FR-8 vs Design §4.3 vs runtime reality.** PRD: "The ingest endpoint, when it sees `__test`, sets `runs.isTest = true` on any run derived from that event (already supported per the schema map)." Design: "(already supported per schema)." **Reality:** schema *column* exists, but **manifest runtime never reads `__test`**. Required change #1 above.
- **PRD §6 FR-5 ("payloadPreview")** vs Design §3 (no `payloadPreview` in `EventRow`/`EventRecentResponse`). Recommendation #4.
- **PRD §5 user-story 4** says non-test toggle is audit-logged; **Design §4.5** ties audit to `source: "operator"` only. Body-field collision with PRD intent — see Recommended #2.
- **Design §10 Rollout:** "behind `operator` role check for the non-test publish (the test-run path stays open)." This role gate is not in the Impl plan (§2.3 publish extend has no role check). Either drop the gate or add it to Impl.
- **PRD §3 Non-goals** says "Cross-tenant publishing — Event Tester respects the auth plugin's single-tenant scope." But **Design §11 future hook #3** ("Multi-tenant federation … sysadmin role could iterate tenants from the same UI") imagines exactly that. Note in PRD that the future hook is consciously deferred but contract-shaped today (the auth-derived tenantId is the chokepoint).

## Open questions for the team

1. The "recent" panel + the causality panel each poll at 1 Hz (Impl §3.1 `setInterval(1000)`). Concurrent with the 250 ms SSE poll, a single open Event Tester tab issues ~5 catalog/recent/causality+SSE-tick queries per second. Multiply by tab count. Is this acceptable in local dev? In prod with N tenants? Should the causality panel piggy-back on the SSE stream (emit `event: causality_update` frames) instead?
2. Should publishing an event with `source: "operator"` *automatically* set `test: true` unless the user explicitly opts out? PRD user-story 4 ("Mark as test run defaults ON") implies yes; Design doesn't make the API enforce it.
3. The proposed SSE `since=<unix-ms>` cursor uses `receivedAt`. `events.receivedAt` is unique-ish but not unique — multiple events can land in the same millisecond. The proposed `cursor = Math.max(cursor, new Date(r.receivedAt).getTime() + 1)` *skips ahead by 1ms*, which loses events on a hot tenant. Should the cursor be `(receivedAt, id)` tuple (lexicographic) instead?
4. What's the policy on **deleted** events? `events.deletedAt` exists (`schema.ts:235`). Should the catalog/stream/causality respect it? Spec is silent.
5. The cURL preview includes a bearer token slice. Is the token retrievable from `window.RAAS_AUTH_HEADERS` in dev mode where auth is cookie-based? If not, the preview shows `Bearer undefined…` — confusing UX.
6. Does the design account for *Inngest dev server being down* (Design §8 lists it as a failure mode) by writing the events row regardless? Today the existing `POST /v1/events` would partially succeed (DB+ledger write) and then throw on `inngest.send`. Confirm the new test mode doesn't change that ordering — and add a test.
