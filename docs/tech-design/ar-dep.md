# Tech Design — Deployment

**Module ID:** AR-DEP
**Owner:** AI Software Architect
**Status:** V1.1 design
**Source catalog:** `docs/catalog/02-ai-runtime-catalog.md` § 8 (AR-DEP-01..04)

## 1. Purpose

The deployment module is **how new code or new manifests land in a running system without restarting it**. Two parallel surfaces share the `deployments` table for audit + rollback but differ on the activation steps:
- **Manifest import** (declarative JSON, the 6-step wizard) — `POST /v1/tenants/:slug/manifest-import` with `validate` and `commit` modes; backs the production "Import workflow manifest" modal.
- **Tenant code deploy** (TypeScript bundle, the CLI) — `agentic deploy [path]` tars up a project; `POST /v1/tenant-code` accepts a USTAR tarball, unpacks, validates, dynamic-imports, atomic-renames into `data/tenants/<slug>/<version>/`.
The **reconcile-imports** boot-time pass closes the crash-recovery loop for both. The big V1.1 changes are (a) fixing the `POST /v1/agents` 500 on tenants with a live tenant-code deployment (AR-GAP-02 / UC-V11-18 / UC-V11-28 — same bug captured from runtime + platform angles), and (b) fixing the `agentic init` scaffold to write the correct `actions_v1.json` shape (AR-GAP-03 / UC-V11-19).

## 2. V1 state (citable)

