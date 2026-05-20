# Agentic Operator — Product Requirements Document
*Version 1.0 — Tenant Management & Agents OS — 2026-05-20*

## 1. Executive Summary

Agentic Operator is a self-hosted platform for designing, deploying, and operating LLM-driven agents and workflows. The platform sits between a durable execution substrate (Inngest) and an LLM gateway fronting 14 providers, and it ships with two parallel authoring surfaces in the same workspace: a declarative JSON manifest (`models/<slug>-v<n>/workflow*.json`) for workflow designers and a TypeScript `BaseAgent` class for engineers who need typed control flow. Both paths share one runs/steps schema, one SSE log tail, and one observability portal. The audience is product teams who want to ship production agents without rebuilding the platform layer (retries, replay, ledgering, multi-tenant isolation, cost attribution) for every new domain.

This milestone delivers two intertwined pieces of work. The first is a complete tenant management surface — list, view, create, edit, archive, restore, clone — with a four-step "New tenant" wizard in the SPA at `apps/web/public/portal/index.html` and a matching CRUD API under `apps/api/src/routes/v1/`. The second is a sharpening of the platform's positioning as an *agents operating system* — defining the four pillars (coding environment, deployment surface, runtime environment, observability) so that the tenant becomes the natural unit of multi-tenancy across all of them. Today the platform already provisions tenants through `pnpm db:seed` and a manual `models/<slug>-v<n>/` drop; this milestone makes the workflow self-service from inside the product.

We ship now because the tenant primitive is the load-bearing dimension across the schema (every user-visible table in `packages/db/src/schema.ts` carries `tenant_id`), the runtime (Inngest function ids are `${tenantSlug}.${agentName}`), the filesystem (`data/tenants/<slug>/<version>/`, `data/logs/<tenant>/`), and the deployment API (`POST /v1/tenants/:slug/code` in `apps/api/src/routes/v1/tenant-code.ts`). The TenantSwitcher stub at `apps/web/public/portal/app.jsx:205-262` reads `window.TENANTS` and shows a non-functional "+ New tenant" button — we cannot demo the dual-authoring story to a new team without a credible answer to "how do I create my workspace." Closing this gap unblocks every onboarding conversation.

## 2. Vision: Agents Operating System

An *agents operating system* is what the platform aspires to be: the layer that owns the four things every multi-tenant agent product needs, so that domain teams only write the agent. We commit to four pillars.

**Pillar 1 — Coding environment.** A tenant is an authoring workspace. Manifest agents live as JSON in a versioned `models/<slug>-v<n>/` tree; code agents live as TypeScript under `tenants/<slug>/src/` or in deployed bundles at `data/tenants/<slug>/<version>/`. The Schema Editor SPA view (`apps/web/public/portal/views/schema-editor.jsx`) edits the manifest tree-or-form-or-Monaco against a Zod→JSON-Schema pipeline with a CI drift gate. *Today*: editor works, but tenant creation is out-of-band. *Commitment*: tenant lifecycle is in-band; the "New tenant" wizard provisions a starter manifest, default event types, and an initial budget atomically.

**Pillar 2 — Deployment surface.** The platform already accepts gzipped tarball uploads at `POST /v1/tenants/:slug/code` (see `apps/api/src/routes/v1/tenant-code.ts`), extracts them under `data/tenants/<slug>/<version>/`, writes a `deployments` row, and hot-swaps Inngest functions via `reregisterInngest()`. Rollback flips the `live` pointer in a transaction at `POST /v1/deployments/:id/rollback`. *Today*: deployments are tenant-scoped but the tenant must already exist; create-tenant is a `db:seed` and api-restart away. *Commitment*: tenant creation produces a tenant row, the `data/tenants/<slug>/` root, an empty manifest workflow version, and a `deployments` row keyed to `target='runtime'` in one API call, with no api restart needed. Archive flips a soft-delete tombstone, removes Inngest registrations for the tenant, and preserves `data/` until the retention window closes.

**Pillar 3 — Runtime environment.** Inngest owns durability; the platform's step engine is a thin shim over `step.run()` (see `packages/runtime/src/register.ts`). Concurrency is keyed on `event.data.subject` per tenant. Runs are durable, replayable, and observable; HITL pauses live as `tasks` rows with `step.waitForEvent("task.resolved", ...)`. *Today*: the runtime already isolates by tenant via Inngest function ids and event namespaces (`${tenantSlug}/${name}`). *Commitment*: tenant creation triggers function registration without api restart; tenant archival removes registrations idempotently; tenant cloning emits one new function set keyed to the new slug.

