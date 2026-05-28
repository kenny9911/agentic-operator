# Agent OS Readiness — Synthesis Audit

> **Audit:** 04 of 04 · synthesis layer
> **Scope:** Is Agentic Operator a true "Operating System for Agents"? What must change?
> **Reviewer:** AI Software Architect
> **Date:** 2026-05-19
> **Status:** Final, opinionated

---

## 1 · Executive summary

**Is this an Agent OS today? — No.**

Agentic Operator is a credible *event-driven workflow runtime + admin portal* with two agent shapes (manifest, code), a real LLM gateway across 14 providers, and a working durable-step engine on Inngest. It clears the bar for an MVP demonstration platform. It does **not** clear the bar for an "Agent Operating System," because the platform-vs-user contract is still partially specified, the user authoring surface is fragmented across three places (`tenants/*/src/`, `models/<slug>/`, in-tree `packages/agents/src/system/`), there is no deployment surface for user code, the runtime offers no isolation between platform and tenant code, and several "OS-grade" primitives — schedules, webhook ingestion, secrets, memory, sub-agents, sandboxing — are either missing or stubbed.

### tl;dr

- The platform has the **plumbing** of an OS — durable runtime, registry, deployments table, audit, multi-tenant DB scoping — but lacks the **boundary semantics** of one (no sandbox, no contract for "user code," no shipping/deployment loop, no per-tenant resource governance).
- The harness contract is clear for `tool`/`logic`/`manual` manifest steps and for single-shot `BaseAgent.run()`. It is muddy or missing for: long-running agents, tool-use loops, schedules, webhooks, multi-agent orchestration, memory, streaming.
- The runtime treats *built-in* code (`packages/agents/src/system/test-agent.ts`) and *user* code (`tenants/raas/src/`) identically — both `import` from `@agentic/agent-kit`. There is no "user-land" vs. "platform-land" distinction; deploying new code means editing the monorepo and restarting Node. That is acceptable for v1, but it is **not** an OS.
- The portal is the strongest piece. It is a credible Inngest+LangSmith-shaped runtime UI. It would carry the brand if the underlying execution model gained five missing primitives.
- The wedge — declarative-first agents that drop into a code-extensible runtime, per-tenant code, integrated portal — is real and defensible. But the wedge has not been packaged into a clear, shippable contract for users yet.

---

## 2 · What is an "Agent Operating System"?

An Agent OS is a platform that provides a **stable runtime contract** for AI-agent workloads such that authors deliver code (or declarative artifacts) and the platform supplies everything else. Operationally, an Agent OS must offer at minimum:

1. **A platform/user boundary.** A clear, versioned contract specifying what authors write, what the platform provides, and how they meet. The contract is enforced by types, schemas, and runtime checks — not by convention.
2. **Authoring affordances.** Local IDE story, type-safety, scaffolding (`init`), hot reload during development, schema validation, sample data, and a way to test in isolation before deployment.
3. **A deployment surface.** The path from "on disk" to "live in the runtime" is automatable: a CLI, a Git integration, or a portal upload — not "edit the monorepo and `pnpm dev`."
4. **A durable runtime.** Retries, timeouts, concurrency keys, schedules, event triggers, replays, and durable state. The runtime survives process restarts.
5. **Isolation.** Tenant code does not crash the platform, exhaust its memory, exfiltrate other tenants' data, or run forever. Resource limits are enforced.
6. **Observability.** Every run, step, tool call, LLM call, and event has a trace. Costs are attributable. Errors are catalogued. Replay is a one-click action.
7. **Versioning + rollback.** Every artifact is immutable and pinned per run. Promote/rollback is atomic.
8. **Extensibility.** New providers, new tools, new agent kinds, new step types, and new event sources can be added without forking the runtime.

### Analogs

| Platform | Wedge | What it gets right |
|---|---|---|
| **Inngest** | Durable step functions on top of an event bus. | Step memoization, concurrency keys, sleep/waitForEvent, dashboard. Best-in-class durability primitives. |
| **Temporal** | Durable workflow programming model. | Activities + workflows, replay determinism, signals, queries, version-pinned executions. Best-in-class durability theory. |
| **LangGraph** (LangSmith) | Stateful multi-agent graph + tracing. | Graph DSL, checkpointing, time-travel, hosted tracing, prompt eval. Best agent-author UX inside Python. |
| **Mastra** | TypeScript-first agent framework. | Strong types, agent + tool primitives, RAG primitives, observability hooks. Best TS DX for solo dev. |
| **Restack** | Temporal-for-agents. | Durable agents with hosted runtime, schedule + event + manual triggers. Best "Temporal but accessible." |
| **Letta** (MemGPT) | Stateful agents with long-term memory. | First-class memory tiers (core, archival), agent-as-process model. Best memory abstraction. |
| **Vellum** | Hosted prompt + agent ops. | Prompt versioning, eval, deploy, A/B. Best "ops for prompts." |

Agentic Operator is positioned closest to **Inngest + LangSmith + Restack** combined — durable event-driven runtime + portal + multi-agent ops. It needs to credibly compete on at least one dimension where each of those wins.

---

## 3 · Harness contract — current state

The single most important table in this audit. Each row is one capability an Agent OS must offer; we show what the platform provides, what the user writes, and the current status.

