# Agents-OS Architecture Review
Reviewer: Principal AI Software Architect · Date: 2026-05-20

## Executive summary

- **The shape is right; the substrate is half-built.** All four pillars have
  real bones — Inngest-backed runtime, 14-provider gateway, tenant-scoped DB,
  hot-swap registry, broadcast channel. But three load-bearing primitives are
  scaffolds: **tool use** never reaches the wire (adapters strip `tools`),
  manifest **`condition`** is parsed but never evaluated, and
  **`triggered_event` branching** still hardcodes `[0]`. Until those close,
  this is "Inngest with better metadata," not an Agent OS.
- **Top fix #1: complete the tool-use loop in the adapters.**
  `packages/llm-gateway/src/adapters/anthropic.ts:97-113` and
  `openai-compatible.ts:84-110` flatten `tool_use`/`tool_result` blocks to
  string placeholders and never pass `req.tools` to the SDK. Contracts, run
  engine, and tests advertise tool use; the wire layer makes it a no-op.
- **Top fix #2: enforce tenant scoping at the type level.**
  `packages/db/src/with-tenant.ts:24` defines `tenantScope()` for exactly
  this; `grep -rn 'tenantScope(' apps packages` returns **zero hits**.
  Every query rebuilds `eq(table.tenantId, ...)` manually — one omission is
  a cross-tenant leak.
- **Top fix #3: collapse the two run engines.**
  `packages/runtime/src/register.ts` (manifest) and
  `packages/agent-runtime/src/run-engine.ts` (code) diverge on at least six
  details: hardcoded `model: "mock-model-v1"` at `register.ts:409` vs.
  `response.model` at `run-engine.ts:436`; SSE broadcast emit only on code
  path; artifacts written via two different code paths. Drift will widen.

## Verdict at a glance

| Pillar | Strength | Weakness | Severity |
|---|---|---|---|
| **1 — Coding env** | Rich manifest Zod with defensive coercion; small BaseAgent contract; repair-retry on `outputSchema` | No CLI; no IDE schema delivery; `typescript_code` is dead weight; manifest `tool` resolution silently hint-guesses | Important |
| **2 — Deployment env** | Real `deployments` lifecycle with rollback; real hot-swap via mutable serve handler; hand-rolled tar with path-traversal defense | No partial UQ enforcing single live deploy; manifest-import wizard is unimplemented; hot-swap failure is logged-and-continued; disk/DB drift possible on commit; `staging` vs `production` is cosmetic | Important |
| **3 — Runtime env** | Inngest discipline (every DB write in `step.run`, `step.sendEvent` for emits, `waitForEvent` for HITL); cron triggers ship | **Tool-use unwired**; condition gates ignored; branching emit hardcoded; subflow is a stub; `delay` uses `setTimeout` not `step.sleep`; manifest path silent on SSE | **Critical** |
| **4 — Harness eng** | Auth dev-bypass closed; audit log widespread (23 sites); budget enforcement real; mutex around hot-swap | `tenantScope()` unused; no `/metrics`; no traces; no orphaned-run sweep; healthcheck ignores LLM gateway; no rate limiting | Important |

---

## Pillar 1: Coding environment

### What's there

- **Manifest schema is real.** `packages/runtime/src/manifest.ts:140-188`
  preserves the Phase-0 silent-drop fix: `input_data`, `ontology_instructions`,
  `tool_use`, `typescript_code`, `cron`, `cron_timezone`, `model`,
  `concurrency`, per-action `retries`/`timeout_s` all survive parse. The
  `.passthrough()` at line 188 keeps the migration window open.
- **Defensive coercion.** `coerceEmptyToUndef` (line 119), `coerceToolUse`
  (line 129), and the `ActionSchema` preprocess (line 34-86) absorb
  hand-edits (string `""` → undefined; `tool_use:["http.fetch"]` →
  `[{name:"http.fetch"}]`; missing `order` derived from `id`). Necessary
  because `models/RAAS-v1/workflow_v1.json` is hand-authored.
- **BaseAgent surface.** `packages/agent-runtime/src/base-agent.ts:35-108`
  is the user contract — small, sealed `run()`, optional `outputSchema`,
  `getTools`/`getToolHandlers` hooks.
- **Migration scaffold.** `packages/runtime/src/migrations/index.ts` is
  empty but well-designed for v1→v2 changes.

### Gaps

