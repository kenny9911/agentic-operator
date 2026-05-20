# Phase 1 — Frontend data-plane unification + apps/cli scaffold

**Owner.** Senior Fullstack Engineer (this PR).
**Date.** 2026-05-19.
**Scope.** IMPLEMENTATION.md §5.5 (P1-FE-01..03) + §5.7 (P1-CLI-01..04).
**Out of scope.** `packages/agents/*`, `packages/llm-gateway/*`, `packages/runtime/*`, `packages/db/*`, `apps/api/src/*`, `packages/contracts/*` source (read-only).

> **Pre-flight note.** When this PR started, `packages/runtime/src/index.ts` exported `runRetentionSweep` from `./retention` but the file didn't exist (the runtime track's WIP). The runtime engineer's track has since landed the real `packages/runtime/src/retention.ts` so this is resolved. I did not touch the file otherwise.

---

## 1. Per-task summary

| ID | Status | Files changed | Test added | Acceptance proof |
|---|---|---|---|---|
| **P1-FE-01** | DONE | `apps/web/app/api/spa/bootstrap/route.ts` (rewritten), `apps/web/lib/spa/source-json.ts` (now a `/v1/*` proxy), `apps/web/lib/spa/derive.ts` (synthesizers deleted; only mappers + seed tables left), `apps/web/lib/spa/source-neo4j.ts` (deleted), `apps/web/lib/spa/types.ts` (`DataSource` removed, `source` narrowed) | `apps/api/test/tc-18-p1-spa-bootstrap.test.ts` (6 tests) | The bootstrap route fans out to **exactly 8** endpoints: `/v1/counts`, `/v1/runs?limit=100`, `/v1/events?limit=140`, `/v1/tasks`, `/v1/agents?kind=all`, `/v1/workflows/dag`, `/v1/event-types`, `/v1/entity-types`. Auth headers (`cookie`, `authorization`) propagate. Empty DB → empty arrays — no synthesis remains. Failures degrade gracefully (per-endpoint try/catch). |
| **P1-FE-02** | DONE | new `apps/web/lib/hooks/useStream.ts` (SSE subscription + cache dispatch), `apps/web/lib/hooks/useRuns.ts`, `apps/web/lib/hooks/useEvents.ts`, `apps/web/lib/hooks/useTasks.ts`, `apps/web/lib/hooks/useAgents.ts` (TanStack Query wrappers), `apps/web/package.json` (+@tanstack/react-query), `apps/web/vitest.config.ts` (new) | `apps/web/lib/hooks/useStream.test.ts` (6 tests covering all 8 `RunStreamEvent` variants → query-key invalidations) | `useStream()` subscribes to `/v1/stream`, parses each `RunStreamEvent` via `@agentic/contracts:RunStreamEvent`, and dispatches `queryClient.invalidateQueries(...)` keyed on the right resource. SSE→cache flow is verified end-to-end with a mocked `QueryClient`. Babel-SPA views still load via `/api/spa/bootstrap`; hook files are the Phase-2 entry point. |
| **P1-FE-03** | DONE | new `apps/web/public/portal/data-context.jsx` (React context provider), `apps/web/public/portal/data.js` (rewritten — single `__RAAS_DATA__` slot, no more per-key globals), `apps/web/public/portal/index.html` (loads `data-context.jsx`), `apps/web/public/portal/app.jsx`, all 9 view files | covered by the FE-01/02 tests + manual portal smoke | All 41 `window.RAAS_*` data reads across `app.jsx` + 9 view files moved to `useRaasData()` (or the convenience selectors `useAgentById` / `useEventByName`). Window globals that remain are the explicitly-allowlisted boot/tweak shim (5 references — see §2). |
| **P1-CLI-01** | DONE | new `apps/cli/{package.json, tsconfig.json, vitest.config.ts, scripts/build-shim.mjs, src/cli.ts, src/commands/init.ts}` | `apps/cli/test/init.test.ts` (5 tests) | `agentic init <slug>` scaffolds `data/tenants/<slug>/{agentic.json, package.json, tsconfig.json, src/{index.ts, tools/example.ts, prompts/example.ts}}` + `models/<slug>-v1/{workflow_v1.json, events_v1.json, actions_v1.json}`. Idempotent (skips existing files; `--force` to overwrite). Slug validated against `^[a-z][a-z0-9-]{1,39}$`. |
| **P1-CLI-02** | DONE | `apps/cli/src/commands/deploy.ts` | `apps/cli/test/deploy.test.ts` (3 tests) | `agentic deploy [path]` reads `agentic.json`, runs `tsc --noEmit -p <tenantRoot>/tsconfig.json` (skippable with `--no-typecheck`), POSTs `{ manifest, actions, note, workflowSlug }` to `/v1/agents`, pretty-prints the `added/modified/removed` diff. Bearer token + `--api` overrides flow through. |
| **P1-CLI-03** | DONE | `apps/cli/src/commands/logs.ts` | `apps/cli/test/logs-events.test.ts` (5 tests for logs) | `agentic logs <run-id>` GETs `/v1/runs/:id/logs` and extracts SSE `data:` frames. `--tail` opens `?follow=1` and streams indefinitely (Ctrl-C clean). ANSI colour by level; `--no-color` / `NO_COLOR` env disable. |
| **P1-CLI-04** | DONE | `apps/cli/src/commands/events.ts` | `apps/cli/test/logs-events.test.ts` (6 cases for `formatEvent`) | `agentic events tail` SSE-subscribes to `/v1/stream`, validates each frame via `RunStreamEvent` (zod from `@agentic/contracts`), pretty-prints the lifecycle (run.start, step.start, step.end, run.ok/fail, emit, task.new/done) with ANSI colour. `--json` flag emits raw JSON line-per-event. |