| Capability | Platform-provided | User-written | Today |
|---|---|---|---|
| **Event trigger** | Inngest event with `${tenant}/${EVENT}` naming, fan-out to listeners (`packages/runtime/src/register.ts:66`) | Manifest `trigger: [...]` field, or external `POST /v1/events` | YES |
| **Durable run** | One Inngest function per agent, retries=3, concurrency=8/subject (`register.ts:70-81`) | None — automatic | YES |
| **Step memoization** | `step.run()` wrap; replays are idempotent (`register.ts:283-349`) | None — automatic | YES |
| **Tool dispatch (manifest)** | Resolver: tenant registry → generic fallback (`step-engine.ts:158-209`) | `defineTool({...})` in `tenants/<slug>/src/tools/` | YES |
| **LLM call** | `LLMGateway.chat()` over 14 providers, JSON-mode, failover (`packages/llm-gateway/src/gateway.ts`) | System+user prompts, optional structured-output schema | YES |
| **Code-defined agent (single-shot)** | `BaseAgent` abstract + run engine (`packages/agents/src/run-engine.ts`) | Subclass + `buildMessages()` + optional `parseOutput()` | YES |
| **Tool-use loop (multi-step LLM)** | `maxSteps` field declared on BaseAgent, **not implemented** (`base-agent.ts:42`) | — | NO |
| **Multi-agent orchestration** | None — agents communicate only via events; no `invoke(otherAgent)` primitive | — | NO |
| **Sub-agent / spawn** | None | — | NO |
| **Human-in-the-loop** | `manual` step type → `tasks` row → `step.waitForEvent('task.resolved')` (`register.ts:169-279`) | Manifest declares `{ type: 'manual', task_type: '…' }`; portal renders task | YES |
| **Schedules / cron** | None — no scheduler component, no cron trigger | — | NO |
| **Webhook ingestion** | `POST /v1/webhooks/:provider` route exists (`apps/api/src/routes/v1/webhooks.ts`) but no registration/dispatch contract | Implied: per-provider signature verifier | PARTIAL |
| **External event ingest** | `POST /v1/events` → SQLite row + ledger + Inngest send | Bearer token | YES |
| **Run state (in-flight)** | `runs` table + Inngest replay determinism | — | YES |
| **Run output (post-completion)** | `runs.emittedEventId` + `artifacts/*` sidecars | — | YES |
| **Long-term memory** | None | — | NO |
| **Vector / retrieval** | None — PRD §3 declares this non-goal | BYO retrieval | DEFERRED |
| **Concurrency control** | Per-agent Inngest concurrency key (default `event.data.subject`) | Hard-coded constant in `registerAgent` | PARTIAL |
| **Rate limiting (per-tenant LLM)** | None | — | NO |
| **Cost caps** | None | — | NO |
| **Timeouts** | Default Inngest behavior; per-step `timeout_s` declared in schema, **not honored in step-engine** | Manifest action `timeout_s` (parsed but unused) | PARTIAL |
| **Retries** | Per-agent retries=3 (hard-coded); per-step `retries` in schema, **not honored** | Manifest action `retries` (parsed but unused) | PARTIAL |
| **Streaming responses** | None (`base-agent.ts` returns whole string; no SSE for LLM token streams) | — | NO |
| **Artifacts** | Step-input / step-output JSON written to `artifacts/<runId>/` (`run-engine.ts:46-52`) | `defineTool()` can return arbitrary data; no first-class artifact API | PARTIAL |
| **File / blob storage** | Filesystem only; no S3/blob abstraction | — | PARTIAL |
| **Secrets / credentials** | Env vars only; `apiTokens` table exists but only for inbound auth | — | PARTIAL |
| **Per-tenant BYOK (provider keys)** | None — gateway holds one key per provider, shared across tenants (`services/llm.ts`) | — | NO |
| **Logging** | NDJSON-ish file logs + SSE tail (`packages/runtime/src/log-writer.ts`) | — | YES |
| **Tracing (OTel)** | Not wired; design doc mentions optional support | — | NO |
| **Audit log** | `audit_log` table + `writeAudit()` helper (`apps/api/src/plugins/audit.ts`) | — | PARTIAL |
| **Versioning** | `workflow_versions` + `agent_versions` + `deployments` tables | — | YES |
| **Promote / rollback** | DB rows allow it; API endpoints `POST /deployments/:id/rollback` declared in DESIGN.md but coverage incomplete | — | PARTIAL |
| **Replay (event / run)** | `POST /v1/events/:id/replay`, `POST /v1/runs/:id/replay` declared in DESIGN.md §7; implementation unverified | — | PARTIAL |
| **Tenant code shipping** | None — adding a tenant package requires editing `apps/api/package.json` and `bootstrap.ts` (`bootstrap.ts:14-17`) | Edit monorepo | NO |
| **Sandboxing of tenant code** | None — tenant `defineTool` handlers run in the same Node process as the platform | — | NO |
| **Resource limits per tenant** | None — no CPU/memory/wall-time caps | — | NO |
| **Hot reload (dev)** | Inngest functions are re-registered only on process restart; manifest changes require restart | — | NO |
| **CLI (`agentic` command)** | None — DESIGN.md §5.6 promises `agentic init/deploy/logs/events`; no `apps/cli` package exists | — | NO |
| **Visual builder** | Not present; PRD lists as Mode 3; no implementation | — | NO |
| **API contract introspection** | `@agentic/contracts` Zod schemas + dual-side validation (`packages/contracts/src/`) | — | YES |
| **Frontend ↔ backend separation** | Next.js web (`:3599`) calls Fastify api (`:3501`); no shared DB access | — | YES |
| **Multi-tenant DB scoping** | `with-tenant.ts` helpers; `tenantId` on every user-visible table | — | YES |

### What this table says

- **The manifest path is the most-finished surface.** Trigger, step engine, retries, manual, audit — all wired.
- **The code-agent path is single-shot only.** `BaseAgent.run()` does one LLM call and returns. There is no tool-use loop, no orchestration with other agents, no streaming. The `maxSteps` field is a placeholder.
- **The deployment story does not exist for user code.** Both manifest tenants (`models/<slug>/`) and code tenants (`tenants/<slug>/`) are picked up at boot. There is no "ship a new build" — only "edit the monorepo, restart Node."
- **Several declared schema fields are dead code today** — `actions.retries`, `actions.timeout_s` are validated but not honored by the step engine. This is harmless drift but signals an incomplete contract.

---

## 4 · Authoring environment

### What exists today