- **No CLI.** PRD `FR-OS-6` and IMPL P1-CLI-01..04 prescribe `agentic
  init/deploy/logs/events tail`. The `apps/cli` directory does not exist.
  Tenants base64-encode tarballs by hand to deploy code today.
- **`typescript_code` field is dead weight.** `manifest.ts:166-167` calls
  it a documentation slot; there is no path from `agent.typescript_code =
  "..."` to a runnable code agent. Authors will assume the field executes.
- **Manifest `tool` action silently falls back to mock.**
  `step-engine.ts:268-279` tries the tenant registry, then
  `runTool(genericCtx, action.name)` — the generic stub registry — with no
  warning. An action `type:"tool", name:"searchCandidates"` resolves to
  a mock at run time instead of failing at deploy.
- **`tool_use` advertised on agents never reaches the LLM.** Even when set,
  the manifest step engine never reads `agent.tool_use` to build a
  `ChatRequest.tools[]`. (This compounds the Pillar-3 tool-use gap.)
- **No IDE schema delivery.** `packages/runtime/src/generate-workflow-schema.ts`
  exists but `models/workflow.schema.json` is gitignored output. No author
  gets red-squiggles on save.

### Recommendations

1. **Wire `typescript_code` to the tenant code shipping path or delete it.**
   At deploy, require a matching `data/tenants/<slug>/<version>/src/agents/
   <agent.name>.ts` when the field is non-empty. Severity: important.
2. **Ship the CLI** as a thin wrapper around existing routes (`apps/cli`).
   `init` lays out the tenant tree; `deploy` tars + posts to
   `/v1/tenants/:slug/code`. Severity: important.
3. **Promote `models/workflow.schema.json` to a shipped artifact** under
   `packages/contracts/dist/` and reference via `"$schema"`. Severity:
   nice-to-have.
4. **Fail loud on missing manifest tools.** `step-engine.ts:272`: if no
   tenant tool resolves and the generic registry has no entry for
   `action.name`, return `{ok:false, error:'tool_not_registered'}` rather
   than the hint-guessed mock. Severity: important.

---

## Pillar 2: Deployment environment

### What's there

- **Version pinning is correct.** `schema.ts:191-215` —
  `agent_versions(agentId, workflowVersionId, manifestJson)` with unique
  index `agv_agent_wfv_uq`. `runs.agentVersionId` (`schema.ts:280`) pins
  in-flight runs so roll-forward doesn't disturb them.
- **Deployments lifecycle.** `target ∈ {workflow, agent, runtime,
  code_agent, tenant_code}`, `status ∈ {live, rolled_back, pending}`
  (`schema.ts:139-146`). Routes flip atomically inside
  `db.transaction(...)` — see `routes/v1/agents.ts:300-323` and
  `routes/v1/deployments.ts:46-63`.
- **Hot-swap is real.** `apps/api/src/services/inngest-registry.ts` holds
  a mutable serve handler and rebuilds on `reregisterInngest()`. The
  `reregisterChain` promise at line 102 serializes concurrent rebuilds
  — closes a real race when two operators upload simultaneously.
- **Dynamic tenant loader.** `packages/runtime/src/tenant-loader.ts` reads
  `data/tenants/<slug>/<version>/agentic.json`, dynamic-`import()`s the
  registry, and cache-busts via `?v=&t=mtime`. Composition with in-tree
  tenants — dynamic wins (`bootstrap.ts:78-96`).
- **Tarball ingest hardened.** `routes/v1/tenant-code.ts:333-416` ships a
  hand-rolled tar reader that rejects symlinks, refuses `..` and absolute
  paths (lines 405-409), extracts to a `.tmp-<rand>/` dir and `fs.rename`s
  for atomicity.

### Gaps

- **No partial UQ on `deployments WHERE status='live'`.** DESIGN §13.1
  mandates it. `schema.ts:132-156` has none. A future contributor adding
  a "promote" route can silently insert a second live row. Today the
  invariant is enforced procedurally inside each transaction.
- **Manifest-import endpoint is unbuilt.**
  `docs/design/import-workflow-manifest.md` specifies
  `POST /v1/tenants/:slug/manifest-import` with `validate/stage/commit`
  modes, conflict resolution, overwrite guard. The contracts exist
  (`packages/contracts/src/workflows.ts:82-145`) but the route doesn't:
  `grep -rn 'manifest-import' apps packages` returns only the contracts.
  The wizard is documentation of a proposal.
