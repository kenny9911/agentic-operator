# Implementation: Import Workflow Manifest

**Status:** Draft v1 · **Companions:** [PRD](../prd/import-workflow-manifest.md), [Design](../design/import-workflow-manifest.md)

## File map

### New

| Path                                                                 | Purpose                                                | LoC est. |
|----------------------------------------------------------------------|--------------------------------------------------------|----------|
| `apps/api/src/routes/v1/manifest-import.ts`                          | route: validate/commit/cancel + fetch-url + fetch-repo | ~400     |
| `apps/api/src/services/manifest-import.ts`                           | validate / commit service (pure)                       | ~500     |
| `apps/api/src/services/ssrf-guard.ts`                                | `assertSafeOutboundUrl` + redirect-safe fetch          | ~120     |
| `apps/api/src/services/reconcile-imports.ts`                         | boot-time orphan-tmp + crashed-rename recovery         | ~100     |
| `apps/api/src/queries/workflows.ts`                                  | `getLiveWorkflowMeta(tenantSlug)` single-join helper   | ~80      |
| `packages/runtime/src/lint.ts`                                       | O(N+E) cross-reference linter, 11 checks               | ~250     |
| `packages/db/migrations/0002_import_recovery.sql`                    | additive columns (expires_at, file_path) + indexes     | ~10      |
| `apps/api/test/manifest-import-validate.test.ts`                     | validate happy + 5 invalid                             | ~180     |
| `apps/api/test/manifest-import-commit.test.ts`                       | full commit + hot-swap + crash recovery                | ~200     |
| `apps/api/test/manifest-import-overwrite-guard.test.ts`              | compound threshold + 409 + confirm                     | ~150     |
| `apps/api/test/manifest-import-conflict.test.ts`                     | all 11 conflict types                                  | ~280     |
| `apps/api/test/manifest-import-concurrent.test.ts`                   | 423 on double validate, DELETE releases lock           | ~120     |
| `apps/api/test/manifest-import-ssrf.test.ts`                         | private CIDRs / metadata IP rejected                   | ~120     |
| `apps/api/test/manifest-import-fuzz.test.ts`                         | fast-check, 50 seeded runs                             | ~120     |
| `apps/api/test/manifest-import-perf.test.ts`                         | 100-agent fixture, ≤ 100 ms lint                       | ~80      |
| `apps/web/public/portal/components/import-preview-graph.jsx`         | read-only DAG for Preview step                         | ~250     |
| `apps/web/public/portal/components/overwrite-confirm-modal.jsx`      | extracted from components.jsx (per review M4)          | ~150     |
| `docs/prd/import-workflow-manifest.md`                               | this PRD (updated post-review)                         | written  |
| `docs/design/import-workflow-manifest.md`                            | this design (updated post-review)                      | written  |
| `docs/impl/import-workflow-manifest.md`                              | this doc                                               | written  |
| `docs/design/agents-os-review.md`                                    | AI software architect review (broad)                   | running  |
| `docs/audits/import-workflow-manifest-review.md`                     | Principal-engineer senior review                       | written  |

### Modified

| Path                                                  | Change                                                                |
|-------------------------------------------------------|-----------------------------------------------------------------------|
| `packages/contracts/src/workflows.ts`                 | add `ManifestImportBody`, `ManifestImportPreview`, `ManifestImportCommit`, `Issue`, `Conflict`, `ConflictResolution`. Re-export. |
| `packages/contracts/src/index.ts`                     | re-export new types                                                                              |
| `packages/db/src/schema.ts`                           | add `expiresAt` and `filePath` columns to `deployments` (no separate `importSessionId` — the `dpl-` id IS the session id, per review A2) |
| `packages/runtime/src/register.ts`                    | wire `agent.concurrency.max_concurrent_executions` into Inngest config (per review M2). Same PR. |
| `apps/api/src/bootstrap.ts`                           | call `reconcileImports(getDb())` after `bootstrapAll`                                            |
| `apps/api/src/server.ts`                              | register new manifest-import route                                                               |
| `apps/api/src/routes/v1/agents.ts`                    | thin wrapper: call `manifestImportService.commit` and re-shape the response to legacy `ManifestUploadResponse` (preserves `version` field per review M1) |
| `apps/api/src/services/inngest-registry.ts`           | `reregisterInngest({ scope:'tenant' })` filters rebuild to the named tenant only (per review P3)  |
| `apps/web/public/portal/views/import-manifest.jsx`    | replace mocks with `fetch()`; wire OverwriteConfirmModal + ImportPreviewGraph                    |
| `apps/web/public/portal/views/workflows.jsx`          | pass `tenantSlug` prop to `<ImportManifestModal>`                                                |
| `apps/web/public/portal/app.jsx`                      | pass tenant down to `<Workflows>`                                                                |
| `apps/web/public/portal/index.html`                   | script tag for `components/import-preview-graph.jsx` and `components/overwrite-confirm-modal.jsx`|
| `apps/web/lib/api-client.ts`                          | (Next.js dormant layer per CLAUDE.md) inline Zod for now; swap to `@agentic/contracts` after backend exports them |