| Layer | State |
|---|---|
| **Local repo** | Monorepo (Turbo + pnpm). User clones, runs `pnpm dev`, gets web+api+inngest. |
| **Manifest authoring** | Hand-edit `models/<slug>/workflow_v1.json` + `actions_v1.json`. Zod parsing on load. No editor support for the schema. |
| **Tool authoring** | Edit `tenants/<slug>/src/tools/*.ts`. `defineTool` builder is typed; output Zod schema validated at runtime. |
| **Code agent authoring** | Subclass `BaseAgent`, `import { agentRegistry }; agentRegistry.register(new MyAgent())`. (`packages/agents/src/system/test-agent.ts:33`) — but this lives in `packages/agents/src/system/`, the platform's own tree. There is no obvious user-land path for code agents. |
| **TypeScript IntelliSense** | Works inside the monorepo. `@agentic/agent-kit`, `@agentic/llm-gateway`, `@agentic/contracts` all export typed surfaces. |
| **Hot reload** | Web app (Next.js) hot-reloads. API does not — Fastify + Inngest functions are registered on `bootstrapRuntime()` once. Editing a manifest, a tool, or a code agent requires restarting `pnpm dev`. |
| **Schema validation** | `WorkflowManifestSchema` in `packages/runtime/src/manifest.ts:40`. Errors surface at load time as thrown exceptions. No editor integration (e.g., JSON Schema export for VSCode). |
| **Sample data / fixtures** | None. PRD §16 mentions `tests/fixtures/<tenant>/<event-name>.json` as a future best practice. |

### Gaps

- **No "user workspace" concept.** The boundary between platform code (`packages/agents/src/system/`) and user code (`tenants/<slug>/src/`) is convention, not enforcement.
- **No scaffold CLI.** PRD §5.6 promises `agentic init` and `agentic deploy`. Neither exists.
- **No "live preview" or "test run" affordance.** A user authoring a new code agent has no path to "run with sample input, see result, iterate" short of `curl POST /v1/agents/:name/invoke` after restart.
- **No JSON Schema export.** Manifest authors cannot get autocomplete/validation in their editor without a separately distributed `.schema.json`.
- **No portal-driven editing.** The "Edit" button on the Agents page (per `apps/web/app/_portal_legacy/agents/`) cannot edit a deployed manifest or code agent; it shows the config read-only.

### What the SPA's "Edit" / "Deploy agent" buttons SHOULD do

To match the OS framing, they should:

- **"Edit" on a manifest agent** — open a Monaco editor with the live manifest, schema-validated. Save creates a new `workflow_version`, deploys, leaves audit trail.
- **"Edit" on a code agent** — out of scope for portal v1; surface as "Open in editor" deep link instead. The OS doesn't pretend to be a remote IDE.
- **"Deploy agent" wizard** — three paths matching PRD §5.4: (a) manifest upload from disk, (b) CLI hint with copy-pastable `agentic deploy raas --version …`, (c) "create from template" for code agents.

---

## 5 · Deployment surface

### How code goes from disk to running today

```
┌─────────────────────────────────────────────────────────────────────┐
│  Author writes / edits files in monorepo                            │
│   ├─ models/<slug>/workflow_v1.json   (manifest agent)              │
│   ├─ tenants/<slug>/src/tools/*.ts    (tenant tools)                │
│   └─ packages/agents/src/system/*.ts  (code agent — wrong place!)   │
└───────────────────────────────┬─────────────────────────────────────┘
                                │  pnpm dev (restart)
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  apps/api/src/bootstrap.ts:bootstrapRuntime()                       │
│   1. getLLMGateway() ← env vars                                     │
│   2. bootstrapCodeAgents() ← imports + registers code agents        │
│   3. bootstrapAll(TENANT_REGISTRIES) ← reads models/ folders        │
│   4. Inngest receives N functions                                   │
└─────────────────────────────────────────────────────────────────────┘
```

**Critical observation:** code-agent registration is import-side-effect (`agentRegistry.register(new TestAgent())` at the bottom of `test-agent.ts`). For new code agents to load, `packages/agents/src/system/index.ts` must `import` them. Tenants that want their own code agents have nowhere obvious to put them — the system folder is platform-owned.

### Build-time vs. runtime registration

| Mechanism | Today | OS-correct |
|---|---|---|
| Manifest agents | Loaded at boot from disk; DB rows upserted | Loaded at boot; DB rows + Inngest functions atomically updated on `POST /v1/agents` |
| Code agents | Registered via TypeScript import side-effect | Loaded via a runtime registry that the platform reads from a *content* directory, ideally bundled and uploaded |
| Tenant code (tools/prompts) | Imported by `apps/api/src/bootstrap.ts:30` (`import raasTenant from "@tenants/raas"`); requires editing `package.json` + bootstrap.ts to add a new tenant | Discovered from a per-tenant package path, dynamic `import()` allowed |

### Versioning, promote, rollback

| Concern | Schema support | Runtime support |
|---|---|---|
| `workflow_versions` table | YES (`schema.ts:97`) | YES — `bootstrapTenant` and `POST /v1/agents` write rows |
| `agent_versions` table | YES (`schema.ts:173`) | YES — written on manifest upload and code-agent bootstrap |
| `deployments` table with `status: live/rolled_back/pending` | YES (`schema.ts:120`) | PARTIAL — live pointer flips on upload, but `POST /deployments/:id/rollback` is in DESIGN.md only |
| Run pinning (`runs.agentVersionId`) | YES | YES — set by `registerAgent` at run time |
| Atomic re-registration of Inngest functions | NO | Re-registration happens on process boot only |

### Drift between disk and DB

When a manifest is uploaded via `POST /v1/agents`, DB rows are written but `models/<slug>/` on disk is not touched. On next boot, `bootstrapAll()` re-reads disk and may write a competing version. **This is a real correctness risk** for a v1 platform.

### What an OS needs

1. **Disk → DB is a one-way pump at boot.** Or, **DB is authoritative** and disk is a seed. Decide; document.
2. **An upload endpoint that survives restart.** The new version must be picked up without re-reading disk.
3. **An atomic deploy.** Insert version + flip live pointer + re-register Inngest function in one transaction.
4. **A rollback endpoint** that actually flips the live pointer and is tested.
5. **A CLI** that wraps the upload endpoint, bundles tools, and gives the author git-style ergonomics.

---

## 6 · Runtime environment

### Process model

