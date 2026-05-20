# Backend Implementation Review — Production Readiness

> Audit scope: `apps/api`, `packages/{db,contracts,runtime,agents,agent-kit,llm-gateway,shared,tools}`, monorepo + build/deploy. UI critique excluded per scope.
> Reviewer perspective: principal fullstack engineer, hardening for first paying customer.

---

## 1. Executive summary

The platform has a *coherent, design-led* skeleton: clean envelope, typed contracts shared end-to-end, WAL-mode SQLite, a layered runtime (manifest agents on Inngest + code agents on `BaseAgent`), and a working LLM gateway with 14 providers. Architecturally this is a strong v1 — easily an order of magnitude ahead of typical "agent platform" prototypes. **However, it is not production-grade yet** along several axes that matter the moment a real tenant lands: auth is in permanent dev-mode bypass, cross-tenant isolation has a documented `__system` escape hatch on `/v1/runs/:id`, `bootstrapRuntime()` does heavy DB writes at server start (a startup-vs-migration race), there is no rate limit / body limit / helmet, no graceful shutdown, no compiled build target, and the web app's `/api/spa/bootstrap` synthesizes most of its data instead of going to `/v1/*`.

**tl;dr**
- Envelope, contracts, schema, indexes: solid foundation, keep.
- Auth: `requireAuth` always returns the dev tenant outside `production` — needs real bearer/cookie story before any external user.
- Tenant isolation: `__system` fallback on `/v1/runs/:id` and `/v1/runs/:id/logs` leaks code-agent runs across tenants by design — needs a scope check before being shippable.
- Startup model: `bootstrapRuntime()` writes to DB inside `apps/api/src/server.ts` build-time; migrations are not invoked. SQLite-on-startup race plus missing migrate step.
- Build/deploy: there is no compile target, no Dockerfile, no `pnpm start`, no PM2/systemd story. `tsx watch` is dev-only.
- Web↔API: the SPA bootstrap route bypasses `/v1/*` and reads JSON from disk + synthesizes runs/tasks/deployments. Two parallel data planes today.
- Hardening absent: rate limit, body limit, helmet, request ID, structured 5xx leak control, audit on read paths, graceful shutdown, pagination, soft delete, log rotation cron.

---

## 2. Architecture overview

### 2.1 Component diagram

```
                          ┌───────────────────────────┐
                          │  Browser (Babel-SPA UI)   │
                          └─────────────┬─────────────┘
                                        │ HTTP
                                        ▼
   ┌──────────────────────────────────────────────────────────┐
   │  Next.js 16 @ :3500  (apps/web)                          │
   │                                                          │
   │  • rewrites:                                             │
   │     /v1/*       → API_URL (proxy)                        │
   │     /health     → API_URL                                │
   │     /           → /portal/index.html                     │
   │     /*  fallback → /portal/index.html                    │
   │                                                          │
   │  • app routes:                                           │
   │     /api/spa/bootstrap  → reads models/RAAS-v1/*.json    │
   │                           + lib/spa/derive synthesis     │
   │     /api/prefs          → cookie set                     │
   │                                                          │
   │  • static:  /public/portal/* (data.js, app.jsx, ...)     │
   └─────────────┬────────────────────────────────────────────┘
                 │ proxied /v1/* + /health
                 ▼
   ┌──────────────────────────────────────────────────────────┐
   │  Fastify @ :3501  (apps/api)                             │
   │                                                          │
   │  bootstrap.ts:                                           │
   │    1. getLLMGateway() (env-driven, 14 providers)         │
   │    2. setAgentGateway + setRuntimeGateway                │
   │    3. bootstrapCodeAgents()  ← writes DB                 │
   │    4. bootstrapAll(...)      ← discovers models/, writes │
   │                                                          │
   │  plugins:  error envelope · auth(devTenant) · audit      │
   │  routes:   /health · /inngest                            │
   │            /v1/{events,runs,runs-logs,tasks,agents,      │
   │             agent-invoke,deployments,webhooks,artifacts, │
   │             reads,llm}                                   │
   └──────┬──────────────────────────┬────────────────────────┘
          │                          │
          ▼                          ▼
   ┌──────────────┐         ┌────────────────────────┐
   │  SQLite WAL  │         │ Inngest Dev CLI @ :8288│
   │  data/       │         │ (long-running worker)  │
   │   agentic.db │         └────────────────────────┘
   │   logs/      │
   │   artifacts/ │
   └──────────────┘
```

### 2.2 Request flow (browser data fetch)

```
browser → /v1/runs?limit=50
       → Next rewrite (next.config.mjs:27)
       → fastify :3501 /v1/runs
       → onRequest hook  (auth.ts:67)  → devTenant()  (raas)
       → handler runsRoutes.GET /runs (routes/v1/runs.ts:13)
       → ListRunsQuery.parse(req.query)
       → queries/runs.ts:listRecentRuns(tenantSlug, opts)
       → drizzle SELECT FROM runs JOIN agents JOIN events
       → hydrateStepInfo (extra batched query for current step)
       → reply.ok(rows) → { ok:true, data: RunRow[] }
```

### 2.3 Process model

| Port  | Process | Owner | Restartable | Notes |
|-------|---------|-------|-------------|-------|
| 3500  | Next.js dev server | `pnpm --filter @agentic/web run dev` | yes | Turbopack, no native deps |
| 3501  | Fastify | `tsx watch ../../.env src/server.ts` | yes | better-sqlite3 native binding |
| 8288  | Inngest Dev CLI | `npx inngest-cli@latest dev -u …/inngest` | yes | binds API_URL/inngest for discovery |
| 50052/3 | Inngest gRPC | inngest-cli | yes | killed in `predev` |

`predev` script (`package.json:11`) hard-kills these ports before each `dev` run — a sharp tool, but no equivalent for production where you'll want PM2/systemd unit files.

### 2.4 Strengths to preserve

1. **Uniform envelope** (`registerEnvelope`, `reply.ok`/`reply.fail`) — every route is consistent and the client mirrors it.
2. **`@agentic/contracts`** — single zod source of truth between API and UI; `z.coerce.date()` handles JSON round-trip.
3. **Drizzle schema** with explicit indexes on `(tenant_id, ...)` composites for the hot read paths (`runs_tenant_started_idx`, `runs_tenant_status_idx`, `evt_tenant_name_received_idx`).
4. **Step-engine in `step.run()`** — every effect is memoized so Inngest retries are durable, including the `task.resolved` wait pattern in `register.ts:213-217`.
5. **Append-only NDJSON event ledger** + `payload_ref` pointers — sane separation of metadata from blob.
6. **LLM gateway** with provider-chain failover, retry-once-on-transient, and a clean `LLMError` taxonomy mapped to HTTP status in `agent-invoke.ts:119-137`.
7. **Multi-tenant convention** in the schema (every user-visible table has `tenant_id` with FK + cascade) and a `tenantScope()` helper. Implementation discipline is what's currently weak; the model itself is right.

---

## 3. API surface (`/v1/*`)

Surveyed every route file under `apps/api/src/routes/`. All routes are mounted under `/v1` except `/health` and `/inngest`.

