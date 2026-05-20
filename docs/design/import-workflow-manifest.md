# Design: Import Workflow Manifest

**Status:** Draft v1 · **Companion:** [PRD](../prd/import-workflow-manifest.md)

## Surface area

One new HTTP endpoint with two modes (the `stage` mode from an earlier draft
was dropped per principal-engineer review C3; the staging file added no
durability above what the DB already provides):

```
POST /v1/tenants/:slug/manifest-import   ?confirm=1
```

Modes via `body.mode`:

- `validate` — dry-run. Parse + lint + diff. No DB or disk writes. **Inserts
  a `deployments(status='pending', expires_at=now+1h)` lock row** so a parallel
  operator's second `validate` returns 423 with the in-flight `deployment_id`.
  The pending row's `id` IS the import session id (no separate `imp-` prefix).
- `commit` — promote the manifest to `live`. Demote prior live. Write the
  manifest into the tenant's models folder. Hot-swap Inngest. Requires
  `?confirm=1` on the query string when the overwrite guard trips.

Auxiliary endpoints:

```
POST   /v1/tenants/:slug/manifest-import/fetch-url     { url }
POST   /v1/tenants/:slug/manifest-import/fetch-repo    { repo, ref?, path? }
DELETE /v1/tenants/:slug/manifest-import/:deployment_id
```

`fetch-url` server-side fetches a remote URL with the SSRF protocol below.
`fetch-repo` is **501 in v1** (still requires auth — the slug existence must
not leak). `DELETE` manually releases the pending lock if an operator
abandons a wizard mid-flow.

### SSRF protocol for `fetch-url`

```ts
async function assertSafeOutboundUrl(raw: string) {
  const u = new URL(raw);
  // 1. https-only, except localhost with explicit dev opt-in
  if (u.protocol !== 'https:' &&
      !(process.env.AGENTIC_FETCH_ALLOW_HTTP_LOCALHOST === '1' &&
        u.protocol === 'http:' && u.hostname === 'localhost')) {
    throw new SsrfError('https_only');
  }
  // 2. DNS-resolve, then reject by IP
  const { address } = await dns.promises.lookup(u.hostname, { family: 0 });
  if (isPrivate(address) || isLoopback(address) ||
      isLinkLocal(address) || address === '169.254.169.254' /* AWS metadata */ ||
      address.startsWith('fd00:') /* IPv6 ULA */) {
    throw new SsrfError('blocked_target');
  }
}
```

Call `assertSafeOutboundUrl` before the fetch **and on every redirect
Location**. Use `fetch(url, { redirect: 'manual' })`, follow up to 3 hops,
re-validate each Location. Stream-count body bytes (`for await (chunk of
res.body)`) and abort on > 5 MB. Validate content-type before AND after the
body (some servers lie). 5 s connect timeout, 5 s body timeout. Reject all
non-http(s) schemes.

### Auth contract

Every endpoint above runs `requireAuth(req)` **before** any body parse,
**before** the 501 in `fetch-repo`, and asserts `auth.tenantSlug ===
req.params.slug` (403 on mismatch). This pattern mirrors
`apps/api/src/routes/v1/workflow.ts:171`.

## Request and response schemas

The Zod definitions live in `packages/contracts/src/workflows.ts`. New types:

```ts
// Request
const ManifestImportBody = z.object({
  mode: z.enum(["validate", "commit"]),
  workflow: z.unknown(),                       // raw input, pre-migrate
  actions: z.array(z.unknown()).optional(),
  target: z.enum(["staging", "production"]).default("production"),
  // `target` is recorded on the deployment row but is cosmetic in v1
  // (no separate staging Inngest namespace yet). UI labels it "Target" with a tooltip "v1: cosmetic, future: shadow runtime".
  deployment_id: z.string().optional(),        // pending row id from prior validate
  note: z.string().max(500).optional(),
  conflict_resolutions: z.array(ConflictResolution).default([]),
});
// confirm_overwrite is passed as query string `?confirm=1`, not body.

// Issue surfaced at validate
const Issue = z.object({
  path: z.string(),                            // JSON pointer
  message: z.string(),
  severity: z.enum(["error", "warning", "info"]),
  code: z.string(),                            // machine-readable
});

// Conflict surfaced at validate (auto-fixable kind of issue)
const Conflict = z.object({
  path: z.string(),
  type: z.enum([
    "kebab_id_collision",
    "dangling_trigger",            // listens to event with no upstream emitter
    "dangling_emitter",            // emits event nothing listens to (warn only)
    "orphan_actor",                // actor=Human but no taskDefinition
    "model_not_configured",
    "concurrency_excess",
    "schema_version_downgrade",
    "invalid_cron",                // cron string fails parse
    "silent_rename",               // kebab_id same, id field changed
    "broken_subflow",              // subflow target absent or being removed
    "prompt_injection_smell",      // ontology_instructions / typescript_code triggers heuristic
  ]),
  severity: z.enum(["block", "warn"]),
  detail: z.string(),
  suggestion: z.string().optional(),
  auto_fix: ConflictResolution.optional(),
});

const ConflictResolution = z.object({
  path: z.string(),
  action: z.enum(["accept_suggestion", "skip", "override"]),
  override_value: z.unknown().optional(),
});

// Response (validate)
const ManifestImportPreview = z.object({
  ok: z.boolean(),
  schema_version: z.number(),
  parsed: z.object({
    agents: z.number(),
    events: z.number(),
    actions: z.number(),
  }),
  issues: z.array(Issue),
  conflicts: z.array(Conflict),
  diff: ManifestDiff,                          // reused; added/removed/modified
  prior: z.object({
    version: z.string().nullable(),
    version_label: z.string().nullable(),       // e.g. "raas@2026.05.18-v3"
    deployed_at: z.number().nullable(),         // unix ms
    agents: z.number(),
    live_deployment_id: z.string().nullable(),
  }),
  deployment_id: z.string(),                   // pending row id, becomes session token
  elapsed_ms: z.number(),
});

// Response (commit) — also includes back-compat `version` field so the
// thin `POST /v1/agents` wrapper preserves its legacy response shape.
const ManifestImportCommit = z.object({
  ok: z.literal(true),
  workflow_version_id: z.string(),
  version: z.string(),                         // preserved for back-compat (M1)
  deployment_id: z.string(),
  target: z.enum(["staging", "production"]),
  inngest_fns_registered: z.number(),
  file_written: z.string(),
  prior_deployment_id: z.string().nullable(),
  note: z.string(),
  elapsed_ms: z.number(),
});

// Error envelope for the overwrite guard (HTTP 409)
const ManifestImportOverwriteRequired = z.object({
  ok: z.literal(false),
  requires_confirmation: z.literal(true),
  reason: z.enum(["removes_agents", "modifies_threshold"]),
  diff: ManifestDiff,
  conflicts: z.array(Conflict),
});
```

## Validation pipeline

`manifestImportService.validate(rawInput, ctx)` runs:

1. `migrate(rawInput)` from `packages/runtime/src/migrations/index.ts` — turns
   any wire schema version into the current internal form.
2. `WorkflowManifestSchema.safeParse(migrated)` — structural check.
3. `ActionsManifestSchema.safeParse(actions)` — if actions present.
4. `lint(migrated, { liveWorkflow, llmProviders, concurrencyMax })` — new
   module at `packages/runtime/src/lint.ts`. **All checks must be O(N + E)**
   where N is agent count and E is event-edge count; build a `Set<string>`
   for kebab IDs, a `Map<eventName, Agent[]>` for emitter→listener lookups,
   and run Tarjan's algorithm for cycle detection. A perf test in
   `manifest-import-perf.test.ts` asserts ≤ 100 ms on a 100-agent fixture
   (P2 from review).

   Cross-reference checks (per review C4):
   - every `trigger` is emitted by another agent in the manifest **or** the
     live workflow. Otherwise → `dangling_trigger`.
   - every `triggered_event[i]` is consumed by **either** another in-manifest
     agent or a live agent that survives the import. Otherwise →
     `dangling_emitter` (warn only — emitting an unobserved event is legal).
   - every `actor='Human'` agent has a `taskDefinition` tool in `tool_use[]`
     or an action of `type='manual'` → `orphan_actor`.
   - every `model` value either matches a configured gateway provider
     (`gateway.listProviders()` injected via ctx) or is absent → `model_not_configured`.
   - every `concurrency.max_concurrent_executions` ≤ `concurrencyMax` →
     `concurrency_excess`. **Important** (M2): this only fires once
     `register.ts:74` is updated to *read* `agent.concurrency.max_concurrent_executions`
     instead of hardcoding 8. The same PR must do both or the check is checking
     dead config.
   - every `kebabId` is unique within the manifest **and**, if it collides
     with a live agent of a *different* `id`, → `kebab_id_collision`.
   - every `cron` string parses as IANA cron → `invalid_cron`.
   - every `subflow` target exists in the manifest **and** is not on the
     removed list → `broken_subflow`.
   - rename detection: same `kebabId`, different `id` field → `silent_rename`
     (warn only; the operator may have intentionally renamed).
   - `ontology_instructions` and `typescript_code` length ≤ 16 KB / 64 KB
     respectively, and don't match prompt-injection heuristic patterns
     (`/ignore previous/i`, `/system:/i`, high-entropy base64 blobs > 200
     chars) → `prompt_injection_smell` (warn only; per review S3).