- **3 processes in dev:** `apps/web` (Next.js :3599), `apps/api` (Fastify :3501), `inngest-cli dev` (:8288). `package.json:11` shows the `concurrently` invocation.
- **In production:** identical — no horizontal scaling story documented.

### Isolation

- **Zero isolation between tenant code and the platform.** Tenant tools/prompts (`tenants/raas/src/tools/ping-probe.ts`) are loaded into the same Node process as the API. A poorly behaved handler can:
  - throw and crash a Fastify request (caught by `error.ts`, OK)
  - block the event loop (no protection)
  - leak memory (no protection)
  - open arbitrary sockets / read arbitrary files (no protection)
  - exfiltrate other tenants' data through DB queries (DB queries from inside tenant code are *not* tenant-scoped automatically — author must remember; this is a footgun)
- **No worker isolation.** Inngest functions run in the same Node process as Fastify.

### Resource limits

- **Per-step timeout:** declared in manifest, ignored in code (`step-engine.ts` does not pass `timeout_s` to anything).
- **Per-step retries:** declared in manifest, ignored.
- **Wall-time:** Inngest default (long).
- **Memory:** Node default (V8 limit ~4GB).
- **CPU:** none.
- **LLM token budget:** none — every call hits the configured provider until the key is rate-limited.
- **Concurrency:** per-agent limit=8, key=`event.data.subject` (`register.ts:74-77`). Reasonable default; not per-tenant.

### LLM cost caps

- None. A tenant can burn the platform key indefinitely. The PRD §6 lists "cost attribution per agent / per tenant beyond raw token counts" as out of scope for v1, but for an OS this is a v1 must.

### Sandbox story

- **None today.** PRD §6 lists "sandboxed code execution for tools" as deferred. For v1 this is acceptable for *trusted tenants only* — i.e., self-hosted by a single team. For "multi-tenant SaaS Agent OS" it is disqualifying.

---

## 7 · Multi-tenancy

### What works

- **Identity propagation:** `registerAuth` decorates every request with `req.auth = { tenantId, tenantSlug }` (`apps/api/src/plugins/auth.ts:67-69`).
- **DB scoping:** `with-tenant.ts` helpers wrap queries; every user-visible table has `tenant_id`.
- **Inngest namespacing:** event names are `${tenant}/${EVENT}` (`register.ts:67`); function IDs are `${tenant}.${name}` (`register.ts:58`).
- **Log paths:** per-tenant directory layout planned (`data/logs/<tenant>/runs/<date>/`).
- **API tokens:** SHA-256 hashed, tenant-scoped (`api_tokens` table).
- **`__system` tenant:** special slug for cross-tenant code agents (`packages/agents/src/bootstrap.ts:29`). Sound design choice.

### What's missing

| Concern | State | Severity |
|---|---|---|
| Per-tenant API keys (BYOK) for LLM | Not implemented; one platform key per provider | HIGH |
| Cost attribution per tenant | Token counts on runs, but no aggregation/dashboard/quota | HIGH |
| Per-tenant rate limit | None | HIGH |
| Per-tenant resource limits (CPU/mem/wall) | None | HIGH |
| Tenant code isolation | None (see §6) | HIGH for SaaS, LOW for self-host |
| Cross-tenant data leak protection | Convention-based: author must use `withTenant(ctx)`. No automated guard. | MEDIUM |
| Per-tenant secrets vault | None — env vars only | MEDIUM |
| Tenant onboarding flow | None (manual DB seed) | MEDIUM |

### Threat model

For **trusted self-hosted single-team deployment**: this is fine. Multi-tenancy is structurally there for org-style separation, not for adversarial isolation.

For **public SaaS**: this is not deployable. A tenant's tool can call internal endpoints, read other tenants' rows (if author forgets `withTenant`), or exhaust the LLM budget. The recommendation is to *brand v1 explicitly as self-host* and reserve the SaaS framing for v2 after a sandbox lands.

---

## 8 · Observability and runtime UI

### What the portal surfaces today

| Surface | Implementation | Quality |
|---|---|---|
| **Dashboard** — KPIs, active runs, agent grid, event ticker, awaiting humans, runtime health | `app/_portal_legacy/page.tsx` reads `counts`, `runs`, `events`, `tasks`, `agents` APIs | Strong — matches prototype |
| **Runs** — list + detail with timeline, logs (SSE tail), I/O, events | `/runs/[id]` route, `runs-logs.ts` SSE | Strong |
| **Agents** — grid + detail with config, versions, runs | `/agents/[kebab]` route | Strong |
| **Events** — firehose, filter, replay | `/events` route | Strong (replay endpoint partial) |
| **Tasks** — HITL inbox with type-specific surfaces | `/tasks` route | Strong (surface is generic; per-type surfaces deferred) |
| **Logs** — file-tree explorer | `/logs` route | Adequate |
| **Deployments** — versions, history, rollback, new-deploy wizard | `/deployments` route | Partial — wizard for manifest upload only; no CLI/visual deploy |
| **Workflows** — DAG canvas with agents-as-nodes, events-as-edges | `/workflows` route | Strong for visualization |
| **Settings** — RBAC, credentials, quotas | `/settings` route | Mostly placeholders for v2 |

### What's missing vs. LangSmith / Inngest dashboards

| Capability | Inngest | LangSmith | Agentic Operator |
|---|---|---|---|
| Per-LLM-call cost & token chart | YES | YES | Steps have provider/model/tokens; no aggregation UI |
| Trace tree (waterfall of all nested calls in one run) | YES | YES | Steps are a flat list, no nesting |
| Error catalog ("top 10 errors this week") | YES | YES | NO |
| Replay UI ("re-run this exact event with my new agent") | YES | YES | Endpoint declared, UI partial |
| A/B test (route X% to version v2) | NO | YES | NO |
| Eval harness (offline grading) | NO | YES | NO |
| Prompt diff viewer | NO | YES | NO |
| Cross-run search (full-text over logs) | YES | YES | grep over file logs only |
| Spans / OTel export | LIMITED | YES | NO |
| Dataset capture from runs | NO | YES | NO |

### Recommendation

The portal is the strongest asset. For v1, the gap analysis above translates to two priorities:

1. **Cost dashboard** — aggregate per-tenant token + cost charts; the data already lives in `runs` + `steps`.
2. **Trace tree view on a run** — visually nest LLM calls inside tool calls inside steps. Today it's flat.

A/B, eval, dataset capture, prompt diff — all great, all v2.

---

## 9 · Versioning, rollback, audit

### Tables present and populated

| Table | Populated by | Read by |
|---|---|---|
| `workflow_versions` | manifest upload, bootstrap | `POST /v1/agents` diff, deployments page |
| `agent_versions` | manifest upload, code-agent bootstrap | `runs.agentVersionId` for run pinning, agents detail |
| `deployments` | manifest upload, code-agent bootstrap | deployments page |
| `audit_log` | `writeAudit()` in manifest upload | (no UI surface yet for the audit log itself) |

### Rollback semantics

- DB schema supports it: a `deployments` row carries `status: live | rolled_back | pending`.
- On a new upload, the prior live row flips to `rolled_back` (`apps/api/src/routes/v1/agents.ts:233-253`).
- **Reverse direction (rollback to an older version)** — DESIGN.md §9 specifies `POST /api/deployments/:id/rollback`. Not wired in `apps/api/src/routes/v1/deployments.ts` per the route scan.
- **In-flight runs are pinned** to their `agent_version_id` (`runs.agentVersionId` set on insert). This is correct.

### Audit log

- `audit_log` is written on manifest deploy (`agents.ts:255-262`).
- Not written for: rollback, task resolve, token issuance, agent enable/disable, deployments via code-agent bootstrap.
- No UI surface to read it.

### Gaps

- Rollback endpoint is not implemented.
- Audit log writes are spotty.
- No "diff this version against that one" UI for code agents (manifest diff exists for upload).

---

## 10 · Extensibility model

### Adding a new LLM provider

- Add an adapter to `packages/llm-gateway/src/adapters/`.
- Register it in `packages/llm-gateway/src/providers/index.ts`.
- Add it to `PROVIDER_IDS` and `PROVIDER_MODEL_CATALOG` in `packages/contracts/src/providers.ts`.
- Add env-var resolution in `packages/llm-gateway/src/config.ts`.

**This is a clear pattern**, well-documented in `docs/design/llm-gateway-and-baseagent.md`. ~4 file edits per provider.

### Adding a new tool everyone can use

- Add a function to `packages/tools/src/index.ts` (today only `httpFetch` and `channelPublish` exist).
- Extend `runTool()`'s dispatch table.
- **Or** make it tenant-specific: `defineTool({...})` in `tenants/<slug>/src/tools/`.

**Pattern is OK but "everyone can use" tools live in a package, not in user-land.** An OS would let users contribute platform-tier tools without editing the platform.

### Adding a new agent kind

- Today: extend `AgentKind = "manifest" | "code"` in `packages/db/src/schema.ts:157` and `packages/contracts/src/agents.ts:5`.
- Add bootstrap path.
- Add registration path.

**This is intrusive — touches DB schema and contracts.** A new "workflow agent that orchestrates other agents" would require ~5 file edits. The plug-in surface for agent kinds is shallow.

### Adding a new step type

- Today: `StepTypeEnum = z.enum(["tool", "logic", "manual"])` in `packages/runtime/src/manifest.ts:14`.
- Extend the enum, add a case in `step-engine.ts:runAction()`, add a case in `register.ts` if the type needs durable wait semantics like `manual`.

**This is intrusive — touches schema, step engine, and registration.** Adding `approval | delay | subflow` would require ~3 file edits each. Acceptable for now, but a richer DSL would split this.

### Custom event sources (webhook → event)

- `POST /v1/webhooks/:provider` exists as a route — no concrete provider wiring.
- DESIGN.md §13 references HMAC verification per provider.
- **Effectively: TODO.**

---

## 11 · Comparison to analogs

| Dimension | Agentic Operator | Inngest | Temporal | LangGraph | Mastra | Restack | Letta |
|---|---|---|---|---|---|---|---|
| Trigger model | Event + manifest + manual | Event | Workflow signal | Graph entry | Code call | Event + cron + manual | Stateful agent |
| Durability | Inngest-backed | First-class | First-class | Checkpointed | Limited | Inngest-like | Stateful |
| Multi-tenancy | Built-in (DB-level, soft isolation) | Native (workspaces) | Namespace | None native | None native | Native | Per-agent |
| Code vs. config | Both (manifest + code) | Code-only | Code-only | Code-only | Code-only | Code-only | Config-heavy |
| Harness | Mid — gaps in code-agent loop | Strong — function w/ steps | Strongest — replay determinism | Strong — graph DSL | Strong — typed | Strong | Strong — agent process |
| Observability portal | Strong (own portal) | Strong (cloud) | Strong (cloud + OSS UI) | Strong (LangSmith) | Limited | Cloud only | Limited |
| LLM gateway | Built-in (14 providers) | None | None | LangChain-mediated | Built-in | None | Built-in |
| HITL | First-class `manual` + tasks inbox | `step.waitForEvent` | Signal | LangGraph interrupt | None native | Manual trigger | None native |
| Schedules / cron | NO | YES | YES | NO | YES | YES | NO |
| Memory | NO | NO | NO | Checkpointed | Built-in (RAG) | NO | First-class |
| Sandboxing | NO | Process | Process | None | None | Process | Container |
| Cost | DB tracks tokens, no UI | Logged | None native | Tracked | None native | None | None |
| Self-host | YES | YES (Cloud first) | YES | NO (cloud-only LangSmith) | YES | YES | YES |

### Where Agentic Operator wins

- **Multi-tenancy out of the box.** None of Inngest, Temporal, LangGraph, Mastra makes tenants a first-class table.
- **Manifest agents AS WELL AS code agents.** Inngest/Temporal/Mastra are code-first; LangGraph is graph-first. Agentic Operator straddles, which lets non-engineers ship.
- **Integrated runtime portal.** The dashboard is at platform-tier quality. Inngest has a dashboard, Temporal has a UI, LangSmith is the platform — but none combine portal + multi-tenant + tasks inbox + manifest agents.
- **HITL as a first-class step type.** Built into the schema, the UI, and the engine — not bolted on.
- **LLM gateway across 14 providers.** Inngest, Temporal, Restack, LangGraph don't ship this; you BYO.