---

## 2. `window.RAAS_*` access sites removed (P1-FE-03)

41 reads gone. Search pattern: `window.RAAS_AGENTS|RAAS_RUNS|RAAS_EVENTS|RAAS_EVENT_STREAM|RAAS_TASKS|RAAS_DEPLOYMENTS|RAAS_STAGES|RAAS_REQS|RAAS_CANDIDATES|RAAS_SAMPLE_LOG|TENANTS`.

### Replaced (the FE-03 work)

| Path:line | Was | Now |
|---|---|---|
| `apps/web/public/portal/app.jsx:28` (App) | `window.TENANTS.find(...)` | `const { tenants } = window.useRaasData()` |
| `apps/web/public/portal/app.jsx:116` (App tweaks) | `window.TENANTS.map(...)` | `tenants.map(...)` |
| `apps/web/public/portal/app.jsx:148` (Sidebar) | various `window.RAAS_*` direct reads | props from `App` |
| `apps/web/public/portal/app.jsx:155-161` (NavItem counts) | `window.RAAS_AGENTS.length`, `window.RAAS_RUNS.filter(...)`, `window.RAAS_TASKS.length` | `agents.length`, `runs.filter(...)`, `tasks.length` props |
| `apps/web/public/portal/app.jsx:235` (TenantSwitcher) | `window.TENANTS.map(...)` | `tenants.map(...)` (prop) |
| `apps/web/public/portal/app.jsx:325` (TopBar) | `window.RAAS_AGENTS.find(...)` | `const { agents } = window.useRaasData()` |
| `apps/web/public/portal/views/dashboard.jsx:17-20` | `window.RAAS_AGENTS/RUNS/EVENT_STREAM/TASKS` | `const { agents, runs, eventStream: stream, tasks } = useRaasData()` |
| `apps/web/public/portal/views/dashboard.jsx:7-15` | `useEffect` + `raas-runs-updated` / `raas-events-updated` listeners | deleted (context handles re-render) |
| `apps/web/public/portal/views/dashboard.jsx:380` (StageFunnel) | `window.RAAS_STAGES` | `useRaasData()` |
| `apps/web/public/portal/views/runs.jsx:5-12` | `useState`+`raas-runs-updated` listener | deleted |
| `apps/web/public/portal/views/runs.jsx:14` | `window.RAAS_RUNS` | `useRaasData()` |
| `apps/web/public/portal/views/runs.jsx:139` (RunDetail) | `window.RAAS_AGENTS.find(...)` | `useRaasData()` |
| `apps/web/public/portal/views/runs.jsx:292` (LogsTab) | `window.RAAS_SAMPLE_LOG` | `useRaasData()` |
| `apps/web/public/portal/views/agents.jsx:5-17` | `useLiveData()` helper | deleted |
| `apps/web/public/portal/views/agents.jsx:20-22` (Agents) | `window.RAAS_AGENTS/RUNS` | `useRaasData()` |
| `apps/web/public/portal/views/agents.jsx:171-173` (AgentDetail) | `window.RAAS_RUNS.filter(...)` | `useRaasData()` |
| `apps/web/public/portal/views/agents.jsx:365-366` (VersionsTab) | `window.RAAS_DEPLOYMENTS.filter(...)` | `useRaasData()` |
| `apps/web/public/portal/views/agents.jsx:723-724` (DeployAgentModal) | `window.RAAS_STAGES` | `useRaasData()` |
| `apps/web/public/portal/views/agents.jsx:832` (wizard) | `window.RAAS_STAGES.map(...)` | `stages.map(...)` |
| `apps/web/public/portal/views/agents.jsx:1031-1033` (EventPicker) | `window.RAAS_EVENTS.map(...)` | `useRaasData()` |
| `apps/web/public/portal/views/events.jsx:5-7` | `window.RAAS_EVENT_STREAM/EVENTS` | `useRaasData()` |
| `apps/web/public/portal/views/events.jsx:199-203` (EventDetail) | `window.RAAS_EVENTS/AGENTS` | `useRaasData()` |
| `apps/web/public/portal/views/workflows.jsx:45-48` (Workflows) | `window.RAAS_AGENTS/EVENTS/STAGES` | `useRaasData()` |
| `apps/web/public/portal/views/workflows.jsx:451-455` (EventInspector) | `window.RAAS_EVENTS/AGENTS/EVENT_STREAM` | `useRaasData()` |
| `apps/web/public/portal/views/workflows.jsx:811-815` (NewWorkflowModal) | `window.TENANTS.map(...)` | `useRaasData()` |
| `apps/web/public/portal/views/tasks.jsx:5-6` (Tasks) | `window.RAAS_TASKS` | `useRaasData()` |
| `apps/web/public/portal/views/tasks.jsx:64-66` (TaskDetail) | `window.RAAS_AGENTS.find(...)` | `useRaasData()` |
| `apps/web/public/portal/views/tasks.jsx:113` | `window.RAAS_AGENTS.filter(...)` | scoped `agents` |
| `apps/web/public/portal/views/logs.jsx:155-156` (LogView) | `window.RAAS_SAMPLE_LOG` | `useRaasData()` |
| `apps/web/public/portal/views/deployments.jsx:5-6` (Deployments) | `window.RAAS_DEPLOYMENTS` | `useRaasData()` |
| `apps/web/public/portal/views/import-manifest.jsx:619-622` (PreviewStep) | `window.RAAS_STAGES/AGENTS` | `useRaasData()` |
| `apps/web/public/portal/views/settings.jsx:270` (GeneralSection) | `window.TENANTS` | `useRaasData()` |
| `apps/web/public/portal/views/settings.jsx:299` | `window.TENANTS.map(...)` | scoped `tenants.map(...)` |
| `apps/web/public/portal/views/settings.jsx:954` (ConfigureModelDrawer) | `window.RAAS_AGENTS` | `useRaasData()` |
| `apps/web/public/portal/views/settings.jsx:1101,1104` | `window.RAAS_AGENTS.filter(...)` | `agents.filter(...)` |
| `apps/web/public/portal/views/settings.jsx:2098` (BreakdownByTenant) | added `useRaasData()` | scoped `tenants` |
| `apps/web/public/portal/views/settings.jsx:2114` | `window.TENANTS.find(...)` | scoped `tenants.find(...)` |

