# Implementation Plan — Event Tester

**Status:** Draft → Ready (2026-05-20)
**Companion:** [PRD](../prd/event-tester.md) · [Design spec](../design/event-tester.md)

This document is the implementation checklist. Each section maps to a concrete patch with file paths, what to add, and how to verify.

---

## 1. Sequencing & ownership

Two streams run in parallel:

| Stream | Files touched |
|---|---|
| **Backend** | `packages/contracts/src/events.ts`, `apps/api/src/routes/v1/events.ts`, `apps/api/src/queries/events.ts` (new), `apps/api/test/event-tester.test.ts` (new) |
| **Frontend** | `apps/web/public/portal/views/event-tester.jsx` (new), `apps/web/public/portal/app.jsx` (sidebar wiring), `apps/web/public/portal/index.html` (script tag) |

They share only the new contracts module; otherwise independent, parallel-mergeable.

## 2. Backend patches

### 2.1 `packages/contracts/src/events.ts`

Append the new schemas listed in §3 of the design spec:

```ts
// Catalog
export const EventCatalogField = z.object({
  name: z.string(),
  type: z.string(),
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
  fields: z.array(EventCatalogField),
  raw_payload_schema: z.unknown().nullable(),
});
export type EventCatalogEntry = z.infer<typeof EventCatalogEntry>;

export const EventCatalogResponse = z.object({
  events: z.array(EventCatalogEntry),
});

// Extend publish
export const IngestEventBody = z.object({
  name: z.string().min(1),
  subject: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  test: z.boolean().optional(),
  source: z.enum(["operator", "system", "external"]).optional(),
});

// Recent + causality (sibling route)
export const EventCausalityEdge = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.enum(["triggered_run", "emitted_event"]),
});

export const EventRecentResponse = z.object({
  events: z.array(EventRow),
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

Export them from `packages/contracts/src/index.ts` (single barrel file already in use).

### 2.2 `apps/api/src/queries/events.ts` (new)

Two exports:

```ts
// Reads eventTypes for tenant, parses payload.event_data[] → fields array.
export async function listEventCatalog(tenantSlug: string): Promise<EventCatalogEntry[]> {
  // SELECT * FROM eventTypes WHERE tenantId = ?
  // For each row, JSON.parse(payloadJson) if non-null and walk event_data[].
}

// Returns seed event + downstream runs + emitted events, depth-limited.
export async function fetchCausality(
  tenantSlug: string,
  seedEventId: string,
  maxDepth: number = 3,
): Promise<{ events: EventRow[]; runs: { … }[]; edges: EventCausalityEdge[] }> {
  // BFS over (events.id → runs WHERE triggerEventId = id) → (runs.id → events WHERE id = runs.emittedEventId)
  // Guard: tenantId match on every row.
}
```

The catalog query is < 5ms even on 50 events. The causality query is bounded by depth × fanout; with the default depth=3 and per-event fanout cap of 50, the worst case is 7,500 row reads — still fast on SQLite.

### 2.3 `apps/api/src/routes/v1/events.ts` (extend)

Add three handlers:

```ts
// GET /v1/events/catalog
app.get("/events/catalog", async (req, reply) => {
  const auth = requireAuth(req);
  const events = await listEventCatalog(auth.tenantSlug);
  return reply.ok({ events });
});

// GET /v1/events/stream — SSE live tail
app.get<{ Querystring: { since?: string; names?: string } }>(
  "/events/stream",
  async (req, reply) => {
    const auth = requireAuth(req);
    // Header setup mirrors runs-logs.ts:
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.hijack();

    let cursor = req.query.since ? parseInt(req.query.since, 10) : Date.now();
    const names = req.query.names?.split(",").filter(Boolean) ?? null;

    const sendFrame = (row) => reply.raw.write(`event: event\ndata: ${JSON.stringify(row)}\n\n`);
    const sendHeartbeat = () => reply.raw.write(`event: heartbeat\ndata: {}\n\n`);

    const tick = setInterval(async () => {
      const rows = await fetchEventsSince(auth.tenantSlug, cursor, names);
      for (const r of rows) {
        sendFrame(r);
        cursor = Math.max(cursor, new Date(r.receivedAt).getTime() + 1);
      }
    }, 250);

    const hb = setInterval(sendHeartbeat, 15_000);
    const closeIn30Min = setTimeout(() => reply.raw.end(), 30 * 60_000);

    req.raw.on("close", () => {
      clearInterval(tick);
      clearInterval(hb);
      clearTimeout(closeIn30Min);
    });
  },
);

