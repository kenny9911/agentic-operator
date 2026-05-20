# Design Spec — Event Tester

**Status:** Draft → Review (2026-05-20)
**Companion:** [PRD](../prd/event-tester.md) · [Implementation plan](../impl/event-tester.md)

This spec is opinionated on **how Event Tester is built inside the Agentic Operator harness**. It treats the runtime as an operating system for event-driven agents and proves that the Tester is a first-class harness component, not a per-tenant UI.

---

## 1. Position in the operating-system model

Agentic Operator is structured as four layers; each layer is tenant-agnostic and exposes versioned contracts:

```
┌──────────────────────────────────────────────────────────────────────────┐
│  L4  Operator surface       portal SPA  ·  CLI  ·  /v1 REST  ·  SSE     │ ← Event Tester
├──────────────────────────────────────────────────────────────────────────┤
│  L3  Harness services       run engine · llm gateway · audit · vault    │
├──────────────────────────────────────────────────────────────────────────┤
│  L2  Durable substrate      Inngest  ·  SQLite (WAL)  ·  NDJSON ledger  │
├──────────────────────────────────────────────────────────────────────────┤
│  L1  Tenant artefacts       manifests (models/<slug>-vN/*.json)         │
│                              code agents (BaseAgent subclasses)         │
└──────────────────────────────────────────────────────────────────────────┘
```

Event Tester is **pure L4**. It does not introduce per-tenant code and it does not bypass L3 — every publish goes through the same `POST /v1/events → appendToLedger → events row → inngest.send` path that an external system would use. The Tester reads the catalog from L1 (manifest) via an L3 query.

This is the load-bearing property: when a tenant adds a new event to `events_v1.json` and runs the bootstrap, Event Tester immediately supports it. No new code anywhere.

## 2. Architecture overview

```
                     ┌───────────────────────────┐
 portal SPA          │  views/event-tester.jsx    │
 (L4 client)         │  publish form │ recent     │
                     │  live tail    │ causality  │
                     └────┬──────┬────────────────┘
                          │      │                ▲
            GET /v1/events│      │POST /v1/events │SSE: /v1/events/stream
            /catalog       │     │/publish (existing /v1/events)
                          ▼      ▼                │
                  ┌─────────────────────────────────────────┐
                  │  apps/api  (Fastify, L4 surface)        │
                  │   routes/v1/events.ts                   │
                  │     • catalog (NEW)                     │
                  │     • publish (extended: __test)        │
                  │     • stream  (NEW SSE)                 │
                  │     • recent  (extended: causality)     │
                  │     • replay (existing)                 │
                  └────┬───────────────────────────┬────────┘
                       │                           │
                       ▼                           ▼
              ┌──────────────────┐        ┌─────────────────────┐
              │ queries/events.ts │        │  packages/runtime    │
              │ (read path)       │        │  appendToLedger      │
              │  • catalog        │        │  inngest.send        │
              │  • recent +       │        │  (durable substrate) │
              │    causality      │        └─────────────────────┘
              └────┬─────────────┘
                   │
                   ▼
            ┌────────────────────────────────────────────┐
            │ @agentic/db (SQLite WAL)                   │
            │   eventTypes   ← catalog source-of-truth   │
            │   events       ← live + historical events   │
            │   runs         ← join via triggerEventId    │
            └────────────────────────────────────────────┘
```

The dotted contract: **everything the UI knows is also exposed over REST**. The SPA is a thin client. Anything the SPA can do, the CLI and any third-party operator console can do.

## 3. Data contracts (additions to `@agentic/contracts/events.ts`)

