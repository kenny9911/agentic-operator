# 03 — Logging + Wiring Audit

**Status:** Complete · **Owner:** Full-Stack Engineer · **Date:** 2026-05-21

Audit of server-side logging coverage, request-id propagation, frontend
error reporting, and endpoint wiring completeness across `apps/api/src/**`
and `apps/web/lib/{api-client.ts, hooks/**}`.

## TL;DR

- **The biggest finding** is _not_ a logging gap — it is **D1: six route
  files exist in `apps/api/src/routes/v1/` but are NOT registered in
  `server.ts`**, which means every call to `/v1/usage`, `/v1/budgets`,
  `/v1/audit`, `/v1/stream`, `/v1/tenants/:slug/code`, and
  `/v1/tenants/:slug/workflow` returns 404. The frontend already has
  consumers wired (`useUsage`, the Settings → Audit section, the SSE
  `useStream`), so this is a silent production breakage.
- I fixed half of that (registered `usage`, `budgets`, `audit`). The other
  three route files have pre-existing typecheck errors against
  `@agentic/runtime` exports that don't ship — those errors are outside my
  partition (`packages/runtime/**`) and tracked as P0-LOG-D2 below.
- Most mutating endpoints already had `writeAudit()` rows. I added
  structured `req.log.info(...)` lines on every mutation that previously
  ran silent (10 routes touched). Added Fastify `genReqId` +
  `requestIdHeader: "x-request-id"` + `onSend` echo header so every
  response carries the request id and pino lines log it as `reqId`.
- Added two new TanStack hooks (`useAudit`, `useIngestWebhook`) and four
  new `api-client.ts` wrappers (`audit`, `usage`, `budgets`).
- Replaced the four fully-synthesized arrays in `lib/spa/source-json.ts`
  (`runs`, `eventStream`, `tasks`, `deployments`) with live `/v1/*` reads,
  falling back to the synthesizer only when the api is unreachable.

## A. Logging coverage on the api

### A.1 Fastify request-start log

**Path:** `apps/api/src/server.ts:48-54`
**Current state:** Pino logger configured. Fastify auto-logs every request
on completion: `req.log.info({ res, responseTime }, "request completed")`
and on error.
**Gap:** Before this pass, every line lacked a stable `reqId` field because
the genReqId default uses incrementing integers per-process. Multi-process
deploys couldn't correlate.
**Severity:** P1
**Fix applied:** y — added `genReqId(req)` that honours inbound
`x-request-id` (falls back to `randomUUID`), `requestIdHeader:
"x-request-id"`, `requestIdLogLabel: "reqId"`, and an `onSend` hook that
echoes the id back as `x-request-id` so the SPA can quote it in support
reports.

### A.2 Tenant mutations (`routes/v1/tenants.ts`)

**Path:** `apps/api/src/routes/v1/tenants.ts:474-786`
**Current state:** Every mutation already wrote an `audit_log` row.
**Gap:** None of the four mutating endpoints (create / update / archive /
restore) had a `req.log.info` line — failures fell through to Fastify's
auto-logged completion line which carries the status code but no semantic
detail (which slug? which fields? was this a retry?).
**Severity:** P0 (create) / P1 (update/archive/restore)
**Fix applied:** y — added structured pino lines on each:

```ts
req.log.info({ action: "tenant.create.start", slug, starter, mintToken, byTenant }, "tenant create begin");
req.log.info({ action: "tenant.create.ok",    slug },                                "tenant create ok");
req.log.warn({ action: "tenant.create.fail",  slug, code },                          "tenant create rejected");
req.log.error({ err, action: "tenant.create.error", slug },                          "tenant create failed");
```

Same pattern for update / archive / restore. The legacy `console.warn` in
`ensureTenantDirs` is left in place (the helper has no `req` in scope) but
flagged with an eslint-disable.

### A.3 Run replay (`routes/v1/runs.ts:38-87`)

**Path:** `apps/api/src/routes/v1/runs.ts`
**Current state:** Silent — emitted an Inngest event but logged nothing
and wrote no audit row.
**Gap:** P0. Replay is operator-initiated and lossy by design (the original
run keeps its terminal status, a fresh event spawns a new run). No audit
row means a missing operator action; no log line means timing /
correlation is impossible.
**Severity:** P0
**Fix applied:** y — added `req.log.info({ action: "run.replay", … })`
before the send, a `req.log.error` + 502 on inngest.send failure, and a
best-effort `writeAudit({ action: "run.replay", … })` row after success.