| File:line | Endpoint | Auth | Body / Query schema | Idempotency | Pagination | Drift / smell |
|---|---|---|---|---|---|---|
| `routes/health.ts:12` | `GET /health` | none | — | — | — | OK — returns 503 if any subsystem down. **Does not** hit envelope; raw object. Some LBs may want a HEAD as well. |
| `routes/inngest.ts:13` | `GET/POST/PUT /inngest` | none (Inngest signs) | inngest-internal | inngest-managed | — | OK |
| `routes/v1/events.ts:13` | `POST /v1/events` | `requireAuth` | `IngestEventBody` zod | **No** dedup key — duplicate POST will create duplicate event rows + Inngest sends | — | OK shape; ID generation is internal `makeId("evt")` so client cannot supply idempotency key |
| `routes/v1/events.ts:57` | `POST /v1/events/:id/replay` | `requireAuth` | — | New id minted `${id}-replay-${Date.now()}` (collides every ms!) | — | **Bug risk:** replay id is not `makeId("evt")`; uses string concat with `Date.now()`. Two replays in same ms collide and inserts into events table will FK fail or silently overwrite. |
| `routes/v1/events.ts:100` | `GET /v1/events` | `requireAuth` | `ListEventsQuery` (limit, name) | — | limit-only | OK |
| `routes/v1/runs.ts:13` | `GET /v1/runs` | `requireAuth` | `ListRunsQuery` | — | limit-only | OK; status enum-allow-list defended in query layer |
| `routes/v1/runs.ts:27` | `GET /v1/runs/:id` | `requireAuth` | — | — | — | **Cross-tenant leak** (see §7): fallback `getRun("__system", id)` — *any* authed tenant can fetch any code-agent run |
| `routes/v1/runs.ts:38` | `POST /v1/runs/:id/replay` | `requireAuth` | — | New event id minted | — | OK; correctly 410s if trigger event missing |
| `routes/v1/runs-logs.ts:30` | `GET /v1/runs/:id/logs` (SSE) | `requireAuth` | `?follow=1` | — | — | Same `__system` fallback as above — log content streams across tenants. Path-traversal: no — uses `run.id` not user input for filename. |
| `routes/v1/tasks.ts:12` | `GET /v1/tasks` | `requireAuth` | none | — | hardcoded 100 | OK |
| `routes/v1/tasks.ts:19` | `GET /v1/tasks/:id` | `requireAuth` | — | — | — | OK; scoped properly |
| `routes/v1/tasks.ts:27` | `POST /v1/tasks/:id/resolve` | `requireAuth` | `ResolveTaskBody` | re-resolve guarded by `status !== 'open'` → 409 | — | OK pattern. Audit row written. Event name `task.resolved` is **not tenant-namespaced** — so the inngest function's match `async.data.taskId == "${taskId}"` works cross-tenant; this is acceptable because taskIds are globally unique, but should be documented. |
| `routes/v1/agents.ts:61` | `GET /v1/agents` | `requireAuth` | `?kind=&tenant=` | — | none | `?tenant=` is an **unauthenticated authorization downgrade**: any caller may pass `?tenant=foo` and the response is scoped to whatever they wrote — no membership check. |
| `routes/v1/agents.ts:86` | `GET /v1/agents/:kebab` | `requireAuth` | — | — | — | OK |
| `routes/v1/agents.ts:97` | `POST /v1/agents` | `requireAuth` | `ManifestUploadBody` zod | Re-upload of identical manifest reuses `workflowVersion` (idempotent on content); deployment flip is wrapped in `db.transaction` | — | OK; **no body size cap** — Fastify default 1MB applies but a tenant pushing a 5MB manifest would 4xx with `FST_ERR_CTP_BODY_TOO_LARGE` — at least the surface fails cleanly. Should be explicit. |
| `routes/v1/agent-invoke.ts:36` | `POST /v1/agents/:name/invoke` | `requireAuth` — but the route **hardcodes** `tenantSlug: "__system"` regardless of caller (line 91) | `InvokeAgentBody` zod | None; concurrent invokes mint new runIds | — | **Tenant scoping bug**: a `raas` tenant invoking `testAgent` writes a row under `__system`. Cross-tenant auditability is broken. |
| `routes/v1/deployments.ts:10` | `GET /v1/deployments` | `requireAuth` | — | — | none | OK |
| `routes/v1/deployments.ts:21` | `POST /v1/deployments/:id/rollback` | `requireAuth` | — | Wrapped in `db.transaction`. Re-running on already-live is a no-op (re-flips to live). | — | OK; **note**: comment says "Restart api for runtime to pick up the new manifest" — Inngest registrations are only set at boot, so a rollback does not actually live-swap functions. |
| `routes/v1/webhooks.ts:28` | `POST /v1/webhooks/:provider` | HMAC | constant-time `timingSafeEqual` | **No replay protection** — no timestamp window check, no nonce | — | OK signature math; tenant resolution is hardcoded to `AGENTIC_DEV_TENANT ?? "raas"` (line 65), so prod is single-tenant from webhooks. |
| `routes/v1/artifacts.ts:9` | `GET /v1/artifacts/:id` | `requireAuth` | — | — | — | Streams `row.path` directly. **Path-traversal hazard** if `artifacts.path` is ever populated from user input. Currently it's only written by run-engine using `path.join(artifactsRoot(), runId, name)` so it's safe today, but the route trusts the DB column blindly — worth a defense-in-depth check (e.g. assert path is under `AGENTIC_ARTIFACTS_DIR`). |
| `routes/v1/reads.ts:13` | `GET /v1/counts`, `…/workflows/dag`, `…/event-types`, `…/entity-types` | `requireAuth` | — | — | — | OK |
| `routes/v1/llm.ts:19` | `GET /v1/llm/providers`, `…/llm/models?provider=` | none ⚠️ | — | — | — | **Anonymous read** of provider catalog + `hasKey` flag. Doesn't leak keys themselves, but does signal which providers are configured. Should be authed for parity. |

### 3.1 Drift between contracts and routes

| Contract symbol | Route uses | Notes |
|---|---|---|
| `ApiError { code, message, hint? }` | `reply.fail(code, message, status, hint?)` | matches |
| `RunRow` (33 fields incl. `currentStepName`, `currentStepOrd`, `stepCount`) | `queries/runs.ts:listRecentRuns` hydrates those three | matches |
| `IngestEventBody.payload` is `z.record(z.string(), z.unknown())` | route lifts whole `req.body` through zod | matches |
| `ManifestUploadBody.actions: Array<z.record(...)>.optional()` | not validated again at insert time; column is `text json` | matches |
| `InvokeAgentResponse.error: z.string().optional()` | route returns error via envelope, not in `data` | minor — `error` field on `data` is reserved/unused |
| `DeploymentRow.deployedBy: string.nullable()` | query joins users → may be null | matches |
| `HealthReport` | route returns it unwrapped (no envelope) | intentional but documented inconsistency |

No structural drift — the schemas and impls evolved together, which is the upside of having both client and server reach into the same `@agentic/contracts` package.

### 3.2 Missing routes worth flagging

- No `GET /v1/runs/:id/steps/:stepId/artifacts` — to navigate from a step to its `inputRef`/`outputRef` files. Today the UI must split the `inputRef` filesystem path itself.
- No `DELETE /v1/agents/:kebab` or `PUT enabled` — disabling a code agent requires editing source.
- No `GET /v1/auditlog` — audit table exists, no read surface.
- No bulk endpoint for runs by `correlationId` — the index exists (`runs_correlation_idx`), the route doesn't.

---

## 4. Database schema review

