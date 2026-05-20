# PRD — Event Tester

**Status:** Draft → Review (2026-05-20)
**Owner:** Agentic Operator harness team
**Reviewers:** AI Architect · Principal Full-stack Engineer · AI Software Architect
**Related:** [DESIGN.md](../DESIGN.md) · [Event Tester design spec](../design/event-tester.md) · [Implementation plan](../impl/event-tester.md)

---

## 1. Problem

Agentic Operator already runs declarative manifest agents and code-defined agents that are *triggered by events*. Every workflow we ship — RAAS, and every future tenant — is event-driven: an external system or an upstream agent emits `${tenant}/${EVENT_NAME}` and the runtime dispatches the corresponding agent(s).

There is no first-class **operator tool** to drive this surface. Today, to test an agent end-to-end an operator must:

1. Hand-craft a `curl POST /v1/events` body with a JSON payload that matches the (Chinese-titled, deeply nested) `events_v1.json` schema.
2. Compose the right `subject` (used as the Inngest concurrency key) by reading the manifest.
3. Tail `data/logs/<tenant>/events/<date>.ndjson` *and* the run log stream simultaneously to verify the downstream agent fired and what it emitted.
4. Mentally correlate `__triggerEventId` across the ledger, the `runs` table, and any emitted children.

This is the same loop a "Postman for events" needs to short-circuit. Until it exists, every iteration on a workflow has minutes of friction; QA, demos, and incident reproduction all suffer.

## 2. Goals

| # | Goal | Why it matters |
|---|---|---|
| G1 | Publish a tenant-scoped event from the UI with **schema-driven form input** | Removes JSON hand-crafting; turns the manifest into a UX |
| G2 | **Live tail** of recently emitted events for the current tenant | Closes the verification loop without `tail -f` on NDJSON |
| G3 | Visualise **causality**: which event triggered which run, which run emitted which child event | Makes the event-driven model legible; required for debugging |
| G4 | Be useful for **any tenant** (zero per-tenant code), driven entirely from `eventTypes` + manifest metadata | Honors the "harness, not per-customer code" principle |
| G5 | Mark publishes as **test runs** (`runs.isTest = true`) so they're filtered out of dashboards/metrics by default | Test traffic must not pollute production observability |
| G6 | Round-trip in **< 10s** for the publish→fire→observe loop locally | Fast feedback is the entire point |

## 3. Non-goals (v1)

- **Editing** the event catalog — that's the schema-editor's job ([feedback_native_modules_in_nextjs.md] sibling work).
- Cross-tenant publishing — Event Tester respects the auth plugin's single-tenant scope.
- Replaying *historical* events at a chosen point in time — replay of one captured event already exists via `POST /v1/events/:id/replay`; we surface the button, we don't extend semantics.
- A scriptable / batch publisher (CSV → many events). Out of scope; CLI can do this.
- Persisting drafts of unpublished payloads across sessions. Local-storage-only is fine.

## 4. Users & jobs-to-be-done

| Persona | JTBD |
|---|---|
| **Workflow author** (declarative-manifest tenant) | "Given my newly added agent, drive its trigger event and confirm the downstream chain works." |
| **Code-agent author** (`BaseAgent` subclass) | "I just hot-reloaded my agent; send it a synthetic event and watch the run." |
| **SRE / operator on-call** | "Reproduce a customer's incident by replaying yesterday's event; confirm a regression is fixed." |
| **Demo / Sales engineering** | "Drive the RAAS workflow on a fresh tenant in front of a customer without using a terminal." |

## 5. User stories

