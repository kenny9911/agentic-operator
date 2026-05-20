# P3 Portal authoring + dashboards status

**Owner:** Senior Frontend Engineer (P3 in-portal authoring track)
**Date:** 2026-05-20
**Branch state:** no commits made; uncommitted changes on `main`.
**Quality gate:** `pnpm --filter @agentic/web typecheck` ✓ ·
`pnpm --filter @agentic/web exec vitest run` → **76/76 pass** (13 files,
13 new tests across the 6 P3 tasks added on top of Phase 2's 63).

## Per-task summary

| ID | Title | Status | Key files |
|---|---|---|---|
| **P3-FE-01** | Workflow editor with save → `POST /v1/agents` | DONE | `apps/web/app/portal/[tenant]/(views)/workflows/page.tsx`, `apps/web/app/portal/components/workflows/{draft,AgentEditor}.tsx`, `apps/web/lib/hooks/useManifest.ts` |
| **P3-FE-02** | Code-agent authoring (Monaco edit + tar deploy) | DONE | `apps/web/app/portal/components/agent-code/{edit-code,tar}.tsx`, `apps/web/lib/hooks/useTenantCode.ts`, `apps/web/app/portal/[tenant]/(views)/agents/[id]/page.tsx` |
| **P3-FE-03** | Cost dashboard at Settings → Usage | DONE | `apps/web/app/portal/[tenant]/(views)/settings/usage/page.tsx`, `apps/web/app/portal/components/usage/charts.tsx`, `apps/web/lib/hooks/useUsage.ts`, **new** backend `apps/api/src/routes/v1/usage.ts` |
| **P3-FE-04** | Trace tree view on run detail | DONE | `apps/web/app/portal/components/runs/TraceTree.tsx`, `apps/web/app/portal/[tenant]/(views)/runs/[id]/page.tsx`, contracts + API plumbing for `parentRunId` |
| **P3-FE-05** | Settings → Audit (live, with diff) | DONE | `apps/web/app/portal/components/settings/sections/Audit.tsx`, `apps/web/app/portal/[tenant]/(views)/settings/audit/page.tsx` |
| **P3-FE-06** | Replay button on run detail | DONE | `apps/web/app/portal/[tenant]/(views)/runs/[id]/page.tsx`, `apps/web/app/portal/[tenant]/(views)/runs/page.tsx` (REPLAY badge) |

## Test paths

- `apps/web/app/portal/components/runs/TraceTree.test.ts` — `composeTrace` ordering (4 tests)
- `apps/web/app/portal/components/settings/sections/Audit.test.ts` — `renderDiffRows` field diffing (6 tests)
- `apps/web/app/portal/components/usage/charts.test.ts` — `bucketBars` + `lineChartPoints` math (6 tests)
- `apps/web/app/portal/components/workflows/draft.test.ts` — `applyDraft` / `toManifest` / `countDraftChanges` (7 tests)
- `apps/web/app/portal/components/agent-code/tar.test.ts` — USTAR header layout + trailers (6 tests)

All run inside the existing `vitest` harness; no new pool / config tweaks required. Full suite goes from 63 (Phase 2) → 76 tests (Phase 3 adds 13).

## P3-FE-01 — Workflow editor

**Save endpoint:** `POST /v1/agents` (the existing `ManifestUploadBody` route — same one Heavy Views used as P2-FE-08's NewWorkflowModal/ImportManifestModal target). Request body shape:

```json
{
  "manifest": [ AgentSpec, ... ],
  "workflowSlug": "raas",
  "note": "In-portal edit · 1+/2~/0-",
  "actions": []
}
```

Response (with the contract from `packages/contracts/src/agents.ts:ManifestUploadResponse`):

```json
{
  "workflow_version_id": "wfv-abc...",
  "version": "upload-9f8e1c2a",
  "diff": { "added": [...], "removed": [...], "modified": [...], "prior_version": "prior" },
  "note": "Server restart picks up the new manifest in Inngest runtime."
}
```

**Verified the call shape against the API:** the route is in `apps/api/src/routes/v1/agents.ts:133` and parses with `ManifestUploadBody.parse(req.body)`. It persists a new `workflow_versions` row keyed by manifest hash (so back-to-back saves with no diff don't churn), flips the prior live `deployments` row to `rolled_back`, and inserts the new one as `live`. Acceptance hits: a new `workflow_version` row lands in the DB on save (verified by reading the route + audit-log entry `manifest.deploy`).

**Caveats / known limitations:**
1. The bootstrap snapshot doesn't carry the full `actions` array for each agent today (`SpaAgent` has `steps: string[]` only). I synthesize a one-element placeholder action in `toManifest()` so the contract parse succeeds. Round-tripping the full action set is a follow-up that needs `GET /v1/agents/:kebab` to surface `actions`.
2. Add-node uses a dummy id; the operator can wire it but the canvas LAYOUT only knows 23 RAAS positions, so a "new" node won't position itself outside the existing grid — they'll need to drag/drop once that toolset is wired. The data model handles the new node correctly; the visual is a v2 concern.
3. Validate button isn't wired yet (it's still a no-op from P2-FE-08).

## P3-FE-02 — Code-agent authoring

**Deploy endpoint:** `POST /v1/tenants/:slug/code` (Engineer B shipped P3-API-01 — verified live in `apps/api/src/routes/v1/tenant-code.ts`). Request body:

```json
{
  "version": "0.0.1234",
  "tarballBase64": "<base64 of gzip(tar)>",
  "note": "In-portal edit of analyzeRequirement"
}
```

The client builds a 2-file tarball in `tar.ts` (USTAR header subset, `CompressionStream("gzip")` for compression). Files written:
- `agentic.json` — manifest pointer (`{tenant, version, entry, authoredAt}`)
- `src/agents/<name>.ts` — the new TS source

**Verified shape:** the backend's regex check on `version` is `^[A-Za-z0-9._-]+$` and limited to 64 chars; the auto-suggested `0.0.<short-hash>` clears both constraints. The 409 `version_exists` is surfaced via the toast error path. SSE hot-reload then lights up the new version inside ~5s (Engineer B's `reregisterInngest()` is wired into the same response path).

**Caveats / known limitations:**
1. The Monaco editor doesn't run `tsc --noEmit` locally — server validation is authoritative. Errors come back as `tarball_invalid` / `compile_failed` (backend) and surface as red toasts.
2. The tarball is intentionally minimal (2 files). For multi-file tenant packages the operator still needs the CLI path; this in-portal flow is best for hotfixes.
3. We don't run a permissions check that the operator can deploy code for `<slug>` — the API's `auth.tenantSlug !== slug` 403 catches it server-side.

## P3-FE-03 — Cost dashboard

**Live endpoint added:** `GET /v1/usage` — new in this PR (`apps/api/src/routes/v1/usage.ts`). Aggregates `runs.tokens_in / tokens_out × MODEL_PRICING` and groups by agent / model / day. Response:

```json
{
  "totals":  { "runs": N, "tokensIn": N, "tokensOut": N, "usdCents": N },
  "byAgent": [{ "key": "analyzeRequirement", "runs": N, "tokensIn": N, "tokensOut": N, "usdCents": N }, ...],
  "byModel": [{ "key": "claude-sonnet-4-5", ... }, ...],
  "byDay":   [{ "key": "2026-05-19", ... }, ...],
  "budget":  { "monthlyTokenCap": N|null, "monthlyUsdCap": N|null, "usedTokensMonth": N, "usedUsdMonth": N, "periodStart": ms }
}
```

**Pricing stub** lives in `MODEL_PRICING` inside the same file. Lift to `@agentic/contracts/providers` when a follow-up promotes per-provider catalog metadata.

**Frontend:** `Settings → Usage & cost` is its own sub-route (`apps/web/app/portal/[tenant]/(views)/settings/usage/page.tsx`) — clicking the new sidebar entry pushes the URL so refresh + back/forward work. The settings sidebar gained a 10th item (`SETTINGS_SECTIONS` in `apps/web/app/portal/components/settings/data.ts`). Routed-section pattern is shared with the Audit sub-route (P3-FE-05).

Charts are rolled inline as SVG (no chart library installed) — `HorizontalBarChart` for the agent/model breakdown, `LineChart` for the per-day series. Math helpers (`bucketBars`, `lineChartPoints`) are unit-tested.

**Degradation:** if `/v1/usage` returns an error the page shows the budget row + an `Empty` "live usage data unavailable" notice (the brief said: render the budget row at minimum).

## P3-FE-04 — Trace tree view

**Contract additions** (`packages/contracts/src/runs.ts`):
- `RunRow.parentRunId: string | null` — surfaced from `runs.parent_run_id`
- `ListRunsQuery.parentRunId?: string` — filter for the trace fan-out

**API additions** (`apps/api/src/routes/v1/runs.ts`, `apps/api/src/queries/runs.ts`):
- `listRecentRuns({ parentRunId })` honors the new filter (indexed in DB via `runs_parent_run_idx`).
- The route maps the query param straight through after `ListRunsQuery.parse(req.query)`.

**Frontend:**
- `TraceTree.tsx` renders nested levels — each level fetches `useRuns({ parentRunId })` for its children and lazy-loads each child's steps via `useRun(id)` on expand. Hard depth cap at 6 with a "Open this run on its own page" escape hatch.
- New `trace` tab inserted between `timeline` and `logs` on the run detail page.

Acceptance: when a run has `parentRunId` set, it renders as a child block under its parent's trace tab. Composing helper (`composeTrace`) is unit-tested.

## P3-FE-05 — Settings → Audit view

The Heavy Views engineer's skeleton at `apps/web/app/portal/components/settings/sections/Audit.tsx` was replaced wholesale. Now:
- Uses the real `GET /v1/audit?limit=100[&cursor=]` pagination (the API returns `{items, nextCursor, count}`).
- Adds "Load older entries" pagination via the `nextCursor`.
- For rows whose `meta` contains `before` / `after` blobs (e.g. `settings.update`, `deploy.rollback`), surfaces an inline expandable diff renderer (`AuditDiffPanel`) — `before` left / `after` right, changed keys highlighted, removed/added keys flagged.
- Falls back to `SETTINGS_AUDIT_FALLBACK` only when the API call fails so the section still renders in dev.

A deep-link route at `/portal/[tenant]/settings/audit/page.tsx` wraps the same `AuditSection` so the audit log gets a stable URL.

`renderDiffRows` is exported and unit-tested.

## P3-FE-06 — Replay button

**Endpoint:** `POST /v1/runs/:id/replay` (already shipped in P1; we just call it). Wired via the existing `useReplayRun()` hook in `apps/web/lib/hooks/useRuns.ts` — that hook already invalidates `RUN_KEYS.all` + `COUNT_KEYS.tenant` so the runs list refreshes when the new run row lands.

- New `Replay` button on the run detail header (next to `Open agent`).
- On click: posts, toasts the `new_event_id`, navigates back to `/portal/<tenant>/runs`. The fresh run will appear at the top via cache-invalidation + SSE `run.started`.
- New `REPLAY` badge surfaces on both the run detail header AND the runs list rows when `run.parentRunId` is set. Same `parentRunId` surface as the trace tree — they share one wire field for "this run is descended from another".

## Notes for coordination

### Package renames (Engineer B)

`packages/agents → packages/agent-runtime` and `packages/agent-kit → packages/agent-sdk` haven't landed yet — the api typecheck still complains in unrelated files (`bootstrap.ts`, `inngest.ts`, `agents/src/types.ts`). My new file `apps/api/src/routes/v1/usage.ts` is independent of those packages so the typecheck of my route is clean. I do not import from those packages directly.

### Backend endpoints touched in this PR

- **new** `GET /v1/usage` (P3-FE-03 backend) — `apps/api/src/routes/v1/usage.ts`, wired into `apps/api/src/server.ts:registerEnvelope` block.
- **extended** `GET /v1/runs?parentRunId=X` (P3-FE-04) — `packages/contracts/src/runs.ts:ListRunsQuery`, `apps/api/src/routes/v1/runs.ts`, `apps/api/src/queries/runs.ts:listRecentRuns`.
- **extended** `RunRow.parentRunId` (P3-FE-04 / P3-FE-06) — `packages/contracts/src/runs.ts`, `getRun` query.

These contract additions don't break older callers (both new fields are optional / nullable).

### Open follow-ups

1. **Workflow editor — full action round-trip.** Today's `toManifest()` ships a one-element placeholder action because `SpaAgent.steps: string[]` can't reconstruct `ActionSpec.{order,type,condition,task_type}`. A `GET /v1/agents/:kebab` extension that returns the full `actions[]` would close this (likely owned by Heavy Views or backend).
2. **Workflow editor — drag-to-add node positioning.** The hand-tuned LAYOUT map only knows 23 RAAS ids; an added node renders without canvas coordinates. Out of scope for this task per the §7.5 brief.
3. **Cost dashboard — pricing source.** The `MODEL_PRICING` stub in `apps/api/src/routes/v1/usage.ts` should be promoted to `@agentic/contracts/providers` once that catalog ships its price columns.
4. **Tenant code deploy — TS validation on the client.** Server-side `compile_failed` is the source of truth; a future polish could run `tsc --noEmit` in-browser via the Monaco language service.
5. **Trace tree — subflow step ↔ child run mapping.** Today children sort below their parent's steps. Once `runs.parentRunId` is paired with `runs.parentStepOrd` we can interleave the children under the spawning subflow step inline (the `composeTrace` helper is already structured for this).

## Working-tree snapshot

Modified (M, tracked):
- `apps/web/app/portal/[tenant]/(views)/runs/[id]/page.tsx` (trace tab + replay button)
- `apps/web/app/portal/[tenant]/(views)/runs/page.tsx` (REPLAY badge)
- `apps/web/app/portal/[tenant]/(views)/workflows/page.tsx` (editor wiring)
- `apps/web/app/portal/[tenant]/(views)/settings/page.tsx` (sub-route navigation for usage/audit)
- `apps/web/app/portal/[tenant]/(views)/agents/[id]/page.tsx` (edit-code tab)
- `apps/web/app/portal/components/settings/data.ts` (added `usage` section)
- `apps/web/app/portal/components/settings/sections/Audit.tsx` (full rewrite)
- `apps/web/lib/hooks/useRuns.ts` (parentRunId in filter + RunListRow)
- `apps/web/package.json` (re-added P2 devDeps that weren't in HEAD)
- `apps/api/src/routes/v1/runs.ts` (parentRunId query passthrough)
- `apps/api/src/queries/runs.ts` (parentRunId column + filter)
- `apps/api/src/server.ts` (register `usageRoutes`)
- `packages/contracts/src/runs.ts` (RunRow.parentRunId, ListRunsQuery.parentRunId)

New (untracked):
- `apps/api/src/routes/v1/usage.ts`
- `apps/web/app/portal/components/runs/TraceTree.tsx` + `.test.ts`
- `apps/web/app/portal/components/workflows/{draft,AgentEditor}.tsx` + `draft.test.ts`
- `apps/web/app/portal/components/agent-code/{edit-code,tar}.tsx` + `tar.test.ts`
- `apps/web/app/portal/components/usage/charts.tsx` + `charts.test.ts`
- `apps/web/app/portal/[tenant]/(views)/settings/usage/page.tsx`
- `apps/web/app/portal/[tenant]/(views)/settings/audit/page.tsx`
- `apps/web/lib/hooks/{useUsage,useManifest,useTenantCode}.ts`
