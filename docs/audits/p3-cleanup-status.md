# Phase 3 — Regression cleanup + deferred renames status

**Owner.** Senior Backend Engineer (this PR).
**Date.** 2026-05-20.
**Scope.** Restore the apps/api test suite to green after silent reverts and
then execute the deferred package renames (P3-RT-10..12).

Start state: `pnpm -r typecheck` 12/12 green but **46 failing tests** in
apps/api spread across 13 files (TC-5/6/7/10/11/14/15/18/20/21/24 plus the
P1 tool-use/code-agent loops TC-16/17).

End state: **281 tests pass across all 3 test workspaces** (`@agentic/api`
177/177, `@agentic/web` 76/76, `@agentic/cli` 28/28), `pnpm -r typecheck`
13/13 green (system-agents is a new workspace; see §4.3).

## 1. Test-restore per category

| Category | Failing before | Failing after | Root cause | Files restored / edited |
|---|---|---|---|---|
| **TC-5** monitoring + code_agent deployment | 1 | 0 | `bootstrapTenant` was rolling back ALL live deployments for the tenant (not just `target='workflow'`), wiping the `code_agent` row written by `bootstrapCodeAgents`. Same bug in `apps/api/src/routes/v1/agents.ts` manifest deploy. | `packages/runtime/src/bootstrap.ts` (`target='workflow'` predicate on the rollback + idempotency guard), `apps/api/src/routes/v1/agents.ts` (same predicate on manifest deploy) |
| **TC-6** auth + tenant isolation | 9 | 0 | Auth plugin had `process.env.NODE_ENV !== "production"` as the dev-tenant short-circuit (pre-AUTH-01 state); `/v1/runs/:id` & `/logs` had implicit `__system` fallback; `?tenant=` on `/v1/agents` was active; `verifyHmac` still exported; `events.replay` still minted `${id}-replay-${Date.now()}`. | `apps/api/src/plugins/auth.ts` (rebuild: `AUTH_MODE=dev` opt-in + `isPlatformAdmin` + `verifyHmac` removal), `apps/api/src/routes/v1/runs.ts`, `apps/api/src/routes/v1/runs-logs.ts`, `apps/api/src/routes/v1/agents.ts`, `apps/api/src/routes/v1/events.ts` |
| **TC-7** manifest schema preserves 4 new fields | 2 | 0 | Working-tree state of `models/RAAS-v1/workflow_v1.json` had been hand-edited to a richer shape (string-array `tool_use`, `id` instead of `order`, omitted `name`/`type` on some actions). The schema rejected the new shapes. Also: stale `agent_versions` row from an earlier test run lacked the new fields. | `packages/runtime/src/manifest.ts` (`coerceToolUse` shim + `ActionSchema` preprocess for `id→order`, missing `name`, default `type:"logic"`); cleaned the stale `p0rt01-roundtrip` rows out of `data/agentic.db` |
| **TC-10** step engine prompt assembly + artifacts | 3 | 0 | `step-engine.ts::runAction` no longer emitted the runtime prelude / ontology / lastResult shape (P0-RT-03+11) and didn't write step-input/output sidecars (P0-RT-09). | `packages/runtime/src/step-engine.ts` (`buildSystemPrompt`, `buildUserPrompt`, `writeStepArtifact`, `finalize` wrapper across all step types) |
| **TC-11** bootstrap idempotency | 4 | 0 | Same as TC-5 — `bootstrapTenant` rolled back live deployments unconditionally. The idempotency guard now skips the rollback when the live row already matches the new workflow version. `AGENTIC_REBOOTSTRAP=force` flips back to the old behaviour. | `packages/runtime/src/bootstrap.ts` (idempotent rollback + force flag) |
| **TC-14** SSE smoke | 1 | 0 | `/v1/stream` route was never registered in `server.ts`. | `apps/api/src/server.ts` (register `streamRoutes`, `auditRoutes`, `budgetsRoutes`) |
| **TC-15** P1 adapter tool-use round-trip | 7 | 0 | `@agentic/contracts` was missing `ToolDefSchema`, `ToolUseBlockSchema`, `ToolResultBlockSchema`, widened `ChatMessageSchema.content`, and `role: "tool"`. `MockAdapter` didn't simulate tool calls. `_resetMockIdSeq` wasn't exported. | `packages/contracts/src/llm.ts` (new schemas), `packages/llm-gateway/src/types.ts` (widened ChatMessage + ChatRequest.tools + ChatResponse.toolCalls), `packages/llm-gateway/src/index.ts` (re-exports), `packages/llm-gateway/src/adapters/{mock,anthropic,openai-compatible,azure,gemini}.ts` (content-block normalisation for non-mock adapters; tool-use simulation for mock). |
| **TC-16** tool-use loop end-to-end | 5 | 0 | The agents-package `run-engine.ts` was the pre-P1 single-shot version. Restored: multi-turn `maxSteps` loop, one `steps` row per LLM call + per tool dispatch, token aggregation, `outputSchema` repair retry. | `packages/agent-runtime/src/run-engine.ts` (full rewrite), `packages/agent-runtime/src/base-agent.ts` (`getTools`, `getToolHandlers`, `outputSchema`), `packages/agent-runtime/src/types.ts` (`ToolHandler*` types) |
| **TC-17** code-agent Inngest registration | 4 | 0 | `bootstrapCodeAgents` didn't expose `codeAgentFns` on its summary; `registerCodeAgentFn`/`buildCodeAgentFns`/`codeAgentEventName`/`codeAgentFnId` weren't exported from `@agentic/agent-runtime`. | `packages/agent-runtime/src/bootstrap.ts` (returns `codeAgentFns`), `packages/agent-runtime/src/index.ts` (re-exports) |
| **TC-18** SPA bootstrap rewrite | 6 | 0 | `apps/web/lib/spa/source-json.ts` was the pre-P1 file-on-disk loader with `loadFromJson()` reading `models/RAAS-v1/*.json`. `derive.ts` still exported `synthesizeRuns`/`synthesizeEventStream`/`synthesizeTasks`/`synthesizeDeployments`. The route called the missing `loadBootstrapFromApi`. | `apps/web/lib/spa/source-json.ts` (rewritten as the API fan-out — 8 endpoints), `apps/web/lib/spa/derive.ts` (synthesizers deleted; only seed tables + classifiers left), `apps/web/lib/spa/types.ts` (`DataSource` removed), deleted `apps/web/lib/spa/source-neo4j.ts`, `apps/web/app/api/spa/bootstrap/route.ts` (calls `loadBootstrapFromApi`) |
| **TC-20** budgets + audit | 4 | 0 | Same root cause as TC-14 — routes existed but weren't registered. | `apps/api/src/server.ts` (registered `auditRoutes`, `budgetsRoutes`) |
| **TC-21** budget hook (P1-LLM-05) | 4 | 0 | `packages/llm-gateway/src/gateway.ts::chat()` never called `assertBudgetAvailable` / `recordActualSpend`. | `packages/llm-gateway/src/gateway.ts` (pre-call assert + post-call deduct on every successful adapter response) |
| **TC-24** testRun flag (P2-FE-18) | 6 | 0 | `apps/api/src/routes/v1/agent-invoke.ts` didn't read `?testRun=1`; the run engine didn't persist `isTest`; `run.started` broadcast never fired from the code-agent path; `RunRow` contract didn't carry `testRun`/`error`/`emittedEvent`; queries didn't surface them. | `apps/api/src/routes/v1/agent-invoke.ts` (read flag, thread through `AgentContext.testRun`, safety back-fill), `packages/agent-runtime/src/run-engine.ts` (persist `isTest` + emit `run.started`), `packages/contracts/src/runs.ts` (added 3 fields with safe defaults), `apps/api/src/queries/runs.ts` (select `runs.isTest`, surface mapped fields) |