// GET /v1/events/recent — causality envelope
app.get<{ Querystring: { causality?: string; seed?: string; limit?: string } }>(
  "/events/recent",
  async (req, reply) => {
    const auth = requireAuth(req);
    if (req.query.causality && req.query.seed) {
      const out = await fetchCausality(auth.tenantSlug, req.query.seed);
      return reply.ok(out);
    }
    const rows = await listRecentEvents(auth.tenantSlug, {
      limit: req.query.limit ? parseInt(req.query.limit, 10) : 30,
    });
    return reply.ok({ events: rows });
  },
);
```

Extend the existing `POST /events` handler:

```ts
const parsed = IngestEventBody.parse(req.body);
const payload = {
  ...(parsed.payload ?? {}),
  ...(parsed.test ? { __test: true } : {}),
};
// … existing ledger + DB insert (no schema change) …
await inngest.send({ name: tenantNamespacedName, data: { ...payload, subject: parsed.subject, __triggerEventId: eventId } });

// Audit if source=operator
if (parsed.source === "operator") {
  audit.writeAudit({
    tenantId: auth.tenantId,
    action: "event.publish",
    targetType: "event",
    targetId: eventId,
    meta: { name: bareName, subject: parsed.subject, test: !!parsed.test, fields: Object.keys(parsed.payload ?? {}) },
  });
}
```

### 2.4 `apps/api/test/event-tester.test.ts` (new)

```ts
describe("event tester", () => {
  it("publishes and lists in recent", async () => { … });
  it("rejects cross-tenant access", async () => { … });
  it("honors test flag → runs.isTest", async () => { … });
  it("writes audit row when source=operator", async () => { … });
  it("returns causality DAG up to depth 3", async () => { … });
  it("SSE delivers a published event within 500ms", async () => { … });
});
```

Follow the `pool: "forks"` + `sequence.concurrent: false` setup already in `vitest.config.ts`; tests share `data/agentic.db`.

## 3. Frontend patches

### 3.1 `apps/web/public/portal/views/event-tester.jsx` (new)

Top-level component skeleton (full file below):

```jsx
const { useState, useMemo, useEffect, useRef } = React;

function EventTester({ navigate, params, liveStream }) {
  // 1. Catalog fetch (one-shot at mount)
  const [catalog, setCatalog] = useState([]);
  useEffect(() => {
    fetch("/v1/events/catalog", { headers: window.RAAS_AUTH_HEADERS }).then(r => r.json()).then(j => setCatalog(j.events ?? []));
  }, []);

  // 2. Selected event + form state
  const [selectedName, setSelectedName] = useState(params.eventName ?? null);
  const event = useMemo(() => catalog.find(e => e.name === selectedName) ?? null, [catalog, selectedName]);
  const [subject, setSubject] = useState("");
  const [testMode, setTestMode] = useState(true);
  const [fieldValues, setFieldValues] = useState({});

  // 3. Recent events (SSE)
  const [recent, setRecent] = useState([]);
  useEffect(() => {
    const es = new EventSource("/v1/events/stream");
    es.addEventListener("event", (e) => {
      const row = JSON.parse(e.data);
      setRecent(prev => [row, ...prev].slice(0, 100));
    });
    return () => es.close();
  }, []);

  // 4. Causality (fetched after publish)
  const [pinnedEventId, setPinnedEventId] = useState(null);
  const [causality, setCausality] = useState(null);
  useEffect(() => {
    if (!pinnedEventId) return;
    const id = setInterval(async () => {
      const r = await fetch(`/v1/events/recent?causality=1&seed=${pinnedEventId}`, { headers: window.RAAS_AUTH_HEADERS });
      setCausality(await r.json());
    }, 1000);
    return () => clearInterval(id);
  }, [pinnedEventId]);

  const onPublish = async () => {
    const body = { name: selectedName, subject: subject || undefined, payload: fieldValues, test: testMode, source: "operator" };
    const r = await fetch("/v1/events", { method: "POST", headers: { "Content-Type": "application/json", ...window.RAAS_AUTH_HEADERS }, body: JSON.stringify(body) });
    const j = await r.json();
    if (j?.data?.event_id) setPinnedEventId(j.data.event_id);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ViewHeader title="Event Tester" subtitle={`${catalog.length} event types in this tenant`} />
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "260px 1fr 360px", minHeight: 0 }}>
        <EventTesterCatalogSidebar catalog={catalog} selected={selectedName} onSelect={setSelectedName} />
        <EventTesterPublishPane event={event} subject={subject} setSubject={setSubject} testMode={testMode} setTestMode={setTestMode} fieldValues={fieldValues} setFieldValues={setFieldValues} onPublish={onPublish} />
        <EventTesterRecentPane recent={recent} pinnedEventId={pinnedEventId} causality={causality} navigate={navigate} />
      </div>
    </div>
  );
}