- **`POST /v1/agents` deploys without conflict detection.**
  `routes/v1/agents.ts:164-355` computes a diff but no overwrite guard,
  no kebab-id collision check, no model-not-configured surface. This is
  the legacy path the manifest-import service is supposed to supersede.
- **Hot-swap failure is logged-and-continued.** Three sites:
  `routes/v1/agents.ts:333-338`, `workflow.ts:308-314`,
  `deployments.ts:69-76` all wrap `reregisterInngest` in try/catch and
  just log. No surface flags runtime/DB drift to an operator; no
  `deployments.runtime_status` column; an operator may believe a deploy
  succeeded when the new version is on disk but not running.
- **`staging` vs `production` is cosmetic.** Per
  `import-workflow-manifest.md` §"Out of scope": `commit applies the
  manifest live in either case`. A column value with no behavior.
- **Disk/DB drift on commit.** `routes/v1/workflow.ts:299-303` writes the
  file before the DB transaction commits. If the audit insert fails
  after writeFile succeeds, you have an orphan file; if writeFile fails
  after the DB commit, an orphan deployment row. There is no boot-time
  reconciliation that materializes missing files from the DB.
- **`deployments.expires_at` and `import_session_id` are missing.**
  `import-workflow-manifest.md` requires both for the `pending` lifecycle.
  Schema has neither.

### Recommendations

1. **Land the partial UQ.** `packages/db/drizzle/0012_deployments_live_uq.sql`:
   `CREATE UNIQUE INDEX dpl_one_live_per_target_uq ON deployments
   (tenant_id, target) WHERE status = 'live'`. Severity: important.
   Effort: XS.
2. **Implement `POST /v1/tenants/:slug/manifest-import`.**
   `apps/api/src/services/manifest-import.ts` + `routes/v1/manifest-import.ts`.
   Extract the diff/lint/commit logic from `routes/v1/agents.ts:164-355`
   into the service. Add `migrate()` call before Zod parse. Add the
   `expires_at`+`import_session_id` columns. Severity: important. Effort:
   L. (This is the feature this review is contextualised by.)
3. **Make hot-swap failures non-silent.** Add `deployments.runtime_status:
   "live" | "stale" | "failed"`; portal Deployments view shows a warning
   chip on `stale`; new endpoint `POST /v1/deployments/:id/reregister` for
   retry. Severity: important.
4. **Reverse commit order in `routes/v1/workflow.ts`:** DB commit first,
   disk write second. Add `packages/runtime/src/reconcile-disk.ts` to
   materialize missing files from `workflow_versions.manifestJson` on
   boot. Severity: important.
5. **Treat `target=staging` as a real namespace** — staged manifests get
   Inngest events under `${tenant}.staging/${name}`. Gate behind feature
   flag; v1.1. Severity: nice-to-have for v1.

---

## Pillar 3: Runtime environment

### What's there

- **Inngest discipline.** `packages/runtime/src/register.ts` puts every
  DB write inside `step.run` (init at line 93, manual init at 174,
  finalize at 369). Concurrency keyed `event.data.subject` (line 76),
  retries=3 (line 78). HITL via `step.waitForEvent("task.resolved",
  {if: 'async.data.taskId == "<id>"', timeout: "7d"})` — exactly the
  pattern in DESIGN §7.1.
- **Code-agent run engine.** `packages/agent-runtime/src/run-engine.ts:136-492`
  is the single-shot + multi-turn loop. One `steps` row per LLM call
  and per tool dispatch; artifact sidecars; broadcast `run.started`
  (line 178); repair-retry on `outputSchema` parse failure (lines 346-423).
- **LLM gateway dispatch.** `packages/llm-gateway/src/gateway.ts:60-150`
  implements failover: try, retry-once-on-transient, fall through provider
  list. Budget pre-flight at line 79; post-call deduction at lines 110-115.
  `combineSignals` (lines 162-180) uses native `AbortSignal.any()` when
  available.
- **14 providers registered.** `adapters/` covers anthropic, openai,
  openrouter, gemini, azure, groq, together, mistral, deepseek, qwen,
  custom, bedrock(stub), vertex(stub), mock. The `createOpenAICompatibleAdapter`
  factory carries 8 of the 14.
- **Cron triggers ship.** `packages/runtime/src/scheduler.ts:118-146`
  registers Inngest scheduled fns per (tenant, agent), supports
  TZ-prefixed crons, sends to the agent's primary trigger event so the
  registrar wakes up unchanged.