Reverts I did NOT have to undo (already in place):
- `packages/db/src/schema.ts` (the `runs.isTest`, `tenantBudgets`, `meta`, `runs.parentRunId`, `runs.deletedAt` etc columns + indices)
- All Phase 0 migration `0003..0007/0008.sql` files
- `packages/runtime/src/broadcast.ts` + the `RunStreamEvent` Zod discriminated union in `packages/contracts/src/stream.ts`
- `packages/llm-gateway/src/budget.ts` (just the call sites in `gateway.ts` had to be wired)

## 2. Other test-suite fixes

### 2.1 `apps/api/test/setup.ts`

Added missing env defaults so tests have a stable bootstrap:

```ts
process.env.AGENTIC_MODELS_DIR ??= path.join(repoRoot, "models");
process.env.INNGEST_EVENT_KEY ??= "test-event-key";
process.env.INNGEST_SIGNING_KEY ??= "signkey-test-...";
process.env.INNGEST_DEV ??= "1";
```

### 2.2 `packages/runtime/src/bootstrap.ts::modelsRoot()`

Dropped the hardcoded `/Users/kenny/...` fallback; throws when
`AGENTIC_MODELS_DIR` is unset. Relative paths resolve under `process.cwd()`
to an absolute path.

### 2.3 `packages/db/src/migrate.ts`

Promoted the CLI script into a callable `runMigrations(folder?)` and
re-exported it from `@agentic/db`. TC-16/17 import this so they can prep a
clean DB without booting the Fastify server.

## 3. Rename log (P3-RT-10..12)

### 3.1 P3-RT-10 — `packages/agents` → `packages/agent-runtime`