// All sub-components are prefixed EventTester* to avoid global-scope collision per CLAUDE.md.
function EventTesterCatalogSidebar({ … }) { … }
function EventTesterPublishPane({ … }) { … }
function EventTesterFieldRow({ field, value, onChange }) {
  switch (field.type) {
    case "Boolean": return <Toggle … />;
    case "Number": case "Integer": return <NumberInput … />;
    case "Date": case "DateTime": return <input type="datetime-local" … />;
    default:
      if (field.type.startsWith("Array<")) return <EventTesterArrayInput … />;
      if (field.enum?.length) return <Select … />;
      return <input type="text" … />;
  }
}
function EventTesterRecentPane({ … }) { … }
function EventTesterCausalityMinimap({ … }) { … }
function EventTesterCurlPreview({ … }) { … }
function EventTesterPresets({ … }) { … }
```

### 3.2 `apps/web/public/portal/index.html`

Add (alphabetically after `events.jsx`):

```html
<script type="text/babel" src="/portal/views/event-tester.jsx"></script>
```

### 3.3 `apps/web/public/portal/app.jsx`

In the Sidebar's "Operate" group, add:

```jsx
<NavItem id="event-tester" view={view} navigate={navigate} icon="play" label="Event Tester" />
```

In the App's view dispatch:

```jsx
{view === "event-tester" && <EventTester navigate={navigate} params={params} liveStream={tweaks.liveStream} />}
```

### 3.4 Auth header helper

If `window.RAAS_AUTH_HEADERS` doesn't already exist (used in other views), add it to `data.js` early init — it's an object with `{ Authorization: \`Bearer ${token}\` }` derived from the bootstrap response. Re-use whatever pattern the existing views use to call `/v1/*` from the SPA — `events.jsx` and `runs.jsx` already do this; mirror their helper.

## 4. Verification checklist

| # | Step | Pass criterion |
|---|---|---|
| 1 | `pnpm install && pnpm db:migrate && pnpm db:seed && pnpm seed:rich` | No errors |
| 2 | `pnpm dev` | Web on :3599, API on :3501, Inngest on :8288 |
| 3 | Open http://localhost:3599/ → Event Tester in sidebar | View renders |
| 4 | Catalog sidebar shows 3 RAAS events | `CLIENT_RULES_PASSED`, `CLIENT_RULES_FAILED`, `AI_INTERVIEW_COMPLETED` |
| 5 | Select `CLIENT_RULES_PASSED` → form shows 3 typed fields | `client_id`, `candidate_id`, `rules_passed` |
| 6 | Fill in values, subject `req-test-001`, click Publish | Success toast; event_id pinned |
| 7 | Recent pane shows the new event within ~500ms | Visible via SSE |
| 8 | Causality minimap shows seed → downstream run within 2s | `analyzeRequirement` (or whichever) fires |
| 9 | Run appears in Runs view with `isTest=true` | Filter "test runs" includes it |
| 10 | `data/logs/<tenant>/audit/<date>.log` contains `event.publish` row | Confirms audit hook |
| 11 | `pnpm --filter @agentic/api exec vitest run test/event-tester.test.ts` | All 6 tests pass |
| 12 | Stop dev, restart, repeat #5: catalog still loads | Idempotence |
| 13 | Open 2 tabs of Event Tester, publish in one | Other tab's Recent pane shows it (proves shared SSE) |
| 14 | Quit out of view → Network tab shows the EventSource closed | No leaked connections |

## 4.1 Runtime patch (Round-1 reviewer consensus blocker)

Three independent reviews flagged that the manifest path in `packages/runtime/src/register.ts` did not read `event.data.__test` and did not set `runs.isTest`. Without this, the "Mark as test run" toggle was UI-only and dashboards stayed polluted by test traffic.

Patch (already applied):

```diff
   async ({ event, step, logger }) => {
     const data = (event.data ?? {}) as Record<string, unknown>;
     const subject = typeof data.subject === "string" ? data.subject : null;
+    const isTest = data.__test === true;
     …
     db.insert(runs).values({
       …
+      isTest,
     }).run();
```

The code-agent path (`packages/agent-runtime/src/run-engine.ts`) already honored a `testRun` flag set by `agent-invoke.ts`; both paths now write `runs.isTest = true` in the situations they should.

## 5. Out-of-scope (linked tickets to file)

- **Burst publish** (count > 1)
- **Schema-driven assertions** (declare expected downstream events; run as evals)
- **Templated payloads** (handlebars on presets)
- **System-tenant publishing** (cross-tenant via sysadmin role)

## 6. Migrations & rollback

- **One migration:** `packages/db/drizzle/0013_confused_vertigo.sql` — adds `evt_tenant_received_idx (tenant_id, received_at)`. Round-1 reviewer correctly flagged that the original "no migrations" claim was wrong: the SSE poll query (no `?names=` filter) cannot use the existing `(tenant_id, name, received_at)` index because the `name` column sits between the equality and the range predicate. The new covering index keeps the 250ms poll a B-tree seek on tenants with 100k+ events.
- Rollback = revert PR + drop the index (`DROP INDEX evt_tenant_received_idx`). The new endpoints disappear and the UI nav item is gone. Existing event ingest/replay paths are untouched.
- Contracts addition is purely additive — old clients keep working.

## 7. Files added / modified

```
ADDED:
  apps/api/src/queries/events.ts                                 (329 lines)
  apps/api/test/event-tester.test.ts                             (789 lines, 11 tests)
  apps/web/public/portal/views/event-tester.jsx                  (1696 lines)
  packages/db/drizzle/0013_confused_vertigo.sql                  (the SSE index)
  docs/prd/event-tester.md
  docs/design/event-tester.md
  docs/impl/event-tester.md
  docs/audits/event-tester-review-ai-architect-round-1.md        (AI Architect)
  docs/audits/event-tester-review-backend-eng-round-1.md         (Principal engineer)
  docs/audits/event-tester-review-ai-software-architect-round-1.md (Software Architect / OS-readiness)
  docs/audits/event-tester-review-consolidation.md               (cross-review synthesis + fix log)

MODIFIED:
  packages/contracts/src/events.ts        (additive schemas)
  apps/api/src/routes/v1/events.ts        (3 new routes + extend POST + audit refinement)
  apps/web/public/portal/index.html       (1 script tag)
  apps/web/public/portal/app.jsx          (sidebar + dispatch)
  packages/runtime/src/register.ts        (PLUMB __test → runs.isTest — Round-1 BLOCK)
  packages/db/src/schema.ts               (covering index for SSE poll)
```

## 8. Round-1 review results

All three reviewers (AI Architect · Principal engineer · AI Software Architect) returned `iterate` and converged on the same load-bearing bug (`__test` not plumbed in manifest runtime). It has been fixed. See [docs/audits/event-tester-review-consolidation.md](../audits/event-tester-review-consolidation.md) for the full finding-by-finding status table.

**Test status:** `pnpm --filter @agentic/api exec vitest run test/event-tester.test.ts` → 11/11 passing.