### Where it loses

- **No durability theory.** Inngest/Temporal have years of thinking on replays, signals, queries, version pinning. We use Inngest, which inherits some of this — but we have not exposed it.
- **No multi-agent orchestration primitive.** LangGraph's graph + state DSL is the canonical answer here; we have nothing.
- **No memory layer.** Letta + Mastra have it; we don't.
- **No sandbox.** Restack runs activities in subprocesses; Temporal can dispatch to workers; LangGraph cloud has multi-tenant sandbox. We have none.

---

## 12 · Differentiation thesis (200-300 words)

Inngest and Temporal already do durable workflows. LangGraph already does graph-shaped agents. Restack is Temporal-for-agents. Why does Agentic Operator exist?

The wedge is **the manifest**. Inngest, Temporal, LangGraph, Mastra, Restack are all *code-first* platforms: the unit of authorship is a TypeScript or Python file, and the unit of deployment is a build. This is correct for engineers and incorrect for everyone else. It also means each new agent requires a developer round-trip — *and so the cost of changing an agent is the cost of a deploy*. For domain experts who design workflows (recruiters, compliance officers, ops managers), this is the wrong shape.

Agentic Operator's bet is: a declarative manifest format covers ~70% of real agent workflows (linear pipelines of LLM calls + tool calls + human approvals), and a typed code-extension surface (`@agentic/agent-kit`) covers the other 30%. Authors flow between modes without rebuilding the platform. Combined with a built-in multi-tenant runtime portal and a 14-provider LLM gateway, the result is the *first agent platform a domain expert can drive directly*, where engineers extend rather than gatekeep.

This wedge is real but undercooked. It needs three things to become defensible: (a) the manifest format must be expressive enough to handle branching and sub-agents — today it cannot; (b) the deployment loop must be one-click from the portal — today it requires editing the monorepo; (c) the multi-tenant story must include cost caps and BYOK — today it has neither. With those three, the thesis stands. Without them, the platform is a working prototype for a single-tenant team, not an OS.

---

## 13 · MUST-HAVES to credibly claim "Agent OS"

15 items. Each: definition, current state, effort (S/M/L), priority.

1. **CLI (`agentic`)** — `init`, `deploy`, `logs`, `events tail`, `events replay`. Wraps the upload + token + SSE endpoints. **State:** missing entirely. **Effort:** M. **Priority:** P0.
2. **Atomic deploy via API** — `POST /v1/agents` should also re-register Inngest functions without a process restart. **State:** restart required. **Effort:** M. **Priority:** P0.
3. **Rollback endpoint + UI** — `POST /v1/deployments/:id/rollback` that flips live pointer, re-registers, audit-logs. **State:** schema supports, endpoint missing. **Effort:** S. **Priority:** P0.
4. **Per-tenant BYOK for LLM** — `tenant_provider_keys` table; gateway resolution order: per-tenant → platform default. **State:** not implemented; gateway holds one key per provider. **Effort:** M. **Priority:** P0.
5. **Per-tenant cost cap + token budget** — daily/monthly token + USD cap with enforcement at the gateway boundary. **State:** tokens tracked on `runs`, no budgets. **Effort:** M. **Priority:** P0.
6. **Schedule / cron triggers** — declarative `schedule: "0 * * * *"` on a manifest agent; Inngest cron functions. **State:** none. **Effort:** S. **Priority:** P1.
7. **Webhook ingest contract** — per-provider HMAC verifier registry; `POST /v1/webhooks/:provider` dispatches to a configured signature-verifier + event-translator. **State:** route exists, no contract. **Effort:** M. **Priority:** P1.
8. **Tool-use loop in BaseAgent** — multi-step LLM with tool calls; `maxSteps > 1`; gateway tool-call adapter normalized across providers. **State:** declared, not implemented. **Effort:** L. **Priority:** P1.
9. **Sub-agent / agent-invokes-agent primitive** — a code agent can `await this.invoke("otherAgent", input)`; same DB rows, correlationId threaded. **State:** none. **Effort:** M. **Priority:** P1.
10. **Memory / state per agent or per subject** — KV table keyed by `(tenant, agent, subject)`; gateway hook to read+write. **State:** none. **Effort:** M. **Priority:** P1.
11. **Replay UI + endpoint hardening** — `POST /v1/runs/:id/replay` with deterministic input reconstruction; "Replay" button on run detail. **State:** declared, partial. **Effort:** S. **Priority:** P1.
12. **Per-step retries + timeouts honored** — read `action.retries` + `action.timeout_s` and apply at `step.run()` config. **State:** parsed, ignored. **Effort:** S. **Priority:** P1.
13. **Cost dashboard (per-tenant, per-agent, per-model)** — aggregate `steps.tokensIn/Out × price` over time. **State:** raw data exists, no UI. **Effort:** M. **Priority:** P1.
14. **Streaming LLM responses** — `gateway.chatStream()` → SSE in the portal for live token streams. **State:** none. **Effort:** M. **Priority:** P2.
15. **Out-of-process tenant code (worker isolation)** — tenant tools run in a separate Node process (or `vm2`/`isolated-vm`); RPC over IPC. **State:** none. **Effort:** L. **Priority:** P2 for self-host, P0 for SaaS.

---

## 14 · SHOULD-HAVES (post-launch)

- **OTel spans** wired through the gateway and run engine.
- **Dataset capture from runs** — bookmark a run as an eval input.
- **Eval harness** — `pnpm eval` runs a frozen dataset against a candidate version, scores, diffs.
- **Prompt versioning + A/B routing** — per-tenant flag at the gateway boundary.
- **Visual builder for manifests** — drag-and-drop canvas exporting `workflow.json`.
- **Secret vault** — libsodium-encrypted secrets table with KMS-rooted master key.
- **Hot reload for manifests** — file watcher re-registers Inngest functions.
- **Federated event ingest** — accept events from another Agentic Operator instance over a signed protocol.
- **Marketplace of community tools** — a registry of `@agentic/tools-*` packages discoverable from the portal.
- **Multi-region read replicas** for the DB.

