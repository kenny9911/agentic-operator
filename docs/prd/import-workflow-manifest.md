# PRD: Import Workflow Manifest

**Owner:** Platform · **Status:** Draft v1 · **Last updated:** 2026-05-20

## Problem

Today an Agentic Operator tenant only acquires a workflow at boot. To bring a new
workflow into a tenant the operator must drop files under `models/<slug>-v<n>/`,
edit `packages/db/src/seed.ts`, run `pnpm db:seed`, and restart the api. There is
no operator-facing path to import a workflow manifest after the fact, and no safe
way to overwrite a tenant that already has a running workflow.

The "Import workflow manifest" wizard closes that gap.

## Goals

1. An operator can import a workflow manifest (`workflow.json` + optional
   `actions.json`) into the *current* tenant from one of four sources: file
   upload, pasted JSON, HTTPS URL, or git repository.
2. The server validates the manifest, computes drift vs the live workflow,
   detects conflicts, and only deploys after explicit operator confirmation.
3. Deploys hot-swap the tenant's Inngest functions without restarting the api,
   reusing the existing `reregisterInngest()` path.
4. Every import creates an auditable `workflow_versions` row and a `deployments`
   row; the prior live version is demoted to `rolled_back`, never deleted.
5. Both schema versions are accepted: v1 (bare `AgentSpec[]`) and v2
   (`{ $schemaVersion: 2, agents: [...] }`). Runtime migrations transform v2 to
   the current internal form before any validation runs.

## Non-goals (v1)

- Multi-tenant import. An operator can only import into their own tenant.
- Importing agent *code* (TypeScript). Manifest only.
- Cross-environment promotion (staging → prod with the same artifact). The
  operator picks `staging` or `production` at the Deploy step; that decision
  is final for this import.
- Concurrent imports per tenant. The server enforces a single in-flight import
  via a `pending` deployment row; a second `stage` call returns 423.
- Git repository fetch is stubbed (returns 501) in v1; operators paste or
  upload instead.

## User flow

The 6-step wizard from the Figma reference:

| # | Step      | What the operator sees                                            | Server work                                 |
|---|-----------|-------------------------------------------------------------------|---------------------------------------------|
| 1 | SOURCE    | Pick Upload / Paste / URL / Repo, provide artifact                | none (URL fetch is server-assisted)         |
| 2 | VALIDATE  | Parse + schema-lint result, count of agents/events/actions        | migrate → Zod parse → lint → 0-N issues     |
| 3 | DIFF      | Added / removed / modified agents vs live workflow                | compute against current live version        |
| 4 | RESOLVE   | Conflicts: kebab-id collision, dangling triggers, orphans, etc.   | reuse validate result, accept resolutions   |
| 5 | PREVIEW   | DAG of the imported workflow (read-only)                          | none (client renders from validated form)   |
| 6 | DEPLOY    | Pick staging or production; confirm if overwriting a live tenant  | tx: demote prior, insert deployment, write file, hot-swap |

## Overwrite guard

If the tenant has a live workflow with `priorN` agents, the server returns
`409 { requires_confirmation: true, diff, conflicts, prior }` when **any** of
these hold:

- `removed >= 1` — any deletion is loud, regardless of manifest size, or
- `modified >= max(1, ceil(0.30 * priorN))` — modification rate hits 30%, or
- `added + removed + modified >= max(3, ceil(0.50 * priorN))` — total churn hits
  50% with a floor of 3 changes.

Worked examples:

| priorN | trip threshold (mod) | trip threshold (total churn) | rationale                          |
|--------|----------------------|------------------------------|------------------------------------|
| 1      | 1                    | 3                            | any change to a 1-agent flow trips |
| 3      | 1                    | 3                            | tiny flows: any removal trips      |
| 10     | 3                    | 5                            | mid-size: 30% mod or half churn    |
| 100    | 30                   | 50                           | large: absolute counts matter      |

The SPA shows an "Overwrite confirmation" modal listing exactly what will
change, including the prior version label and deployed-at timestamp. The
operator must re-submit with `?confirm=1` (query string, not body) to proceed.

## Risks & mitigations

| Risk                                                          | Mitigation                                                                                                  |
|---------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------|
| Hot-swap races with in-flight runs of the old manifest        | Existing Inngest concurrency key (`event.data.subject`) bounds one run per subject; reregister only changes the function set for new triggers. |
| Validation false-negatives if v2 schema diverges              | Validate against the migrated form (post `migrate()`), not raw input.                                       |
| Disk + DB drift if `writeFile` succeeds but DB insert fails   | DB tx commits FIRST; disk write uses the workflow_version_id as filename suffix. Disk-write failure logs an alert; next boot reads from DB which is authoritative. |
| Operator imports a manifest that references unavailable LLMs  | `model_not_configured` conflict surfaces at Resolve; commit is blocked until the operator confirms.         |
| Two operators import in parallel                              | One `pending` deployment per tenant; second `stage` call returns 423 with the session_id of the in-flight import. |

## Success metrics

- An operator can import a 20-agent v2 manifest from upload to live deploy in
  **under 30 seconds**.
- Zero data loss across `models/`: every prior `workflow_v<N>.json` file is
  preserved on disk (we always write `v<N+1>.json`).
- Every successful import produces exactly **one** `workflow_versions` row and
  **one** `deployments` row with `status='live'`; rollback restores prior state
  without rerunning the wizard.
- Server rejects every invalid manifest with at least one structured `Issue`
  pointing at the offending JSON path.

## Out of scope, explicitly

- A "diff three-way merge" UI. The Resolve step accepts/rejects auto-fixes; it
  does not let the operator hand-edit the imported manifest. Editing happens in
  the Schema Editor view, then they re-import.
- Cron schedule conflict detection (two tenants firing at the same instant).
  Out of scope for v1.
- Manifest signing / provenance. Out of scope for v1.