- **CLI deploy** (AR-DEP-01) — `apps/cli/src/commands/deploy.ts`. Flow: (1) read `agentic.config.json` for tenant slug + bearer, (2) `tsc --noEmit` gate + `esbuild --bundle --format=cjs --platform=node --outfile=dist/index.cjs`, (3) tar dist/ + agentic.config.json + any models/ into USTAR (no symlinks, no leading slashes), (4) `POST /v1/tenant-code` with `Content-Type: application/x-tar`. Server side at `apps/api/src/routes/v1/tenant-code.ts`: tarball size cap 16 MB, path-traversal scan (any `/` or `..` rejected), entry count cap 1000, unpack to `data/tenants/<slug>/.staging-<dpl-id>/`, `tsc --noEmit` re-validate, dynamic `import()`, atomic-rename to `data/tenants/<slug>/<version>/`, insert `deployments(kind:'tenant_code', status:'live')` row, demote prior live, re-register registry entries.
- **Atomic-rename activation** (AR-DEP-02) — five-step pattern mirrored across tenant-code + manifest-import: (1) write artifact to staging, (2) `fsync`, (3) write DB rows, (4) `fs.rename(staging, live)` (atomic at POSIX layer for same-FS), (5) re-register Inngest. Crash between (3) and (4): DB row points at staging → reconcile completes the rename. Crash between (4) and (5): DB+disk agree but Inngest not told → also fixed at boot.
- **Manifest import wizard** (AR-DEP-03) — `POST /v1/tenants/:slug/manifest-import` at `apps/api/src/routes/v1/manifest-import.ts:1-307`. Two modes:
  - `validate`: insert `deployments(status:'pending', expires_at: now+1h)` lock row (the row's `id` IS the import session token, per review A2). Returning 423 LOCKED when another pending row exists for `(tenant, kind)`. Preflight runs parse + lint + diff in memory.
  - `commit`: four-phase atomic flow:
    1. Preflight in-memory (parse + lint, fail-fast unless `?confirm=overwrite=1`).
    2. Stage on disk — write `data/imports/<deployment_id>/workflow.json` (+ `actions_v1.json`) + fsync.
    3. Synchronous SQLite tx (`db.transaction(() => {...})()`) — demote prior live, upsert `workflow_versions`, INSERT fresh `deployments(status:'live', file_path:'data/imports/<dpl-id>/workflow.json')`, upsert `agents`/`agent_versions`/`event_listeners`, audit row.
    4. Atomic rename `fs.rename('data/imports/<dpl-id>/...', 'models/<slug>-v<N+1>/...')` + `reregisterInngest()`.
  - Conflict handling: `validate` returns `409 ManifestImportOverwriteRequired` when overwriting non-empty live state; SPA's OverwriteConfirmModal reissues commit with `?confirm=overwrite=1`. 409 + 423 responses are **flat** (no envelope) per CLAUDE.md gotcha — client `unwrapEnvelope<T>()` handles both shapes.
- **Reconcile-imports** (AR-DEP-04) — `apps/api/src/services/reconcile-imports.ts:1-306`. Runs at every API boot before any HTTP listener is bound. Three crash-recovery cases per `docs/design/import-workflow-manifest.md`:
  1. **Expired pending** — `status='pending' AND expires_at < now()`. Drop row + workflow_version + `data/imports/<dpl-id>/`.
  2. **Crashed rename** — `status='live' AND file_path LIKE 'data/imports/%'`. Phase-3 DB commit succeeded but phase-4 rename did not. Complete the rename, then `reregisterInngest`.
  3. **Missing on-disk file** — `status='live' AND file_path NOT NULL AND file_path missing on disk`. Someone manually deleted the file. Re-emit from `workflow_versions.manifest_json` (durable, per `migrations/index.ts:13`).
  Reconcile is **idempotent**. On error, logs but does not abort boot.

## 3. V1.1 changes

### UC-V11-18 / UC-V11-28 / AR-GAP-02 / PF-GAP-02 — `POST /v1/agents` 500 on live tenant_code deployment
**Site:** `apps/api/src/routes/v1/agents.ts` (the workflow editor's "Add agent" save), and the dynamic-import resolver (logic currently inline in route, V1.1 extracts to `apps/api/src/services/tenant-code.ts`).
**Bug:** When a tenant has a live `deployments(kind:'tenant_code', status:'live')` row, the resolver does `dynamic import(absoluteTenantPath)` but the path resolution **loses the version segment**. The tarball unpacks into `data/tenants/<slug>/v<version>/dist/index.cjs`, but the import call resolves to `data/tenants/<slug>/dist/...` (without the `v<version>/` segment). Symptom: 500 with `Cannot find module '@tenants/raas/dist'`.
**Root cause:** The code that builds the import URL was written assuming there's only one tenant directory per slug. When tenant-code deploys land, multiple `v<version>/` subdirs accumulate, and the resolver does not pick the right one.
**Fix:**
1. **Extract resolver to a service.** Create `apps/api/src/services/tenant-code.ts` with:
   ```ts
   export async function resolveTenantCodePath(tenantId: string): Promise<string | null> {
     const live = db.select().from(deployments)
       .where(and(eq(deployments.tenantId, tenantId),
                  eq(deployments.kind, "tenant_code"),
                  eq(deployments.status, "live")))
       .all()[0];
     if (!live) return null;
     return path.join(
       process.env.AGENTIC_DATA_DIR ?? "./data",
       "tenants",
       live.tenantSlug,
       `v${live.version}`,
       "dist",
       "index.cjs",
     );
   }
   ```
2. **Use it in the agents route.** Replace the inline path-construction in `apps/api/src/routes/v1/agents.ts` with `await resolveTenantCodePath(auth.tenantId)`. When null, fall through to the workspace `@tenants/<slug>` import (the pre-tenant-code path).
3. **Use it during tenant-code deploy** (`apps/api/src/routes/v1/tenant-code.ts`). The deploy currently writes `data/tenants/<slug>/<version>/` (no `v` prefix); V1.1 standardizes the layout to `data/tenants/<slug>/v<version>/` so the version-extraction code can use a simple regex. Migration: rename existing `<n>/` to `v<n>/` (idempotent — V1.1 boot-time migration in `reconcile-imports.ts` or a separate migration helper).

**New types:** `resolveTenantCodePath(tenantId: string): Promise<string | null>` exported from `apps/api/src/services/tenant-code.ts` (file does not exist today).
**Migration:** Boot-time rename of existing tenant-code dirs from `data/tenants/<slug>/<n>/` to `data/tenants/<slug>/v<n>/`. Run in `reconcile-imports.ts` because the DB+disk reconciliation is its job; gate behind `if (!existsSync(path.join(...)))` so idempotent.
**Tests:**
- `tc-agents-add-with-live-tenantcode.test.ts` (new) — seed tenant + live `tenant_code` deployment row + on-disk `data/tenants/<slug>/v<n>/dist/index.cjs`, POST `/v1/agents`, assert 200 + registered.
- `tc-tenant-code-path-migration.test.ts` (new) — seed `data/tenants/<slug>/3/dist/` (legacy), run reconcile, assert `data/tenants/<slug>/v3/dist/` exists.
- `tc-tenant-code-versioning.test.ts` (existing) — extend with the path-shape assertion.

### UC-V11-19 / AR-GAP-03 — `agentic init` writes correct `actions_v1.json` shape
**Site:** `apps/cli/src/commands/init.ts` (the scaffold) and the `ActionsManifestSchema` reference at `packages/runtime/src/manifest.ts:43`.
**Bug:** `agentic init <slug>` writes a stub `actions_v1.json` that doesn't match `ActionsManifestSchema`. On first `agentic deploy`, the server-side validation rejects it with a confusing schema error. Workaround today: replace `actions_v1.json` with the RAAS sample manually.
**Fix:**
1. **Read schema as source of truth.** Update `apps/cli/src/commands/init.ts` to import `ActionsManifestSchema` from `@agentic/runtime` (or `@agentic/contracts` if it lives there — TBD; centralize in contracts if not). Generate the scaffold from a minimal `ActionsManifest` literal that passes Zod parse, NOT from a hand-typed template.
2. **Scaffold contents.** The minimal valid manifest:
   ```json
   {
     "version": "v1",
     "agents": [
       {
         "id": "exampleAgent",
         "name": "exampleAgent",
         "title": "Example agent",
         "description": "Replace with your agent description.",
         "actor": ["Agent"],
         "trigger": ["EXAMPLE_EVENT"],
         "actions": [
           {
             "name": "exampleAction",
             "type": "logic",
             "description": "Replace with what this action does."
           }
         ],
         "triggered_event": ["EXAMPLE_COMPLETED"]
       }
     ]
   }
   ```
3. **CI gate.** Add a CLI-level test that runs `agentic init test-tenant` into a temp dir, then parses the generated `actions_v1.json` through `ActionsManifestSchema.parse()`. Fail the build on Zod error.

**New types:** None (consumes existing schema).
**Migration:** None (only affects new tenants).
**Tests:**
- `tc-cli-init-schema.test.ts` (new) — `agentic init` into temp dir, parse `actions_v1.json` via Zod, assert no errors.
- `tc-cli-deploy-fresh.test.ts` (new) — `agentic init` then `agentic deploy` on the fresh scaffold; assert deploy succeeds end-to-end.
- `tc-agentic-deploy.test.ts` (existing) — already covers tarball path; extend with the schema-validation assertion.

### Adjacent V1.1 housekeeping (coupled to deploy)
- **PF-GAP-09 / UC-V11-31** — Gitignore `apps/api/data/imports/`. The directories at `apps/api/data/imports/dpl-*` are staging dirs created by manifest-import commits; reconcile cleans them but they currently leak into `git status` if a crash leaves them behind. The current root `.gitignore` covers `data/*` but not `apps/api/data/`. Add `apps/api/data/imports/` to root `.gitignore`. (Cleanup engineer task.)
- **PF-GAP-11 / UC-V11-33** — Register `/v1/stream`, `/v1/tenant-code`, `/v1/workflow` modules in `apps/api/src/server.ts`. CLI `agentic events tail` currently 404s because `/v1/stream` isn't wired. The route files exist; they're just not registered in `server.ts`. This is a one-line fix per route.

## 4. Interfaces (the contract)

**Deployment row (`packages/db/src/schema.ts` — `deployments` table):**
```
id          text PK              `dpl-...`
tenant_id   text FK→tenants
kind        text                 'workflow' | 'tenant_code'
version     int                  workflow_version sequence OR tenant_code version
status      text                 'pending' | 'live' | 'previous' | 'cancelled'
file_path   text                 staging path (pending) or models/<slug>-vN/... (live)
expires_at  timestamp_ms         set on pending, NULL on live
created_at  timestamp_ms
created_by  text                 actor user id (FK→users)
```

**Manifest import REST shapes (Zod in `packages/contracts/src/manifest-import.ts`):**
```ts
export const ManifestImportBody = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("validate"),
    source: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("inline"), workflow: ... }),
      z.object({ kind: z.literal("url"), url: z.string().url() }),
    ]),
    confirm_overwrite: z.boolean().optional(),
  }),
  z.object({
    mode: z.literal("commit"),
    deployment_id: z.string(),    // the dpl- token from validate
    confirm_overwrite: z.boolean().optional(),
  }),
]);

// Response shapes
export type ManifestImportPreview = {
  deployment_id: string;
  diff: { agentsAdded[], agentsRemoved[], agentsChanged[] };
  issues: { blocking[], warnings[] };
  model_diff: { added[], removed[], changed[] };
};
export type ManifestImportCommit = {
  deployment_id: string;
  workflow_version: number;
  file_path: string;
  agents_active: number;
};
```

**Tenant-code REST shape:** `POST /v1/tenant-code` with `Content-Type: application/x-tar`, body = USTAR bytes. Returns:
```ts
{
  deploymentId: string;     // dpl-...
  version: number;
  status: "live";
  diff: { agentsAdded: string[]; agentsRemoved: string[]; agentsChanged: string[] };
}
```

**Reconcile (`apps/api/src/services/reconcile-imports.ts`):** `export async function reconcileImports(): Promise<void>` — called from `apps/api/src/bootstrap.ts` before HTTP listener bind. Idempotent.

**CLI flags (`apps/cli/src/commands/deploy.ts`):**
- `agentic deploy [path]` — default path=`.`.
- `agentic init <slug>` — V1.1 scaffold fix.
- `agentic logs <run-id> [--tail]` — V1.1 needs `/v1/stream` registered (UC-V11-33).
- `agentic events tail` — V1.1 needs `/v1/stream` registered (UC-V11-33).

## 5. Data flow

Manifest import commit (4-phase):

```
operator: POST /v1/tenants/raas/manifest-import { mode:"commit", deployment_id:"dpl-X" }
   |
   v
Phase 1: preflight in-memory
   parse workflow.json via Zod, lint via packages/runtime/src/lint.ts
   fail-fast on blocking issues (unless ?confirm=overwrite=1)
   |
   v
Phase 2: stage on disk
   writeFile("data/imports/dpl-X/workflow.json", json)
   fsync(file) + fsync(parent dir)
   |
   v
Phase 3: synchronous SQLite tx
   db.transaction(() => {
     update prior live deployment SET status='previous'
     upsert workflow_versions row (with manifest_json)
     insert deployments(id='dpl-X', status='live', file_path='data/imports/dpl-X/workflow.json')
     upsert agents + agent_versions + event_listeners
     insert audit_log
   })()
   |
   v
Phase 4: atomic rename + re-register
   fs.rename('data/imports/dpl-X/workflow.json', 'models/raas-v3/workflow_v3.json')
   reregisterInngest(tenantSlug)   // drops old per-tenant functions, creates new
   |
   v
return 200 { deployment_id, workflow_version, file_path, agents_active }


Tenant-code deploy:

CLI: agentic deploy
   tsc --noEmit  ->  esbuild --bundle --outfile=dist/index.cjs
   tar dist/ + agentic.config.json + models/  ->  upload.tar
   POST /v1/tenant-code  body=upload.tar  Content-Type=application/x-tar
   |
   v
server: validate tarball (size cap, path traversal, entry count)
   unpack to data/tenants/<slug>/.staging-dpl-Y/
   tsc --noEmit re-validate
   dynamic import(.staging-dpl-Y/dist/index.cjs)  -> registry register-side-effect
   |
   v
   fs.rename(.staging-dpl-Y/, v<N+1>/)        // V1.1 standardized layout
   insert deployments(kind:'tenant_code', version:N+1, status:'live', file_path:v<N+1>/)
   update prior live SET status='previous'
   |
   v
   return 200 { deploymentId, version, status:'live', diff }


Boot reconcile:

apps/api boot
   |
   v
reconcileImports()
   |
   +-- expired pending: drop row + workflow_version + rm -rf data/imports/dpl-X/
   |
   +-- crashed rename: complete fs.rename + reregisterInngest
   |
   +-- missing on-disk: re-emit from workflow_versions.manifest_json
   |
   +-- V1.1: legacy tenant-code dir migration: rename <n>/ -> v<n>/
   |
   v
HTTP listener binds, traffic begins
```

## 6. Failure modes

| Failure | What happens | Recovery |
|---|---|---|
| Concurrent `validate` for same `(tenant, kind)` | 423 LOCKED with in-flight `deployment_id` | SPA offers "Resume or cancel"; DELETE the lock row to free |
| `validate` against non-empty live state | 409 `ManifestImportOverwriteRequired` with `confirm` hint | Operator reissues commit with `?confirm=overwrite=1` |
| Crash between phase-3 and phase-4 | DB says live, disk says staging | Reconcile completes the rename at next boot |
| Crash between phase-4 and Inngest re-register | DB+disk agree but functions not registered | Reconcile re-registers at next boot |
| Tarball too large | 413 with size limit | Caller reduces bundle |
| Tarball path traversal | 400 `path_traversal_detected` | Caller fixes archive (no `/` or `..`) |
| `tsc --noEmit` fails on staged tenant-code | 400 with TS error log | Caller fixes types |
| Dynamic import fails | 400 `module_load_failed` with stderr; staging cleaned | Caller fixes runtime error |
| `POST /v1/agents` on live tenant-code (V1) | 500 `Cannot find module` | V1.1 fix above |
| `agentic init` produces invalid manifest (V1) | First `agentic deploy` rejects with schema error | V1.1 fix above |
| Staging dir `data/imports/dpl-*` left after crash | Visible in `git status` (V1) | V1.1 gitignore (UC-V11-31); reconcile cleans expired pending |
| Pending lock TTL expires while operator still on wizard | Validate row dropped, commit fails with 404 | SPA restarts wizard from step 1; reconcile already cleaned the staging dir |

## 7. V2 roadmap

- **UC-V2-18 / PF-GAP-13** — Worker isolation for tenant code (worker-thread or subprocess sandbox per tenant). PRD §11 explicit V1 non-goal; R-7 HIGH risk.
- **Blue-green deployments.** Today rollback uses `POST /v1/deployments/:id/rollback` which demotes current live and promotes the previous row. V2 adds time-windowed canaries — a percentage of traffic routes to the new version for N minutes before full promotion.
- **Hot-reload of in-flight runs.** Today the contract is "in-flight runs complete against the old code." V2 ticket: declare per-agent whether mid-run reload is safe; for safe agents, swap the registered function pointer mid-run.
- **Marketplace + signing** (UC-V2-04). V2 vision; PRD §5.2 #6 non-goal for V1.

## 8. Acceptance tests

- `tc-agents-add-with-live-tenantcode.test.ts` — UC-V11-18 / UC-V11-28 fix.
- `tc-tenant-code-path-migration.test.ts` — V1.1 layout migration.
- `tc-cli-init-schema.test.ts` — UC-V11-19 scaffold validates.
- `tc-cli-deploy-fresh.test.ts` — UC-V11-19 fresh scaffold deploys end-to-end.
- `tc-18-manifest-import-happy.test.ts` (existing) — validate + commit + reconcile.
- `tc-manifest-import-conflict.test.ts` (existing) — 423 LOCKED.
- `tc-manifest-import-overwrite.test.ts` (existing) — 409 + confirm.
- `tc-manifest-import-rollback.test.ts` (existing) — rollback path via `/v1/deployments/:id/rollback`.
- `tc-reconcile-imports.test.ts` (existing, 24 scenarios) — all three recovery cases.
- `tc-reconcile-imports-idempotent.test.ts` (existing) — re-running is a no-op.
- `tc-rename-crash-recovery.test.ts` (existing) — fault-injected crash between phases 3+4.
- `tc-agentic-deploy.test.ts` (existing) — CLI tarball happy path.
- Playwright `e2e/import-manifest-wizard.spec.ts` (existing) — UI 6-step flow.

Coverage gates: every UC-V11-* listed has a paired failing-then-passing test per the TDD mandate in `docs/USE_CASES.md` § 6.