- **Broadcast channel.** `packages/runtime/src/broadcast.ts:38-70`.
  Per-tenant EventEmitter map, isolation by `tenantId`. Acknowledged
  backpressure deferred to Phase 4.

### Gaps

- **Tool use is plumbed but not wired (CRITICAL).**
  - `adapters/anthropic.ts:97-113` builds the SDK call with
    `messages: rest.map(m => ({role, content: messageToText(m)}))` where
    `messageToText` (line 20-31) flattens `tool_use`/`tool_result` blocks
    to placeholder strings (`[tool_use:${b.name}]`). `req.tools` is
    **never referenced**. The response is parsed at line 115-118 for
    text blocks only; `tool_use` blocks dropped.
  - `adapters/openai-compatible.ts:84-128` — same pattern. No `tools`
    in the request, no `tool_calls` parsed from the response.
    `mapFinishReason` accepts `"tool_calls"` (line 30) but it can never
    be returned.
  - `adapters/gemini.ts` — `grep req.tools` returns zero hits.
  - Mock adapter is the only one that simulates a tool call. `tc-15`
    and `tc-16` test the contract shape and mock path; no test
    wire-tests a real provider.
  - Net: any BaseAgent overriding `getTools()` gets an empty
    `tool_calls[]` from every real LLM. PRD `FR-RT-6` is unmet.
- **Manifest `condition` is parsed but never evaluated.**
  `packages/runtime/src/condition.ts:1-165` is a careful sandbox
  evaluator. `grep -rn 'evaluateCondition' packages apps` returns **no
  hits in `step-engine.ts` or `register.ts`**. `step-engine.ts:316-326`
  has a `case "condition":` that just returns `{evaluated:true, note:
  "condition gate passed"}`. PRD `FR-RT-4` is unmet.
- **Branching emit hardcodes `triggered_event[0]`.** `register.ts:368`
  literally `const emittedName = agent.triggered_event[0]`. The DESIGN
  §7.6 fix and IMPL P0-RT-02 acceptance is unimplemented. `matchResume`
  with three declared outcomes always emits the first. PRD `FR-RT-2`
  is unmet.
- **`runs.model` hardcoded "mock-model-v1" on the manifest path.**
  `register.ts:409`. The code-agent path correctly uses `response.model`
  (`run-engine.ts:436`). PRD `FR-RT-5` is unmet on one of two engines.
- **Subflow step is a stub.** `step-engine.ts:338-348` returns a
  metadata object; `register.ts` has no case for `type:"subflow"`. PRD
  `FR-RT-7` is partially unmet.
- **`delay` step uses `setTimeout`, not `step.sleep`.**
  `step-engine.ts:329-330`. Process restart during a 1-hour delay
  orphans the run. Inngest's durable `step.sleep` is bypassed.
- **Manifest path does not publish stream events.** `register.ts`
  has no calls to `publishStreamEvent`. Only the code-agent engine
  emits to the broadcast channel. The portal's `/v1/stream` SSE sees
  half the runs.
- **HITL `task_timeout_s` ignored.** Manifest schema accepts it
  (`manifest.ts:74-75`); `register.ts:217` hardcodes `timeout: "7d"`.
- **Subagent invoke unimplemented.** DESIGN §7.5 documents it as
  v1.1; today no `BaseAgent.invoke()`, no `__subagent.${name}` event,
  no `parentRunId` written by any code path despite the column existing.

### Recommendations

1. **Wire `tools` through the Anthropic adapter.** In `adapters/anthropic.ts:97-113`,
   add `tools: req.tools?.map(...)` to the `c.messages.create({...})` call;
   parse `response.content` blocks of type `tool_use` into
   `ChatResponse.toolCalls[]`. Effort: S. Severity: **critical**.
2. **Same for OpenAI-compatible.** Add `tools: req.tools?.map(t => ({type:
   "function", function: {name: t.name, description: t.description,
   parameters: t.input_schema}}))`. Response parse:
   `choice.message.tool_calls?.map(tc => ({id: tc.id, name:
   tc.function.name, input: JSON.parse(tc.function.arguments)}))`.
   Effort: S. Severity: **critical**.
