# Product Requirements Document — Agentic Operator

> **Status:** Draft for handoff
> **Version:** 0.1
> **Last updated:** 2026-05-16
> **Owner:** Platform team

---

## 1 · Summary

**Agentic Operator** is an event-driven runtime + admin portal that runs AI
agents organized into workflows. It is the "operating system" for
applications-built-out-of-agents.

The first application to ship on top of Agentic Operator is **RAAS**
(Recruitment-as-a-Service) — 22 agents and 33 event types covering the full
pipeline from client-requirement intake to candidate submission.

This PRD describes the **Agentic Operator** platform itself, not RAAS.
RAAS is treated as the proof workload and the reference implementation of
"a workflow."

---

## 2 · Problem

Teams building agentic products today hand-roll the same infrastructure
over and over:

- **Event plumbing** — wiring agent A's output to agent B's input
- **Durable retries** — handling LLM rate limits, tool timeouts, partial
  failures without losing work
- **Human-in-the-loop** — pausing a run while a human reviews/approves
- **Observability** — knowing which runs are stuck, what each agent is
  doing right now, where errors are concentrated
- **Deployment** — versioning and rolling back agent logic in production
- **Multi-tenancy** — isolating customer data and runs

Without a platform, every team writes its own bespoke ops console and its
own bespoke event bus, and the result is brittle, opaque, and impossible
to debug at 3am.

**Agentic Operator** is the shared platform. Build your application's
agents and workflows; we run them.

---

## 3 · Goals & Non-goals

### Goals (v1)

1. Run event-driven, multi-step, multi-agent workflows reliably at scale
2. Provide a control plane (admin portal) where operators can monitor,
   inspect, intervene, deploy, and roll back
3. Make human-in-the-loop a first-class primitive
4. Support three modes of agent deployment (manifest, code, visual)
5. Be multi-tenant from day one
6. Keep ops lightweight: SQLite + files, no Postgres/Kafka required to
   start

### Non-goals (v1)

- Be a model provider (we orchestrate; we don't host inference)
- Be a vector store (agents BYO retrieval)
- Provide chat UI for end users (we power applications; we are not one)
- Multi-region active/active (single-region is fine for v1)
- Replace Inngest's own dashboard (we layer above; Inngest stays the
  durable engine)

---

## 4 · Users & jobs-to-be-done

### Persona 1 — **Workflow Author**
Builds the agent graph for a tenant. Defines the manifest, writes the tools,
ships new versions.
- **JTBD-1.1:** "When I have a new agent, deploy it without redeploying the
  whole platform."
- **JTBD-1.2:** "When a run failed, replay it with my fix without
  re-triggering all upstream agents."
- **JTBD-1.3:** "When I add a new event type, see exactly which agents
  listen for it."

### Persona 2 — **Operator** (delivery manager, ops engineer)
Watches the system, intervenes when needed, approves human tasks.
- **JTBD-2.1:** "When a run is stuck, find it within 10 seconds and see
  why."
- **JTBD-2.2:** "When the inbox has 30 tasks, prioritize and clear them
  efficiently."
- **JTBD-2.3:** "When a downstream channel breaks, see the impact and
  pause affected workflows."

### Persona 3 — **Platform Admin**
Manages tenants, credentials, quotas, RBAC.
- **JTBD-3.1:** "When onboarding a new application, isolate its data,
  events, and logs from existing tenants."
- **JTBD-3.2:** "When auditing, see who deployed what when."

### Persona 4 — **End Application User** (e.g., HSM in RAAS)
Doesn't use Agentic Operator directly — but their actions in the
application produce events that flow through it. They see human tasks
surfaced in their own app's UI (which is powered by the same task
records).

---

## 5 · Scope — v1 feature list

### 5.1 Runtime
- [ ] Event ingestion API (`POST /api/events`)
- [ ] Inngest-backed step functions per agent
- [ ] Manifest loader: turns RAAS-format JSON into Inngest function
      registrations
- [ ] Step types: `tool`, `logic`, `manual` (manual pauses the run)
- [ ] Per-run correlation IDs propagated across all logs/events
- [ ] Retry policy per agent (max attempts, backoff)
- [ ] Concurrency keys per agent (e.g. one run per `candidate_id`)
- [ ] Timeout per step

### 5.2 Storage
- [ ] SQLite (better-sqlite3) for metadata: agents, versions, runs,
      events index, tasks, tenants, users, deployments, audit
- [ ] File-backed logs: `logs/runs/<YYYY-MM-DD>/<run-id>.log`
- [ ] File-backed event ledger: `logs/events/<YYYY-MM-DD>.ndjson`
- [ ] Artifacts directory: `artifacts/<tenant>/<run>/<artifact-id>`
- [ ] Log rotation (daily), compression for >7d files

### 5.3 Portal (matches prototype `index.html`)
- [ ] **Dashboard** — live KPIs, active runs, agent activity grid, event
      ticker, pending tasks, runtime health, stage funnel
- [ ] **Workflows** — DAG canvas with agents as nodes, events as edges;
      click node / event to highlight + inspect
- [ ] **Agents** — grid + detail (config, schema, versions, runs tabs)
- [ ] **Runs** — list (filter by status/agent/subject/text) + detail
      (timeline, logs, IO, events)
- [ ] **Events** — filterable stream + per-event detail (source,
      listeners, payload, replay)
- [ ] **Tasks** — human-in-the-loop inbox with type-specific surfaces:
      JD review, package approval, resume fix, clarification, supplement,
      manual publish