Tables: 16 in DESIGN, present + 1 additional ontology pair (`event_types`, `entity_types`) via migration `0001`, plus `agents.kind` + `agents.enabled` + `steps.provider/model/tokens_in/tokens_out` via migration `0002`.

| Table | Tenant-scoped | FKs (cascade?) | Indexes | Issues |
|---|---|---|---|---|
| `tenants` | n/a | — | UQ on `slug` | OK |
| `users` | n/a | — | UQ on `email` | OK; no `password_hash` / `auth_token_hash` — auth is bearer-via-`api_tokens` only |
| `memberships` | yes (composite PK) | both cascade | none beyond PK | OK |
| `workflows` | yes | tenant cascade | UQ `(tenantId, slug)`, idx `(tenantId)` | OK |
| `workflow_versions` | indirect (via workflow) | workflow cascade, `created_by` no-action | UQ `(workflowId, version)` | **Missing**: no FK index on `workflow_id` alone; for `getDag` joins it'd help. Drizzle's UQ acts as a leftmost-prefix index so this is fine in practice. |
| `deployments` | yes | tenant cascade | idx `(tenantId, status)`, idx `(versionId)` | **Missing**: there is no UQ guard that only ONE deployment per tenant per target may be `status='live'` at a time. The `manifest upload` + `rollback` paths both use a transaction to flip the existing 'live' to 'rolled_back' first, but a crash between the two statements leaves an inconsistent state. Consider a partial index `WHERE status = 'live'` + UNIQUE. |
| `agents` | indirect | workflow cascade | UQ `(workflowId, kebabId)`, idx `(workflowId)` | **Missing**: no FK from `agents` to `tenants` directly. `tenant_id` is derived via the workflow join — this works but makes every tenant-scoped agent query an extra JOIN through `workflows` (see `queries/agents.ts:48`). Consider denormalizing `tenant_id` onto `agents` for hot paths. |
| `agent_versions` | indirect | both cascade | UQ `(agentId, workflowVersionId)` | OK |
| `events` | yes | tenant cascade, source_agent no-action | idx `(tenantId, name, receivedAt)`, idx `(tenantId, subject)` | **Missing soft-delete** — events grow unbounded; need a retention/archive pass. |
| `event_listeners` | none (cross-tenant) | agent cascade | PK `(eventName, agentId)`, idx `(eventName)` | OK as a routing table |
| `runs` | yes | tenant cascade, agent no-action, version no-action, trigger_event no-action | idx `(tenantId, started_at)`, idx `(tenantId, status)`, idx `(agentId)`, idx `(correlationId)`, idx `(subject)` | Excellent index coverage for the dashboard queries; **missing**: no idx on `(tenantId, correlationId)` for the chain view |
| `steps` | indirect | run cascade | idx `(runId, ord)` | **Missing**: no idx on `(runId, status)` — but `(runId, ord)` already covers the hot read of all steps for a run. Could add an `ord` UNIQUE within a run to prevent duplicate inserts on retries; today the `step.run` memoization in Inngest guards this at runtime but not at the schema. |
| `tasks` | yes | tenant cascade, run cascade, awaiting/resolved_by no-action | idx `(tenantId, status)`, idx `(runId)` | OK; consider `(awaitingRole, status)` if a user-routed inbox view appears. |
| `artifacts` | yes | tenant cascade, run cascade | idx `(runId)` | **Missing UQ**: `(runId, path)` to prevent duplicate sidecar rows if a step retries. |
| `audit_log` | yes | tenant cascade, actor no-action | idx `(tenantId, at)`, idx `(targetType, targetId)` | OK |
| `api_tokens` | yes | tenant cascade | UQ `hash`, idx `tenantId` | OK; rotation/expiration not modeled (no `expires_at`). |
| `event_types` | yes (composite PK) | tenant cascade | PK `(tenantId, name)` | OK |
| `entity_types` | yes (composite PK) | tenant cascade | PK `(tenantId, entityId)` | OK |

### 4.1 Pragmas / connection

`client.ts:118-121`:

```
journal_mode = WAL          ✅
foreign_keys = ON           ✅
synchronous = NORMAL        ✅
busy_timeout = 5000         ✅
```

`page_cache`, `mmap_size`, `temp_store=MEMORY` are not set — for write throughput at scale (>1k runs/sec) these become relevant. Not blocking for v1.

### 4.2 Migrations

- Versioned files exist under `packages/db/drizzle/0000_*.sql … 0002_*.sql`.
- Runner is `packages/db/src/migrate.ts`, invoked manually via `pnpm db:migrate`.
- **They are NOT run on API boot.** `apps/api/src/server.ts:48` calls `bootstrapRuntime()` which writes rows but does not migrate. First-time deploys onto a fresh box would crash unless `pnpm db:migrate` is sequenced first.
- No "schema_locked / app_version" guard — if the running code expects a column added in `0002` but the DB is on `0001`, `bootstrapCodeAgents()` will throw on first INSERT.

### 4.3 Multi-tenant isolation at the DB layer

- Every tenant-scoped table has a `tenant_id` FK with `ON DELETE CASCADE`.
- `with-tenant.ts` exists but is **not used by any production query path**. `queries/*.ts` reach into the global `getDb()` and explicitly add `eq(table.tenantId, ctx.tenantId)`. The discipline is correct *most* of the time; manual is not enforced by the type system.
- One route (`/v1/runs/:id`) explicitly bypasses tenant scoping via the `__system` fallback (see §7).

### 4.4 Anti-patterns spotted

- `manifest_json` and `actions_json` are stored as JSON text — fine, but **no JSON validation at the DB layer** (SQLite has `json_valid()` checks; not used). Insertion of a malformed manifest is caught at zod parse time in the API; runtime-discovered manifests come from `loadModelsFromDisk` which also parses, so the constraint is enforced upstream but not at rest.
- No `created_at` on `agents`, `agent_versions`, `event_listeners` — no audit trail of when an agent appeared.
- No `updated_at` columns anywhere, so we can't tell when `steps.status` flipped from `running → ok`. We rely on `endedAt` exclusively.

---

## 5. Bootstrap + runtime lifecycle

### 5.1 `apps/api/src/bootstrap.ts`

Initialization order:

```
1. getLLMGateway()             — builds adapters, registers 14 providers
2. setAgentGateway(gateway)    — assigns to module-global in @agentic/agents
3. setRuntimeGateway(gateway)  — assigns to module-global in @agentic/runtime
4. bootstrapCodeAgents()       — DB writes: __system tenant, workflow, version,
                                  agents.kind='code', agent_versions, deployments
5. bootstrapAll(TENANT_REGISTRIES)
   - readdir(models/)
   - for each tenant folder:
     - loadModelsFromDisk() — disk reads + zod parse
     - upsert workflows + workflow_versions
     - DB writes deployment 'live' (transactionally flips prior)
     - for each agent: upsert agents + agent_versions + event_listeners
     - call registerAgent() → returns Inngest function
     - upsert event_types + entity_types
   - return all Inngest functions
6. inngestRoute(app, { client, functions }) — mounts /inngest serve adapter
```

**Strengths**

- Idempotent on every step (existing rows skipped).
- The order — gateway → agents → runtime — guarantees the step engine has a callable LLM by the time the first Inngest event lands.
- Deployment flipping uses `db.transaction(() => { … })`.

**Race conditions / failure modes**