3. **Add an e2e test that hits a real provider with a recorded fixture.**
   `apps/api/test/tc-19-p1-adapter-tools-e2e.test.ts` — `nock` or
   `vitest-fetch-mock`. The mock-only test in `tc-15`/`tc-16` is why this
   regressed unnoticed. Effort: M. Severity: **critical**.
4. **Call `evaluateCondition` from the step engine.** Top of switch in
   `step-engine.ts:267`: if `action.condition` is set, evaluate; on false
   return `{ok:true, type, data:{skipped:true}}` and caller writes
   `steps.status='skipped'` without updating `lastResult`. Severity:
   **critical** (data-correctness; PRD acceptance).
5. **Honor `__emit` discriminator + use `response.model`.** Replace
   `register.ts:368` and `:409`. Effort: S. Severity: **critical**.
6. **Implement subflow via `step.invoke`.** New case in `register.ts`:
   `await step.invoke(...)` against the callee's fn id; callee writes
   `runs.parentRunId` in its init step. Effort: M. Severity: important.
7. **Make `delay` durable.** Thread the Inngest `step` handle into
   `StepInput` so `step-engine.ts:329-330` can `step.sleep` instead of
   `setTimeout`. Effort: S. Severity: important.
8. **Publish stream events from `register.ts`** — five sites:
   `run.started`, per-step `started`/`completed`, `run.completed`/`failed`.
   Effort: S. Severity: important.
9. **Honor `task_timeout_s`** — `register.ts:217`. Effort: XS.

---

## Pillar 4: Harness engineering

### What's there

- **Auth dev-bypass correctly closed.** `plugins/auth.ts:33-69` requires
  `AUTH_MODE=dev` to be explicitly opted-in; `assertAuthModeSafe` (lines
  78-103) refuses to start if `AUTH_MODE=dev` + `NODE_ENV=production`.
  PRD `FR-API-1` met.
- **Audit log coverage.** 23 `writeAudit` call sites across 11 routes
  (deploys, rollbacks, task resolutions, agent enable/disable, budget
  updates, LLM keys, events emit, tenants CRUD). PRD `FR-OS-8` broadly met.
- **Cost cap enforcement.** `packages/llm-gateway/src/budget.ts` —
  `assertBudgetAvailable` pre-flight + `recordActualSpend` post-call,
  wired in `gateway.ts:79,110`. `tenant_budgets` table (`schema.ts:508`).
  PRD `FR-OS-9` met.
- **Hot-swap mutex.** `inngest-registry.ts:101-124` serializes concurrent
  re-registers.
- **Tarball path-traversal defense.** `tenant-code.ts:404-409` — normalize,
  reject `..` and absolute paths, drop symlinks.
- **Test breadth.** ~38 test files, 6,131 LOC, sequential SQLite pool.

### Gaps

- **`tenantScope()` defined but never used.** `with-tenant.ts:24-30`
  exists; `grep -rn 'tenantScope(' apps packages` returns zero hits.
  Every query in `apps/api/src/queries/*.ts` manually composes
  `eq(table.tenantId, tenantId)` — see `queries/runs.ts:85,179,225`.
  No compile-time guard against a missed predicate. PRD `NFR-SEC-1` is
  procedurally met today, structurally unguarded.
- **No partial UQ on `deployments WHERE status='live'`** (cross-ref
  Pillar 2).
- **No Prometheus `/metrics` endpoint.** Phase 4 work per IMPL P4-OPS-05.
  `apps/api/src/services/metrics.ts` likely a stub; not wired into
  `bootstrap.ts`. PRD `FR-OBS-3` unmet.
- **No tracing.** Acknowledged as v2 in DESIGN §16.4. The on-call cost
  is felt today: a 3-turn run that took 90s is "read artifact sidecars
  and infer."
- **Healthcheck ignores LLM gateway.** `routes/health.ts` checks DB +
  Inngest; PRD `NFR-DEP-4` requires `llmGateway: ok|degraded|down`. A
  tenant with no configured keys looks "ok" until the first invocation.
- **No orphaned-run sweep registered.** `packages/runtime/src/sweepers.ts`
  exists per the directory listing but I see no registration in
  `bootstrap.ts`. Stuck runs sit in `status='running'` forever.
- **5xx responses may leak internal messages.** Scrubbing is Phase-4
  per IMPL P4-API-02.
- **No body-size caps; no rate limiting.** PRD `FR-API-9`/`NFR-SEC-3`
  unmet; `@fastify/rate-limit` not in `server.ts`. `POST /v1/tenants/:slug/code`
  with a 5MB tarball is 6.7MB base64 — silently rejected by default 1MB
  cap.