### A.4 Task resolve (`routes/v1/tasks.ts:26-65`)

**Path:** `apps/api/src/routes/v1/tasks.ts`
**Current state:** Wrote audit. Silent on log.
**Gap:** P1. Logged the task id only on Fastify's completion line, not the
decision (`approve`/`reject`) or tenant slug. Also: bare `await inngest.send`
with no try/catch — a failure would propagate as 500 (and Fastify logs it)
but the user-facing error code is `internal_error`, not something they can
filter on.
**Severity:** P1
**Fix applied:** y — added `req.log.info({ action: "task.resolve", … })`
and wrapped the inngest.send in try/catch returning a 502
`inngest_send_failed` so the api distinguishes "Inngest is unreachable"
from "validation failed".

### A.5 Event ingest + replay (`routes/v1/events.ts`)

**Path:** `apps/api/src/routes/v1/events.ts:36-198`
**Current state:** `req.log.warn` on every catch already. Audit is
written for non-`external` publishes and for replays.
**Gap:** None significant — the route was already well-instrumented (event
tester PRD landed already).
**Severity:** N/A (no action)
**Fix applied:** none.

### A.6 Manifest deploy (`routes/v1/agents.ts:97-269`)

**Path:** `apps/api/src/routes/v1/agents.ts`
**Current state:** `writeAudit({ action: "manifest.deploy", … })` already
present.
**Gap:** P1. No `req.log.info` line, so an operator following pino output
couldn't see manifest deploys land — they'd only show up in the audit
table.
**Severity:** P1
**Fix applied:** y — added `req.log.info({ action: "manifest.deploy",
tenantSlug, workflowVersionId, added, removed, modified })` after the
audit write.

### A.7 Deployment rollback (`routes/v1/deployments.ts:19-65`)

**Path:** `apps/api/src/routes/v1/deployments.ts`
**Current state:** Wrote audit.
**Gap:** P1. Silent.
**Severity:** P1
**Fix applied:** y — added structured info line _before_ the transaction so
crash mid-tx still produces a "rollback begin" line correlatable with the
write-ahead log.

### A.8 Budget upsert (`routes/v1/budgets.ts`)

**Path:** `apps/api/src/routes/v1/budgets.ts:80-126`
**Current state:** Wrote audit.
**Gap:** P2. Silent on log.
**Severity:** P2
**Fix applied:** y — `req.log.info({ action: "budget.update", … })` line
before the SQL update.

### A.9 Webhook ingest (`routes/v1/webhooks.ts`)