- **Two API processes booting simultaneously** (rolling deploy, blue/green): both call `bootstrapCodeAgents` and may race on `INSERT INTO agents` for the same `(workflow_id, kebab_id)`. The UQ index catches it, but the loser throws and crashes boot. Need to either `INSERT … ON CONFLICT DO NOTHING` or single-instance the bootstrap (advisory lock).
- **Empty/missing `models/` directory** → `bootstrapAll` logs a warning and returns no tenant functions; API still starts. That's correct behavior.
- **Malformed manifest** → `loadModelsFromDisk` throws zod error → `bootstrapTenant` throws → loop in `bootstrapAll` catches and logs `[bootstrap] failed to load ${folder}:` and continues. So one bad manifest doesn't kill boot. Good.
- **DB locked** → `busy_timeout = 5000ms` covers brief contention. If `agentic.db-wal` is huge (4.1MB observed) the first writer may block longer. Worst case: 5s timeout → exception → API boot fails. No retry around `bootstrapCodeAgents`.
- **Port 3501 in use** → `app.listen()` rejects → `process.exit(1)`. Fine.
- **Native binding mismatch** (better-sqlite3 vs Node 26): `resolveNativeBinding` in `client.ts:25` searches up `node_modules` for both hoisted and `.pnpm/` layouts. If neither exists, throws a clear error: `[db/client] could not locate better_sqlite3.node`. Good defensive pattern.

**Architectural concern: deployment writes at boot**

Treating `bootstrapAll` as a *deployment* (it writes `deployments` rows on every API start) is misleading. The `deployments` table is supposed to be an audit trail of human-initiated promotions, not an artifact of "server happened to start". Every restart with a code change creates one. Recommendation: move deployment-flipping into a one-shot `pnpm deploy` command and have boot be read-only (just register the in-memory Inngest functions). Already, `runtime/bootstrap.ts:174-194` flips existing `live` to `rolled_back` on EVERY start when there's a new manifest hash — silent rollback of an operator's prior pin.

### 5.2 `packages/runtime/src/bootstrap.ts`

`bootstrapTenant` does the same upsert dance as `agents/bootstrap.ts` but for *manifest* agents. Lots of code duplication between the two; future refactor target.

The function returns `BootstrapTenantResult` and is called from `bootstrapAll`. `registerAgent()` is called inside the loop to create the Inngest function — these are accumulated and returned, then `apps/api/src/server.ts` hands them to `serve()`.

`registerAgent` (`packages/runtime/src/register.ts`) is dense (468 lines). The hot path is correct: every effect is wrapped in `step.run`, the human-in-the-loop path uses `step.waitForEvent` with a 7-day timeout, and `step.sendEvent` outside of `step.run` for the emit. **One sharp edge**: `failRun` (line 446) writes directly to the runs table *not* inside a step — if the Inngest function retries after `failRun` fired, the second pass will see status=failed and not write a new run row. This is the intended behavior, but it means there's a window where the runs row says "failed" but the Inngest function will still throw and retry, and the user sees flipping statuses in the UI.

### 5.3 Inngest worker registration

- `serve()` from `inngest/fastify` (`routes/inngest.ts:14`) handles GET/POST/PUT.
- Functions list is computed at boot only. **No hot reload.** Manifest changes via `POST /v1/agents` write to DB but don't add a new Inngest function until restart.
- No graceful drain on shutdown — open Inngest invocations on the worker process will be ungracefully killed.

### 5.4 Startup failure modes (summary)

| Failure | Behavior today | Production-ready behavior |
|---|---|---|
| DB locked >5s | `bootstrapCodeAgents` throws → API never listens | Retry with backoff; fail boot only if locked >30s |
| Missing migrations | First INSERT throws on missing column | Run `migrate()` in `bootstrap.ts` step 0 |
| Malformed tenant manifest | Logged, that tenant skipped, API up | OK |
| Native binding missing | Clear error from `resolveNativeBinding` | OK |
| Port in use | `process.exit(1)` | OK (but `predev` hard-kills siblings; risky on shared boxes) |
| Inngest CLI unreachable | API still starts; first event goes nowhere | Health check should reflect this |
| Two API instances booting | UQ collisions throw on the loser | `ON CONFLICT DO NOTHING` |
| Env-driven gateway has no keys for default provider | `LLMGateway` constructs, first call surfaces `not_configured` | OK; needs documenting |

---

## 6. Error handling & envelopes

### 6.1 The plugin

`apps/api/src/plugins/error.ts`:

- `reply.ok(data, status?)` → `{ ok: true, data }`
- `reply.fail(code, message, status?, hint?)` → `{ ok: false, error: { code, message, hint } }`
- `setErrorHandler` catches `ZodError` → 400 `invalid_input` with concatenated issue paths in `hint`
- All other thrown errors → uses `err.statusCode` or 500 and `err.code` or `internal_error`

### 6.2 Information leak

`error.ts:53-57` returns `err.message` directly on 500. If an upstream layer throws a stack-leaking error (e.g. a SQLite constraint violation that includes the actual SQL or path), the message is shipped to the client. Strongly recommend stripping `message` to a generic string on 5xx and only including the requestId for correlation. The full message is already logged via `req.log.error({ err }, "unhandled error")`.

### 6.3 Status code conventions

Inventory of `reply.fail` calls across `apps/api/src/routes/v1/*`:

| Code | Status | Use sites |
|---|---|---|
| `invalid_input` | 400 (from zod) | error.ts |
| `bad_request` | 400 | agent-invoke (provider validation) |
| `unauthorized` | 401 | auth.ts (requireAuth) |
| `no_signature` / `bad_signature` | 401 | webhooks |
| `forbidden` | 403 | events, runs, tasks, deployments, artifacts |
| `not_found` | 404 | events, runs, tasks, deployments, artifacts, agents |
| `agent_disabled` | 409 | agent-invoke |
| `already_resolved` | 409 | tasks |
| `gone` | 410 | events, runs, artifacts |
| `not_implemented` | 501 | agent-invoke (async branch) |
| `tenant_missing` | 500 | agents (POST /v1/agents) |
| `no_secret` | 500 | webhooks |
| `internal_error` | 500 (default) | error.ts |
| `provider_error` / `auth` / `rate_limit` / `timeout` / `model_not_found` / `not_configured` / `network` | 502 / 401 / 429 / 504 / 400 / 503 / 502 | agent-invoke (LLM error map) |