### Recommendations

1. **Make `tenantScope()` the only path.** Convert every query in
   `apps/api/src/queries/*.ts`; add an ESLint rule (or AST test) blocking
   raw `eq(*.tenantId, ...)` outside `with-tenant.ts`. Severity:
   **important**. Effort: M.
2. **Land orphaned-run sweeper.** Register the scheduled function in
   `bootstrap.ts`; sweeps `runs WHERE status='running' AND started_at <
   now - 2h` every 30 min. Severity: important. Effort: S.
3. **Prometheus `/metrics` + basic Grafana JSON.** `prom-client` +
   `apps/api/src/routes/metrics.ts`. Counters: runs-by-status, tokens,
   step-duration histogram, provider-error counter, cost-USD. Severity:
   important. Effort: M.
4. **Tighten `/health`.** Add `gateway.listProviders().some(p => p.hasKey)`
   probe. Effort: XS.
5. **Body-size caps per route + rate limiting.** Severity: important.
   Effort: S.
6. **Cost columns + daily rollup.** `runs.costUsd`, `steps.costUsd`,
   `tenant_usage_daily` table, scheduled aggregator. The cost dashboard
   in PRD §6.3 has nothing to read today. Severity: important.

---

## Cross-cutting concerns

- **Cost observability has enforcement but not visibility.**
  `assertBudgetAvailable` blocks over-cap calls, but `tenant_usage_daily`
  doesn't exist; `runs.costUsd` / `steps.costUsd` columns aren't added.
  The dashboard chart has nothing to read.
- **Two run engines drift.** Already in the executive summary. Unification
  path: extract `executeRun({kind, agent, input, ctx})` in
  `packages/agent-runtime/src/run-engine.ts` that dispatches to the
  appropriate loop. Same artifact-write code, same broadcast emit, same
  `runs.model` write. Effort: XL (1-2 engineer-weeks). Closes three of
  the Pillar 3 gaps permanently.
- **Multi-region readiness.** Schema is region-agnostic; broadcast is
  in-process (a multi-pod deploy fans out incorrectly until the channel
  moves to Redis pub/sub). Acknowledged in `broadcast.ts:8-15`.
- **The dual-runtime story is a Pillar-3 risk.** CLAUDE.md claims "two
  parallel agent execution paths share the same `runs/steps` schema and
  SSE log tail" — true on the schema, false on the SSE tail (manifest
  path silent). The PRD §3 differentiation only delivers if both paths
  are first-class. Today only the code path is.

---

## Prioritised recommendations

Ordered critical → important → nice-to-have. Each: title, files, effort
(XS<2h, S<1d, M<3d, L<1wk, XL>1wk), impact.

1. **[CRITICAL] Wire `req.tools`/`toolCalls` through the Anthropic and
   OpenAI-compatible adapters.** Files:
   `packages/llm-gateway/src/adapters/anthropic.ts:97-130`,
   `openai-compatible.ts:84-130`. Effort: S+S. Impact: tool-use becomes
   real for the two most-used providers.
2. **[CRITICAL] Real-provider e2e test for tool use.** File:
   `apps/api/test/tc-19-p1-adapter-tools-e2e.test.ts`. Effort: M.
   Impact: regression insurance for #1.
3. **[CRITICAL] Call `evaluateCondition` from the step engine + record
   `steps.status='skipped'`.** Files: `step-engine.ts:267`, `register.ts`.
   Effort: S. Impact: PRD `FR-RT-4` met.
4. **[CRITICAL] Honor `__emit` discriminator and use `response.model` on
   the manifest path.** Files: `register.ts:368-414`. Effort: S. Impact:
   `FR-RT-2`, `FR-RT-5` met.
5. **[CRITICAL] Implement subflow via `step.invoke`.** Files: `register.ts`
   (new case), `code-agent-fn.ts` (callee writes `parentRunId`).
   Effort: M. Impact: `FR-RT-7`; trace tree gains data.
6. **[IMPORTANT] Make `tenantScope()` the only tenant predicate.** Files:
   `apps/api/src/queries/*.ts`, new ESLint rule. Effort: M. Impact:
   cross-tenant leak structurally impossible.
