# P3 Tenant Code Shipping + Package Refactor — Status

**Owner:** Senior Platform Engineer (this PR slice)
**Scope:** IMPLEMENTATION.md §7.3 (tenant code shipping) + §7.4 (package refactor)
**Date:** 2026-05-20

## Per-task status

### §7.3 — Tenant code shipping

| ID | Title | Status | Files |
|---|---|---|---|
| **P3-RT-08** | Dynamic tenant code load via `data/tenants/<slug>/<version>/agentic.json` | **Done** | new: `packages/runtime/src/tenant-loader.ts`; edit: `packages/runtime/src/index.ts`, `apps/api/src/bootstrap.ts` |
| **P3-RT-09** | File-watcher hot reload (dev-only) for `data/tenants/*` + `models/*` | **Done** | new: `packages/runtime/src/hot-reload.ts`; edit: `packages/runtime/src/index.ts`, `apps/api/src/bootstrap.ts` |
| **P3-API-01** | `POST /v1/tenants/:slug/code` — tarball upload, atomic switch | **Done** | new: `apps/api/src/routes/v1/tenant-code.ts`; edit: `apps/api/src/server.ts` |
| **P3-API-02** | `POST /v1/deployments/:id/rollback` — atomic flip + Inngest re-register | **Done** | edit: `apps/api/src/routes/v1/deployments.ts` |
| **P3-API-03** | Atomic Inngest re-registration on deploy + rollback | **Done** | new: `apps/api/src/services/inngest-registry.ts`; edit: `apps/api/src/bootstrap.ts`, `apps/api/src/routes/inngest.ts`, `apps/api/src/routes/v1/agents.ts`, `apps/api/src/routes/v1/deployments.ts` |

### §7.4 — Package refactor

| ID | Title | Status | Notes |
|---|---|---|---|
| **P3-RT-10** | Rename `packages/agents` → `packages/agent-runtime` | **Deferred** | Per the spec, "absolute final step" after §7.3 is green. Repo had pre-existing typecheck failures in `packages/llm-gateway/src/budget.ts` and `apps/api/src/routes/v1/{stream,usage,budgets}.ts` (out of my scope) that block the "all green" gate. Renames cause atomic damage if anything else regresses concurrently, so I held them. Mechanical change once the gate clears. |
| **P3-RT-11** | Rename `packages/agent-kit` → `packages/agent-sdk` | **Deferred** | Same reason as RT-10. |
| **P3-RT-12** | Move system agents → `data/system-agents/` | **Deferred** | Depends on RT-10 (the source dir moves with the rename). |

## New files

| File | Lines | Purpose |
|---|---|---|
| `packages/runtime/src/tenant-loader.ts` | ~270 | Discovers + dynamic-imports `data/tenants/<slug>/<version>/`; resolves live version via `deployments` row, falls back to highest disk dir. |
| `packages/runtime/src/hot-reload.ts` | ~170 | `node:fs.watch` recursive watcher; no-op in production; debounced 250ms; invokes a callback per (kind, tenant) burst. |
| `apps/api/src/routes/v1/tenant-code.ts` | ~415 | `POST /v1/tenants/:slug/code` — gzip+tar decode, atomic `mkdir-tmp + rename`, DB writes, Inngest re-register. Includes a minimal POSIX/ustar reader so we don't add a new direct dep. |
| `apps/api/src/services/inngest-registry.ts` | ~145 | Mutable serve-handler bookkeeping. `initInngestRegistry()` at boot, `reregisterInngest({ scope })` swaps in new fns without restart. `getActiveHandler()` is what the `/inngest` Fastify route delegates to. |
| `apps/api/test/tc-25-p3-tenant-loader.test.ts` | ~100 | Pure-unit fixtures of the loader, no API boot. |
| `apps/api/test/tc-26-p3-inngest-registry.test.ts` | ~50 | Bookkeeping smoke test of the mutable handler registry. |
| `apps/api/test/tc-27-p3-tenant-code-upload.test.ts` | ~210 | E2E: upload → new version → rollback. Verifies on-disk fixture + `deployments` rows + live pointer transitions. |

## Files edited

| File | Edits |
|---|---|
| `packages/db/src/schema.ts` | Added `"tenant_code"` to `deployments.target` enum so `target='tenant_code'` rows can be written by P3-API-01 / P3-API-03. **No new migration needed**: SQLite doesn't enforce enums at column level — they're a TS-only constraint via Drizzle. |
| `packages/runtime/src/index.ts` | Re-exported `dataTenantsRoot`, `listTenantVersions`, `resolveLiveVersion`, `loadTenant`, `loadLiveTenants`, `TenantManifest`, `LoadedTenant`, `startHotReload`, and the `HotReload*` types. |
| `apps/api/src/bootstrap.ts` | Composed `TENANT_REGISTRIES` (in-tree) with `loadLiveTenants()` (dynamic disk). Dynamic wins on slug conflict. Wired `initInngestRegistry()` at boot. Started `hot-reload` watcher dev-only. Exposed `rebuildTenantFns()` + `rebuildCodeAgentFns()` for the inngest-registry service. |
| `apps/api/src/routes/inngest.ts` | Switched the `/inngest` Fastify route to delegate to the mutable handler; fallback to a static `serve()` if the registry isn't initialized (test resilience). |
| `apps/api/src/routes/v1/agents.ts` | `POST /v1/agents` now calls `reregisterInngest({ scope: "tenant" })` after the DB transaction; the response carries `inngest_fns`. |
| `apps/api/src/routes/v1/deployments.ts` | Rollback now demotes only the SAME `target` (no cross-type clobber), then calls `reregisterInngest({ scope })` based on the target. Audit row carries the new fn count. |
| `apps/api/src/server.ts` | Wired `tenantCodeRoutes` into the `/v1` register block. |