Looks correct in spirit but some inconsistencies:
- `no_secret` should be 500 only if it's a config bug; if it's per-provider misconfig, 503 is more honest. Currently 500.
- `tenant_missing` returns 500 — should be 404 or 409 (the tenant *can't* be created from this endpoint).
- 410 `gone` is rarely used; consider whether 404 is closer to client expectations.

### 6.4 Missing pieces

- No `requestId`. Fastify supports `genReqId`; not configured. Without it, the client cannot include a "see logs for ID xyz" hint.
- No `traceId` propagation to the runtime (so an HTTP request that fires an event has no thread to a downstream Inngest run beyond `correlationId`, which itself is event-local).
- No body-size guard for `POST /v1/events` (a 50MB payload would be parsed and base64-quotient-stored in the ledger). Fastify default 1MB applies but should be tuned per-route.

---

## 7. Auth + multi-tenancy

### 7.1 `requireAuth` and `registerAuth`

`apps/api/src/plugins/auth.ts:28-59`:

```
if (process.env.AUTH_MODE === "dev" || process.env.NODE_ENV !== "production")
  return devTenant();      // hardcoded to env AGENTIC_DEV_TENANT or "raas"
```

**This is the single most important production-readiness item.** As coded, *outside* of `NODE_ENV=production`, every request is auto-authed as the seeded `raas` admin. There is no way to test the real bearer flow without flipping `NODE_ENV=production` *and* unsetting `AUTH_MODE`. There is no test that exercises the bearer path either.

Real-token path:
1. `Authorization: Bearer <token>` → SHA-256 → compare against `api_tokens.hash`
2. Update `api_tokens.last_used_at`
3. Resolve tenant via `tenants.id = api_tokens.tenant_id`
4. Return `{ tenantId, tenantSlug, via: "token" }`

There is no:
- Token creation/revocation endpoint
- Expiration column on `api_tokens`
- Scopes enforcement (column exists, never read)
- Refresh / rotation
- Cookie/session option (so browser SPA can't auth without a token typed by hand)
- CSRF defense (because there are no sessions; this is consistent)

### 7.2 Web app → API auth propagation

- `apps/web/lib/api-client.ts:55`: `if (API_TOKEN) headers["Authorization"] = ...`. The token is `process.env.AGENTIC_API_TOKEN` — **server-side env on Next**, never reaches the browser.
- The Babel-SPA in `public/portal/*` does its own `fetch('/v1/...')` calls — same-origin → goes through Next rewrite → Fastify. No token header is added.
- In dev, the Fastify auth plugin bypasses to devTenant, so SPA fetches work.
- **In production**, the Babel-SPA would 401 every call unless the browser had a cookie/token. There is no story for this. The DESIGN says "magic-link auth" with `RESEND_API_KEY` — not implemented anywhere in the code I read.

### 7.3 Tenant isolation guarantees

Per-table:

- Mutations to tenant-scoped tables always include `tenantId: auth.tenantId` (manifest upload `agents.ts:121`, event ingest `events.ts:38`, task resolve writes via inngest event, etc.).
- Reads in `queries/*.ts` always start with `resolveTenantId(slug)` then `eq(table.tenantId, tenantId)` in every `WHERE` clause.
- **One explicit escape hatch**: `routes/v1/runs.ts:30-31`:
  ```ts
  const run =
    (await getRun(auth.tenantSlug, req.params.id)) ??
    (await getRun("__system", req.params.id));
  ```
  Designed to let any authed caller see code-agent runs (which live in `__system`). The threat: if tenant A passes the runId of tenant B's regular run, the first lookup misses (different tenant), the second lookup also misses (different tenant ≠ `__system`) — so this only leaks `__system` runs. **But** that's still cross-tenant, just constrained to one shared tenant. Acceptable for v1 ops only if every code-agent run is genuinely shared. If a code agent ever processes tenant-private input data, this is a leak. **Action**: make the fallback opt-in (a query param `?include_system=1`) or scope code-agent runs to the calling tenant.
- Same pattern in `runs-logs.ts:35-39` — `__system` log files are streamable across tenants. Same caveat.
- `routes/v1/agent-invoke.ts:91`: `tenantSlug: "__system"` is hardcoded — every invocation writes under `__system`. The runId is returned to the caller, the run shows up under that caller's tenant only via the cross-tenant fallback above. Net effect: runs and steps for any code agent are pooled.

### 7.4 The `?tenant=` query parameter

`routes/v1/agents.ts:70`:
```ts
const tenantSlug = req.query.tenant ?? auth.tenantSlug;
```
**This is an explicit authorization bypass.** A `raas` admin can `GET /v1/agents?tenant=finance` and read another tenant's agent list. Need a `memberships` check or remove the param.

### 7.5 Threat model — can tenant A read tenant B's runs?

| Resource | Path | Cross-tenant readable? | How |
|---|---|---|---|
| runs (regular tenant) | `GET /v1/runs` | No | tenantId filter |
| runs (code-agent under __system) | `GET /v1/runs/:id` | **Yes** (line 30-31) | Documented fallback |
| run logs (code-agent) | `GET /v1/runs/:id/logs` | **Yes** (line 35-39) | Same fallback |
| events | `GET /v1/events/:id/...` | No | route checks `row.tenantId !== auth.tenantId` |
| tasks | `GET /v1/tasks/:id/...` | No | route checks tenant |
| agents | `GET /v1/agents?tenant=X` | **Yes** (line 70) | `?tenant=` honored without membership check |
| deployments | `GET /v1/deployments/:id/rollback` | No | route checks tenant |
| artifacts | `GET /v1/artifacts/:id` | No | route checks tenant |

Three known leak vectors, two of them intentional (`__system` fallback for code-agent visibility), one outright bug (`?tenant=`).

### 7.6 Webhook ingest tenant

`routes/v1/webhooks.ts:65`: `const tenantSlug = process.env.AGENTIC_DEV_TENANT ?? "raas";` — every inbound webhook is attributed to the dev tenant. There is no per-provider mapping to a tenant. Production multi-tenant webhooks would need a provider→tenant table or path-encoded routing (`/v1/tenants/:slug/webhooks/:provider`).

---

## 8. Observability

### 8.1 Logger

- Pino via Fastify's built-in (`server.ts:26-32`). `pino-pretty` transport in dev only.
- `LOG_LEVEL` env-controlled.
- **No `genReqId`**, **no `serializers`** for `err`, **no `redact`** of sensitive headers (Authorization is in raw req.headers when pino dumps `req`).

### 8.2 Per-run file logs

`packages/runtime/src/log-writer.ts` writes:
```
2026-05-19T08:14:02.001Z  INFO   run.start  run_id=run-... correlation_id=... ...
```
to `logs/<tenant>/runs/<YYYY-MM-DD>/<run-id>.log`. SSE tail in `runs-logs.ts` follows it via `fs.watch`. Good for v1; doesn't scale beyond one box without shared filesystem.

### 8.3 Audit log

`audit_log` table is written by `plugins/audit.ts:writeAudit` from three routes (`manifest.deploy`, `deployment.rollback`, `task.resolve`). **No read endpoint, no UI, no retention policy.** Audit is half-implemented.

### 8.4 Metrics

Zero. No Prometheus scrape endpoint, no OpenTelemetry, no in-process counter that the health endpoint surfaces beyond `journalMode` and disk-free bytes. For a workflow runtime you'll want at minimum: runs by status (gauge), tokens-in/out (counter), step duration (histogram), LLM provider error rate (counter).

### 8.5 Tracing

Zero. Correlation IDs propagate through events and runs (`correlation.ts`) but there's no OpenTelemetry instrumentation. A spec for "see the full chain from event to final emitted event" would need a recursive correlation-id query, which the index supports.

---

## 9. Security

### 9.1 Input validation

- All POST bodies are zod-parsed. `events`, `agents`, `tasks`, `agent-invoke` all use schemas from `@agentic/contracts`.
- Query strings: `runs`, `events` use zod. `agents` uses raw type cast (`req.query.kind`) which is then narrowed manually — fine.
- Path params: never zod-parsed, always trusted as strings. Mostly safe because they're then looked up in DB and missing rows 404. Worth a quick zod regex (`^run-[0-9a-f]{12}$`) for defense-in-depth.

### 9.2 Rate limiting

**None.** No `@fastify/rate-limit`, no token-bucket on `POST /v1/events`, no per-IP throttling. A single client can flood the event ingester.

### 9.3 CORS

`server.ts:35-39`:
```ts
await app.register(cors, {
  origin: WEB_ORIGIN,   // defaults to http://localhost:3500
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
});
```

Good — origin-pinned. In production needs to be the deployed web URL. `credentials: true` is fine since auth is currently bearer in headers, but if cookies are added, double-check the CSRF surface.

### 9.4 Secrets management

- `.env` and `.env.local` are `.gitignore`d ✅
- **The repo's `.env` file currently contains real production-grade API keys (OpenRouter, OpenAI, Google).** Not committed (verified `git ls-files`), but worth a note that the workstation copy ships secrets in plaintext. Rotate before any shared environment.
- `WEBHOOK_HMAC_SECRET_*` is per-provider — good pattern.
- `AUTH_SESSION_SECRET` is in `.env.example` with the literal default value `change-me-in-production-32-bytes-min`. No length check at boot.
- API tokens are SHA-256-hashed at rest (`auth.ts:18-20`). Good.

### 9.5 Path traversal

- `artifacts.ts:28` streams `row.path` from DB. Only writers populate that column (`agents/run-engine.ts:46-52`), and they use `path.join(artifactsRoot, runId, name)` where `name` is hardcoded. **Not vulnerable today**, but the route should still assert the resolved path is under `AGENTIC_ARTIFACTS_DIR` for defense-in-depth.
- `runs-logs.ts:45-51` builds the log path from `run.id` (DB-controlled) — safe.
- `manifest.ts:loadModelsFromDisk` `readFile(path.join(dir, candidate))` — `dir` is `AGENTIC_MODELS_DIR/<folder>`. Folder names come from `readdir` which can't traverse out of root. Safe.

### 9.6 SQL injection

- All queries go through Drizzle's parameterized builder.
- Two raw `sql\`\`` template usages in `queries/runs.ts:34, 56` for `IN (...)` lists — but they interpolate via `sql\`${id}\`` placeholders, which Drizzle escapes. Safe.
- `health.ts:49` runs a fixed `SELECT 1 as ok` — safe.

### 9.7 Other findings

- `webhooks.ts:54` uses `createHmac` with `timingSafeEqual` on hex buffers — correct constant-time compare.
- `auth.ts:96-103` uses `require("node:crypto").createHmac(...)` *inside* a function called `verifyHmac` — that's literally never called (search returned 0 callers). Dead code; same logic re-implemented in `webhooks.ts`. Remove or unify.
- No CSP headers, no `Strict-Transport-Security`. Add `@fastify/helmet`.
- Webhook signature has **no timestamp anti-replay** (no `X-Timestamp` window check, no nonce table). An attacker who once captured a signed request can re-fire it.

---

## 10. Build, packaging, deployment

### 10.1 Current `pnpm dev`

`package.json:11-12`:
```
predev: lsof -ti:3500,3501,8288,8289,50052,50053 | xargs kill -9 2>/dev/null
dev:    concurrently web, api, inngest
```

Web is `next dev --port 3500`. API is `tsx watch --env-file=../../.env --env-file=.env.local src/server.ts`. Inngest is `npx -y inngest-cli@latest dev -u http://localhost:3501/inngest`.

This works locally. It does NOT scale to:
- CI (no test orchestrator across services)
- Staging/prod (no compiled bundle, no PM2/systemd, no Docker)

### 10.2 TypeScript build setup

- Each package has `tsc --noEmit` only. No package emits `dist/`.
- `tsbuildinfo` files exist (incremental compilation cache).
- Turborepo's `build` task is wired (`turbo.json:5`) but the actual `build` scripts are missing for every workspace except `apps/web` (which has `next build`).
- API "build" in prod would be: install deps → `tsx src/server.ts`. Not literally compiled.

### 10.3 ESM vs CJS

- All workspace packages declare `"type": "module"` ✅
- `apps/api/package.json` is module ✅
- `inngest@4.4.0` and `fastify@5.8.5` are both ESM-friendly at runtime.
- `better-sqlite3@12.10.0` is a native CommonJS module, loaded via a custom `nativeBinding` path resolver (`packages/db/src/client.ts:25-66`) to avoid the webpack-bindings issue. Documented and tested.
- One CJS-style fallback: `auth.ts:96` uses `require("node:crypto")` inside an ESM module. Node permits this under `createRequire` but here it's a bare `require` — likely works under tsx but would fail in pure Node ESM. Combined with the dead-code observation, the fix is to delete the function.

### 10.4 Native module pinning

- `.nvmrc` → `26`. `package.json:engines.node = ">=26.0.0"`. Forces Node 26.
- pnpm `onlyBuiltDependencies` lists `better-sqlite3`, `esbuild`, `protobufjs`, `sharp`, `unrs-resolver`.
- `pnpm-workspace.yaml:9-14` has `allowBuilds:` (pnpm 11 feature).
- `AGENTIC_SQLITE_BINDING` env var lets the runtime override the binding path for production where install layout differs.

This is *good* engineering work — the kind of thing that bites teams six months later. Keep it.

### 10.5 Production build target

**There is no Dockerfile, no compose, no Helm, no Pulumi, no `pnpm start` at the root.** `apps/api/package.json` has `"start": "tsx --env-file=… src/server.ts"` — this is "run the dev runner in non-watch mode", not a production-grade entry. There's no compiled JS bundle.

For a production target:
- Either commit to `tsx` in prod (acceptable; many shops do) and provide a Dockerfile that pins Node 26 + better-sqlite3 native binding location + runs migrations on first start + uses tini for signal handling.
- Or use `tsc` / `esbuild --bundle` to emit JS, drop tsx, and ship a single bundle.

### 10.6 Env-var contract

Required for the API to function at all:
- `DATABASE_URL` (defaults to walking up for `data/agentic.db`)
- `AGENTIC_LOGS_DIR`, `AGENTIC_ARTIFACTS_DIR` (default to `./logs`, `./artifacts`)
- `AGENTIC_MODELS_DIR` (hardcoded fallback to `/Users/kenny/CSI-AICOE/agentic-operator/models`!)
- `INNGEST_*` (dev mode bypass exists)
- LLM provider keys (mock is the safe default)
- `WEB_ORIGIN` for CORS
- `AGENTIC_DEV_TENANT` (used in dev auth AND webhook tenant resolution!)

**Hardcoded absolute path** at `packages/runtime/src/bootstrap.ts:72` is the only thing that has to be deleted before this can run on any other machine. Should be a required env or a relative resolution from the workspace root.

`AUTH_SESSION_SECRET` is documented but never read by any code — `RESEND_API_KEY` likewise. Magic-link auth is vapor.

---

## 11. Testing posture

### 11.1 What exists

- `apps/api/test/tc-1-llm-providers.test.ts` — assert `/v1/llm/providers` returns 14 + `hasKey` truthiness.
- `apps/api/test/tc-2-llm-models.test.ts` — `/v1/llm/models` shape.
- `apps/api/test/tc-3-test-agent-happy.test.ts` — invokes `testAgent`, asserts run row + step row + file log content.
- `apps/api/test/tc-4-test-agent-error.test.ts` — bad provider / unknown agent / stub provider.
- `apps/api/test/tc-5-monitoring-reuse.test.ts` — `/v1/agents?kind=code`, `/v1/runs/:id`, `deployments` row.
- 22 cases per the memory file, all green.
- Framework: Vitest, `pool: "forks"` to keep better-sqlite3 single-threaded, `sequence: { concurrent: false }` to serialize.
- Harness boots the **real Fastify app** via `app.inject()` — no network roundtrip, but full handler chain executes.
- Setup file (`test/setup.ts`) forces `LLM_DEFAULT_PROVIDER=mock`, redirects logs/artifacts dirs, points at the **dev DB** (not a separate test DB).

### 11.2 What's missing

- **Test DB isolation** — every test runs against `data/agentic.db`. Each test invocation leaves rows. `data/agentic.db-wal` is currently 4.1MB. The team relies on row-by-row assertions (runId is unique). One day a test will collide.
- **No tests for tenant isolation** — no test verifies `?tenant=raas` from a `finance` user returns 403/empty; no test verifies the `__system` fallback boundary.
- **No tests for migrations** — no schema-up/down asserted.
- **No tests for webhooks** — HMAC verify path is uncovered.
- **No tests for the Inngest function path** — i.e. an event POSTed to `/v1/events` actually reaches `register.ts` and writes a run. The `agent-invoke` path is covered; the manifest-driven path is not.
- **No e2e** — `tests/e2e/` is empty. No Playwright. The UI is purely manually tested.
- **No load test** — capacity is unknown.
- **No tests for `apps/web`** — none.

### 11.3 Confidence assessment

The tests that exist do *exactly* the right thing — they exercise the route through a real Fastify, write to a real SQLite, and assert at the DB + filesystem level. For the code-agent path that's covered, this is high-confidence. The 80% of the surface that *isn't* covered (manifest agents, webhooks, multi-tenant routes, the SSE log stream, deployments lifecycle) is the production risk.

---

## 12. Web ↔ API integration

### 12.1 The `/v1/*` rewrite

`apps/web/next.config.mjs:24-36`:
```js
async rewrites() {
  return {
    beforeFiles: [
      { source: "/v1/:path*",   destination: `${API_URL}/v1/:path*` },
      { source: "/health",      destination: `${API_URL}/health` },
      { source: "/",            destination: "/portal/index.html" },
    ],
    afterFiles: [],
    fallback: [
      { source: "/:path*",      destination: "/portal/index.html" },
    ],
  };
}
```

`/v1/*` and `/health` are proxied to Fastify. The root and any unmatched path falls back to the SPA shell at `/public/portal/index.html`. The SPA uses client-side routing — the fallback rewrite is the SPA mode. **Good pattern.** Same-origin in dev, same-origin in prod (assuming a single reverse proxy).

### 12.2 `/api/spa/bootstrap` route

`apps/web/app/api/spa/bootstrap/route.ts` reads JSON files from `models/RAAS-v1/` and runs derivation helpers in `apps/web/lib/spa/derive.ts` to synthesize ~140 events, ~67 runs, 6 tasks, sample log content, etc. The response is the `SpaBootstrap` payload consumed by the legacy `public/portal/data.js`.

This means the **SPA has two parallel data planes**:
1. The "live" data plane: `/v1/runs`, `/v1/events`, etc., backed by SQLite.
2. The "demo" data plane: `/api/spa/bootstrap`, backed by disk JSON + synthesis.

The synthesizers (`synthesizeRuns`, `synthesizeEventStream`, `synthesizeTasks`, `synthesizeDeployments`) generate hardcoded sample subjects (REQ-2041, CAN-88412) and seeded RNG values — i.e. the same fake data on every load. This is fine *for a demo*, completely wrong *for production*.

**Recommendation:** Pick one. For production, either:
- The SPA should source everything from `/v1/*` (the API has the same data, organized by tenant), and `/api/spa/bootstrap` should be deleted, OR
- The legacy SPA is replaced by a real Next.js UI that fetches `/v1/*` via `apps/web/lib/api-client.ts` (which already exists, fully typed).

The data shapes don't match either path — `SpaRun`'s `Record<string, unknown>` is not the contracts-defined `RunRow`. So there's an additional mapping layer needed when consolidating.

### 12.3 Auth propagation browser → Next.js → Fastify

Today:
1. Browser → Next `/v1/runs` (no auth header in dev SPA)
2. Next rewrite → Fastify `/v1/runs` (header preserved, but there is no header)
3. Fastify `registerAuth` `onRequest` hook → calls `authenticate(req)`
4. `authenticate` sees `AUTH_MODE === "dev"` (or `NODE_ENV !== "production"`) and returns the dev tenant
5. Request succeeds as the dev tenant

In production with `AUTH_MODE` unset and `NODE_ENV=production`:
1. Browser → Next `/v1/runs` (no auth header)
2. Next rewrite → Fastify (no header)
3. `authenticate` finds no `Authorization: Bearer …` → returns null
4. `requireAuth` throws 401

**There is no implemented path to make step 1 carry a real token from a browser.** The SPA is anonymous. This is the critical gap before any external user can hit the system.

Options (one to pick, not three):
- **Session cookie**: Next "login" route → calls Fastify magic-link → Fastify sets HttpOnly cookie → Fastify auth plugin learns to read cookie. Standard approach. Requires `AUTH_SESSION_SECRET` to actually be used.
- **Bearer in JS**: SPA logs in to Next, Next stores token in `localStorage`, SPA injects `Authorization` header on every fetch. Less secure (XSS) but simpler.
- **Server-rendered**: Migrate SPA into Next server components; Next holds the token server-side and injects it on `api-client.ts:55`. Best long-term but requires the rewrite the user is planning.

---

## 13. Top 10 prioritized fixes for production

Ranked by risk × cost-of-inaction. Effort: S = ≤1 day, M = 2–5 days, L = 1+ week.

| # | Title | Why | Effort | Risk if not done | Suggested approach |
|---|---|---|---|---|---|
| 1 | **Real auth pathway (browser → API)** | Cannot ship to any external user. Dev auth bypass is the default. | M | Anyone hitting any URL is "raas admin". | Pick cookie-session (recommended): Next `/api/auth/*` issues a signed cookie (`AUTH_SESSION_SECRET` actually used), Fastify plugin reads cookie OR Bearer; magic-link via Resend per `.env.example`. Add `expires_at` to `api_tokens`. Write tests that exercise the bearer path AND the unauthed path. |
| 2 | **Close the `__system` and `?tenant=` cross-tenant leaks** | Two routes return data from other tenants today (`/v1/runs/:id`, `/v1/runs/:id/logs`, `/v1/agents?tenant=`). | S | First multi-tenant demo bug: tenant A sees tenant B's run. | (a) `agents.ts:70`: drop the query param OR require a `memberships` lookup. (b) `runs.ts:30` and `runs-logs.ts:38`: gate `__system` fallback behind `?include_system=1` AND require a membership flag; default-off. (c) `agent-invoke.ts:91`: stop hardcoding `tenantSlug: "__system"`; use the caller's tenant. Tests: assert cross-tenant 404 on every path. |
| 3 | **Migrations on boot + deployment cleanup** | `apps/api/src/server.ts` does not call `migrate()`. First prod boot on an empty DB will crash. `bootstrapRuntime` also flips deployments to `live` on every restart, which silently rolls back operator-pinned versions. | S | Cold-start failure; spurious "deployments" rows. | Step 0 in `bootstrap.ts`: call `migrate(getDb(), {migrationsFolder})` if schema-version table differs. Move deployment-creation out of boot into an explicit `pnpm deploy` script (or only insert deployment when manifest hash actually changed AND no live deployment exists). |
| 4 | **Production build target** | `tsx` is dev-only. No Dockerfile. No PM2/systemd unit. No graceful shutdown. | M | Cannot deploy. | Add a minimal Dockerfile (Node 26-alpine, install with `--prod`, `pnpm install --frozen-lockfile`, `RUN pnpm db:migrate`, `CMD ["tsx", "apps/api/src/server.ts"]`). Add SIGTERM handler that calls `app.close()` (drains in-flight requests) then `closeDb()`. Provide `pnpm start:api` at root. Decide: `tsx` in prod (fine) vs `tsc --emit` per-package + run plain JS. |
| 5 | **Rate limit + body limit + helmet** | Public endpoints (`/v1/events`, webhook receivers, `/v1/agents/:name/invoke`) have no throttle. `setBodyLimit` not configured. Helmet absent. | S | First synthetic-load test or DOS bites; default Fastify 1MB body works but tenant gets opaque error. | `@fastify/rate-limit` with per-IP + per-token buckets, tuned per-route; `@fastify/helmet` with restrictive CSP; explicit `bodyLimit` per route — generous for `POST /v1/agents` (manifest can be large), tight for `POST /v1/events`. |
| 6 | **Test DB isolation + tenant-isolation tests** | Tests share the dev DB; no test verifies tenant boundary. | S | Risk of merging a regression that breaks isolation. | `apps/api/test/setup.ts`: use a per-worker temp DB (`pathToFileURL`-safe tmpdir) and migrate it. Add tests for §13.2 fixes. |
| 7 | **Request IDs, log redaction, structured 5xx** | Pino is on, but no `genReqId`, no `redact: ['req.headers.authorization']`, no scrubbing of `err.message` on 500. | S | Authorization values may end up in log files; clients can't correlate to logs. | Configure Fastify: `genReqId: () => randomUUID()`, `disableRequestLogging: false`, `serializers: {err: ...}`, `redact: {paths, censor}`. In `setErrorHandler` return `{ code: 'internal_error', message: 'see logs', hint: requestId }` for 5xx and log the real message. |
| 8 | **Webhook anti-replay + tenant routing** | HMAC verifies signature only; no timestamp window, no nonce. Webhook tenant is hardcoded to `AGENTIC_DEV_TENANT`. | S | Captured webhook replay is a real attack. Multi-tenant webhooks impossible. | (a) Require `X-Timestamp` header within ±5 min and include it in the signed payload. (b) Store last N event_ids per provider in a small table and reject duplicates. (c) Route `/v1/tenants/:slug/webhooks/:provider` so the URL carries tenancy; map via DB-stored `webhook_subscriptions` with per-tenant secrets. |
| 9 | **Pagination + audit read endpoints + soft delete** | Lists today return `LIMIT 50` and stop. `audit_log` is unreadable via API. `events`/`runs` grow forever. | M | UX cliff at 50 rows; auditors have no view; SQLite balloons. | Use cursor pagination (`(startedAt, id)` composite key) for `runs` and `events`; add `GET /v1/audit`; add a `retention_days` policy + nightly Inngest cron that uses `log-rotate.ts`-style sweep on `events.received_at < now - retention`. The 16-table schema doesn't have a soft-delete flag — adding `deleted_at` on `events`, `runs`, `tasks` is cheap and lets the cron be a soft mark first, then hard delete after a grace window. |
| 10 | **Pick one data plane for the SPA bootstrap** | `apps/web/app/api/spa/bootstrap/route.ts` synthesizes data; `/v1/*` returns real data. | M (depends on UI rewrite) | Two truths. Already a maintenance pothole; ships demo-data to prod by accident. | Aligned with the planned UI rewrite. Decision: kill `/api/spa/bootstrap` and have the SPA fetch `/v1/*` directly (after auth fix #1). The `lib/spa/derive.ts` synthesizers (~600 lines) become dev-only seed data driven through `apps/api/scripts/seed-rich.ts`. |

---

## 14. Open questions for product / team

1. **Tenancy model**: Is `__system` a real shared-services tenant or just a parking spot for code agents? If real, what's the authorization story for who can read its runs/logs? (Today: everyone.)
2. **Magic-link vs SSO**: `.env.example` mentions magic-link with Resend. Is there an SSO requirement (Okta, Google, Azure AD) for the first paying customer? Magic-link is fine for ops; enterprises will demand OIDC.
3. **Workflow live-reload**: Operators uploading manifests via `POST /v1/agents` expect their changes to fire. Today the new manifest is in the DB but the Inngest function registration is boot-time. Is a restart-on-deploy acceptable, or do we need hot-reload?
4. **Multi-instance API**: SQLite + per-process Inngest function registration means scaling beyond one box requires either (a) Postgres + shared queue, or (b) sticky tenant→instance routing. Which direction?
5. **Code-agent vs manifest-agent run namespace**: should runs from a code agent invoked by `raas` be visible under `raas` (with `agent.kind='code'` exposed) or under `__system`? The current "everywhere in `__system`, fall back from caller" pattern is the worst of both worlds.
6. **Audit retention**: how long do we keep `audit_log`, `events`, `runs`, `logs/*`? The log-rotate cron handles 7 days for files; nothing handles DB rows.
7. **Cost accounting**: `tokens_in/out` and `model` are stored per-run but there's no per-tenant aggregation or cost calculation. Do we surface this in v1 or push to v2?
8. **Webhook providers**: which providers (Stripe, GitHub, etc.) does the first customer need? Each one has a slightly different signature scheme; `webhooks.ts:5-17` already accepts the common headers but `pickSignature` swallows the mismatch silently.
9. **Artifact retention**: artifact files live forever under `AGENTIC_ARTIFACTS_DIR`. No cleanup. What's the lifecycle? (Run-tied? Soft-delete window?)
10. **Frontend rewrite scope**: the user has signaled a rewrite is coming. Will it remain Babel-SPA-on-Next, or move to first-class Next server components + the existing `api-client.ts`? If the latter, the SPA bootstrap route and `lib/spa/*` can be deleted wholesale.

---

### Appendix A — quick file index

For follow-up reads:

- **Boot**: `apps/api/src/server.ts:24`, `apps/api/src/bootstrap.ts:53`
- **Auth**: `apps/api/src/plugins/auth.ts:28`, `apps/api/src/plugins/auth.ts:73`
- **Envelope**: `apps/api/src/plugins/error.ts:39`
- **Cross-tenant leaks**: `apps/api/src/routes/v1/runs.ts:30`, `apps/api/src/routes/v1/runs-logs.ts:38`, `apps/api/src/routes/v1/agents.ts:70`, `apps/api/src/routes/v1/agent-invoke.ts:91`
- **Schema**: `packages/db/src/schema.ts`, migrations under `packages/db/drizzle/`
- **Client**: `packages/db/src/client.ts:25` (native binding resolver)
- **Step engine**: `packages/runtime/src/register.ts:53`, `packages/runtime/src/step-engine.ts:158`
- **Code-agent run engine**: `packages/agents/src/run-engine.ts:101`
- **LLM gateway**: `packages/llm-gateway/src/gateway.ts:71`
- **SPA bootstrap (synthesis)**: `apps/web/app/api/spa/bootstrap/route.ts`, `apps/web/lib/spa/derive.ts`
- **Contracts**: `packages/contracts/src/index.ts`
- **Typed client**: `apps/web/lib/api-client.ts:40`
- **Tests**: `apps/api/test/tc-*.test.ts`, `apps/api/test/setup.ts`, `apps/api/test/harness.ts`