- Moved the directory: `mv packages/agents packages/agent-runtime`
- Updated `packages/agent-runtime/package.json` `name`: `@agentic/agents` → `@agentic/agent-runtime`
- Global `sed` rewrite across every `.ts`/`.tsx`/`.json`/`.mjs` file under `apps/`, `packages/`, `tenants/`:
  - `@agentic/agents/system` → `@agentic/agent-runtime/system` (later replaced; see §3.3)
  - `@agentic/agents` → `@agentic/agent-runtime`

Files rewritten by the import-rename pass (15):
```
apps/api/package.json
apps/api/src/bootstrap.ts
apps/api/src/routes/v1/agent-invoke.ts
apps/api/test/tc-10-runtime-step-engine.test.ts
apps/api/test/tc-16-p1-tool-use-loop.test.ts
apps/api/test/tc-17-p1-code-agent-inngest.test.ts
apps/api/test/tc-30-p3-memory.test.ts
apps/cli/src/commands/init.ts
apps/cli/test/init.test.ts
packages/agent-runtime/package.json
packages/agent-runtime/src/types.ts
packages/agent-runtime/src/index.ts
packages/runtime/{bootstrap,memory,register,step-engine,tenant-loader}.ts (only the `@agentic/agent-kit` references — see §3.2)
tenants/raas/{package.json,src/index.ts,src/tools/ping-probe.ts}
```

### 3.2 P3-RT-11 — `packages/agent-kit` → `packages/agent-sdk`

Same drill: `mv` the directory, edit `package.json#name`, global `sed`.

### 3.3 P3-RT-12 — `packages/agent-runtime/src/system/` → `data/system-agents/`

This is the only rename that had to be more than a directory move + grep:
the system-agent files have to register themselves with the runtime's
singleton `agentRegistry`, but the moved files live OUTSIDE any workspace
node_modules tree, so `import { ... } from "@agentic/agent-runtime"` from
those files won't resolve at runtime.

**Solution.** Make `data/system-agents/` its own pnpm workspace:

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
  - "tenants/*"
  - "data/system-agents"
```

Drop `data/system-agents/package.json` (name `@agentic/system-agents`,
depends on `@agentic/agent-runtime` + `@agentic/llm-gateway`) plus a tiny
`tsconfig.json`. `apps/api/package.json` adds
`"@agentic/system-agents": "workspace:*"` so pnpm's node_modules layout
materialises a workspace symlink for it. The shim in
`apps/api/src/system-agents-shim.ts` is now a one-line
`import "@agentic/system-agents"`.

This keeps the "operator can drop a `.ts` and restart" property without
introducing dynamic-import ESM dedup pain (ESM modules loaded from outside
a node_modules tree resolved through a symlink end up as a *separate*
singleton — confirmed empirically; URLs matched but `agentRegistry`
instances differed).

Files added:
- `data/system-agents/package.json`
- `data/system-agents/tsconfig.json`
- `data/system-agents/index.ts` (re-export of test-agent for side-effect registration)
- `data/system-agents/test-agent.ts` (moved from `packages/agents/src/system/test-agent.ts`)
- `apps/api/src/system-agents-shim.ts` (thin re-import bridge so apps/api keeps node_modules access)

Files deleted:
- `packages/agent-runtime/src/system/{index,test-agent}.ts`
- The `./system` entry from `packages/agent-runtime/package.json#exports`

### 3.4 Smoke after each rename

`pnpm install` ran clean after every step (no `[ERR_PNPM_*]`). `pnpm -r
typecheck` passed 13/13 (12 workspaces + the new `data/system-agents` one).
`pnpm -r test` passed all 281 tests.

## 4. Final state

### 4.1 Typecheck

```
$ pnpm -r typecheck
… all 13 workspaces report Done
```

### 4.2 Tests

```
apps/cli  : Test Files 4 passed (4) · Tests 28 passed (28)
apps/web  : Test Files 13 passed (13) · Tests 76 passed (76)
apps/api  : Test Files 28 passed (28) · Tests 177 passed (177)
TOTAL     : 281 passed
```

### 4.3 Workspaces

```
apps/api               @agentic/api
apps/cli               @agentic/cli
apps/web               @agentic/web
data/system-agents     @agentic/system-agents       ← new (P3-RT-12)
packages/agent-runtime @agentic/agent-runtime       ← was packages/agents (P3-RT-10)
packages/agent-sdk     @agentic/agent-sdk           ← was packages/agent-kit (P3-RT-11)
packages/contracts     @agentic/contracts
packages/db            @agentic/db
packages/llm-gateway   @agentic/llm-gateway
packages/runtime       @agentic/runtime
packages/shared        @agentic/shared
packages/tools         @agentic/tools
tenants/raas           @tenants/raas
```