1. *As a workflow author*, I open **Event Tester** and see a sidebar listing every event in this tenant's catalog (from `eventTypes`). I pick `CLIENT_RULES_PASSED` and the form auto-renders fields for `client_id`, `candidate_id`, `rules_passed` because the manifest declares them.
2. *As an operator*, I type a `subject` (`req-acme-2026-001`) and click **Publish**. Within ~500ms a row appears in the **Recent events** pane (live tail). Within 1-2s I see a new `runs` row appear below with the downstream agent firing.
3. *As an SRE*, I see the full causality chain: my published event → child runs → events those runs emitted → grand-child runs. I can click any node to jump to its detail in Runs, Events, or Logs.
4. *As a tenant admin*, I publish into a sandbox and the run is automatically marked `isTest=true`. A toggle exists for advanced users who want to drive a "production" trigger from the UI; that toggle is audit-logged.
5. *As a workflow author*, I save a "preset" payload locally and reuse it across debugging sessions.
6. *As a CI/QA engineer*, I copy the equivalent `curl` command from the form (Show as cURL) and paste it into a script.

## 6. Functional requirements

### FR-1 — Event catalog read
The UI must fetch the **tenant's event catalog** from a backend endpoint. The catalog returns: event `name`, `description`, `category`, `color`, and a **payload schema** (the manifest's `payload` object, including `event_data[]` with `{ name, type, target_object }`). The endpoint must be authoritative — never read from the local SPA bootstrap snapshot.

### FR-2 — Schema-driven form
For the chosen event, render an input for each declared `event_data[]` field:

| Manifest type | UI control |
|---|---|
| `String` | Text input |
| `Boolean` | Toggle |
| `Number` / `Integer` | Number input |
| `Date` / `DateTime` | Native date / datetime input |
| `Array<X>` | Repeating list of `X`-typed inputs with add/remove |
| `Enum<…>` | Select dropdown (values inferred from `enum:` if present) |
| Unknown / object | Monaco JSON editor (fallback) |

Always render two universal fields above the form: **Subject** (free-text) and **Mark as test run** (default ON).

### FR-3 — Validate before publish
Client-side validation against the field types declared in the manifest. Server-side accepts any JSON body matching the existing `IngestEventBody` Zod schema; soft validation against the catalog payload schema returns warnings in the response without blocking the publish (the manifest schema may be aspirational).

### FR-4 — Publish action
Calls `POST /v1/events` (the existing endpoint). The body is `{ name, subject, payload }`. Bare event name only (no tenant prefix) — the route already namespaces it. The client receives `{ event_id, name }` and pins that ID for the **Watch panel** to filter on.

### FR-5 — Recent events panel (live)
A right-hand panel streams new events for the tenant in real time. Implementation: new SSE endpoint `GET /v1/events/stream` (mirroring `runs-logs.ts`), back-pressured by `since=<ts>`. Each frame contains `{ id, name, subject, category, color, receivedAt, sourceAgentName?, sourceAgentTitle?, payloadRef }` — i.e., the existing `EventRow` shape. The frame schema is shared between catch-up (initial GET window) and live tail (same wire format). Clients fetch the full payload on demand by resolving `payloadRef` (a `path#offset` pointer into the NDJSON ledger).

### FR-6 — Causality view
When the user has just published `evt-X`, show a small DAG: the event itself, downstream runs that were triggered by it (filter `runs.triggerEventId = 'evt-X'`), and child events those runs emitted (filter `events.id IN (runs.emittedEventId WHERE runs.parentRunId = …)`). One-click navigates to Runs, Logs, or Events view scoped to that node. The DAG renders progressively as runs/events arrive.

### FR-7 — Payload tooling
- **Load from past event:** "Use payload from…" picks a past event of the same name and pre-fills the form.
- **Save as preset:** stores `{ tenant, event, name, subject, payload }` in `localStorage` keyed by `<tenant>:<event>:<preset-name>`.
- **Show as cURL:** preview the exact `curl` command — including auth header — that a user could paste into a script.

### FR-8 — Test-run flag
The "Mark as test run" toggle sends `test: true` in the publish body (NOT inside `payload`). The ingest endpoint stamps `__test: true` on the Inngest envelope; the manifest runtime (`packages/runtime/src/register.ts`) and the code-agent run engine (`packages/agent-runtime/src/run-engine.ts`) both read it and set `runs.isTest = true`. Downstream queries (dashboards, run lists) filter on `runs.isTest`, which is the canonical signal — `__test` on the envelope is an internal plumbing detail, not a contract for downstream actions.