## Service interface

```ts
// apps/api/src/services/manifest-import.ts
export interface ManifestImportService {
  validate(input: ManifestImportInput, ctx: TenantCtx): Promise<ManifestImportPreview>;
  commit(input: ManifestImportInput & { confirm: boolean }, ctx: TenantCtx): Promise<ManifestImportCommit>;
  cancel(deploymentId: string, ctx: TenantCtx): Promise<{ ok: true }>;
}
```

Two modes. `validate` runs the pipeline through lint+diff, inserts a
`deployments(status='pending', expires_at=now+1h)` row that serves as the
import session token (the `dpl-` id IS the session id — no separate column).
A second `validate` for the same tenant returns 423 with the in-flight
`deployment_id`. `commit` runs the full transaction and hot-swap per the
phased sequence in design.md. `cancel` releases the pending lock manually.

## DB migration

```sql
-- packages/db/migrations/0002_import_recovery.sql
ALTER TABLE deployments ADD COLUMN expires_at INTEGER;
ALTER TABLE deployments ADD COLUMN file_path TEXT;
CREATE INDEX IF NOT EXISTS deployments_expires_at_idx
  ON deployments(expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS deployments_file_path_idx
  ON deployments(file_path) WHERE file_path IS NOT NULL;
```

Schema file update:

```ts
// packages/db/src/schema.ts (deployments table addition)
expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
filePath: text("file_path"),
```

**No `import_session_id` column** — the deployment row's id (e.g.
`dpl-abc123`) serves as the session id end-to-end (per review A2). This
keeps the prefix convention (`dpl-` for everything deployment-related) and
removes one column from the surface.

## Boot-time recovery

In `apps/api/src/bootstrap.ts`, after `bootstrapAll`:

```ts
await reconcileImports(getDb());
```

Implementation in `apps/api/src/services/reconcile-imports.ts`:

1. **Expired pending rows:** select `deployments` where
   `status='pending' AND expires_at < Date.now()`, delete them and
   `rm -rf data/imports/<id>/`.
2. **Crashed renames:** select `deployments` where `status='live' AND
   file_path LIKE 'data/imports/%'`. For each, complete the rename to
   `models/<slug>-vN/workflow_v<N+1>.json` (where `N+1` is `pickNextWorkflowFilename()`),
   then `UPDATE deployments SET file_path = <final>` and re-register that
   tenant's Inngest functions.
3. **Missing on-disk file:** if a live deployment's `file_path` doesn't
   exist on disk, re-emit it from `workflow_versions.manifest_json` (the DB
   is the source of truth; disk is a cache).

## Lint module

```ts
// packages/runtime/src/lint.ts
export interface LintContext {
  liveWorkflow?: { agents: AgentSpec[]; emittedEvents: string[] };
  llmProviders: string[];        // gateway.listProviders()
  concurrencyMax: number;        // env RUNTIME_CONCURRENCY_MAX || 8
  removedKebabIds?: Set<string>; // computed from diff; subflow checks need it
}

export function lint(manifest: AgentSpec[], ctx: LintContext): {
  issues: Issue[];
  conflicts: Conflict[];
};
```

**Complexity invariant:** all checks must be O(N + E) where N is agent count
and E is event-edge count. Build sets/maps once; never nested-loop the
manifest. `manifest-import-perf.test.ts` enforces ≤ 100 ms on a 100-agent
fixture.

**Checks (11):**

1. `kebabId` uniqueness within manifest → issue `code='duplicate_kebab_id'`
2. `kebabId` collision with live agent of different id → conflict
   `kebab_id_collision`, auto-fix: append `-imported-<rand4>` suffix