**Pillar 4 — Observability.** Every run produces a row in `runs`, a row per `steps`, an audit-log entry where appropriate, and an NDJSON log line on disk at `data/logs/<tenant>/runs/<date>/<run-id>.log` tailed over SSE at `GET /v1/runs/:runId/logs?follow=1`. Event ledger lives at `data/logs/<tenant>/events/<date>.ndjson`. *Today*: all observability is already tenant-scoped — the dashboards in `apps/web/public/portal/views/dashboard.jsx` and `runs.jsx` read tenant-aware endpoints. *Commitment*: the tenant management view exposes per-tenant aggregate counts (agents, runs/24h, last-deployed-at, monthly token usage) computed at the API and shown in the switcher dropdown and tenants table.

## 3. Target Users & Personas

**Workspace owner.** Creates tenants, sets quotas, manages members, owns budgets. Cares about cost predictability and isolation guarantees. Primary surfaces: the "+ New tenant" wizard, the Tenants management view at `/tenants`, the Settings → Quotas tab. Measured by: time-to-provision a new workspace and zero-budget-overrun incidents.

**Workflow designer.** Lives in the Schema Editor, the Workflows view, and the Agents view; rarely writes code. Cares about how fast they can ship a manifest change and whether the system stays out of their way. Primary surfaces: Workflows DAG, Schema Editor, Agents detail, Test run side panel, Deployments view. Measured by: cycle time from edit to live, and percentage of manifest-only delivery.

**Code-agent developer.** Subclasses `BaseAgent` in `packages/agents`, packages a tarball, calls `POST /v1/tenants/:slug/code`. Cares about deploy turnaround, type safety, and replay fidelity. Primary surfaces: a local clone of the tenant package under `tenants/<slug>/`, the agent-code SPA view (`apps/web/public/portal/views/agent-code.jsx`), the Runs view filtered to their agent. Measured by: deploy latency, rollback success rate, and runs/error ratio for the agents they own.

**Operator.** Watches dashboards, resolves HITL `tasks` rows, triggers rollbacks when a deployment regresses, drains queues during incidents. Cares about MTTR and one-pane-of-glass visibility. Primary surfaces: Dashboard, Runs, Tasks, Deployments, Events. Measured by: paging-to-acknowledgment time and SLO adherence per tenant.

**Viewer.** Read-only auditor — compliance, finance partner, customer-success engineer who needs to confirm something on a customer's behalf. Cares about not being able to break anything and being able to reconstruct any incident from the audit log. Primary surfaces: read-only Runs, Events, Audit log, Dashboard. Measured by: report turnaround time and audit-completeness coverage.

## 4. The Tenant Concept (precise definition)

A **tenant** is a logical workspace and the unit of multi-tenancy across the platform. It is simultaneously: (a) a data isolation boundary — every user-visible row carries `tenant_id` and `tenantScope(ctx, table)` from `@agentic/db` enforces the predicate at query time; (b) a deployment scope — `data/tenants/<slug>/<version>/` holds the live code bundle and `deployments` rows track the `live` pointer; (c) an event namespace — Inngest event names are `${tenantSlug}/${name}` so two tenants can ship an `analyzeRequirement` agent that listens for `REQUIREMENT_LOGGED` without colliding; (d) an authoring workspace — the manifest tree at `models/<slug>-v<n>/` and the tenant package at `tenants/<slug>/` belong to one tenant.

**Inside a tenant.** Every row in these tables carries `tenant_id` and belongs to exactly one tenant: `workflows`, `workflow_versions` (via workflow), `deployments`, `agents` (via workflow), `agent_versions` (via agent), `events`, `event_listeners` (via agent), `runs`, `steps` (via run), `tasks`, `artifacts`, `audit_log`, `api_tokens`, `event_types`, `entity_types`, `tenant_budgets`, `webhook_subscriptions`, `agent_memory_long`, `agent_memory_short` (via run). On disk: `data/tenants/<slug>/<version>/`, `data/logs/<tenant>/runs/<date>/<run-id>.log`, `data/logs/<tenant>/events/<date>.ndjson`. Memberships connect `users` to tenants via the `memberships` table with role `admin|operator|viewer`.