*Round-1 reviewer note:* the manifest path did not honor this flag before [docs/audits/event-tester-review-consolidation.md](../audits/event-tester-review-consolidation.md) tracked the fix; both paths now do.

### FR-9 — Replay surfaced
For any event in the recent feed, a "Replay" action calls `POST /v1/events/:id/replay`. Adds an entry to the audit log (already implemented in the route).

### FR-10 — Empty / error states
- No event catalog → empty state with a deep-link to the schema-editor view (`navigate("schema-editor")`).
- Publish failure → inline error with the server's failure code and a "Show details" disclosure.
- SSE disconnect → reconnect with exponential backoff; surface a small "Reconnecting…" indicator.

## 7. Non-functional requirements

| ID | Requirement | Measure |
|---|---|---|
| NFR-1 | Cold open (first paint of Event Tester) | < 200ms on local dev with 100-event ledger |
| NFR-2 | Round-trip publish → row in Recent panel | < 500ms p95 in local dev |
| NFR-3 | Tenant isolation | E2E test confirms tenant A cannot see/publish tenant B's events |
| NFR-4 | Live tail back-pressure | SSE emits at most 20 events/sec; client coalesces above that |
| NFR-5 | Zero per-tenant code | Adding a new tenant (per CLAUDE.md "Adding a tenant") makes Event Tester work for it without UI changes |
| NFR-6 | Auditability | Every publish writes an `auditLog` row with action `event.publish`, including subject and event name (no payload — could contain PII) |
| NFR-7 | Replayable test runs | A run whose trigger event was marked `__test` must remain queryable; `runs.isTest` index already supports this |
| NFR-8 | SSE cleanup | Closing the view aborts the EventSource (no orphan connections in dev tools) |

## 8. Success metrics

| Metric | Target |
|---|---|
| Adoption: % of tenants where Event Tester is used ≥1×/week | 80% within 1 month of GA |
| MTTR for workflow bugs found by SE/QA | -50% vs. baseline (anecdotal) |
| Test runs as % of total runs | 5–20% (signal that operators are testing without skewing prod metrics) |
| Operator NPS on the "verifying a new workflow" task | +20 points |

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Operator publishes a destructive event into production traffic by mistake | "Mark as test run" defaults ON; publishing as non-test surfaces a confirm modal and writes a high-priority audit row |
| Manifest payload schema drifts from real producer payloads → form is wrong | Server validation is soft; the publish always succeeds with whatever JSON the operator submits. Show the diff between declared and submitted shape as a warning |
| SSE connections leak | Cleanup hook in the SPA + server timeout; mirrors the proven `runs-logs.ts` pattern |
| Sensitive PII in payloads end up in browser localStorage presets | Presets are opt-in; a banner reminds the user; we never copy payloads to the audit log |
| Multi-tenant deploy with API tokens scoped to one tenant could think it sees all | Backend always derives tenant from `req.auth`, never from a query param. Verified by an E2E test |

## 10. Open questions

1. Should the causality DAG live inside Event Tester, or hand off to the Workflows view with a filter? **Resolved:** in-view minimap with a deep link to Workflows.
2. Do we need a "burst publish" (N copies for load-testing)? **Deferred** to v1.1 if real demand surfaces.
3. Should test-run mode bypass HITL `waitForEvent` task gates? **No** — test runs go through the real harness, otherwise we're not testing the harness. Future opt-in flag possible.

## 11. Acceptance criteria

A new tenant whose `events_v1.json` declares an event with 3 fields shows that form, publishes successfully, the run fires, the recent panel shows the event, the causality DAG renders the downstream run, and the audit log records the publish — all without any code change beyond installing the tenant.

---

*Reviewer prompts and consolidated feedback live in [/docs/audits/event-tester-review-round-1.md](../audits/event-tester-review-round-1.md) and following rounds.*