- [ ] **Logs** — file-tree explorer with grep + level filter + live tail
- [ ] **Deployments** — live versions card, history table with diff +
      rollback, new-deploy wizard for all three modes
- [ ] Multi-tenant switcher (sidebar)
- [ ] Live/paused stream toggle (top bar)
- [ ] Theme: dark default, light optional; density toggle

### 5.4 Agent Deployment
- [ ] **Mode 1 — Manifest upload**: file picker accepts
      `workflow_v1.json` + `actions_v1.json`, parses, diffs against live,
      previews changes, deploys
- [ ] **Mode 2 — Code package**: `npx agentic deploy <tenant>
      --version <v>` reads `agents/*.ts`, bundles, uploads, registers
- [ ] **Mode 3 — Visual builder**: canvas with palette of agents, drag
      to add, connect with events; "Save as manifest" → mode 1 flow
- [ ] Every deploy creates `AgentVersion` rows (immutable) + a
      `Deployment` (pointer); rollback flips the pointer

### 5.5 APIs
- [ ] `POST /api/events` — ingest external events (auth: tenant token)
- [ ] `GET /api/agents`, `POST /api/agents`, `GET /api/agents/:id`,
      `PATCH /api/agents/:id`
- [ ] `GET /api/runs?status=&agent=&q=`, `GET /api/runs/:id`,
      `GET /api/runs/:id/logs`, `POST /api/runs/:id/replay`
- [ ] `GET /api/events?type=&from=&to=`, `POST /api/events/:id/replay`
- [ ] `GET /api/tasks`, `POST /api/tasks/:id/resolve`
- [ ] `GET /api/artifacts/:id`
- [ ] `POST /api/webhooks/:provider` — partner callbacks
- [ ] `/api/inngest` — Inngest's own webhook

### 5.6 CLI
- [ ] `agentic init` — scaffold a workflow package
- [ ] `agentic deploy <tenant>` — bundle and push
- [ ] `agentic logs <run-id> --follow` — tail
- [ ] `agentic events tail` — live event stream
- [ ] `agentic events replay <event-id>` — replay one event

### 5.7 Auth / RBAC
- [ ] Email-based sign-in (magic link)
- [ ] Roles per tenant: `admin`, `operator`, `viewer`
- [ ] API tokens (per tenant) for event ingestion + CLI
- [ ] Audit log of every deploy, rollback, task resolution

---

## 6 · Out of scope (future)

- Sandboxed code execution for tools (agents call out to first-party tools
  only in v1)
- Marketplace of community agents
- Cross-tenant workflow sharing
- A/B testing of agent versions
- Cost attribution per agent / per tenant beyond raw token counts
- SOC 2 / ISO 27001 (planned for v2)

---

## 7 · Success metrics

| Metric | Target | How measured |
|---|---|---|
| Time-to-first-event for a new tenant | < 30 min | From signup to first event running through a real agent |
| Run failure rate (excluding human rejects) | < 1.5% | Failed runs / total runs over 7 days |
| Median run latency overhead vs. raw agent | < 200ms | Per-run runtime overhead (Inngest + portal + logging) |
| Operator p50 time-to-diagnose a stuck run | < 60s | Time from opening Dashboard to landing on the failing step |
| Agent deploys per workflow per week | ≥ 3 | Adoption proxy; teams should iterate freely |
| Mean human-task age | < 1 hour | Tasks should clear quickly |

---

## 8 · Constraints & assumptions

- **Single region**, single Inngest worker pool in v1 (multi-region is v2).
- **SQLite is enough** for at least the first ~5 tenants at ~10K runs/day.
  Migration path to Postgres is documented but not pre-built.
- **Inngest cloud or self-hosted**: both work; the runtime is agnostic.
- **Agents are owned by tenants**, not the platform: each tenant deploys
  its own version of every agent.
- **The RAAS manifest format is the canonical schema.** Any extensions
  (e.g., for newer agent capabilities) are backward-compatible additions.

---

## 9 · Open questions for engineering

1. Do we sandbox tool calls in v1, or trust the manifest? (Recommendation:
   trust in v1; sandbox is v2.)
2. Where do credentials live — env-only, or encrypted in SQLite via libsodium?
3. Do we ship a hosted version, or self-host only?
4. What's the upgrade path when the manifest schema grows? Embedded
   `schema_version` field + migrations.
5. Webhooks vs. polling for external integrations (RMS, ATS, channels) —
   probably both; clients choose per integration.

---

## 10 · Glossary

| Term | Meaning |
|---|---|
| **Agent** | A node in a workflow. Either an automated step function (Inngest function) or a human node (gated by a task). |
| **Event** | A typed message that flows between agents. Has a name (e.g. `JD_APPROVED`), payload, source, subject. |
| **Workflow** | A versioned graph of agents wired by events. Identified by `tenant + workflow_id + version`. |
| **Run** | One execution of one agent in response to one event. Has steps, logs, an outcome event. |
| **Step** | One sub-unit of work inside a run. Types: `tool`, `logic`, `manual`. |
| **Task** | A pending human action that pauses a run. Lives in the inbox until resolved. |
| **Deployment** | A pointer to an `AgentVersion` (or `WorkflowVersion`) marked as `live` for a tenant. |
| **Tenant** | An isolated customer of Agentic Operator (e.g., RAAS, SupportFlow, FinanceClose). |
| **Tool** | A typed capability exposed to an agent (e.g. `http.fetch`, `pdf.compose`, `ats.adapter`). |