**Outside a tenant.** LLM provider keys live at the platform level — the single `gateway` singleton constructed in `apps/api/src/services/llm.ts` is injected into both consumers at boot; per-tenant BYOK keys are deferred to a later milestone. The `__system` tenant hosts code-defined agents that span tenants (test agents, platform-managed jobs). The Inngest engine is one process serving all tenants; isolation is by function id, not by process. The `users` table is platform-global; one user can be a member of many tenants.

**Tenant identity.** Four fields define a tenant. `slug` is the immutable, URL-safe, DNS-shape primary identifier matching `^[a-z][a-z0-9-]{1,31}$` — used in event namespaces, filesystem paths, and Inngest function ids; once set it cannot change without manual migration. `id` is the prefixed UUID `ten-...` generated by `makeId("ten")` from `@agentic/shared`. `name` is the display string. `subtitle`, `color`, and a new `status` column with values `active|archived` (default `active`) complete the row. The `tenants` table in `packages/db/src/schema.ts` already holds the first five fields; the migration adds `status` and `archived_at`.

## 5. User Stories & Acceptance Criteria

**Story 1 — List tenants.** As a workspace owner, I want to see every tenant I have access to in a sortable table, so that I can find one fast and spot anomalies across my portfolio.
- Endpoint `GET /v1/tenants` returns the list filtered by the caller's memberships.
- Each row includes slug, name, subtitle, color, status, agent count, runs/24h, last-deployed-at.
- Columns are sortable client-side; default sort is `name asc`.
- Archived tenants are hidden by default and revealed by a filter toggle.

**Story 2 — View tenant detail.** As a workspace owner, I want a focused tenant detail page so that I can audit the configuration before changing anything.
- Endpoint `GET /v1/tenants/:slug` returns the tenant row plus aggregate counts and the live deployment summary.
- The page shows identity, status, members, current budget vs. usage, and the current live `runtime` deployment id and version.
- 404 on unknown slug returns the standard error envelope.

**Story 3 — Create tenant via wizard.** As a workspace owner, I want a guided four-step "New tenant" flow so that I can stand up a workspace in under five minutes without touching the database or restarting the API.
- Step 1 collects identity: name (required), slug (auto-generated from name, editable, live-validated), subtitle, color.
- Step 2 picks a template: blank, copy-from-existing-tenant, or apply a named starter manifest.
- Step 3 sets quotas: monthly token cap (default 8M), monthly USD cap (default 4000), max concurrent runs (default 80) — wired to `tenant_budgets`.
- Step 4 confirms and submits. On success, the new tenant appears in the switcher within one render cycle without an api restart.
- Slug uniqueness checked at every keystroke via a debounced `HEAD /v1/tenants/:slug` (200 = taken, 404 = available).
- All four steps validate before "Create" enables.

**Story 4 — Edit tenant settings.** As a workspace owner, I want to edit the display name, subtitle, and color of an existing tenant from the Settings view, so that I can fix typos and re-brand workspaces without leaving the product.
- Endpoint `PATCH /v1/tenants/:slug` accepts a partial update of `{name, subtitle, color}`.
- Slug is read-only in the UI; attempts to change it return `slug_immutable` (400).
- An entry lands in `audit_log` with `action='tenant.update'`.

**Story 5 — Archive tenant.** As a workspace owner, I want to archive a tenant so that I can decommission a workspace without losing its history.
- Endpoint `POST /v1/tenants/:slug/archive` sets `status='archived'`, records `archived_at`, removes Inngest function registrations for that tenant via `reregisterInngest`, and writes an audit entry.
- New events for an archived tenant are rejected with `tenant_archived` (409).
- Existing data (runs, events, logs, tarballs under `data/tenants/<slug>/`) is preserved.

**Story 6 — Restore archived tenant.** As a workspace owner, I want to restore an archived tenant inside the retention window so that an accidental archive is reversible.
- Endpoint `POST /v1/tenants/:slug/restore` sets `status='active'`, clears `archived_at`, re-registers Inngest functions, and writes an audit entry.
- Restore succeeds only if the slug still resolves and the retention window (default 90 days) has not elapsed.