---

## 15 · Recommended architectural refinements

10 concrete refinements, each with rationale.

1. **Rename `packages/agents` → `packages/agent-runtime`** and `packages/agent-kit` → `packages/agent-sdk`. Today both exist and the line between them is fuzzy. `agent-runtime` is platform-internal (BaseAgent class, run engine, registry, bootstrap). `agent-sdk` is user-facing (`defineTool`, `definePrompt`, `BaseAgent` re-export). **Rationale:** the user/platform boundary is the OS's most important seam; the names should reflect it.

2. **Move `packages/agents/src/system/` out of platform tree.** Code agents that ship with the platform should live in `apps/api/src/agents/` (or a new `packages/system-agents/`). The `packages/agents` package should never know about specific agents. **Rationale:** the system folder is a user-land violation — the platform shouldn't ship example code in a platform package.

3. **Introduce `packages/agent-host`** — a lightweight runtime contract that both manifest and code agents satisfy. Today `register.ts` and `run-engine.ts` are parallel paths that re-implement run/step/log lifecycle. Hoist that lifecycle into a shared host. **Rationale:** any new agent kind ("workflow agent", "scheduled agent", "webhook agent") should plug into one host, not require two new files.

4. **Make `actions.retries` and `actions.timeout_s` real.** Read them in `step-engine.ts` and pass to `step.run(name, opts, body)` Inngest config. **Rationale:** dead schema fields are platform debt.

5. **Split `packages/runtime` into `runtime-core` (step-engine, log-writer, event-ledger) and `runtime-bootstrap` (model discovery, Inngest registration).** Today bootstrap and core are tangled in one package. **Rationale:** a hot-reloadable runtime needs `runtime-core` to be a pure library callable from anywhere, while `runtime-bootstrap` owns the lifecycle.

6. **Introduce `packages/agent-server`** — an abstraction over Fastify that bundles routes, auth, audit, and Inngest registration. `apps/api/src/server.ts` shrinks to ~10 lines. **Rationale:** lets users build their own API surface on the same primitives.

7. **Deprecate `tenants/<slug>/` import-from-monorepo pattern.** Replace with: each tenant ships a tarball or zipfile, uploaded via `POST /v1/tenants/:slug/code`. Bootstrap dynamic-imports from `data/tenants/<slug>/`. **Rationale:** this is the deploy story; it cannot require editing `apps/api/package.json`.