3. Every `trigger` is emitted by some agent (manifest or live) → conflict
   `dangling_trigger`, auto-fix: drop the trigger
4. Every `triggered_event[i]` is consumed by something (manifest or live
   survivor) → conflict `dangling_emitter` (warn only)
5. `subflow` target exists in manifest **and not in removedKebabIds** →
   conflict `broken_subflow`, no auto-fix (would require manifest-edit UI)
6. Every `model` is a configured provider (from `llmProviders`) → conflict
   `model_not_configured`, auto-fix: clear the model
7. `concurrency.max_concurrent_executions ≤ concurrencyMax` → conflict
   `concurrency_excess`, auto-fix: clamp. **Requires** `register.ts:74`
   to read this field; same-PR fix is mandatory per review M2
8. `actor='Human'` agent has a `tool_use` of kind `taskDefinition` OR an
   action `type='manual'` → conflict `orphan_actor`, no auto-fix
9. `cron` strings parse as IANA cron (use `cron-parser`) → conflict
   `invalid_cron`, no auto-fix
10. `kebabId` same as live agent but `id` field differs → conflict
    `silent_rename` (warn only)
11. `ontology_instructions ≤ 16 KB`, `typescript_code ≤ 64 KB`, no high-
    entropy or `/ignore previous/i` patterns → conflict
    `prompt_injection_smell` (warn only)

Cycle detection in `triggered_event[0]` lives separately as a structural
issue (`code='trigger_cycle'`) — Tarjan over the in-manifest emit graph.

## Test contract

Vitest tests share a known-good manifest fixture at
`apps/api/test/fixtures/manifests/`. Required fixtures:

- `happy-v1.json` — bare 5-agent v1 manifest
- `happy-v2.json` — `{$schemaVersion:2, agents:[...]}`-wrapped, 5-agent
- `bad-syntax.json` — invalid JSON
- `missing-actor.json` — agent missing actor field
- `dangling-trigger.json` — agent triggers on undefined event
- `kebab-collision-with-live.json` — assumes test seeded RAAS workflow live
- `concurrency-excess.json` — max_concurrent_executions: 999
- `model-not-configured.json` — model: 'unicorn-3-ultra'

`apps/api/test/setup.ts` already seeds the `__system` test tenant; tests
configure `AGENTIC_DEV_TENANT=__system` per the convention.

## Frontend changes — concrete

`apps/web/public/portal/views/import-manifest.jsx` rewires:

```jsx
async function callValidate() {
  const res = await fetch(`/v1/tenants/${tenant.slug}/manifest-import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'validate', workflow, actions }),
  });
  const body = await res.json();
  setValidation(body);
}