**Story 7 — Switch tenants in the sidebar.** As any persona, I want a one-click tenant switcher in the sidebar so that I can move between workspaces without losing my place.
- The TenantSwitcher in `apps/web/public/portal/app.jsx` reads from `/api/spa/bootstrap` (which now returns the live tenant list).
- Switching writes a user preference and reloads only the active view (no full page reload).
- Archived tenants are hidden unless toggled in.

**Story 8 — Per-tenant stats in the switcher dropdown.** As an operator, I want each row in the switcher dropdown to show agent count and runs/24h, so that I can spot a stuck or hot tenant at a glance.
- The bootstrap payload computes `agentCount` and `runs24h` per tenant at request time.
- Counts respect soft-delete tombstones (`deletedAt IS NULL`).
- An "All tenants" affordance is out of scope for v1.

**Story 9 — Starter content on new tenant.** As a workflow designer, I want a new tenant to come with default event types and an empty workflow scaffold, so that I can run my first test in under five minutes.
- The create endpoint provisions a default set of event types (`requirement.logged`, `task.created`, `run.completed`) in `event_types`.
- A blank workflow row is created under the tenant with `slug='default'` and a single placeholder agent version.
- The initial `tenant_budgets` row is created from the wizard quotas.

**Story 10 — Audit trail of tenant changes.** As a viewer, I want every tenant lifecycle event to land in the audit log so that I can reconstruct who did what when.
- Every mutation (`create`, `update`, `archive`, `restore`, `clone`) writes an `audit_log` row with `targetType='tenant'` and the tenant id.
- The audit log is filterable by tenant in the existing audit view.

**Story 11 — Clone tenant from existing.** As a workspace owner, I want to copy a tenant so that I can stand up a sibling workspace from a known-good baseline.
- Endpoint `POST /v1/tenants/:slug/clone` accepts `{newSlug, newName}`.
- It copies the manifest tree (latest live `workflow_versions`), the `event_types`, the `entity_types`, and the budget caps.
- It does *not* copy runs, events, tasks, audit log, or memberships.
- The new tenant starts with zero usage and one membership: the caller as admin.

**Story 12 — Tenant-scoped API tokens.** As a code-agent developer, I want to mint a token scoped to one tenant so that CI can deploy without holding a session cookie.
- Endpoint `POST /v1/tenants/:slug/tokens` returns a token displayed once with a name, scopes list, and creation time.
- The token's hash lands in `api_tokens` with `tenant_id` set; the plaintext is never persisted.
- Bearer auth resolves to the tenant for which the token was minted; cross-tenant use returns `forbidden`.

## 6. UX Requirements (SPA)

The active UI is the static SPA at `apps/web/public/portal/index.html`. Every requirement below assumes Babel/JSX, inline CSS-in-JS, and the SPA global-scope convention documented in `CLAUDE.md`.

**Sidebar TenantSwitcher.** The dropdown at `apps/web/public/portal/app.jsx:205-262` is replaced with a live implementation. Each row renders the color avatar (22×22 square), the name, the subtitle (truncated with ellipsis), and a stats line of the shape `{agentCount} agents · {runs24h} runs/24h`. The current tenant is highlighted with a background of `var(--panel-2)` and a check icon. A "+ New tenant" CTA pinned to the bottom of the dropdown opens the New Tenant modal. The dropdown closes on outside-click and on Escape. Loading state renders a row of `var(--text-4)` skeleton bars; error state shows a single line "Tenants unavailable — try refresh." Empty state ("no tenants — create one") is impossible in practice because the caller always has at least one membership, but is rendered defensively as a single "+ New tenant" button.