5. `diffAgainstLive(migrated, ctx)` — re-uses the diff logic at
   `apps/api/src/queries/runs.ts` (extracted into a shared module). Backed
   by a single-query helper `getLiveWorkflowMeta(tenantSlug)` at
   `apps/api/src/queries/workflows.ts` returning
   `{workflowVersionId, manifestJson, agents, emittedEvents}` in one join
   (per review P1).

## Conflict resolution flow

The validate response carries `conflicts: Conflict[]`. The SPA Resolve step
groups them by `type` and renders cards with the suggested auto-fix. The
operator chooses `accept_suggestion`, `skip`, or `override`. The resolved set
is shipped back inside `conflict_resolutions` on `stage` and `commit`.

The server applies the resolutions after `migrate()` and before persistence.
If any `severity='block'` conflict is unresolved at commit time, the server
returns `400 { issues: [...] }`.

## Storage strategy

### DB

Existing `deployments.status` already allows `'pending'`. **No new id column**
— the deployment row's own id IS the import session id (per review A2,
matching the `dpl-` prefix convention). Two columns added for lifecycle and
recovery:

```sql
ALTER TABLE deployments ADD COLUMN expires_at INTEGER;
ALTER TABLE deployments ADD COLUMN file_path TEXT;
CREATE INDEX deployments_expires_at_idx
  ON deployments(expires_at) WHERE status = 'pending';
CREATE INDEX deployments_file_path_idx
  ON deployments(file_path) WHERE file_path IS NOT NULL;
```

`expires_at` is `now + 1h` for pending rows. `file_path` records the on-disk
location of the manifest — points at `data/imports/<deployment_id>/workflow.json`
between phases 3 and 4 of commit, then is updated to the canonical
`models/<slug>-vN/workflow_v<N+1>.json` after rename in phase 4.

### Disk

- Validate: writes to `data/imports/<deployment_id>/workflow.json` + fsync.
  This is the tmp staging file that becomes the canonical version on commit.
- Commit: the canonical file lands under `models/<slug>-v<folder>/workflow_v<N+1>.json`
  via atomic `rename()` from the tmp path. Filename suffix is `<N+1>` where
  `N` is the highest existing version in that folder; we *never* overwrite,
  ensuring on-disk rollback is always possible.
- A `O_CREAT|O_EXCL` open guards against the unlikely race where two
  near-simultaneous commits both compute `<N+1>` (C7); on EEXIST the service
  re-derives `<N+1>` and retries once.

## Commit transaction sequence (fixed per C1 BLOCKER)

The earlier draft inverted the durability guarantee: it committed the DB tx
**before** writing the on-disk manifest, but `bootstrap.ts:103-106` rebuilds
Inngest functions from `composeTenantRegistries()` which reads from disk via
the dynamic loader (`packages/runtime/src/tenant-loader.ts:132-150`). A crash
between DB commit and disk write would leave the DB saying "new version live"
while every boot thereafter loaded the **old** on-disk manifest. The fix:
write to a tmp file, fsync, commit the tx (whose deployment row records the
tmp path), then atomically `rename()` into place.

```
manifestImportService.commit({ slug, deployment_id, resolutions, ctx, confirm }):

  PHASE 1 — preflight (no IO)
    1. migrate + parse + lint + diff (pure)
    2. apply conflict_resolutions
    3. overwrite_guard(diff, prior) → if trips AND !confirm → throw 409

  PHASE 2 — tmp file
    4. mkdir data/imports/<deployment_id>/
    5. write data/imports/<deployment_id>/workflow.json     (writeFile + fsync)
    6. write data/imports/<deployment_id>/actions.json      (if present + fsync)

  PHASE 3 — atomic DB tx                                    (better-sqlite3)
    7. SELECT live deployment FOR UPDATE
    8. UPDATE live.status = 'rolled_back', note ||= 'auto: superseded by <new id>'
    9. UPSERT workflow_versions(id, manifestJson, actionsJson, version_label)
   10. UPSERT deployments(id=<deployment_id>, status='live', target,
                          expires_at=NULL, file_path=<tmp path>,
                          note=<note>)
   11. UPSERT agents rows by (workflow_id, kebab_id)
   12. INSERT agent_versions rows for this workflow_version_id
   13. REPLACE event_listeners for affected agents
   14. INSERT audit_log row (action='manifest.import.commit', see Observability)
                                                            COMMIT

  PHASE 4 — atomic rename + hot-swap
   15. fs.rename(data/imports/<deployment_id>/workflow.json,
                 models/<slug>-vN/workflow_v<N+1>.json)     (POSIX atomic)
   16. fs.rename(.../actions.json, .../actions_v<N+1>.json) (if present)
   17. UPDATE deployments SET file_path = <final path> WHERE id = <deployment_id>
   18. reregisterInngest({ tenantSlug, scope: 'tenant' })   (P3: filter to slug only)
   19. return ManifestImportCommit
```