```ts
// NEW: catalog endpoint
export const EventCatalogField = z.object({
  name: z.string(),
  type: z.string(),                 // "String" | "Boolean" | "Number" | "Array<String>" | …
  target_object: z.string().nullable().optional(),
  required: z.boolean().optional(),
  enum: z.array(z.string()).optional(),
});
export type EventCatalogField = z.infer<typeof EventCatalogField>;

export const EventCatalogEntry = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  source_action: z.string().nullable().optional(),
  fields: z.array(EventCatalogField),       // derived from manifest event_data[]
  raw_payload_schema: z.unknown().nullable(),  // pass-through for "expert" tab
});
export type EventCatalogEntry = z.infer<typeof EventCatalogEntry>;

export const EventCatalogResponse = z.object({
  events: z.array(EventCatalogEntry),
});

// EXTENDED: publish body — additive, backwards-compatible
export const IngestEventBody = z.object({
  name: z.string().min(1),
  subject: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  test: z.boolean().optional(),     // NEW
  source: z.enum(["operator", "system", "external"]).optional(),  // NEW (default "external" for back-compat)
});

// NEW: recent + causality
export const EventCausalityEdge = z.object({
  from: z.string(),         // event id OR run id
  to: z.string(),
  kind: z.enum(["triggered_run", "emitted_event"]),
});

export const EventRecentResponse = z.object({
  events: z.array(EventRow),
  // optional: extends EventRow with causality envelope when ?causality=1
  edges: z.array(EventCausalityEdge).optional(),
  runs: z.array(z.object({
    id: z.string(),
    agentName: z.string().nullable(),
    status: z.string(),
    triggerEventId: z.string().nullable(),
    emittedEventId: z.string().nullable(),
    parentRunId: z.string().nullable(),
  })).optional(),
});
```

The `EventRow` already includes `category`, `color`, `payloadRef` (per `packages/contracts/src/events.ts:20-30`); we extend it with the source/test markers in a separate `Recent`-shaped envelope rather than mutating it (preserves back-compat for the existing `GET /v1/events`).

## 4. API surface (additions to `apps/api/src/routes/v1/events.ts`)

### 4.1 `GET /v1/events/catalog`

Returns `EventCatalogResponse`. Tenant-scoped. Built by:

1. `SELECT * FROM eventTypes WHERE tenantId = ?` — gets name, description, category, color, payload schema (the JSON-encoded manifest stub).
2. For each row, parse the embedded `payload.event_data[]` into the typed `fields` array; the original payload structure is preserved in `raw_payload_schema`.