**Tenants management view at `/tenants`.** Adds a new view file `apps/web/public/portal/views/tenants.jsx`, registered the same way the existing views are. The view is a sortable table with columns: avatar+name, slug (monospace), subtitle, status badge (`active` green, `archived` gray), agent count, runs/24h, last-deployed-at (relative time). Actions per row: Open (deep-links to that tenant's dashboard), Edit (opens the edit modal), Archive or Restore (depending on status), Clone (opens the clone modal). A filter toggle in the header reveals archived tenants. A "+ New tenant" button in the top-right opens the same modal as the sidebar CTA. Sort is client-side; default `name asc`. Pagination is omitted for v1 because no workspace has more than ~20 tenants; we revisit at 100.

**New Tenant modal.** Four steps with a progress strip across the top. Step 1 (Identity): inputs for name, slug, subtitle, color picker (the same palette as the existing tenant color list); slug auto-derives from `name.toLowerCase().replace(/[^a-z0-9]+/g, "-")` and validates against the regex live. Step 2 (Template): three radio choices — blank, copy-from-existing (with a dropdown of source tenants), starter manifest (with a dropdown of named templates: "RAAS-shape," "support-triage-shape," "generic"). Step 3 (Quotas & budget): numeric inputs for monthly token cap, monthly USD cap, max concurrent runs; defaults match the Settings → Quotas current values. Step 4 (Confirm & create): renders a JSON-shape preview of the payload that will be POSTed, plus a "Create" button. The "Create" button is disabled if any step has unresolved validation errors; the steps display a red dot in the progress strip when they have errors. On submit success, the modal closes and the new tenant is selected as active.

**Tenant settings page.** The existing Settings view (`apps/web/public/portal/views/settings.jsx`) gains a "General" subsection for the current tenant. Fields: name, subtitle, color, slug (read-only), status (read-only). Actions: Save (calls `PATCH`), Archive (with confirm dialog), Transfer ownership (deferred to phase 2 — show as disabled with a tooltip "Coming in Q3"). The existing tenant-quota table is unchanged; this milestone only adds the per-tenant identity card.

**Empty, error, and loading states.** Loading shows skeleton rows (table) and `--text-4` placeholders (modal). Error renders the standard error envelope's `message` inline; the action that errored stays clickable so the user can retry. Empty states use the existing portal idiom — a single subdued line plus a primary CTA.

## 7. API Requirements

These endpoints land under `apps/api/src/routes/v1/tenants.ts` (new file). The route folder already follows the convention from `apps/api/src/routes/v1/`. Wire-level Zod schemas are defined in the companion Design Spec.

- `GET /v1/tenants` — list tenants the caller has membership in; returns identity plus aggregate counts.
- `GET /v1/tenants/:slug` — full detail including budget snapshot and live deployment summary.
- `HEAD /v1/tenants/:slug` — slug-existence probe for the wizard's live validation. 200 if taken, 404 if free.
- `POST /v1/tenants` — create. Body matches the four-step wizard payload. Atomic: tenant row, default workflow, default event types, budget row, audit entry, Inngest re-register, all-or-nothing.
- `PATCH /v1/tenants/:slug` — partial update of `{name, subtitle, color}`. 400 on slug attempt.
- `POST /v1/tenants/:slug/archive` — flip to archived; idempotent.
- `POST /v1/tenants/:slug/restore` — flip back to active; rejects after retention window.
- `POST /v1/tenants/:slug/clone` — duplicate the manifest, event types, entity types, and budgets under a new slug; does not copy runs.
- `POST /v1/tenants/:slug/tokens` — mint a tenant-scoped API token; returns the plaintext once.
- `GET /v1/tenants/:slug/tokens` — list tokens (hashes only, never plaintext).
- `DELETE /v1/tenants/:slug/tokens/:id` — revoke a token.

The existing `/api/spa/bootstrap` route in `apps/web/app/api/spa/bootstrap/route.ts` is extended to call `GET /v1/tenants` and project the result into `SpaTenant[]`. Auth: all endpoints require a session or a tenant-scoped API token; the caller's tenant memberships gate read access; only `role='admin'` can mutate.

## 8. Non-Goals (this milestone)

- **No billing integration.** Quotas are caps that enforce queueing and surface `Quota` events; no Stripe, no invoicing.
- **No SSO.** Dev-mode auth remains the only auth path; an OIDC provider lands in phase 3.
- **No custom domain per tenant.** All tenants live under one host; subdomain routing is a phase 3 item.
- **No cross-region replication.** SQLite WAL is single-node; Postgres + replicas are a later swap.
- **No hard delete.** Only archive; data retention is governed by a separate policy. A retention sweeper is out of scope here.
- **No per-tenant BYOK LLM keys.** Gateway keys remain platform-level in `apps/api/src/services/llm.ts`. Per-tenant BYOK is a phase 2 feature.
- **No slug change.** Once chosen, the slug is immutable. Workarounds (clone-then-archive) are documented but not automated.
- **No tenant-level RBAC beyond `admin|operator|viewer`.** Fine-grained permissions are deferred.
- **No bulk operations.** No "archive 5 tenants at once" or "export all tenants."

## 9. Success Metrics

- **Time-to-first-agent-run for a new tenant: under 5 minutes** from clicking "+ New tenant" to seeing the first row in the Runs view, measured end-to-end in a smoke test.
- **100% of tenant-scoped queries pass the `tenantScope` assertion.** A repo-level lint plus a runtime assertion in dev mode fails any query that touches a tenant-scoped table without the predicate, measured by CI green-rate and zero runtime warnings in dev logs.
- **Zero cross-tenant data leak incidents.** Audit query coverage runs nightly in CI against a fixture with two tenants and asserts that no read from tenant A surfaces tenant B's rows. Track incidents in the audit log with `action='security.crosstenant'`.
- **Operator survey: 4.5/5 or higher on "I trust the tenant isolation."** Two-question survey to operators after each release.
- **Tenant-management API p95 latency: under 200ms** for list and detail, under 500ms for create (with the Inngest re-register call included).

## 10. Risks & Open Questions

1. **Per-tenant secret isolation (severity: high).** Webhook secrets live in `webhook_subscriptions.secret_encrypted` per-tenant, but the key used to decrypt is platform-wide. *Mitigation*: out of scope for this PRD; document and queue a KMS-backed per-tenant key wrap for phase 2.
2. **Multi-version coexistence during canary (severity: medium).** The `deployments` table has one `live` row per `(tenant_id, target)`; canary rollouts (10% to v2, 90% to v1) are not modeled. *Mitigation*: phase 2 introduces a `weight` column on `deployments` plus a router shim in `packages/runtime/src/register.ts`. Out of scope here.
3. **Archived-tenant data retention (severity: medium).** Archive preserves `data/tenants/<slug>/`, `data/logs/<tenant>/`, and all rows. Cost grows unbounded. *Mitigation*: announce a 90-day default retention window now; build the sweeper in phase 2.
4. **Rate-limit fairness across tenants (severity: medium).** Inngest concurrency caps are per-function, not per-tenant; one runaway tenant can saturate provider rate limits and starve others. *Mitigation*: per-tenant concurrency keys are already wired via `event.data.subject`, but a noisy-neighbor sweeper that checks `tenant_budgets.used_usd_month` and pauses functions is a phase 2 item. Document the risk in the runbook.
5. **Code-agent registration collisions across tenants (severity: low).** Two tenants both deploying an agent named `processResume` register Inngest functions with ids `tenantA.processResume` and `tenantB.processResume`; these are unique, but the in-memory `agentRegistry` from `packages/agents` is platform-global. *Mitigation*: BaseAgent registry keys already prefix with tenant; an assertion in `agentRegistry.register` rejects unprefixed names. Verify in tests.
6. **Slug squatting (severity: low).** Nothing prevents an admin from registering common slugs (`admin`, `system`, `api`) and breaking later routing. *Mitigation*: a reserved-slug list at the API layer rejects 30-ish known slugs, including `__system`.
7. **Clone fidelity (severity: medium).** Copying a tenant's manifest is not enough — code-agent tarballs under `data/tenants/<slug>/` are not duplicated by the clone endpoint. *Open question*: do we deep-copy the live deployment tarball or require the source tenant to redeploy after cloning? *Decision needed before implementation*.
8. **Inngest re-register cost (severity: low).** `reregisterInngest()` walks the whole registry; with 50 tenants and 30 agents each, this is 1500 function objects rebuilt on every tenant change. *Mitigation*: the `scope` parameter on `reregisterInngest({ tenantSlug })` already exists for tenant-scoped re-registers; ensure the new endpoints use it.
9. **Archived tenant in audit queries (severity: low).** Archived tenants still appear in cross-tenant audit reports (the audit log is global per-tenant). *Open question*: do operators want archived tenants filtered by default in their audit view? *Default: yes; surface a toggle*.
10. **Concurrency on slug claim (severity: low).** Two concurrent `POST /v1/tenants` with the same slug. *Mitigation*: the `tenants_slug_uq` unique index already exists; the second insert will hit the SQLite constraint. The API translates the constraint error to a clean 409 `slug_taken`.

## 11. Rollout Plan

**Phase 1 — This milestone.** Land the schema migration adding `status` and `archived_at` to `tenants`. Ship `GET /v1/tenants`, `GET /v1/tenants/:slug`, `HEAD /v1/tenants/:slug`, `POST /v1/tenants`, `PATCH /v1/tenants/:slug`, `POST /v1/tenants/:slug/archive`, `POST /v1/tenants/:slug/restore`. Ship the SPA TenantSwitcher rewrite, the `/tenants` management view, and the four-step "New tenant" modal. Wire `apps/web/app/api/spa/bootstrap/route.ts` to the live tenant endpoint. Audit-log every mutation.

**Phase 2 — Next milestone.** Add `POST /v1/tenants/:slug/clone` with the open question on tarball duplication resolved. Add `POST /v1/tenants/:slug/tokens` and the token-revocation endpoint plus a Tokens tab in the Settings view. Wire hard quota enforcement: when `tenant_budgets.used_usd_month` exceeds `monthly_usd_cap`, the gateway in `apps/api/src/services/llm.ts` returns a `quota_exceeded` error and the runtime emits a `Quota` event. Surface a per-tenant audit page. Per-tenant BYOK LLM keys begin in this phase.

**Phase 3 — Q3.** SSO via OIDC. Billing integration (Stripe metered + invoicing keyed on `tenant_id`). Hard-delete with data export (download a per-tenant zip of `data/tenants/<slug>/`, `data/logs/<tenant>/`, and a CSV dump of the tenant-scoped rows). Retention sweeper for archived tenants past the 90-day window. Per-tenant subdomains.

## 12. Glossary

- **Tenant** — Logical workspace, data isolation boundary, deployment scope, event namespace. Identified by an immutable slug and a prefixed UUID.
- **Workspace** — Synonym for tenant in user-facing copy; "tenant" is used in technical and API contexts.
- **Agent** — A unit of work that consumes an event and produces an event. Two kinds: manifest and code.
- **Workflow** — A graph of agents that share a manifest version. One workflow per `workflows` row.
- **Manifest** — JSON declaration of a workflow tree under `models/<slug>-v<n>/` and `workflow_versions.manifest_json`. The single source of truth for declarative agents.
- **Deployment** — A row in `deployments` that points a `(tenant_id, target)` pair at a `version_id` with `status` in `{live, rolled_back, pending}`.
- **Run** — One execution of one agent. Row in `runs`; rows in `steps`; a log file at `data/logs/<tenant>/runs/<date>/<run-id>.log`.
- **Step** — One atomic unit inside a run, persisted via `step.run()`. Types: `tool`, `logic`, `manual`, `condition`, `delay`, `subflow`.
- **Action** — A named operation inside an agent manifest that maps to a step type at execution time.
- **Event** — A named, payload-carrying signal that triggers agents. Row in `events`; emitted to Inngest under `${tenantSlug}/${name}`.
- **Ledger** — The append-only NDJSON log of all events per tenant at `data/logs/<tenant>/events/<date>.ndjson`, plus the `events` table.
- **Task (HITL)** — A `tasks` row created mid-run when human input is required; the run pauses on `step.waitForEvent("task.resolved", ...)` until the operator resolves it.
- **Correlation ID** — The id that ties a chain of runs across a business transaction. Stored on `runs.correlation_id`.
- **Subject** — The Inngest concurrency key; usually a business id (a candidate id, a ticket id) that serializes runs against the same target. Stored on `runs.subject` and `events.subject`.
- **Code-agent** — A `BaseAgent` subclass in TypeScript, registered at import time, invoked synchronously at `POST /v1/agents/:name/invoke`.
- **Manifest-agent** — A node in a `workflow_v1.json` manifest, registered as one Inngest function with id `${tenantSlug}.${agentName}`.
- **Gateway** — The LLM gateway singleton in `apps/api/src/services/llm.ts`, fronting 14 providers via lazy adapters.
- **Hot-reload** — The runtime swap performed by `reregisterInngest()` so that a deployment or tenant change takes effect without an api restart.
- **Drift gate** — The CI check that asserts the Zod schemas in `@agentic/contracts` match the JSON Schema artifacts the SPA editor consumes; fails the build on drift.