7. **[IMPORTANT] Partial UQ on `deployments WHERE status='live'`.** File:
   `packages/db/drizzle/0012_deployments_live_uq.sql`. Effort: XS. Impact:
   DB-level invariant.
8. **[IMPORTANT] Manifest-import wizard service + route.** Files:
   `apps/api/src/services/manifest-import.ts`,
   `routes/v1/manifest-import.ts`, `drizzle/0013_deployment_pending.sql`.
   Effort: L. Impact: closes the wizard feature this review contextualises.
9. **[IMPORTANT] Publish stream events from `register.ts`.** Files:
   `register.ts` (5 sites). Effort: S. Impact: manifest runs visible in
   real time; `FR-API-6` met for the dominant agent kind.
10. **[IMPORTANT] Unify the run engine.** Files: `agent-runtime/src/run-engine.ts`
    (dispatcher), `register.ts` (delegate). Effort: XL. Impact: drift
    closed permanently.
11. **[IMPORTANT] Surface hot-swap failure.** Files: schema migration,
    `inngest-registry.ts`, `routes/v1/deployments.ts`. Add
    `deployments.runtime_status`. Effort: M.
12. **[IMPORTANT] `delay` durable via `step.sleep`.** Files:
    `step-engine.ts:329-330`, `register.ts`. Effort: S.
13. **[IMPORTANT] Honor `task_timeout_s`.** File: `register.ts:217`.
    Effort: XS.
14. **[IMPORTANT] Orphaned-run sweeper in bootstrap.** Files:
    `packages/runtime/src/sweepers.ts`, `apps/api/src/bootstrap.ts`.
    Effort: S.
15. **[IMPORTANT] `/metrics` endpoint + Grafana dashboard JSON.** Files:
    `apps/api/src/routes/metrics.ts`, `apps/api/src/server.ts`,
    `docs/grafana/`. Effort: M.
16. **[IMPORTANT] Cost columns + daily aggregator.** Files: migration,
    `cost-aggregator.ts`, `routes/v1/usage.ts`. Effort: M.
17. **[IMPORTANT] Body-size caps + rate limiting.** Files:
    `apps/api/src/server.ts`. Effort: S.
18. **[NICE-TO-HAVE] CLI workspace.** Files: `apps/cli/**`. Effort: L.
19. **[NICE-TO-HAVE] Promote `workflow.schema.json` as a shipped artifact.**
    Effort: S.
20. **[NICE-TO-HAVE] Real staging namespace via shadow Inngest events.**
    Effort: L; gate behind flag for v1.

---

## What is already excellent

A short list of design choices that should be protected against regression:

- **The Inngest discipline in `register.ts`.** Every DB write inside
  `step.run`, every outbound event via `step.sendEvent`, HITL via
  `step.waitForEvent` with a structured `if` clause. Textbook. Onboard
  future contributors against this file.
- **Dynamic tenant loader cache-busting.** `tenant-loader.ts`'s
  `?v=&t=mtime` query-string trick + the `inngest-registry` mutex gives a
  real hot-deploy story without a worker pool.
- **Zod `preprocess` for the manifest.** Coercing legacy/hand-edited
  shapes (`tool_use: ""`, `tool_use: ["http.fetch"]`, missing `order`)
  lets the platform accept existing manifests without giving up
  strictness for new authors.
- **The 14-provider gateway abstraction.** `createOpenAICompatibleAdapter`
  carries 8 of 14; only Anthropic, Gemini, Azure bespoke; Bedrock/Vertex
  stubs by design. Cleaner than most production gateways.
- **Audit-log discipline.** 23 sites across 11 routes is not normal —
  most platforms learn this lesson late.
- **`assertAuthModeSafe` boot guard.** Refusing to start when
  `AUTH_MODE=dev` + `NODE_ENV=production` is exactly the kind of guard
  that prevents the worst kind of outage.
- **In-flight runs pin to `agent_version_id`.** Roll-forward doesn't
  disturb mid-flight runs; rollback flips the pointer without surprises.
  Right semantics for an agent OS.
- **Repair-retry on `outputSchema` failure** (`run-engine.ts:346-423`).
  One retry with the parse error inlined as the next user message is the
  right pragmatic response to LLM JSON malformation.
- **Hand-rolled tar reader** at `routes/v1/tenant-code.ts:333-416` avoids
  a heavy dep and includes GNU long-name + path-traversal defense.
  Solid engineering judgment.

---

*Snapshot at 2026-05-20; revise after each phase exits.*