## Migration ordinals

No new Drizzle migrations needed for §7.3. The `deployments.target` enum is enforced at the Drizzle TS layer only; SQLite stores text. Adding `"tenant_code"` to the enum list in `schema.ts` is a pure-code change.

If we later want column-level enforcement, a migration of the shape:
```sql
-- not landed in this PR
CREATE TABLE deployments_new (..., target TEXT CHECK (target IN ('workflow','agent','runtime','code_agent','tenant_code')));
INSERT INTO deployments_new SELECT * FROM deployments;
ALTER TABLE deployments RENAME TO deployments_old;
ALTER TABLE deployments_new RENAME TO deployments;
```
would be sufficient. Deferring.

## Test results

```
$ pnpm --filter @agentic/api exec vitest run \
    test/tc-25-p3-tenant-loader.test.ts \
    test/tc-26-p3-inngest-registry.test.ts \
    test/tc-27-p3-tenant-code-upload.test.ts
 Test Files  3 passed (3)
      Tests  10 passed (10)
```

Boot logs from the E2E run confirm both the new code paths fire:
```
[bootstrap] dynamic tenants loaded: raas
[bootstrap] raas (RAAS-v1): 22/23 agents ...
```

## What broke during the work and how I worked around it

The repo was mid-merge with Engineer A's P3 trigger/memory work. Their package state oscillated during this PR. Specific repairs that came up:

1. **`packages/runtime/src/scheduler.ts` and `system-cron.ts` had unterminated block comments** — JSDoc bodies contained literal `*/` inside cron-expression examples (`*/5 * * * *`). I escaped the slashes (`*\/5 * * * *`) so the runtime package would typecheck. This is Engineer A's file but the fix is one character; without it I couldn't run a single test.
2. **`apps/api/src/services/llm.ts` calls `bootstrapCodeAgents().codeAgentFns`** — the agents-package summary only carries `codeAgentFns` after P1-RT-08. My `rebuildCodeAgentFns()` and `bootstrapRuntime()` use a defensive cast (`(summary as unknown as { codeAgentFns?: InngestFunction.Any[] }).codeAgentFns ?? []`) so the code compiles cleanly against either the P0 or the P1 shape of `BootstrapSummary`.
3. **Inngest's `serve()` captures functions at handler-build time** — `inngest/fastify`'s `serve()` is a single closure with a frozen functions array. To support atomic re-registration, `apps/api/src/services/inngest-registry.ts` builds a fresh `serve()` whenever `reregisterInngest()` is called, and the `/inngest` Fastify route delegates to a getter that returns the latest handler. This means re-register is O(1) function-pointer swap with no per-request overhead beyond an extra function call.
4. **`apps/api` doesn't depend on `@agentic/agent-kit`** — I initially imported `TenantRegistry` from there for type only; switched to `TenantRegistries[string]` (which transitively comes through `@agentic/runtime`) so api stays out of agent-kit's import path.

## Out of my scope but worth surfacing

The following are pre-existing failures that the renames in §7.4 would surface as regressions. Engineer A or the responsible owner should fix before §7.4 is unblocked:

- `packages/llm-gateway/src/budget.ts` — imports `@agentic/db` and `drizzle-orm` but the package's `package.json` has neither. Adds an `LLMErrorCode` value (`"cost_limit_exceeded"`) that the type union doesn't include.
- `apps/api/src/routes/v1/{stream,usage,budgets}.ts` — reference exports that don't exist on the current `@agentic/runtime` and `@agentic/db` (`subscribeStreamEvents`, `tenantBudgets`).
- `apps/api/src/queries/runs.ts:185` — narrows `steps.type` to `'tool' | 'logic' | 'manual'` but the manifest schema extended it to include `'condition' | 'delay' | 'subflow'` (P1-RT-03).
- Several `apps/api/test/tc-*.test.ts` files import symbols that have been renamed in the contracts package (`RunStreamEvent` etc.) — these need a contracts-side rename or a back-compat alias.

## Renames (§7.4) action plan when the green gate clears

The renames are mechanical:

1. `packages/agents` → `packages/agent-runtime`
   - Move dir, update `package.json#name` to `@agentic/agent-runtime`, update workspace deps via `pnpm install`, regex replace `"@agentic/agents"` → `"@agentic/agent-runtime"` across the repo.
   - Files affected: `tenants/raas/package.json`, `packages/runtime/{package.json,src/step-engine.ts,src/bootstrap.ts,src/register.ts}`, `packages/agents/src/{index.ts,bootstrap.ts}`, `apps/cli/{package.json,src/commands/init.ts,test/init.test.ts}`, `apps/api/{package.json,src/bootstrap.ts,src/routes/v1/agent-invoke.ts,test/tc-10/tc-16/tc-17}`.
2. `packages/agent-kit` → `packages/agent-sdk`
   - Same drill against `@agentic/agent-kit` → `@agentic/agent-sdk`.
3. Move `packages/agent-runtime/src/system/` → `data/system-agents/`
   - The runtime loads them via the dynamic loader, so the import in `apps/api/src/bootstrap.ts` (`import "@agentic/agents/system"`) becomes a directory-side discovery instead. The `apps/api` package.json `agents/system` subpath export is dropped.

Do them in this order; typecheck + test after each.