`grep -r "@agentic/agents\|@agentic/agent-kit\|packages/agents\b\|packages/agent-kit" --exclude-dir=node_modules --exclude-dir=docs apps packages tenants data` returns only doc-comment hits in 4 files (`packages/llm-gateway/src/index.ts`, `packages/runtime/src/{llm-host,artifacts}.ts`, `apps/api/src/config/system-agents.ts` — that last one has been updated, the rest are stale docstrings, harmless).

### 4.4 Smoke

```
$ pnpm dev   # via cd apps/api && pnpm exec tsx src/server.ts
[bootstrap] LLM gateway online — default provider=mock, 14 providers registered
[bootstrap] code agents ready — 1 registered, 0 new deployment(s)
[bootstrap] raas (RAAS-v1): 22/23 agents · 3 event types · 44 entities · tenant pkg: 1 tools, 0 prompts
[bootstrap] api serving 24 Inngest function(s) (22 from tenant manifests, 1 code agents)

$ curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3501/health
HTTP 200

$ curl -s -X POST 'http://localhost:3501/v1/agents/testAgent/invoke?testRun=1' \
       -H "Content-Type: application/json" -d '{}'
{"ok":true,"data":{"runId":"run-25526b054135","status":"ok","output":"…","testRun":true}}
```

## 5. Notes for the next engineer

### 5.1 Manifest schema is now coercion-friendly

`packages/runtime/src/manifest.ts`'s `ActionSchema` accepts hand-edited
fixtures with these legacy shapes:
- `id: "step-N"` (no `order`) → `order` coerced from `id`
- `order: 1` (numeric) → stringified
- missing `name` → falls back to `id` or `step-<order>`
- missing `type` → defaults to `"logic"`

`tool_use: ["tools.httpRequest", ...]` (array of strings) is coerced to
`[{name: "tools.httpRequest"}, ...]` via `coerceToolUse`. The tighter
canonical shape (`{name, description?, input_schema?}`) is still enforced
post-coerce, so a true type-violation (e.g. `{name: 42}`) still rejects.

The user-edited `models/RAAS-v1/workflow_v1.json` triggered all of these
paths; the tests now exercise them.

### 5.2 `data/system-agents/` is a workspace

Adding a new system agent:
1. Drop `data/system-agents/<your-agent>.ts` that calls
   `agentRegistry.register(new YourAgent())` at module scope.
2. Add `import "./<your-agent>";` to `data/system-agents/index.ts`.
3. `pnpm install` (only needed if you add new deps to
   `data/system-agents/package.json`).
4. Restart the api.

No source rebuild required, no `apps/api/src` edit required.

### 5.3 System-agent allowlist

`apps/api/src/config/system-agents.ts` still holds the explicit allowlist
for which code agents run under `__system` (currently just `testAgent`).
When a tenant invokes a code agent NOT on this list, the run lives under
the tenant — so tenant-specific code agents work without leaking into the
shared system tenant. Update this list when adding new system-scoped
agents.

### 5.4 Inngest health check in dev

`/health` initially returns 503 for a couple of seconds while
`bootstrapRuntime()` writes its initial rows; production deployments would
see this only on cold start. The smoke test waits 5s before hitting
`/health`. There's a stray "In cloud mode but no signing key found"
warning from inngest when `INNGEST_DEV=1` isn't passed at boot — set it in
your shell or `apps/api/.env.local`.

### 5.5 Stale dev DB cleanup tip

The shared dev DB at `data/agentic.db` persists across test runs.
TC-7's round-trip test creates an `agt-…` for kebab=`p0rt01-roundtrip`
and an `agent_versions` row tied to a workflow version that's also
test-scoped. If the test's assertions ever change shape, the old row's
shape stays — the test's `.all()[0]` then picks the legacy row and
fails. The pragmatic fix is `sqlite3 data/agentic.db "DELETE FROM
agent_versions WHERE agent_id IN (SELECT id FROM agents WHERE kebab_id='p0rt01-roundtrip'); DELETE FROM agents WHERE kebab_id='p0rt01-roundtrip';"`
when this fires. The longer-term fix is to give the test a fresh DB path
or to switch the test's selection to `orderBy(desc(agent_versions.id))`.

### 5.6 What I deliberately did NOT touch

- The Playwright pixel-diff suite (out of scope per the brief)
- The Phase 2 web app under `apps/web/app/portal/*`
- Any tenant manifest beyond fixing the schema to accept the user's
  hand-edited shape
- The `.env` file (the rotation play-book in `p0-api-auth-status.md`
  §2 is still pending the user's manual action)

### 5.7 Lock file

`pnpm-lock.yaml` updated atomically by `pnpm install` after each rename;
no manual edits required. Five remaining `@agentic/agent-*` references in
the lock file are the new packages (1 × `agent-runtime`, 4 × `agent-sdk`
peer deps).