async function callCommit({ confirmOverwrite }) {
  const res = await fetch(`/v1/tenants/${tenant.slug}/manifest-import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: 'commit', workflow, actions, target,
      conflict_resolutions: resolutions,
      confirm_overwrite: confirmOverwrite || false,
      import_session_id: sessionId,
    }),
  });
  if (res.status === 409) {
    const body = await res.json();
    setOverwriteRequired(body);
    return;
  }
  if (!res.ok) { setCommitError(await res.text()); return; }
  onClose();
  window.refreshWorkflowsView?.();
}
```

`OverwriteConfirmModal` props:

```jsx
{
  diff: { added, removed, modified, prior_version },
  conflicts: Conflict[],
  onConfirm: () => void,
  onCancel: () => void,
}
```

## API client additions

```ts
// apps/web/lib/api-client.ts
export const manifest = {
  import: (slug: string, body: ManifestImportBody) =>
    call(ManifestImportPreview.or(ManifestImportCommit),
         `/v1/tenants/${slug}/manifest-import`, {
           method: 'POST', body: JSON.stringify(body),
         }),
  fetchUrl: (slug: string, url: string) =>
    call(z.object({ workflow: z.unknown(), actions: z.array(z.unknown()).optional() }),
         `/v1/tenants/${slug}/manifest-import/fetch-url`, {
           method: 'POST', body: JSON.stringify({ url }),
         }),
};
```

## Rollback story

Migration is additive (two nullable columns + indexes). No down-migration
needed; we never delete a workflow_version or deployment row.

Operational rollback: existing `POST /v1/deployments/:id/rollback` already
flips the live pointer and calls `reregisterInngest`. The new endpoint
piggybacks on the same code path.

## Performance bounds

- 20-agent v2 manifest validates in **< 80 ms** (server-side, warm SQLite).
- Commit transaction: **< 200 ms** for 20 agents on local SQLite.
- Hot-swap (Inngest re-register): **< 250 ms**.
- End-to-end commit budget: **< 500 ms** P95.

`fetch-url` cap: **5 MB**, content-type allow-list, **5 s** timeout.

## Observability

Append-only NDJSON log per import at
`data/logs/<tenant>/imports/<YYYY-MM-DD>.ndjson`. Each mode call writes one
line with `{ts, session_id, mode, result, elapsed_ms, agents, issues, conflicts}`.

`WORKFLOW_DEPLOYED` event ledger row on commit. No Inngest function is
triggered by it; downstream tools can subscribe via the existing event ledger.

## Sequence diagram (commit)

```
SPA           api route             manifest-import service        db        disk        inngest-registry
 │ POST commit │                       │                            │           │              │
 │────────────▶│                       │                            │           │              │
 │             │ ctx = req.auth        │                            │           │              │
 │             │──────────────────────▶│ commit(input, ctx)         │           │              │
 │             │                       │ migrate + parse + lint     │           │              │
 │             │                       │ diff vs live               │           │              │
 │             │                       │ overwrite_guard?           │           │              │
 │             │                       │   if 409 → return          │           │              │
 │             │                       │ BEGIN TX                   │           │              │
 │             │                       │──────────────────────────▶│           │              │
 │             │                       │   demote live              │           │              │
 │             │                       │   upsert workflow_versions │           │              │
 │             │                       │   upsert agents+versions   │           │              │
 │             │                       │   replace event_listeners  │           │              │
 │             │                       │ COMMIT TX                  │           │              │
 │             │                       │◀──────────────────────────│           │              │
 │             │                       │ write workflow_vN+1.json   │           │              │
 │             │                       │──────────────────────────────────────▶│              │
 │             │                       │ reregisterInngest(slug)    │           │              │
 │             │                       │─────────────────────────────────────────────────────▶│
 │             │                       │◀ fns_count                  │           │              │
 │             │ {ok, deployment_id..} │                            │           │              │
 │◀────────────│                       │                            │           │              │
```

## Concrete code anchor points

| Hook                                          | Anchor                                                            |
|-----------------------------------------------|-------------------------------------------------------------------|
| Find live workflow_version + deployment       | `apps/api/src/queries/runs.ts` (extract `findLiveWorkflowVersion`)|
| Diff manifests                                | `apps/api/src/routes/v1/agents.ts:216-219` (extract `diffManifests`) |
| Insert workflow_version + per-agent rows      | `apps/api/src/routes/v1/agents.ts:223-296` (refactor into service) |
| Demote + insert deployment                    | `apps/api/src/routes/v1/agents.ts:300-323`                        |
| Hot-swap                                      | `apps/api/src/routes/v1/agents.ts:328-338` (calls `reregisterInngest`) |
| Pick next on-disk filename                    | `apps/api/src/routes/v1/workflow.ts:92-108` (`pickNextWorkflowFilename`) |
| Boot-time tenant load                         | `apps/api/src/bootstrap.ts:131-201`                               |

## Acceptance

The implementation is done when:

1. All 8 vitest files green: validate, commit, overwrite-guard, conflict (all
   11 types), concurrent (423 + DELETE), ssrf (private CIDR rejection), fuzz
   (fast-check, seeded), perf (100-agent ≤ 100 ms).
2. The SPA wizard goes 1→6 end-to-end against a real api: validates, diffs,
   resolves a conflict, previews the DAG, and commits a `happy-v2.json`
   manifest into the `__system` tenant.
3. Re-running the wizard on the same tenant trips the compound overwrite
   guard (per PRD §"Overwrite guard") and the SPA renders the
   `OverwriteConfirmModal` with the prior version label.
4. After commit, the workflows view shows the new agent set without a page
   refresh.
5. `reconcileImports` recovers state when the api is killed mid-commit
   (between phases 3 and 4) — covered by a kill-and-restart test in
   `manifest-import-commit.test.ts`.
6. `pnpm lint && pnpm typecheck && pnpm test` all pass.
7. **Field rename alignment:** SPA, contracts, and backend all use `channel`
   (renamed from `target` per review C8). If the frontend ships with `target`,
   add a same-PR rename in `apps/web/public/portal/views/import-manifest.jsx`
   and `apps/web/lib/api-client.ts`.