The catalog refreshes whenever a tenant manifest is rebooted; no in-memory cache (it's a single SQLite query, p99 < 5ms with 50 events).

### 4.2 `GET /v1/events/stream` (SSE)

Mirrors `runs-logs.ts`:

```
GET /v1/events/stream?since=<unix-ms>&names=<comma-sep>
Accept: text/event-stream
```

Response: frames of `event: event\ndata: {EventRow}\n\n`. Server polls the events table at 250ms cadence (we can't `tail -f` SQLite; the cost is acceptable for live tail at human cadence). Optional name filter narrows to the tester's interest. Heartbeat every 15s. Server enforces a 30-minute connection timeout (client must reconnect, which is cheap).

Why polling and not LISTEN/NOTIFY? SQLite doesn't have it; we'd otherwise need to bus events through Inngest, which couples the live-tail wire-format to the durability layer. The poll uses a **dedicated covering index** `(tenantId, receivedAt)` (migration 0013), keeping the query a B-tree seek even on tenants with 100k+ historical events.

**Cursor compensation.** SQLite's `unixepoch() * 1000` default has 1-second precision, so an event inserted at wall-clock `T` may carry a `receivedAt` of `floor(T)`. A fresh subscriber that uses `cursor = Date.now()` will miss any event with a `receivedAt` < `Date.now()` from the same wall-clock second. The server defaults to `cursor = Date.now() - 1000` to span the boundary. Tradeoff: same row can appear twice if the client reconnects within that 1s window — duplicate-tolerance is acceptable for an operator tool (Round-1 BLOCK-2 partially-mitigated; full fix would be a `(receivedAt, id)` tuple cursor).

**Future:** in-process per-tenant EventEmitter dispatch is the right design once we go multi-replica. Round-1 reviewer recommended it; deferred until measured cost justifies the refactor.

### 4.3 `POST /v1/events` (extend)

Already exists. Two additions:

- If `test: true`, set `data.__test = true` on the Inngest payload. Downstream agents and the run engine treat `__test` as `runs.isTest = true` (already supported per schema).
- If `source: "operator"`, store the source on the **audit log** row (we do not add a column to `events` — the table is a hot path).

The route remains idempotent on `__triggerEventId` semantics (Inngest dedupes by event id when set).

### 4.4 `GET /v1/events/recent` (extend with causality)

Existing route stays at `GET /v1/events`. Add a new sibling route `GET /v1/events/recent?causality=1&seed=<event-id>` that returns the seed event + its downstream runs (via `runs.triggerEventId = seed`) + the events those runs emitted (via `runs.emittedEventId`) + grand-children, capped at a configurable depth (default 3). Returns an `EventRecentResponse` with `edges` and `runs`.

Why a sibling route? The existing `GET /v1/events` is consumed by the existing `events.jsx` view and we don't want to break its shape. The new shape is additive.

### 4.5 Audit

Every `POST /v1/events` whose `source` is anything other than `"external"` (default) writes an `auditLog` row:

```ts
{
  action: "event.publish",
  targetType: "event",
  targetId: eventId,
  meta: {
    name,
    subject,
    test,
    source,                // "operator" | "system"
    auth_via,              // "token" | "dev" — proves whether this was a real bearer-token publish or a dev-mode bypass
    fields: Object.keys(payload ?? {}),  // names only, no values
  },
}
```

This matches the existing `event.replay` audit shape and addresses Round-1 reviewer concern that tying the audit decision to a body field (`source: "operator"`) creates a trivially-bypassable signal. The body field still controls *whether* we audit, but `auth_via` records the auth context so forensics can distinguish "real operator publish" from "AUTH_MODE=dev bypass".

External webhook ingest stays unaudited here because those callers already have dedicated audit on their own routes (`POST /v1/webhooks/:tenant/:source`).

## 5. Frontend design (SPA view)

### 5.1 View skeleton

`apps/web/public/portal/views/event-tester.jsx` exports a single top-level `EventTester` component. All internal components are prefixed `EventTester*` per the CLAUDE.md global-scope convention.

Layout:

```
┌──────────────────────────────────────────────────────────────────────┐
│ ViewHeader: "Event Tester" · subtitle: "Publish & trace events"      │
├──────────────────────────────────────────────────────────────────────┤
│ 260px        │ 1fr (main)                       │ 360px              │
│              │                                  │                    │
│ Catalog      │  [Event] CLIENT_RULES_PASSED     │  Recent events     │
│ sidebar:     │  Description …                   │  ━━━━━━━━━━        │
│  • CLIENT…   │                                  │  • CLIENT_RULES…   │
│  • AI_INT…   │  Subject  [req-acme-001        ] │  • AI_INTERVIEW…   │
│  • REQUIRE…  │  ☑ Mark as test run              │                    │
│              │                                  │  (SSE live)        │
│ Search…      │  Fields ─────                    │                    │
│              │   client_id  [string  ▢]         │  Causality:        │
│              │   candidate_id [string ▢]        │   evt-… → run-…    │
│              │   rules_passed [● true ○ false] │     ↳ emits evt-…  │
│              │                                  │                    │
│              │  [ Show as cURL ]  [ Publish ]   │                    │
│              │                                  │                    │
│              │  Past payloads ▼  Presets ▼      │                    │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.2 State machine

```
idle ─(select event)→ form        // catalog row clicked
form ─(edit fields)→  form
form ─(publish)→     publishing
publishing ─(success)→ watching   // pin event_id; show row in Recent; render DAG as runs land
publishing ─(fail)→  form (error banner)
watching ─(timeout 60s | publish new)→ form
```

State is local to the view. Live tail uses a singleton `EventSource` lifecycle-bound to the view (close on unmount).

### 5.3 Form rendering

A pure function `EventTesterRenderField(field, value, onChange)` switches on `field.type`. The "object / unknown" path drops to a `MonacoEditor` (shared `window.MonacoEditor`). Validation runs on every change and shows red-underline on the offending field; the **Publish** button is disabled if any required field is missing.

### 5.4 Presets

LocalStorage key: `agentic.preset.${tenantSlug}.${eventName}`. Stored as `{ name, subject, payload, savedAt }[]`. UI affords save/load/delete from a dropdown. Presets never auto-load (security: presets can outlive a user's session).

### 5.5 cURL preview

```
curl -X POST http://localhost:3501/v1/events \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "CLIENT_RULES_PASSED",
    "subject": "req-acme-2026-001",
    "test": true,
    "payload": { … }
  }'
```

The token is masked (`Bearer ${tok.slice(0,6)}…`); user can click to reveal.

### 5.6 Causality minimap

Built with the same SVG primitives `workflows.jsx` already uses (no extra deps). Layout: BFS from seed, lanes by depth. Each node is `{kind: "event"|"run", id, label}`. Click jumps to the corresponding view (Events, Runs, Logs). Updates incrementally as new SSE frames land.

### 5.7 Sidebar nav registration

Add to `app.jsx`:

- `NavItem` in the **Operate** group, between **Events** and **Logs**, label "Event Tester", icon `flask` (or existing `play` if `flask` is absent).
- Conditional render `{view === "event-tester" && <EventTester … />}`.
- Add `<script type="text/babel" src="/portal/views/event-tester.jsx"></script>` before `app.jsx`.

## 6. Tenant isolation

The whole stack derives tenant from `req.auth`. Specifically:

- `GET /v1/events/catalog` filters `eventTypes.tenantId = req.auth.tenantId`.
- `GET /v1/events/stream` filters `events.tenantId = req.auth.tenantId`.
- `POST /v1/events` writes `events.tenantId = req.auth.tenantId`; the Inngest event name is prefixed `${req.auth.tenantSlug}/…` (already done at line 18-20 of the existing route).
- `GET /v1/events/recent?causality=1` joins through `runs.tenantId`.

An E2E test in `apps/api/test/` confirms tenant A receives 0 events when publishing as tenant B.

## 7. Observability of the Tester itself

Event Tester is a high-traffic operator surface. Instrumentation:

- `auditLog` rows for every publish (above).
- Structured Fastify log lines on each route, with `tenantSlug`, `eventName`, `test` flag, and `duration_ms`.
- Optional Prom metric counters (deferred until we add a metrics endpoint org-wide).

## 8. Failure modes

| Failure | UX | Operator-visible signal |
|---|---|---|
| Catalog empty (new tenant, no events.json) | Empty-state with link to schema-editor | "No events declared yet" |
| Inngest dev server down | Publish still writes ledger + DB row, but no downstream run fires | Warning banner "downstream dispatch failed — see logs" |
| SSE 5xx | Reconnect with backoff; "Reconnecting…" pill | Toast on permanent failure |
| Form schema invalid (manifest bug) | Form falls back to Monaco JSON for that field | "Manifest field X has unrecognised type" badge |

## 9. Test plan (mirrors `apps/api/test/` conventions)

| Test | Layer | Mechanism |
|---|---|---|
| Publish round-trip (publish → recent → run row) | Integration | Vitest fork; seed mock-provider tenant; assert via direct DB queries |
| Tenant isolation | Integration | Two tenants, publish as A, query catalog/stream as B → empty |
| Test-flag honored | Integration | `test: true` → `runs.isTest = true` |
| Audit row written | Integration | `auditLog` row exists after publish |
| SSE delivers a published event within 500ms | E2E | New helper `eventStream(tenantSlug)` |
| Causality DAG contains seed → run | E2E | Use the existing test agent |

## 10. Rollout

Single PR; no feature flag. Behind dev auth in non-prod tenants. A role-based guard for non-test publishes is desirable but **not implemented in v1** — the harness has no `requireRole` primitive yet (per the AI Software Architect's Round-1 finding that `isPlatformAdmin()` is stubbed and `memberships.role` is not consulted on routes). Non-test publishes are gated by an SPA confirm-modal + the audit row carrying `auth_via`; full RBAC is on the post-Event-Tester roadmap. Migrations: one — `0013_confused_vertigo.sql` adds the SSE poll's covering index.

## 10.1 Round-1 review consolidation

Three independent reviews (AI Architect · Principal Full-stack Engineer · AI Software Architect) of this design returned **iterate / needs-revision** on the same set of findings. The fixes — including the load-bearing `__test` plumbing bug in the manifest runtime — are tracked in [docs/audits/event-tester-review-consolidation.md](../audits/event-tester-review-consolidation.md). The shape of the feature did not change; the implementation is now correct against the spec.

## 11. Future hooks

These are deliberately deferred but the API is shaped to accept them:

1. **Burst publish** — extend `POST /v1/events` with `count?: number` (capped at 100); use Inngest fan-out semantics.
2. **Templated payloads** — server-side handlebars on stored presets (deferred until users ask).
3. **Multi-tenant federation** — a sysadmin role could iterate tenants from the same UI (today, blocked by auth scope).
4. **Schema-driven assertions** — given an event, declare expected downstream events; the Tester turns into a tiny eval harness.

These extensions are all backwards-compatible with the contracts above.
