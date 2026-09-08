# Agentic Operator — Architecture

Event-driven multi-agent runtime and operations console. One pnpm workspace holds
the operator portal, the REST/SSE API, the durable workflow runtime, the model
gateway, the tool/integration plane, and two agent-authoring planes (Agent
Factory and OntoCode).

This document is the architecture reference: ten diagrams, each with the
description of what it shows and where the code lives.

- Verified against the working tree on **2026-09-01** (branch `main`).
- **16** workspace packages · **4** published apps (plus `apps/inngest-worker`,
  a Dockerfile-only container definition) · **8** tenant code packages ·
  **10** manifest roots · **88** SQLite tables · **80** migrations ·
  **40** `/v1` route modules · **35** registered global tools in 18 categories ·
  **13** runtime-selectable model providers.

---

## Table of contents

1. [System context](#1-system-context)
2. [Process / container view](#2-process--container-view)
3. [Workspace dependency map](#3-workspace-dependency-map)
4. [The execution path — event to run](#4-the-execution-path--event-to-run)
5. [Step engine and the tool trust boundary](#5-step-engine-and-the-tool-trust-boundary)
6. [LLM gateway and the usage ledger](#6-llm-gateway-and-the-usage-ledger)
7. [Authoring planes and the promotion pipeline](#7-authoring-planes-and-the-promotion-pipeline)
8. [OntoCode session and harness jobs](#8-ontocode-session-and-harness-jobs)
9. [Storage and the system of record](#9-storage-and-the-system-of-record)
10. [Security and trust boundaries](#10-security-and-trust-boundaries)

---

## 1. System context

Who talks to the platform, and which external systems it reaches. Everything
crossing the dashed boundary is credentialed, policy-gated, and attributed.

```mermaid
flowchart TB
    subgraph actors["People and clients"]
        OP["Operator / admin<br/>browser"]
        CLI["agentic CLI<br/>apps/cli"]
        EXT["Upstream systems<br/>API tokens + webhooks"]
    end

    subgraph platform["Agentic Operator"]
        WEB["Portal — Next.js 16<br/>apps/web :3599"]
        API["API + runtime host — Fastify 5<br/>apps/api :3540"]
    end

    subgraph external["External systems (credentialed egress)"]
        LLM["Model providers ×13 runtime-selectable<br/>Anthropic · OpenAI · Gemini · Azure · Groq<br/>Mistral · Together · DeepSeek · Moonshot<br/>Z.ai · Qwen · OpenRouter · custom"]
        SAAS["Business SaaS<br/>GoHire ATS · HTTP APIs · Postgres · MetaERP"]
        MCPS["MCP servers<br/>stdio / streamable-http child processes"]
        CDX["Codex app-server 0.150.1<br/>pinned, JSON-RPC over stdio"]
        SBX["Isolated sandbox host<br/>Docker execution plane"]
        OBJ["Blob backend<br/>S3 / R2 / MinIO or HTTP"]
    end

    OP --> WEB
    CLI --> API
    EXT --> API
    WEB -->|"/v1/* + /health rewrite"| API
    API --> LLM
    API --> SAAS
    API --> MCPS
    API --> CDX
    API --> SBX
    API --> OBJ

    classDef boundary stroke-dasharray:5 5
    class external boundary
```

**Description.** The portal has **zero database access** — every read and write
goes over `/v1/*`, which `apps/web/next.config.mjs` rewrites to
`AGENTIC_API_URL`. Three client classes reach the API: browser sessions
(HttpOnly `agentic_session` JWT cookie), tenant-scoped bearer API tokens
(`apps/api/src/routes/v1/api-tokens.ts`), and inbound provider webhooks that
require a configured HMAC secret (`routes/v1/webhooks.ts`).

Outbound, the platform is deliberately fail-closed. A missing credential
surfaces as an explicit **integration gap** rather than a synthesized result;
`assertRealLLMGateway` in `apps/api/src/services/llm.ts` refuses to boot a
non-test API against a mock-like provider or model, and `/health` publishes
`llmGateway.mock` so one curl proves whether a stack is real.

---

## 2. Process / container view

What actually runs, on which port, holding which state.

```mermaid
flowchart LR
    subgraph dev["pnpm dev — one supervised stack"]
        direction TB
        W["@agentic/web<br/>Next.js 16 · React 19<br/>:3599"]
        A["@agentic/api<br/>Fastify 5 · tsx watch<br/>:3540"]
        I["inngest-cli dev<br/>:8488 (gateway 8489)"]
    end

    subgraph state["Durable state on disk"]
        DB[("SQLite WAL<br/>data/agentic.db<br/>88 tables")]
        LOGS[("Run logs<br/>data/logs/‹tenant›/runs/‹date›/‹run-id›.log")]
        LEDG[("Event ledger NDJSON<br/>data/logs/‹tenant›/events/‹date›.ndjson")]
        ART[("Artifacts + blobs<br/>data/artifacts")]
        MODELS[("Manifests<br/>models/‹slug›-v‹n›/*.json")]
    end

    subgraph scaleout["Optional scale-out backends"]
        RED["Redis — cross-instance SSE fanout<br/>REDIS_URL"]
        PG["Postgres + pgvector<br/>long-term agent memory"]
        S3["S3 / R2 / MinIO<br/>shared blob replication"]
    end

    subgraph side["Side processes"]
        MCPP["MCP server children<br/>@agentic/mcp manager"]
        SBXR["Sandbox runner containers<br/>deploy/factory-sandbox/*"]
        ERP["@agentic/mock-erp<br/>demo ERP target"]
    end

    W -->|rewrite| A
    A <-->|"serve + PUT self-sync<br/>/inngest and /inngest/:slug"| I
    I -->|"invoke functions"| A
    A --- DB
    A --- LOGS
    A --- LEDG
    A --- ART
    A -->|boot-time load| MODELS
    A -.-> RED
    A -.-> PG
    A -.-> S3
    A --> MCPP
    A --> SBXR
    A -.-> ERP
```

**Description.** `pnpm dev` boots exactly three supervised processes
(`concurrently` with `--kill-others-on-fail`); `predev` first kills stale
processes owned by this workspace. The API is the only writer of durable state.

**Inngest is one app per tenant.** `apps/api/src/routes/inngest.ts` serves the
base app at `/inngest` (the `__system` platform app, or `INNGEST_MAIN_TENANT`
when set) and every tenant app at `/inngest/:slug`, delegating to a **mutable**
handler held in `services/inngest-registry.ts`. That indirection is what lets a
deploy, an agent enable/disable, an archive, or a tenant onboarding swap a
served function set **without restarting the process**;
`services/inngest-sync.ts` reconciles apps with the broker via PUT self-sync.

The optional backends are config-flips, not rewrites: `fanout-redis.ts` reports
`redis` or `local` to `/health`; `blob-backend.ts` keeps local writes
authoritative and replicates content-addressed keys out to S3 asynchronously,
falling back to the backend on a local read miss.

Node is pinned to **26.8.1** to keep local, CI, and Docker runtimes consistent.
`better-sqlite3` must match the runtime's native-module ABI.
`scripts/ensure-native-modules.mjs` detects a mismatch via
`process.dlopen` and rebuilds in place; it is wired into `postinstall` and every
native-dependent `pre*` script.

---

## 3. Workspace dependency map

The package graph. Arrows point from consumer to dependency.

```mermaid
flowchart TB
    subgraph apps["apps/"]
        WEB["@agentic/web<br/>portal · 18 views"]
        API["@agentic/api<br/>REST · SSE · Inngest host"]
        CLIA["@agentic/cli"]
        ERP["@agentic/mock-erp"]
    end

    subgraph core["Runtime core"]
        RT["@agentic/runtime<br/>manifest · register · step-engine<br/>codeact · artifacts · ledger"]
        AG["@agentic/agents<br/>BaseAgent · registry · run-engine"]
        GW["@agentic/llm-gateway<br/>adapters · budgets · usage ledger"]
        TL["@agentic/tools<br/>global registry · 68 tools"]
        DB["@agentic/db<br/>drizzle schema · tenantScope · seed"]
    end

    subgraph auth["Authoring planes"]
        AF["@agentic/agent-factory<br/>conductor · specialists · sandbox"]
        OC["@agentic/ontology-compiler<br/>compile · package admission"]
    end

    subgraph shared["Contracts and kits"]
        CT["@agentic/contracts<br/>Zod — single source of truth"]
        AK["@agentic/agent-kit<br/>defineTool · ToolContext"]
        SDK["@agentic/agent-sdk"]
        SH["@agentic/shared<br/>makeId · time"]
        MCP["@agentic/mcp"]
        SK["@agentic/skills"]
        CH["@agentic/codex-harness"]
        CP["@agentic/codex-protocol"]
        RC["@agentic/recruitment-capabilities"]
    end

    subgraph ten["tenants/ — custom code only"]
        T["raas · robohire · northwind<br/>insightlab · zhaopin<br/>agents-generation · tenant-test1"]
    end

    WEB --> CT
    CLIA --> CT
    API --> RT
    API --> AG
    API --> GW
    API --> TL
    API --> DB
    API --> AF
    API --> MCP
    API --> SK
    API --> CH
    API --> RC
    API --> CT
    API --> T
    RT --> AK
    RT --> SDK
    RT --> CT
    RT --> DB
    RT --> GW
    RT --> TL
    AG --> CT
    AG --> DB
    AG --> GW
    AG --> RT
    GW --> CT
    GW --> DB
    TL --> AK
    TL --> DB
    DB --> SH
    AF --> CT
    AF --> SH
    MCP --> AK
    SK --> AK
    CH --> CP
    RC --> AG
    RC --> TL
    T --> AK
    T --> TL
```

**Description.** `@agentic/contracts` is the spine: Zod schemas that the API
validates requests with and the portal parses responses with
(`apps/web/lib/api-client.ts`). One schema change is caught at both ends by
`pnpm typecheck`.

Two rules explain the shape of this graph:

- **Tenant wiring lives in `apps/api`, not in `@agentic/runtime`.** pnpm's
  isolated module resolution requires each package to own its own deps, so
  `TENANT_REGISTRIES` in `apps/api/src/bootstrap.ts` is where a tenant code
  package gets registered. `@agentic/runtime` stays tenant-agnostic.
- **New tools go in `packages/tools`, not in a tenant package.** Anything
  exported into `globalToolRegistry` is callable by any agent in any tenant. The
  remaining `tenants/*/src/tools/*.ts` files are ~3-line re-export shims kept
  for back-compat.

Two directories look like workspace members but are not: `packages/agent-runtime`
holds only build residue, and `apps/inngest-worker` is a Dockerfile plus an
entrypoint script — a container image definition, not a package.

A **manifest-only tenant needs no TypeScript at all** — drop
`models/<slug>-v<n>/`, add the tenant row, restart. Bootstrap auto-discovers it
and it runs on global tools.

---

## 4. The execution path — event to run

The core loop, from an inbound event to a persisted run and the next event.

```mermaid
sequenceDiagram
    autonumber
    participant C as Client<br/>(portal · token · webhook)
    participant API as apps/api<br/>POST /v1/events
    participant DB as SQLite
    participant L as Event ledger<br/>NDJSON
    participant IG as Inngest broker
    participant FN as registerAgent fn<br/>tenant.agentName
    participant SE as step-engine
    participant SSE as GET /v1/stream

    C->>API: publish ${tenant}/EVENT_NAME
    API->>API: auth → membership → tenant scope
    API->>DB: insert events row
    API->>L: append ledger line
    API->>IG: inngest.send (namespaced event)
    IG->>FN: invoke (concurrency key = data.subject, retries = 3)

    FN->>DB: step.run → insert runs row (status=running)
    loop each manifest action
        FN->>SE: runAction inside step.run
        SE->>SE: dispatch tool / llmCall / decision / …
        SE->>DB: insert steps row (+ llm_calls, run_trace_events)
        SE->>SSE: publish RunStreamEvent
        SE-->>FN: StepOutput
    end
    FN->>DB: write run log lines (NDJSON-ish per line)
    FN->>DB: insert outbound events row
    FN->>IG: step.sendEvent (idempotent emit)
    FN->>DB: update run status=ok + emitted_event_id
    SSE-->>C: live tail (backfill from log, then stream)
```

**Description.** `packages/runtime/src/register.ts` turns each `AgentSpec` in a
manifest into exactly one Inngest function:

| Property | Value |
| --- | --- |
| Function id | `${tenantSlug}.${agentName}` |
| Concurrency key | `event.data.subject` — one run per subject in flight |
| Retries | manifest `retries` (0–10), else 3 |
| Trigger | `${tenantSlug}/${eventName}`, or a transport adapter's external contract |
| Cancellation | `cancelOn` matching `${tenantSlug}/run.cancel` on the subject |

**Durability discipline** is the rule that makes this correct under replay.
Inngest replays handlers, so **every DB write must sit inside `step.run(...)`**
— that is what produces exactly one row per real execution. `step.sendEvent` is
the only idempotent emit; `inngest.send` inside a step body would duplicate on
replay. Human-in-the-loop follows the same shape: create the `tasks` row inside
`step.run`, then `step.waitForEvent("task.resolved", { if: 'async.data.taskId
== "…"' })`.

Two known operational edges, both documented in the code: Inngest **dev mode is
not crash-safe** (a `tsx watch` reload can drop an in-flight handler — re-fire
under a fresh subject), and `pnpm --filter @agentic/api run dev` alone does
**not** start Inngest, so `inngest.send` fails with `fetch failed`.

Three observability sinks are fed from the same execution records — SQLite rows,
the per-run NDJSON log, and the in-process broadcast channel
(`runtime/src/broadcast.ts`, keyed per `tenantId`) that `GET /v1/stream` and
`GET /v1/runs/:runId/logs?follow=1` turn into SSE. Subscribers that join mid-run
backfill from the persisted log, then stream. The UI keeps no second dataset.

---

## 5. Step engine and the tool trust boundary

How one manifest action becomes a real side effect.

```mermaid
flowchart TB
    ACT["Manifest action<br/>{ name, type, … }"]

    ACT --> SW{"action.type"}
    SW -->|tool| T1["Direct tool dispatch"]
    SW -->|logic| T2["LLM tool-use loop<br/>via routing gateway"]
    SW -->|decision| T3["Decision table<br/>first-match, deterministic"]
    SW -->|condition| T4["Guarded branch"]
    SW -->|foreach| T5["Collection fan-out"]
    SW -->|invoke| T6["Sub-agent step.invoke"]
    SW -->|subflow| T7["Nested workflow"]
    SW -->|manual| T8["HITL task + waitForEvent"]
    SW -->|emit| T9["Explicit downstream intent"]
    SW -->|delay| T10["Durable sleep"]

    T1 --> RES
    T2 --> RES

    subgraph RES["Tool resolution — first match wins"]
        direction LR
        R1["1 · tenantRegistry.tools<br/>tenant override"] --> R2["2 · globalToolRegistry.get(name)<br/>global core"] --> R3["3 · MCP tools<br/>server.tool"]
    end

    RES --> GATE

    subgraph GATE["Pre-dispatch gates — fail closed"]
        direction TB
        G1["tool_use[] allow-list<br/>the trust boundary"]
        G2["Execution policy + declared side effects"]
        G3["Credential resolution<br/>config → Integrations → env"]
        G4["Sandbox interception<br/>-sb tenants: reads live, writes stubbed"]
        G1 --> G2 --> G3 --> G4
    end

    GATE --> RUN["handler(ctx)"]
    RUN --> OUT["ctx.lastResult forwarded server-side<br/>steps row + tool-call audit record<br/>throw → tool_result is_error → model self-corrects"]
```

**Description.** `packages/runtime/src/step-engine.ts` implements ten action
types (`StepTypeEnum` in `manifest.ts`). Both the LLM tool-use loop and a direct
`type:"tool"` action resolve through the same three-tier lookup, so a tenant can
shadow a global tool while everyone else gets the default.

**Registration is not authorization.** A tool is callable only if the agent's
`tool_use[]` names it — that array is the trust boundary. A `tool_use[].config`
object is lifted into `ctx.config` on every handler call, which is how one
global tool serves many tenants with different credentials and paths:

```json
"tool_use": [
  { "name": "gohireParseResumeApi", "config": { "api_key_env": "TENANT_X_GH_KEY" } },
  { "name": "fs.readFromInbox",     "config": { "subdir": "resumes" } }
]
```

Tools are authored with `defineTool({ name, description, output?, handler })`
from `@agentic/agent-kit` — a plain descriptor, no DI, no decorators. Handlers
read LLM-supplied args from `ctx.event.data` (the runtime overrides `event` with
the tool-call input, so there is a single read site whether the LLM or a
manifest action invoked it). `ctx.lastResult` carries the previous tool's output
forward **server-side** — that is how a multi-KB base64 PDF passes from
`fs.readFromInbox` to a parser without the model re-quoting and corrupting it.

The catalog holds **35 registered tools across 18 categories**: `browser` (7,
Playwright-backed session/navigate/read/click/fill/screenshot/close), `gohire`
(5, the canonical ATS family), `fs` (4), `ontology` (3), `postgres` and
`records` (2 each), and one each of `http`, `comms`, `crypto`, `document`,
`search`, `viz`, `report`, `object-store`, `metaerp`, `robohire`, `config`, and
`meta`. A further **25 back-compat aliases** let older manifests keep working —
`fs.writeHtmlToArchive` still answers to `writeReportToDisk` and
`writeBriefToDisk`. One rule bounds aliasing: **never alias a real business
operation to a diagnostic probe**, because a missing integration must fail
closed rather than resolve to a ping.

`GET /v1/tools` serves this catalog and the portal's **Agentic Tools** page
renders it as API docs with copy-paste manifest snippets. Two directories under
`packages/tools/src` are infrastructure rather than tools: `integrations/` is
the DI seam through which `apps/api` injects the DB-backed credential resolver
(so `@agentic/tools` never imports the database layer), and `declarative/` holds
the declarative tool-spec machinery.

**CodeAct** is the fourth execution shape: generated `defineAgent` handlers run
in one of three isolation kernels — `worker_thread`, `isolated_subprocess`, or
`isolated_container` — with every stateful capability (reason, tool, memory,
invoke, spawn) crossing an explicit RPC bridge back to the host. Production
execution is denied without an opt-in flag **and** an exact SHA-256 attestation
of the code bytes (`runtime/src/codeact.ts`, `codeact-receipt.ts`).

---

## 6. LLM gateway and the usage ledger

Per-tenant model routing with mandatory attribution.

```mermaid
flowchart TB
    subgraph consumers["Consumers — injected once at boot"]
        C1["BaseAgent<br/>setAgentGateway"]
        C2["Step engine logic / llmCall<br/>setRuntimeGateway"]
        C3["Agent Factory + OntoCode<br/>factory model adapter"]
        C4["Sandbox model proxy<br/>grant-scoped"]
    end

    HOST["services/llm.ts — tenant-routing gateway host<br/>one concrete gateway per tenant credential scope"]

    C1 --> HOST
    C2 --> HOST
    C3 --> HOST
    C4 --> HOST

    subgraph creds["Credential + policy resolution"]
        K1["Settings → encrypted key vault<br/>AES-256-GCM, AGENTIC_KEY_VAULT_SECRET"]
        K2["Env fallback"]
        K3["Workspace AI policy<br/>data/llm-settings.json"]
    end

    HOST --> creds
    HOST --> ADP

    subgraph ADP["6 adapter shapes → 14 provider modules"]
        A1["anthropic"]
        A2["openai-responses"]
        A3["openai-compatible<br/>openrouter · groq · mistral · together<br/>deepseek · moonshot · zai · qwen · custom"]
        A4["gemini"]
        A5["azure"]
        A6["mock — test-only, never advertised"]
    end
    NR["bedrock · vertex — catalogued but NON_RUNTIME<br/>no provider module; never offered by the model picker"]

    ADP --> ACC

    subgraph ACC["Accounting — every call, no exceptions"]
        U1["llm_calls ledger row"]
        U2["Budget reservation + tenant_budgets"]
        U3["usage_events + pricing"]
    end

    ACC --> EXP["GET /v1/usage · GET /v1/observability<br/>tokens by model / provider / agent / run"]
```

**Description.** Adapters capture credentials at construction, so
`apps/api/src/services/llm.ts` keeps **one concrete gateway per tenant
credential scope** and exposes a single stable routing gateway injected into
both consumers at boot (`bootstrap.ts`).

Every provider call is attributed and accounted.
`LLM_REQUIRE_USAGE_ATTRIBUTION=true` rejects an unattributable call outright,
and `runtime/src/usage-attribution-envelope.ts` threads attribution through the
event envelope so a cost can always be traced back to a tenant, agent, and run.

Two naming traps worth knowing when querying: migration
`0055_rename_llm_call_telemetry` renamed the old factory telemetry table
`llm_calls` → `llm_call_telemetry`, and the **usage ledger now owns the
`llm_calls` name**. They are different tables.

The provider catalog in `@agentic/contracts/providers` lists **16** ids, but
`NON_RUNTIME_PROVIDERS` in `apps/api/src/routes/v1/llm.ts` excludes three —
`mock`, `bedrock`, and `vertex` — leaving **13 runtime-selectable providers**.
`bedrock` and `vertex` have catalog metadata but no gateway provider module, and
the model picker never offers them; this is the README's "incomplete adapters
are not advertised by a non-test API" made concrete. The `mock` adapter exists
for tests and explicit sandbox verification only, and `/health` reports
`llmGateway.mock` so a stack cannot masquerade as real.

---

## 7. Authoring planes and the promotion pipeline

Four ways an agent comes into existence, converging on one gated release path.

```mermaid
flowchart TB
    subgraph author["Authoring surfaces"]
        P1["Hand-authored manifest<br/>models/‹slug›-v‹n›/workflow*.json"]
        P2["Workflow authoring API<br/>draft → validate → publish"]
        P3["Agent Studio<br/>AgentDefinitionV2 per agent"]
        P4["Agent Factory / OntoCode<br/>ontology-grounded generation"]
    end

    subgraph factory["Agent Factory — 6-stage conductor"]
        direction LR
        S1["read"] --> S2["plan"] --> S3["design"] --> S4["validate"] --> S5["sandbox"] --> S6["deliver"]
    end

    P4 --> factory

    factory --> DRAFT["agent_drafts + agent_draft_revisions<br/>generated TypeScript + manifest"]
    P1 --> DRAFT
    P2 --> DRAFT
    P3 --> DRAFT

    DRAFT --> SBX

    subgraph SBX["Isolated sandbox — the evidence gate"]
        direction TB
        B1["Dedicated -sb tenant<br/>own Inngest app, broker, event + signing keys"]
        B2["Reads run live · external writes stubbed or cassette-replayed"]
        B3["Function tests + regression suite"]
        B4["Signed execution-plane attestation"]
        B1 --> B2 --> B3 --> B4
    end

    SBX --> GATES

    subgraph GATES["promoteDrafts — ~20 fail-closed gates"]
        direction TB
        G1["Signed isolated-runner receipt<br/>same_host_container ⇒ development_only ⇒ REFUSED"]
        G2["Human HMAC review receipt<br/>interactive humans only"]
        G3["No-mock provider proof"]
        G4["Whole-version promotion, not cherry-pick"]
        G5["Production integration probes"]
        G6["Tool + permission resolution"]
    end

    GATES -->|all pass| REL["deployments row + workflow_versions<br/>Inngest re-register, no restart<br/>rollback point recorded"]
    GATES -->|any fail| REJ["Explicit refusal + failure receipt<br/>no partial release"]
```

**Description.** All four surfaces converge on the same draft → sandbox →
promotion path. Nothing reaches a production tenant without passing every gate.

**Agent Factory** (`packages/agent-factory` — 115 modules against 142 test
files) is a conductor-driven
generation pipeline whose 6 stages drive the live canvas rail. Its notable
property is that the **stage filter derives the visible tool roster** — a tool
that cannot legally run at the current stage is not offered at all, rather than
being offered and refused after the model has already paid for it
(`conductor.ts:stageVisibleTools`).

**The sandbox is the hard boundary, and it is honest about it.** A local
`same_host_container` runner is permanently `development_only`, and `promote.ts`
refuses `allowDiagnosticSameHost`. Promotion therefore requires a genuinely
isolated runner with a signed attestation — the external Docker execution plane
in `deploy/factory-sandbox/`. This is by design: a sandbox that could vouch for
itself would vouch for nothing.

The other gates are governance, not obstacles: an HMAC review receipt only an
interactive human can sign, a no-mock proof, whole-version promotion (never
cherry-picked agents), live production integration probes, and full tool and
permission resolution.

Release is hot. `services/inngest-registry.ts` swaps the served function set for
one app in place, and `deployment-rollback.ts` keeps the prior version
recoverable.

---

## 8. OntoCode session and harness jobs

The ontology-driven authoring plane: a durable, resumable, human-gated session.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> intake
    intake --> scope: analyze_scope
    scope --> configure: gaps found
    configure --> blueprint: connections resolved
    scope --> blueprint: no gaps
    blueprint --> build
    build --> verify
    verify --> debug: failures
    debug --> build
    verify --> review: green
    review --> release: human signs
    release --> observe
    observe --> completed
    completed --> [*]

    build --> configure: waiting_user
    review --> debug: rejected
```

```mermaid
flowchart LR
    subgraph jobs["11 harness job kinds — ontocode_harness_jobs"]
        direction TB
        J1["ontology_analysis<br/>read-only comprehension"]
        J2["scope"]
        J3["blueprint"]
        J4["build"]
        J5["simulation"]
        J6["test"]
        J7["debug"]
        J8["regression"]
        J9["promotion 🔒"]
        J10["deploy 🔒"]
        J11["production_analysis"]
    end

    W["ontocode-harness-worker<br/>lease → run → receipt"]
    ST["queued → leased → running →<br/>waiting_user | retry_scheduled |<br/>failed_recoverable | failed_terminal |<br/>cancelled | succeeded"]

    jobs --> W --> ST
    W --> EV["Evidence records · change sets · artifacts<br/>content-addressed blobs + versions"]
```

**Description.** OntoCode compiles a business **Ontology** — Actions, Events,
DataObjects, Rules — into deployable agents, and it persists as a first-class
durable object: `ontocode_projects` → `ontocode_sessions` → jobs, commands,
change sets, artifacts, evidence records, and a purge trail, across 20+ tables.

A single worker (`services/ontocode-harness-worker.ts`) leases jobs and runs
them. `promotion` and `deploy` are marked `PRODUCTION_JOB_KINDS` and carry the
full gate set from §7. `waiting_user` is a first-class terminal-ish state, not
an error — the session parks and resumes when a human answers.

The **Ontology Analyst** job kind exists because of a concrete root-cause
finding recorded in `docs/ontocode-status-2026-07-28.md`: `read_ontology` was
handing the model `links: <count>` — a single integer — after loading the
compiled relationship graph into memory and discarding it. On a live domain that
graph is 580 evidence-bearing edges across 13 relationship types. The model had
simply never seen it. The fix is guarded by tests that enforce honesty: **every
ontology id the model cites is looked up, and an id that does not exist is
downgraded to "unverified."** Substrate reporting is tri-state, distinguishing
"could not look" (`not_configured`, `unsupported_by_source`) from "looked and
found nothing" (`empty`) — which is why the Analyst reports Neo4j as
`not_configured` rather than silently returning zero rows from a predicate
mismatch.

A separate, deliberately **non-runtime** boundary handles immutable third-party
ontology packages: `packages/ontology-compiler/src/package-admission.ts` and
`scripts/ontology-package-inspect.mjs` validate an envelope plus its family
schemas, verify family/package hashes and workflow/subflow pins against three
exact trust pins, and emit an explicitly **non-deployable** shadow receipt. It
refuses aliased outputs and runtime `models/` roots, and never imports a
manifest or registers a workflow.

---

## 9. Storage and the system of record

Where each kind of state lives, and why it lives there.

```mermaid
flowchart TB
    subgraph sqlite["SQLite WAL — data/agentic.db · 88 tables · 80 migrations"]
        direction TB
        ID["<b>Identity</b><br/>tenants · users · memberships<br/>api_tokens · audit_log"]
        DEF["<b>Definitions</b><br/>workflows · workflow_versions · deployments<br/>agents · agent_versions · agent_drafts(+revisions)<br/>event_types · entity_types · runtime_profiles"]
        EXE["<b>Execution</b><br/>runs · steps · llm_turns · run_summaries<br/>run_messages · run_trace_events · run_emitted_events<br/>agent_executions · agent_run_sessions · tasks · artifacts"]
        MET["<b>Metering</b><br/>llm_calls (ledger) · usage_events<br/>tenant_budgets · llm_budget_reservations<br/>llm_call_telemetry (factory) · tool_stats"]
        FAC["<b>Factory</b><br/>factory_runs · factory_skills · factory_tools(+revisions)<br/>factory_sandbox_attempts · _model_grants · _tool_snapshots<br/>factory_integration_profiles · factory_codeact_authorizations"]
        ONT["<b>OntoCode</b><br/>projects · sessions · build_executions · commands<br/>harness_jobs · change_sets(+operations) · artifacts(+blobs,+versions)<br/>evidence_records · package_versions · candidate_heads · assistant_runs"]
        INF["<b>Infra</b><br/>integrations · webhook_subscriptions<br/>idempotency_keys · operation_leases<br/>agent_memory_short · agent_memory_long · event_store"]
    end

    subgraph fs["Filesystem — everything under data/ is gitignored"]
        F1["data/logs/‹tenant›/runs/‹date›/‹run-id›.log<br/>append-only, one JSON object per line"]
        F2["data/logs/‹tenant›/events/‹date›.ndjson<br/>event ledger"]
        F3["data/artifacts/…<br/>AGENTIC_ARTIFACTS_DIR"]
        F4["data/‹subdir›/‹tenant›/…<br/>fs.* tool root"]
        F5["data/llm-settings.json<br/>non-secret AI policy"]
    end

    subgraph git["Checked in"]
        G1["models/‹slug›-v‹n›/*.json<br/>workflow + ontology manifests"]
        G2["packages/db/drizzle/*.sql + meta/_journal.json"]
    end
```

**Description.** SQLite in WAL mode is the system of record. **Every
user-visible table carries `tenant_id`**, and the predicate must be built with
`tenantScope(ctx, table)` from `@agentic/db` — a raw `getDb()` query leaks
across tenants. IDs are prefixed strings from `makeId(prefix)` (`run-…`,
`evt-…`, `agt-…`, `tsk-…`); timestamps are unix-ms.

Run logs are deliberately **not** in the database: append-only per-run files
make the SSE tail cheap and let a run's history survive independently of row
retention. The same records feed SQLite, the log files, SSE, and the
observability APIs — there is exactly one dataset.

Migrations are **hand-authored** in this repo (`db:generate` hangs on an
incomplete snapshot chain), which makes `meta/_journal.json` load-bearing: it
once silently dropped 11 of 17 entries and had to be rebuilt. Treat it as code.

The `fs.*` data root resolves `AGENTIC_DATA_ROOT` → `pnpm-workspace.yaml`
walk-up → `<cwd>/data`. `AGENTIC_DATA_ROOT` is deliberately **unpinned** and the
walk-up is the live mechanism: a root-`.env` pin of `./data` would win env-file
layering and resolve against the API's cwd to `apps/api/data/` — the exact
stranding bug the pin was meant to prevent. Artifacts are pinned instead, via an
identical cwd-relative `AGENTIC_ARTIFACTS_DIR=../../data/artifacts` in both env
files.

Two destructive maintenance paths exist and are scoped: `db:wipe-runtime`
truncates runtime traffic (runs, steps, events, tasks, audit, artifacts) while
preserving identity and configuration; `db:prune-deployments` GCs superseded
deployment rows and their import tmp dirs.

---

## 10. Security and trust boundaries

```mermaid
flowchart TB
    REQ["Inbound request"]

    REQ --> L1

    subgraph L1["1 · Authentication — plugins/auth.ts"]
        direction TB
        A1["AUTH_MODE=production (default)<br/>HS256 session cookie or bearer API token"]
        A2["AUTH_MODE=dev — sandbox only<br/>requires AGENTIC_DEV_TENANT · resolves a REAL active user<br/>no hard-coded fallback · REJECTED when NODE_ENV=production"]
    end

    L1 --> L2

    subgraph L2["2 · Tenant + role authorization"]
        direction TB
        B1["x-agentic-tenant header selects an active tenant"]
        B2["Server re-derives membership + role every request"]
        B3["tenantScope(ctx, table) on every query"]
        B4["plugins/rbac.ts · plugins/audit.ts"]
    end

    L2 --> L3

    subgraph L3["3 · Secrets"]
        direction TB
        C1["AES-256-GCM envelope, per-secret salt+IV<br/>AGENTIC_KEY_VAULT_SECRET required in production"]
        C2["Integrations stored encrypted per tenant"]
        C3["Startup errors + telemetry redacted<br/>Bearer · api_key · sk-* · URL userinfo"]
    end

    L3 --> L4

    subgraph L4["4 · Egress"]
        direction TB
        D1["ssrf-guard + gateway-network-safety"]
        D2["egress-guard (factory)"]
        D3["Webhook HMAC required"]
        D4["Write tools must declare side effects<br/>and pass policy + credential gates"]
    end

    L4 --> L5

    subgraph L5["5 · Execution isolation"]
        direction TB
        E1["CodeAct: worker_thread | subprocess | container<br/>SHA-256 attestation required in production"]
        E2["Sandbox tenants: separate Inngest app,<br/>broker, event key, signing key, namespace"]
        E3["Codex: pinned 0.150.1, private CODEX_HOME,<br/>no inherited provider credentials"]
        E4["Promotion: signed isolated-runner receipt<br/>+ human HMAC review"]
    end
```

**Description.** Five layers, each fail-closed.

The **`AUTH_MODE=dev` footgun** is explicitly defused: it requires
`AGENTIC_DEV_TENANT`, resolves a real active database user (there is no
hard-coded user or tenant fallback), and the process refuses to start with
`NODE_ENV=production` — because in that combination every unauthenticated
request would become an authenticated one.

Tenant identity **always** comes from the authenticated principal. The
`x-agentic-tenant` header only selects among tenants the server independently
confirms the principal belongs to.

`pnpm db:seed` provisions tenant rows and exactly one bootstrap superadmin from
three mandatory env vars (`AGENTIC_BOOTSTRAP_ADMIN_EMAIL`, `_NAME`,
`_PASSWORD`). **The repository ships no default account and no sample
identities.** Further users are created through the authenticated Access
surface.

The runtime contract in the README is enforced, not aspirational: real provider
for every run, no demo mode, external systems reached only through configured
tools or MCP servers, missing credentials surfaced as an explicit gap, and
deterministic adapters/fixtures/replay stubs confined to tests and explicit
sandbox verification.

---

## Verification commands

```bash
curl --fail http://localhost:3540/health   # ok:true and llmGateway.mock:false
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm codex:protocol:check && pnpm verify:codex-harness
pnpm --filter @agentic/api verify:observability
```

`verify:observability` is an isolated canary labelled as a test run. It uses the
configured real default provider (refusing mock), then verifies persistence, run
logs, SSE replay, `llm_calls`, token accounting, and agent-call aggregation —
without claiming that any external business action occurred.

---

## Reading the code from here

| Question | Start here |
| --- | --- |
| How does an event become a run? | `packages/runtime/src/register.ts` |
| How is one action executed? | `packages/runtime/src/step-engine.ts` |
| How do I add a tool? | `packages/tools/src/registry.ts` (`REGISTRATIONS`) |
| How is a tenant wired? | `apps/api/src/bootstrap.ts` (`TENANT_REGISTRIES`) |
| What is the API surface? | `apps/api/src/server.ts` → `routes/v1/*` |
| What is the data model? | `packages/db/src/schema.ts` |
| What crosses web↔api? | `packages/contracts/src/*` |
| How is an agent generated? | `packages/agent-factory/src/conductor.ts` |
| How is a release gated? | `apps/api/src/services/agent-factory/promote.ts` |