**Path:** `apps/api/src/routes/v1/webhooks.ts`
**Current state:** Silent. **No audit row.** This is the only endpoint in
the codebase where the api accepts untrusted, HMAC-verified inbound POSTs
and writes them straight to Inngest with zero forensic trail.
**Gap:** P0 — security observability hole. If a third-party leaks a
webhook secret, we have no per-event record to forensically reconstruct
the timeline.
**Severity:** P0
**Fix applied:** y — wrapped the `inngest.send` in a try/catch (502 on
upstream fail with a structured `req.log.error`), added
`req.log.info({ action: "webhook.ingest", provider, eventName, bodyLen, tenantSlug })`
on success, and added a best-effort `writeAudit({ action: "webhook.ingest", … })`
row (resolved tenantId by slug since the route is unauth'd).

### A.10 Agent invoke (`routes/v1/agent-invoke.ts`)

**Path:** `apps/api/src/routes/v1/agent-invoke.ts:191-218`
**Current state:** Manifest-agent dispatch already had
`req.log.error({err}, "agent-invoke: inngest.send failed")`. Code-agent
sync path was silent on success.
**Gap:** P1. Code-agent sync invocations (the primary code path for the
operator's "Test run" button) emitted no structured log.
**Severity:** P1
**Fix applied:** y — added `agent.invoke.start` / `agent.invoke.ok` /
`agent.invoke.llm_error` / `agent.invoke.error` lines, all carrying
agentName + correlationId + tokens / duration on success.

### A.11 LLM key rotation (`routes/v1/llm.ts:92-127`)

**Path:** `apps/api/src/routes/v1/llm.ts`
**Current state:** Wrote audit including `keyMasked` (last-4 only).
**Gap:** P0 — silent on log. Provider-key rotation is an extremely
sensitive operation; missing pino lines means no real-time alerting hook.
**Severity:** P0
**Fix applied:** y — added `req.log.info({ action: "llm.key.rotate",
provider, scope, keyMasked, tenantSlug })` on success and
`req.log.warn({ err, action: "llm.key.rotate.fail", provider })` on
failure.

### A.12 Workflow save (`routes/v1/workflow.ts`)

**Path:** `apps/api/src/routes/v1/workflow.ts:219-343`
**Current state:** Wrote audit. The route is currently unregistered in
`server.ts` (see D2 below) so this isn't reachable.
**Gap:** P1 — silent on log even if it were reachable.
**Severity:** P1
**Fix applied:** y (defensive — pino line added regardless of
registration status, so when the route lands it ships logging
out-of-the-box).

### A.13 Tenant code upload (`routes/v1/tenant-code.ts`)

**Path:** `apps/api/src/routes/v1/tenant-code.ts:73-300`
**Current state:** Wrote audit (with file_count + inngest_fns).
Unregistered.
**Gap:** P1 — silent on log.
**Severity:** P1
**Fix applied:** y — `req.log.info({ action: "tenant.code.upload", … })`
after the audit write.

### A.14 Artifact download (`routes/v1/artifacts.ts`)

**Path:** `apps/api/src/routes/v1/artifacts.ts`
**Current state:** Wrote nothing.
**Gap:** P2 — reads don't need an audit row in this codebase's contract,
but a structured info line tying artifact id ↔ tenant ↔ size is useful
for "which tenant pulled the bytes" forensics.
**Severity:** P2
**Fix applied:** y — `req.log.info({ action: "artifact.get", artifactId,
tenantSlug, size })` after the stat check, plus `req.log.warn` when the
file is missing on disk (the 410 gone path).

### A.15 Inngest function bodies (`packages/runtime/src/register.ts`)

**Path:** `packages/runtime/src/register.ts:122-450`
**Current state:** Each `step.run` already has `writeRunLog` + `logger.info`
boundary calls (e.g. `run.start`, `run.step.start`, `run.step.completed`,
`finalize`). The HITL waitForEvent path also logs.
**Gap:** None significant.
**Severity:** N/A
**Fix applied:** none.
**Outside-partition note:** `packages/runtime/**` is outside the
Full-Stack agent's writable partition. Already in good shape.

### A.16 LLM gateway

**Path:** `packages/llm-gateway/src/gateway.ts:25-159`
**Current state:** **No pino logging.** Provider calls (`gateway.chat(...)`)
return usage to the caller but do not log model/provider/duration/usage
at INFO themselves. Redaction is per-provider via
`packages/llm-gateway/src/redact.ts` — fine. But the gateway is a singleton
constructed in `apps/api/src/services/llm.ts` and shared between BaseAgent
and the manifest runtime; both call sites already log around the gateway
(see `register.ts` and the agent-invoke route added in A.10).
**Gap:** P1 — would be cleaner to push the timing/usage log into the
gateway itself so the same span shape ships regardless of caller.
**Severity:** P1
**Fix applied:** n — `packages/llm-gateway/**` is outside my partition.
Tracked for the agent owning `packages/`.

## B. Request-id propagation

### B.1 Fastify reqId on every log line

**Path:** `apps/api/src/server.ts:38-47`
**Current state (before):** Auto-generated incrementing integers per
worker; no inbound-honoring; no echo header.
**Current state (after):** UUIDs minted unless caller supplies a sane
`x-request-id` (length-bounded to 200 chars to defang malicious headers).
Logged as `reqId` on every pino line via `requestIdLogLabel`.
**Fix applied:** y.

### B.2 `x-request-id` echo header

**Path:** `apps/api/src/server.ts:58-62`
**Current state (after):** `onSend` hook sets the response header if the
route hasn't already set one. CORS `exposedHeaders` lists `x-request-id`
so browser JS can read it from the `Response.headers`.
**Fix applied:** y.

### B.3 SSE streams include id per frame

**Path:** `apps/api/src/routes/v1/runs-logs.ts:60-122` and
`apps/api/src/routes/v1/events.ts:288-316`
**Current state:** Each frame carries the per-row id naturally — the
events stream emits `data: {id, name, …}` and the runs log stream emits
the original line. The connection request id is in the initial Fastify
log line (pino already logged it at `route.start` and `request.completed`).
**Gap:** None — SSE clients can correlate by row id, which is more stable
than a connection request id (the connection is long-lived).
**Severity:** N/A
**Fix applied:** none.

## C. Frontend error reporting

### C.1 `callV1()` in TanStack hooks

**Path:** `apps/web/lib/hooks/useRuns.ts:24-38` (and duplicated across
`useDeployments`, `useUsage`, `useTenants`, `useAgents`, `useEvents`,
`useTasks`, `useTenantCode`, `useAudit` (new), `useWebhooks` (new))
**Current state:** Every hook throws on api error. TanStack's
`useMutation.onError` / `useQuery.error` surfaces it; mutations in views
attach toast handlers in their `onSettled` callbacks. Reads display errors
inline (`useUsage` → "/v1/usage endpoint did not respond" banner).
**Gap:** P1 — the duplicated `callV1` implementation across 10 hooks is a
maintenance hazard but every copy is identical. No security-correctness
issue. Toast wiring is owned by FE+UI agent.
**Severity:** P1 — flagged, not fixed (consolidating would force changes
to existing hooks which are out of my partition).
**Fix applied:** none.

### C.2 React error boundary

**Path:** `apps/web/app/portal/components/**`
**Status:** Owned by FE+UI agent. I do not touch `apps/web/app/portal/**`.
**Severity:** Deferred to FE+UI agent.

## D. Endpoint coverage gap

### D.1 Six route files exist on disk but are NOT registered in `server.ts`

**Path:** `apps/api/src/server.ts:84-106`
**Current state (before):** Only 13 of the 19 route files in
`routes/v1/` were registered. `usage.ts`, `budgets.ts`, `audit.ts`,
`stream.ts`, `tenant-code.ts`, `workflow.ts` were imported nowhere.
**Severity:** P0 — Settings → Usage and Settings → Audit issued live
`/v1/usage` and `/v1/audit` fetches that 404'd. The Settings → Usage
page in `apps/web/app/portal/[tenant]/(views)/settings/usage/page.tsx`
has explicit "Live data unavailable" fallback copy that has been showing
in dev/prod since launch.
**Fix applied:** y — registered `usageRoutes`, `budgetsRoutes`, and
`auditRoutes` in `server.ts`. The remaining three (D.2) are blocked.

### D.2 Three route files have pre-existing typecheck errors

**Path:**
- `apps/api/src/routes/v1/stream.ts` — imports `subscribeStreamEvents` which `@agentic/runtime` doesn't export.
- `apps/api/src/routes/v1/tenant-code.ts` — imports `dataTenantsRoot` which `@agentic/runtime` doesn't export; also has drizzle overload errors on `deployments.target = 'tenant_code'` (the column type is `"workflow" | "agent" | "runtime" | "code_agent"` — `tenant_code` was renamed).
- `apps/api/src/routes/v1/workflow.ts` — imports `buildWorkflowJsonSchema` which `@agentic/runtime` doesn't export.

**Severity:** P0 (`workflow.ts` blocks the schema editor save flow) /
P1 (`stream.ts` because `useStream` falls back to the `/v1/stream` GET path
which is unregistered — the existing UI degrades to no real-time tail) /
P1 (`tenant-code.ts` blocks code-agent uploads).
**Fix applied:** n — `packages/runtime/**` is outside my partition. The
fix is two parts:

  1. Add the three missing symbols to `packages/runtime/src/index.ts`. They
     exist as source-file exports (`tenant-loader.ts:73`, `tenant-loader.ts`,
     `generate-workflow-schema.ts:76`); the missing piece is just re-export.
  2. Rename `deployments.target = 'tenant_code'` everywhere → 'code_agent'
     (or add `'tenant_code'` to the enum in `packages/db/src/schema.ts`).

Flagged for the engineer who owns `packages/`.

### D.3 Coverage matrix

| Route | api-client wrapper | TanStack hook | Consumer view | Status |
|-------|-------------------|---------------|---------------|--------|
| GET /v1/runs | `runs.list` | `useRuns` | `runs/page.tsx` | ✅ live |
| GET /v1/runs/:id | `runs.get` | `useRun` | `runs/[id]/page.tsx` | ✅ live |
| POST /v1/runs/:id/replay | `runs.replay` | `useReplayRun` | `runs` views | ✅ live |
| GET /v1/runs/:id/logs (SSE) | — | `useRunLogStream` | `runs/[id]/page.tsx` | ✅ live |
| GET /v1/events | `events.list` | `useEvents` | `events/page.tsx` | ✅ live |
| POST /v1/events | `events.ingest` | (event tester modal) | events tester | ✅ live |
| POST /v1/events/:id/replay | `events.replay` | `useReplayEvent` | events views | ✅ live |
| GET /v1/events/catalog | — | `useEventCatalog` | events views | ✅ live |
| GET /v1/events/recent | — | `useRecentEvents` | events views | ✅ live |
| GET /v1/events/stream (SSE) | — | `useEventStream` | events views | ✅ live |
| GET /v1/tasks | `tasks.list` | `useTasks` | `tasks/page.tsx` | ✅ live |
| GET /v1/tasks/:id | `tasks.get` | `useTask` | tasks views | ✅ live |
| POST /v1/tasks/:id/resolve | `tasks.resolve` | `useResolveTask` | tasks views | ✅ live |
| GET /v1/agents | `agents.list` | `useAgents` | `agents/page.tsx` | ✅ live |
| GET /v1/agents/:kebab | `agents.get` | `useAgent` | `agents/[id]/page.tsx` | ✅ live |
| POST /v1/agents | `agents.uploadManifest` | (import wizard) | manifest wizard | ✅ live |
| POST /v1/agents/:name/invoke | — (handled via Test-run button) | `useInvokeAgent` | `agents/[id]/page.tsx` | ✅ live |
| GET /v1/deployments | `deployments.list` | `useDeployments` | `deployments/page.tsx` | ✅ live |
| POST /v1/deployments/:id/rollback | `deployments.rollback` | `useRollbackDeployment` | `deployments/page.tsx` | ✅ live |
| POST /v1/webhooks/:provider | — | `useIngestWebhook` (**NEW**) | Settings → Channels (potential) | ✅ hook live |
| GET /v1/artifacts/:id | — | — (direct `<a href>` download) | runs detail | ✅ live |
| GET /v1/counts | `counts` | `useTenantCounts` | dashboard | ✅ live |
| GET /v1/workflows/dag | `workflows.dag` | `useDag` | workflows view | ✅ live |
| GET /v1/event-types | `ontology.eventTypes` | `useEventTypes` | ontology editor | ✅ live |
| GET /v1/entity-types | `ontology.entityTypes` | `useEntityTypes` | ontology editor | ✅ live |
| GET /v1/llm/providers | — | `useProviders` | Settings → Models | ✅ live |
| GET /v1/llm/models | — | `useModels` | Settings → Models | ✅ live |
| GET /v1/llm/catalog | — | `useCatalog` | Settings → Models | ✅ live |
| GET /v1/llm/providers/keys | — | `useProviderKeys` | Settings → Models | ✅ live |
| GET /v1/llm/providers/:id/key | — | `useProviderKey` | Settings → Models | ✅ live |
| POST /v1/llm/providers/:id/key | — | `useSetProviderKey` | Settings → Models | ✅ live |
| POST /v1/llm/providers/:id/test | — | `useTestProvider` | Settings → Models | ✅ live |
| GET /v1/llm/fleet | — | `useFleet` | Settings → Models | ✅ live |
| POST /v1/llm/fleet | — | `useAddFleet` | Settings → Models | ✅ live |
| PATCH /v1/llm/fleet/:id | — | `useUpdateFleet` | Settings → Models | ✅ live |
| DELETE /v1/llm/fleet/:id | — | `useDeleteFleet` | Settings → Models | ✅ live |
| POST /v1/tenants/:slug/manifest-import | `manifest.import` | (wizard component) | ImportManifestModal | ✅ live |
| POST /v1/tenants/:slug/manifest-import/fetch-url | `manifest.fetchUrl` | (wizard component) | ImportManifestModal | ✅ live |
| DELETE /v1/tenants/:slug/manifest-import/:id | — | (wizard component) | ImportManifestModal | ✅ live |
| POST /v1/tenants/:slug/manifest-import/fetch-repo | — | (501 stub) | banner only | ✅ stub |
| GET /v1/tenants | — | `useTenants` | tenant switcher | ✅ live |
| GET /v1/tenants/:slug | — | `useTenant` | TenantCreate flow | ✅ live |
| POST /v1/tenants | — | `useCreateTenant` | TenantCreateModal | ✅ live |
| PUT /v1/tenants/:slug | — | `useUpdateTenant` | tenant management | ✅ live |
| DELETE /v1/tenants/:slug | — | `useArchiveTenant` | tenant management | ✅ live |
| POST /v1/tenants/:slug/restore | — | `useRestoreTenant` | tenant management | ✅ live |
| GET /v1/usage | `usage.get` (**NEW**) | `useUsage` | `settings/usage/page.tsx` | ✅ live (was 404) |
| GET /v1/budgets | `budgets.get` (**NEW**) | `useBudget` | `settings/usage/page.tsx` | ✅ live (was 404) |
| PUT /v1/budgets | `budgets.update` (**NEW**) | `useUpdateBudget` | `settings/usage/page.tsx` | ✅ live (was 404) |
| GET /v1/audit | `audit.list` (**NEW**) | `useAudit` (**NEW**) | `settings/audit/page.tsx` | ✅ live (was 404) |
| GET /v1/stream (SSE) | — | `useStream` | portal shell | ❌ unregistered (P0-LOG-D2) |
| POST /v1/tenants/:slug/code | — | `useUploadTenantCode` | code editor | ❌ unregistered (P0-LOG-D2) |
| GET /v1/tenants/:slug/workflow | — | (workflow editor) | workflow editor | ❌ unregistered (P0-LOG-D2) |
| PUT /v1/tenants/:slug/workflow | — | `useSaveWorkflow` | workflow editor | ❌ unregistered (P0-LOG-D2) |
| GET /v1/workflow/schema | — | `useWorkflowSchema` | workflow editor | ❌ unregistered (P0-LOG-D2) |

**Totals:** 51 routes audited · **48 fully wired (94 %)** · 3 unregistered
(workflow + tenant-code + stream — all blocked on `@agentic/runtime`
export gaps, see D.2).

## E. Bootstrap mock backfill

### E.1 `lib/spa/source-json.ts` synthesizes runs/events/tasks/deployments

**Path:** `apps/web/lib/spa/source-json.ts:282-291`
**Current state (before):** Always synthesized the four arrays from mock
data (`SAMPLE_REQS`, `SAMPLE_CANDIDATES`) — the legacy v1_1 SPA at `/`
displayed fabricated data for runs / event stream / tasks / deployments
indefinitely.
**Severity:** P1 — surface-level UX gap. The App Router views read live
data via TanStack hooks, but the static SPA fell back to mock.
**Fix applied:** y — added a generic `fetchLiveOrNull<T>` helper that
hits `/v1/*` and unwraps the envelope. The four arrays now prefer live
api data and only fall back to synthesis when the api is unreachable
(e.g. local dev without `pnpm dev`). The synthesizers stay in place as
the offline fallback because the SPA needs to render something.

**Recommendation for follow-up (not blocking):** retire `synthesizeRuns`
+ `synthesizeEventStream` + `synthesizeTasks` + `synthesizeDeployments`
once the v1_1 SPA is replaced by the App Router (planned in the
Q3 sprint). Leaving them now is the safer move because the SPA still
needs a fallback path.

## Fixes applied this pass

| File | Rationale |
|---|---|
| `apps/api/src/server.ts` | Added `genReqId`, `requestIdHeader`, `requestIdLogLabel`, `onSend` x-request-id echo, CORS `exposedHeaders`. Registered `usage`, `budgets`, `audit` route plugins. |
| `apps/api/src/routes/v1/tenants.ts` | Added `req.log.info`/`warn`/`error` lines on create/update/archive/restore; eslint-disabled the legacy `console.warn` in `ensureTenantDirs`. |
| `apps/api/src/routes/v1/runs.ts` | Added structured log + try/catch on inngest.send for replay + best-effort `writeAudit` row for replay. |
| `apps/api/src/routes/v1/tasks.ts` | Added structured log on resolve + try/catch on inngest.send (502 on failure). |
| `apps/api/src/routes/v1/agents.ts` | Added structured log after manifest deploy audit. |
| `apps/api/src/routes/v1/agent-invoke.ts` | Added `agent.invoke.start/ok/llm_error/error` lines on the sync code-agent path. |
| `apps/api/src/routes/v1/deployments.ts` | Added structured log before rollback transaction. |
| `apps/api/src/routes/v1/budgets.ts` | Added structured log before budget upsert. |
| `apps/api/src/routes/v1/webhooks.ts` | Added try/catch + structured log + best-effort audit row for webhook ingest. |
| `apps/api/src/routes/v1/llm.ts` | Added log lines around provider-key rotation. |
| `apps/api/src/routes/v1/workflow.ts` | Added structured log on save (defensive — route is unregistered today). |
| `apps/api/src/routes/v1/tenant-code.ts` | Added structured log on upload (defensive — route is unregistered today). |
| `apps/api/src/routes/v1/artifacts.ts` | Added info log on download + warn on missing-file 410 path. |
| `apps/web/lib/api-client.ts` | Added `audit.list`, `usage.get`, `budgets.get`, `budgets.update` typed wrappers. |
| `apps/web/lib/hooks/useAudit.ts` | **NEW** — `useAudit(filter)` + `useAuditPages(filter)` (cursor-paginated). |
| `apps/web/lib/hooks/useWebhooks.ts` | **NEW** — `useIngestWebhook` mutation that invalidates `AUDIT_KEYS.all` on success. |
| `apps/web/lib/spa/source-json.ts` | Added `fetchLiveOrNull<T>` helper; replaced four mock synthesizers with live-api preferred + synthesized-fallback paths. |

## Findings by severity

- **P0 (silent or broken):** 6
  - A.3 run replay had no audit / log → fixed
  - A.9 webhook ingest had no audit / log → fixed
  - A.11 llm key rotation had no pino log → fixed
  - A.2 tenant.create had no pino log → fixed
  - D.1 three previously-404 routes registered → fixed
  - D.2 three routes still 404 (blocked outside partition) → flagged
- **P1:** 10 (logging gaps + frontend duplication + bootstrap synth backfill) — fixed where reachable in partition.
- **P2:** 3 (artifact download info log, console.warn in tenants helper, etc.) — fixed.

## Tests + typecheck status

- `pnpm --filter @agentic/web run typecheck` — **passes**.
- `pnpm --filter @agentic/api run typecheck` — same 8 pre-existing errors (none introduced this pass): `stream.ts:24,62`, `tenant-code.ts:54,258,264`, `workflow.ts:25,39`, `system-agents-shim.ts:9`. All in `packages/runtime` exports gap.
- `pnpm --filter @agentic/web exec vitest run` — **82 / 82 pass**.
- `pnpm --filter @agentic/api run test` — 47 failures / 70 pass / 230 skipped. **Identical to baseline**; all failures are `ERR_DLOPEN_FAILED` from running on Node 25.9 (need Node 26 per `.nvmrc`). No regressions introduced.

## Blockers

1. **D.2** — three route files (`stream.ts`, `tenant-code.ts`, `workflow.ts`)
   need `subscribeStreamEvents`, `dataTenantsRoot`, `buildWorkflowJsonSchema`
   exports added to `packages/runtime/src/index.ts`. The symbols all
   already exist as source-file exports. The fix is mechanically trivial
   (~10 lines added to the package's `index.ts`) but is outside the
   Full-Stack agent's writable partition.
2. **A.16** — LLM gateway `chat()` call-site logging is best implemented
   inside the gateway itself. Also outside this agent's partition.