### Crash recovery (`reconcileImports`)

On api boot, after `bootstrapAll`, run `reconcileImports(getDb())`:

- `status='pending'` AND `expires_at < now()` → drop row + `rm -rf data/imports/<id>/`
- `status='live'` AND `file_path LIKE 'data/imports/%'` → the rename in step
  15 didn't happen; redo step 15 + 18.
- `status='live'` AND target file missing on disk → re-emit from
  `workflow_versions.manifest_json` (the DB is the source of truth; disk is a
  cache).

This makes phases 3 and 4 jointly recoverable.

### Failure modes

| Failed step      | DB state                   | Disk state         | Recovery                                      |
|------------------|----------------------------|--------------------|-----------------------------------------------|
| 4–6 (tmp)        | unchanged                  | partial tmp        | discard tmp dir, return 500                   |
| 7–14 (tx)        | unchanged (tx rolled back) | tmp present        | discard tmp dir, return 500                   |
| 15–16 (rename)   | tx committed               | tmp present        | `reconcileImports` completes rename on boot   |
| 18 (re-register) | committed, file present    | runtime stale      | `audit_log` row `manifest.import.fail_swap`; next boot reads from disk and re-registers; operator can call `POST /v1/deployments/:id/retry-hot-swap` for immediate retry |

## SPA wiring

File: `apps/web/public/portal/views/import-manifest.jsx`. The scaffold is
already there. The rewire:

```jsx
const wizardState = {
  step, source: { kind, workflow, actions },
  validation,                              // ManifestImportPreview
  resolutions,                             // ConflictResolution[]
  target,                                 // 'staging' | 'production' (renamed from target)
  deploymentId,                            // dpl- session id, returned from validate
  overwriteRequired,                       // 409 response if guard tripped
  previewTab,                              // 'graph' | 'actions' | 'raw'
};
```

Step transitions:

```
1 → 2: client gathers manifest. If kind='url', POST /fetch-url; else read file.
2 → 3: POST /manifest-import { mode: 'validate', workflow, actions }
       → store validation + deploymentId.
       → on 423: show ResumeOrCancelBanner with the in-flight deployment_id.
       → if validation.ok === false → stay on step 2 with issues panel.
3:     read diff from validation.
4:     local mutation of resolutions[] based on validation.conflicts;
       block-severity conflicts require non-skip resolution before continue.
5:     tabbed: [Graph | Actions JSON | Raw manifest]. Graph renders DAG via
       ImportPreviewGraph. Actions + Raw render in Monaco read-only mode
       (so operators can sanity-check prompts before deploy — per review U1).
6:     POST /manifest-import?confirm=0 { mode: 'commit', workflow, actions,
       target, conflict_resolutions, deployment_id }
       on 409: show OverwriteConfirmModal with prior version label +
       deployed-at; on confirm, re-submit with ?confirm=1.
       confirm_overwrite=true.
       on 200: close wizard, toast "Deployed to <target>",
               trigger workflows view reload.
```

The preview graph is a new component at
`apps/web/public/portal/components/import-preview-graph.jsx`. It re-uses the
SVG layout from `views/workflows.jsx` but is read-only and accepts the
migrated manifest as a prop. Stage assignment uses a topological sort over the
trigger/emit graph; nodes per stage are laid out in a single lane.

## Per-step contracts

| Step      | Frontend reads from              | Backend touches                                                                  |
|-----------|----------------------------------|----------------------------------------------------------------------------------|
| SOURCE    | local files / fetch-url result   | only `/fetch-url` server-side fetch (SSRF-guarded)                               |
| VALIDATE  | `validation.ok / issues / parsed`| migrate + Zod parse + lint + insert pending `deployments` row (the lock)         |
| DIFF      | `validation.diff`                | none (computed at validate)                                                      |
| RESOLVE   | `validation.conflicts`           | none (resolutions kept client-side)                                              |
| PREVIEW   | migrated manifest                | none — UI optionally toggles a Monaco viewer for `actions.json` and raw manifest |
| DEPLOY    | commit response or 409           | full commit tx (above)                                                           |