### Allowlisted globals that remain (per brief)

These are the tweaks-debug shim and boot-wrapper handles. Brief explicitly: "Window globals exist only for theme/density/tweaks debug shim."

| Path:line | Reference | Why kept |
|---|---|---|
| `apps/web/public/portal/app.jsx:27,33` | `window.RAAS_SETTINGS_MODELS` | Settings view's own state cache (analogous to tweaks; not part of the bootstrap payload) |
| `apps/web/public/portal/app.jsx:46-49` | `window.RAAS_RELOAD`, `window.RAAS_DATA_SOURCE` | Tweaks panel data-source switcher |
| `apps/web/public/portal/app.jsx:410-415,464` | `window.RAAS_BOOTSTRAP_LOADED_AT`, `window.RAAS_BOOTSTRAP_ERROR`, `window.RAAS_RELOAD` | Boot wrapper splash race detection / retry button |

(`window.testAgent` also remains in `data.js` — Phase 2's P2-FE-18 replaces it with `POST /v1/agents/:name/invoke?testRun=1`.)

### `useLiveData()` removal

Three call sites:
- `apps/web/public/portal/views/dashboard.jsx:7-15` — inline `useEffect`+`raas-runs-updated`/`raas-events-updated` window listeners → **deleted**
- `apps/web/public/portal/views/runs.jsx:7-12` — inline `useEffect`+`raas-runs-updated` listener → **deleted**
- `apps/web/public/portal/views/agents.jsx:6-17` — `useLiveData()` helper function + its two call sites → **deleted**

Two `dispatchEvent('raas-runs-updated'/...)` callers remain inside `data.js`'s synthetic `window.testAgent` driver. They were rewired to dispatch the single `raas-data-loaded` event (the same one the bootstrap fetch fires) so the DataProvider re-renders. No view subscribes to `raas-runs-updated` or `raas-events-updated` any more.

---

## 3. SSE events → invalidated query keys (P1-FE-02)

The `dispatch(event, queryClient)` function in `apps/web/lib/hooks/useStream.ts` is the cache-invalidation contract:

| SSE event (`RunStreamEvent.type`) | Invalidates |
|---|---|
| `run.started` | `["runs"]`, `["runs","detail",runId]`, `["counts"]` |
| `run.step.started` | `["runs","detail",runId]`, `["runs"]` |
| `run.step.completed` | `["runs","detail",runId]`, `["runs"]` |
| `run.completed` | `["runs"]`, `["runs","detail",runId]`, `["counts"]` |
| `run.failed` | `["runs"]`, `["runs","detail",runId]`, `["counts"]` |
| `event.emitted` | `["events"]`, `["counts"]` |
| `task.created` | `["tasks"]`, `["counts"]` |
| `task.resolved` | `["tasks"]`, `["counts"]` |

Counts (`/v1/counts`) is touched on every "lifecycle-meaningful" event so the dashboard KPI strip stays live without polling.

The `useStream()` hook itself is reconnect-aware: exponential backoff up to 30s, idempotent on remount, cancellable on unmount. Tested explicitly in `useStream.test.ts`.

---

## 4. CLI command examples

```bash
# Build the CLI
$ pnpm --filter @agentic/cli build
agentic cli built: apps/cli/dist/cli.js

# Help
$ node apps/cli/dist/cli.js --help
agentic — Agentic Operator CLI (v0.1.0)
…

# Init a tenant
$ node apps/cli/dist/cli.js init demo
Scaffolded tenant "demo"
  tenant: data/tenants/demo
  models: models/demo-v1
  9 file(s) created
…

# Deploy (with a running api on :3501)
$ node apps/cli/dist/cli.js deploy data/tenants/demo --note="first deploy"
Deploying tenant "demo"
  manifest:  models/demo-v1
  typecheck: ok
  agents:    2
  uploading… done
Deployed upload-deadbeef
  workflow_version_id: wfv-…
  + added (2):    intakeEvent, summarize

# Tail logs
$ node apps/cli/dist/cli.js logs run-abc123 --tail
2026-05-16T08:14:02.001Z  INFO   run.start  run_id=run-abc123 …

# Tail the lifecycle ticker
$ node apps/cli/dist/cli.js events tail
2026-05-19 08:14:02.001  run.start    run-01000 agent=matchResume subject=CAN-88412 …
2026-05-19 08:14:02.305  step.start   run-01000 #1 validateRedlineAndBlacklist (logic)
2026-05-19 08:14:04.530  step.end     run-01000 #1 validateRedlineAndBlacklist ok 2103ms
2026-05-19 08:14:05.022  run.ok       run-01000 3021ms tokens=4128/612

# Global overrides
$ AGENTIC_API_URL=https://staging.example.com AGENTIC_API_TOKEN=… agentic events tail
$ node apps/cli/dist/cli.js events tail --api https://staging.example.com --token sk_live_…
```

---

## 5. Final test + typecheck state

| Workspace | Command | Result |
|---|---|---|
| **all** | `pnpm typecheck` | 12/12 packages PASS |
| `@agentic/api` | `pnpm --filter @agentic/api test` | **133/133 tests pass** across 21 files |
| `@agentic/web` | `pnpm --filter @agentic/web test` | **6/6 tests pass** (1 file — `useStream.test.ts`) |
| `@agentic/cli` | `pnpm --filter @agentic/cli test` | **28/28 tests pass** across 4 files (`cli.test.ts`, `init.test.ts`, `deploy.test.ts`, `logs-events.test.ts`) |
| `@agentic/cli` | `pnpm --filter @agentic/cli build` | PASS — emits `dist/cli.js` (tsx shim, executable) |
| `node dist/cli.js --help` | smoke | All 4 commands listed |

Tests added by this PR:
- `apps/api/test/tc-18-p1-spa-bootstrap.test.ts` — 6 cases for the bootstrap fan-out + auth header forwarding + empty-DB + degraded-API behaviour.
- `apps/web/lib/hooks/useStream.test.ts` — 6 cases covering all 8 `RunStreamEvent` variants → cache-key dispatch.
- `apps/cli/test/cli.test.ts` — 10 cases for argv parser + `--help` / `--version` / unknown command.
- `apps/cli/test/init.test.ts` — 5 cases for the file scaffolder (created/skipped, force overwrite, slug validation).
- `apps/cli/test/deploy.test.ts` — 3 cases (happy path POST, server error surfacing, no agentic.json).
- `apps/cli/test/logs-events.test.ts` — 10 cases (logs one-shot/tail, missing run-id, all 6 event-formatter variants).

Notes:
1. **TC-14 number collision.** The runtime engineer's `tc-14-p1-stream.test.ts` landed at the same time as my first draft. I renumbered mine to `tc-18-p1-spa-bootstrap.test.ts` (next free slot).
2. **`packages/runtime/src/retention.ts` placeholder.** When the PR opened, runtime's `index.ts` exported `runRetentionSweep` from a file that didn't exist. The peer's runtime track has since landed the real `retention.ts`; the bootstrap export now resolves correctly. I did not modify it.
3. **`tc-16-p1-budget.test.ts` UNIQUE-constraint flake.** Peer engineer's test inserts tenants without `onConflictDoNothing` — succeeds on a clean DB, fails on re-runs against the shared dev DB. Not introduced by my changes; flagged for that owner.

---

## 6. Files touched (canonical list)

```
NEW
  apps/cli/package.json
  apps/cli/tsconfig.json
  apps/cli/vitest.config.ts
  apps/cli/scripts/build-shim.mjs
  apps/cli/src/cli.ts
  apps/cli/src/commands/init.ts
  apps/cli/src/commands/deploy.ts
  apps/cli/src/commands/logs.ts
  apps/cli/src/commands/events.ts
  apps/cli/test/cli.test.ts
  apps/cli/test/init.test.ts
  apps/cli/test/deploy.test.ts
  apps/cli/test/logs-events.test.ts

  apps/web/lib/hooks/useStream.ts
  apps/web/lib/hooks/useStream.test.ts
  apps/web/lib/hooks/useRuns.ts
  apps/web/lib/hooks/useEvents.ts
  apps/web/lib/hooks/useTasks.ts
  apps/web/lib/hooks/useAgents.ts
  apps/web/vitest.config.ts

  apps/web/public/portal/data-context.jsx

  apps/api/test/tc-18-p1-spa-bootstrap.test.ts

MODIFIED
  apps/web/app/api/spa/bootstrap/route.ts        (rewritten — calls /v1/* only)
  apps/web/lib/spa/source-json.ts                (now the API fan-out loader)
  apps/web/lib/spa/derive.ts                     (synthesizers deleted; seed tables + mappers only)
  apps/web/lib/spa/types.ts                      (DataSource removed; source narrowed)
  apps/web/package.json                          (+ @tanstack/react-query, + vitest)

  apps/web/public/portal/index.html              (load data-context.jsx)
  apps/web/public/portal/data.js                 (single __RAAS_DATA__ slot; emits raas-data-loaded only)
  apps/web/public/portal/app.jsx                 (useRaasData + DataProvider wrap)
  apps/web/public/portal/views/dashboard.jsx     (useRaasData; deleted window listeners)
  apps/web/public/portal/views/runs.jsx          (useRaasData; deleted window listeners)
  apps/web/public/portal/views/agents.jsx        (useRaasData; deleted useLiveData helper)
  apps/web/public/portal/views/events.jsx        (useRaasData)
  apps/web/public/portal/views/tasks.jsx         (useRaasData)
  apps/web/public/portal/views/workflows.jsx     (useRaasData)
  apps/web/public/portal/views/logs.jsx          (useRaasData)
  apps/web/public/portal/views/deployments.jsx   (useRaasData)
  apps/web/public/portal/views/import-manifest.jsx (useRaasData)
  apps/web/public/portal/views/settings.jsx      (useRaasData)

DELETED
  apps/web/lib/spa/source-neo4j.ts
```