8. **Promote `__system` to a real concept: `system_kind` enum on `agents`.** Today the synthetic `__system` tenant is a workaround. Make code agents first-class without a fake tenant by introducing `agents.scope: 'tenant' | 'system'`. **Rationale:** code agents may be tenant-scoped (a tenant's custom agent) OR system-scoped (a built-in like TestAgent); the schema should say so.

9. **Introduce a `runs.parentRunId` column** to support sub-agent invocations. The portal can then render a tree of runs per top-level event. **Rationale:** when a code agent invokes another agent, the trace tree is the OS's primary debugging affordance.

10. **Adopt a `Trigger` abstraction.** Today `register.ts` only knows about Inngest event triggers. Introduce `interface Trigger { register(agent, ctx): InngestFn }` with implementations for `EventTrigger`, `CronTrigger`, `WebhookTrigger`. **Rationale:** "agent kinds" and "trigger kinds" are orthogonal — a code agent can be event-triggered or cron-triggered. Today they are conflated.

---

## 16 · Critical-path roadmap to v1

A 4-phase, ~6-10 week plan. Each phase has scope, exit criteria, and dependencies.

### Phase 0 — Harden the boundary (1-2 weeks)

**Scope.** Make the harness contract explicit and complete what's declared but dead.

- Refactor `packages/agents` ↔ `packages/agent-kit` rename (Refinement #1).
- Move `packages/agents/src/system/` out of platform tree (Refinement #2).
- Honor `actions.retries` + `actions.timeout_s` in step engine (Refinement #4, MUST #12).
- Implement `POST /v1/deployments/:id/rollback` (MUST #3).
- Implement atomic deploy via API (no restart) (MUST #2).
- Wire audit log writes on all state-changing endpoints.

**Exit criteria.**
- A user can upload a manifest via `POST /v1/agents` and see new runs go through the new version *without restarting the server*.
- Rollback button on deployments page actually flips the live pointer and re-registers Inngest functions.
- Per-action retries + timeouts visible in `runs/steps` data.
- Every state mutation in the API writes an `audit_log` row.

**Dependencies.** None.

### Phase 1 — Ship the CLI + deploy loop (2 weeks)

**Scope.** Build the path from a developer's laptop to a running agent in production without editing the monorepo.

- `apps/cli` package with `init`, `deploy`, `logs`, `events tail`, `events replay`. Wraps existing API endpoints. (MUST #1)
- Tenant code packaging: tarball upload to `POST /v1/tenants/:slug/code`, stored under `data/tenants/<slug>/<version>/`, dynamic-imported on next bootstrap. (Refinement #7)
- Schedule / cron triggers via manifest `schedule` field; introduce `Trigger` abstraction. (MUST #6, Refinement #10)
- Webhook contract: each provider declares `{verifySignature, translateToEvent}`; route looks up by `:provider`. (MUST #7)

**Exit criteria.**
- `npx agentic init my-tenant` scaffolds a tenant repo.
- `npx agentic deploy my-tenant --version 1.0.0` lands code + manifest into a running platform, visible in deployments page within 5 seconds.
- A manifest agent with `schedule: "0 * * * *"` runs hourly.
- A Stripe-style webhook hits `/v1/webhooks/stripe` with valid HMAC and an `INVOICE_PAID` event appears.

**Dependencies.** Phase 0.

### Phase 2 — Real-agent primitives (2-3 weeks)

**Scope.** Make code agents do more than one LLM call.

- Tool-use loop: `BaseAgent.maxSteps > 1` actually loops; gateway tool-call normalization across providers. (MUST #8)
- Sub-agent invocation: `agentRegistry.get('foo').invoke(input, ctx)`; `runs.parentRunId` populated. (MUST #9, Refinement #9)
- Memory primitive: `agent_memory` table keyed by `(tenant, agent, subject)`; SDK hooks `getMemory(ctx)`, `putMemory(ctx, k, v)`. (MUST #10)
- Streaming: `gateway.chatStream()`; SSE wrapper on `POST /v1/agents/:name/invoke?stream=1`. (MUST #14)

**Exit criteria.**
- A code agent can use the `web.search` and `email.send` tools across 3 turns, store intermediate state in memory, then call another agent.
- Run detail in portal shows a nested trace (tool calls inside steps, sub-runs inside parent run).
- Streaming endpoint emits tokens as they arrive.

**Dependencies.** Phase 0 (boundary), Phase 1 (deploy loop) — useful but not required.

### Phase 3 — Multi-tenant safe (2-3 weeks)

**Scope.** Make this deployable to more than one team.

- Per-tenant BYOK at gateway boundary; `tenant_provider_keys` table; UI in Settings → Models. (MUST #4)
- Per-tenant token + USD cost cap; budget-exceeded → 429 with `cost_limit_exceeded` error code. (MUST #5)
- Cost dashboard: per-tenant, per-agent, per-model line charts over 7d/30d. (MUST #13)
- Tenant code worker isolation: dynamic-imported tenant code runs in a forked Node process with limited heap and CPU. (MUST #15)
- Replay UI: button on run detail re-emits trigger event scoped to current live version. (MUST #11)

**Exit criteria.**
- Two tenants on one instance cannot see each other's data, runs, logs, or credentials.
- A tenant exceeding its monthly budget gets a budget error, not a successful LLM call.
- A misbehaving tenant tool that infinite-loops does NOT block the platform's event loop.
- A run with a code error can be replayed from the portal in 1 click.

**Dependencies.** Phases 0-2.

### Combined milestones

| Week | Milestone |
|---|---|
| 1-2 | Phase 0 complete. Atomic deploy + rollback via API. |
| 3-4 | Phase 1 complete. CLI works end-to-end; schedule + webhook triggers live. |
| 5-7 | Phase 2 complete. Tool-use, sub-agents, memory, streaming. |
| 8-10 | Phase 3 complete. BYOK, cost caps, sandboxing, cost dashboard. |
| 10 | **v1 release: "Agent OS, self-host edition"** is a defensible claim. |

The label "Agent OS" sticks at the end of Phase 3. Earlier than that, it's a workflow runtime with agent ambitions.

---

## Appendix A — Verdict by primitive

If we had to score the platform out of 10 against an idealized Agent OS on each primitive, this is the state today:

| Primitive | Score | Comment |
|---|---|---|
| Manifest agent runtime | 8/10 | Solid; needs retries/timeouts honored |
| Code agent runtime | 5/10 | Single-shot only; no loop, no sub-agents, no memory |
| LLM gateway | 8/10 | 14 providers, error model, failover; missing streaming + tool-call normalization |
| Portal (runtime UI) | 8/10 | Strong; missing cost dashboard + trace tree |
| Multi-tenancy (soft) | 7/10 | DB scoping good; BYOK + isolation missing |
| Multi-tenancy (hard isolation) | 1/10 | No sandbox |
| Deployment surface | 2/10 | Edit monorepo + restart |
| Versioning + rollback | 5/10 | Schema yes, endpoints partial |
| Observability | 5/10 | Logs + steps yes; traces + costs no |
| Authoring DX | 5/10 | Types yes; CLI no; hot reload no |
| Extensibility | 6/10 | Providers clear; agent kinds/step types invasive |
| Schedules / cron | 0/10 | Missing |
| Webhooks | 2/10 | Route shell, no contract |
| Memory | 0/10 | Missing |
| Streaming | 0/10 | Missing |

Aggregate: ~4.5/10. Headline: **strong on the parts that exist, structurally absent on five primitives that an OS cannot skip.**

---

## Appendix B — Concrete files quoted in this audit

For follow-up reading:

- `apps/api/src/bootstrap.ts:14-17` — tenant code wiring contract
- `apps/api/src/bootstrap.ts:53-76` — boot sequence
- `apps/api/src/server.ts:48-67` — route registration
- `apps/api/src/routes/v1/agent-invoke.ts:77-86` — async path stubbed at 501
- `apps/api/src/routes/v1/agents.ts:233-253` — live pointer flip on upload
- `packages/agents/src/base-agent.ts:42` — `maxSteps` declared, unused
- `packages/agents/src/run-engine.ts:101-272` — code-agent single-shot lifecycle
- `packages/agents/src/system/test-agent.ts:33` — registration via side effect
- `packages/agent-kit/src/types.ts:17-38` — `ToolContext`, the harness payload
- `packages/agent-kit/src/define-tool.ts:36-46` — user-facing tool builder
- `packages/runtime/src/register.ts:66-81` — Inngest function registration
- `packages/runtime/src/register.ts:169-279` — HITL state machine
- `packages/runtime/src/step-engine.ts:158-209` — tool/logic/manual dispatch
- `packages/runtime/src/manifest.ts:16-25` — `ActionSchema` (retries, timeout_s declared)
- `packages/runtime/src/bootstrap.ts:69-100` — model dir discovery
- `packages/runtime/src/bootstrap.ts:368-396` — bootstrapAll iteration
- `packages/db/src/schema.ts:120-144` — deployments table with `code_agent` target
- `packages/db/src/schema.ts:146-171` — agents table with `kind` + `enabled`
- `packages/contracts/src/agents.ts:5` — `AgentKindEnum`
- `tenants/raas/src/index.ts:24-29` — tenant code registry shape
- `tenants/raas/src/tools/ping-probe.ts:16-35` — minimal `defineTool` example

---

*End of synthesis audit. Combine with audits 01-03 for full coverage. Cross-reference to PRD §3 (Goals) and §6 (Out of scope) when planning v1 scope.*