## Wizard back-navigation

- Stepping back from DIFF/RESOLVE/PREVIEW to SOURCE clears `validation` and
  `resolutions` (the old pending deployment is auto-cancelled via the
  `DELETE` endpoint).
- Stepping back from DEPLOY to RESOLVE preserves `validation` and
  `resolutions`.
- The wizard guarantees at most one pending `deployments` row per tenant at a
  time; opening the wizard fresh while one exists offers "Resume" (load the
  pending) or "Cancel and start over" (DELETE + restart).

## Reuse

- `apps/api/src/routes/v1/agents.ts:164-355` already has 70% of the commit
  path (diff, version-row insert, deployments demote, Inngest re-register).
  The new endpoint extracts that logic into
  `apps/api/src/services/manifest-import.ts`, and the existing
  `POST /v1/agents` becomes a thin wrapper that calls `commit` directly (for
  back-compat with any agents-sdk clients).
- `apps/web/public/portal/views/import-manifest.jsx` already renders the 6
  step dots, file dropzone, Monaco editor for paste, the diff cards, and a
  mini-graph. We replace the `setTimeout` mocks with real `fetch()` calls and
  add the OverwriteConfirmModal.
- `apps/web/public/portal/components.jsx` gets one new component:
  `OverwriteConfirmModal`. Attached to `window.OverwriteConfirmModal`.

## Observability

**Audit ledger (authoritative):** every validate and commit writes one row
to `audit_log` via the existing `writeAudit()` helper at
`apps/api/src/plugins/audit.ts:13`. Mirrors the rollback path pattern at
`apps/api/src/routes/v1/deployments.ts:78`.

```ts
writeAudit(req, {
  action: 'manifest.import.commit',         // or .validate / .cancel / .fail_swap
  target_type: 'workflow_version',
  target_id: workflow_version_id,
  meta_json: {
    deployment_id,
    prior_deployment_id,
    prior_version,
    new_version,
    diff,                                   // full ManifestDiff
    conflicts_resolved: resolutions,
    file_path,
    inngest_fns_registered,
    elapsed_ms,
    target,
  },
});
```

`WORKFLOW_DEPLOYED` is **not** written to the `events` table (per review O1).
That table is the Inngest event ledger; rows there route through
`event_listeners` (`packages/runtime/src/register.ts:386-397`) and would
create a feedback loop if any agent triggers on `WORKFLOW_DEPLOYED`.

**Failure alerts:** the disk-write and hot-swap failure paths emit
`audit_log` rows with `action='manifest.import.fail_swap'` plus `meta_json`
carrying the error. `req.log.error` emits at ERROR level for the SRE log
pipeline. There is no separate Sentry / Slack hook in this codebase; the
audit log IS the alert surface (per review O2). Operators can query
`GET /v1/audit-log?action=manifest.import.%` to enumerate.

**Operator-visible history:** `GET /v1/tenants/:slug/imports?limit=50` reads
recent `audit_log` rows where `action LIKE 'manifest.import.%'` (no NDJSON
duplicate per review O4). The SPA logs view gets an "Imports" tab that
renders this list.

## Route consolidation note (per review A1)

The new `/v1/tenants/:slug/manifest-import` route family duplicates much of
`POST /v1/agents`. Two viable shapes:

- **(a)** Extend `POST /v1/agents` with `?mode=validate|commit` and serve the
  legacy response shape only when mode is unset. Fewer routes, fewer Zod
  schemas, shared auth check.
- **(b)** Keep both. `POST /v1/agents` becomes a thin wrapper that calls
  `manifestImportService.commit(...)` and re-shapes the response to the
  legacy `ManifestUploadResponse` for back-compat with any agents-sdk client.

The v1 implementation picks **(b)** because the SPA scaffold is already
wired to a separate URL family and we don't want to retrofit the legacy
endpoint mid-feature. The mapping is documented in §Reuse. A future cleanup
ticket can consolidate.

## Out of scope

- Diff for `actions.json`. We diff agents only in v1.
- Rolling deploys (partial agent set updates). Whole-manifest replace only.
- Webhook signatures on `fetch-url`.
- Sandbox-only validation. The `target` field (renamed from `target` per
  review C8) is recorded on the deployment row for downstream tools but
  does not change runtime behaviour in v1. The SPA labels it with
  a tooltip "v1: cosmetic, future: shadow runtime". The staging button is
  visible but submits the same code path as production.
- Property-based fuzz testing beyond the seeded fast-check suite.
- Per-URL fetch auth (no `headers` field on `fetch-url`). Deferred to v2 per
  review S4.
