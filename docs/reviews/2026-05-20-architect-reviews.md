# Multi-architect review — Tenant management + Agents-OS positioning

*Date: 2026-05-20. Reviewers spawned in parallel by the implementation work
on `main`. Consolidated by the implementation engineer.*

This document captures three independent architectural reviews that informed
the P5-TEN-01 design. Each was conducted "cold" — the reviewer had no prior
conversation context, only the repo and a self-contained prompt.

Source of truth for the verdicts is the prose below. The implementation that
landed in this PR resolves the items marked **(addressed)** and tracks the
remainder in `docs/impl/tenant-management-impl.md` §11 (Open issues).

---

## Reviewer 1 — AI Software Architect

**Brief.** Judge whether Agentic Operator is genuinely an "agents operating
system" — a complete platform providing coding, deployment, and runtime
environment for AI-LLM agents and workflows.

**Verdict.** *Not yet.* The platform is a credible agent execution engine
with a polished single-tenant developer experience, but falls short of an
"OS for agents" along the axes that matter most: tenant lifecycle,
multi-tenant isolation, sandboxing, and identity. Roughly 70% of a real
agents-OS is in place; the missing 30% is the part that distinguishes a
hosted platform from a deployable internal tool.

**Top strengths.**
1. Durability discipline is real. `packages/runtime/src/register.ts:93-140`
   wraps every DB write in `step.run("init", …)`; the finalize step at
   `register.ts:369-415` is also memoized; downstream emission uses
   `step.sendEvent` (line 421), which is Inngest's only idempotent send
   primitive. This is correct exactly-once-ish behavior.
2. Two execution paths over a unified storage spine. Manifest agents
   (`packages/runtime`) and code agents (`packages/agent-runtime`) both
   produce rows in the same `runs`/`steps` tables (`packages/db/src/schema.ts:258-340`)
   and stream the same SSE log format, so observability is uniform regardless
   of authoring style.
3. Hot-swappable tenant code with atomic rollback.
   `apps/api/src/routes/v1/tenant-code.ts:108-273` extracts to tmp,
   atomic-renames, transactionally flips the live deployment pointer, then
   hot-reregisters Inngest. Combined with the dynamic loader's
   "DB pointer wins over disk lexical sort" rule, you can ship a tenant
   hotfix without restarting the API. Few internal platforms get this right.

**Critical gaps.**

| ID | Gap | Severity | Status |
|----|-----|----------|--------|
| G1 | No `/v1/tenants` lifecycle surface (CRUD missing) | P0 | **Addressed** by `apps/api/src/routes/v1/tenants.ts` |
| G2 | Identity stops at the tenant, not the user — `AuthedContext` has no `userId`; `actorUserId` is always null on audit writes | P0 | Open — tracked in P5-TEN-02 |
| G3 | Tenant code runs unsandboxed in the API process; `await import(url)` of arbitrary tenant code can `process.exit()` the API | P0/security | Open — Worker-thread isolation planned for P5-TEN-03 |
| G4 | Code-agent registry is process-global, not tenant-keyed — two tenants registering `summarize` clobber each other | P1 | **Addressed (partial)** by tenant-keyed map in `packages/agent-runtime/src/registry.ts`. `agentRegistry.get(name, tenantSlug?)` resolves tenant-scoped first, falls back to `__system`. Same change pending in legacy `packages/agents/src/registry.ts` (full swap when bootstrap refactor lands). |
| G5 | Provider keys lack real tenant scoping — `getProviderKey(id)` ignores the `tenantId` field | P1 | **Addressed** in `apps/api/src/services/provider-keys.ts:165-208`. New precedence: tenant-scope exact match → workspace-scope → env. Tenant-scoped records without a matching `tenantId` are no longer used as platform defaults (closes the cross-tenant credentials bleed). |
| G6 | No multi-version coexistence / canary; rollback is a single-pointer flip | P1 | Open |
| G7 | Resource fairness missing — `concurrency.limit: 8` is per-function, not per-tenant | P1 | **Addressed** in `packages/runtime/src/register.ts:75-95`. Concurrency key now composes `${tenantSlug}:${event.data.subject}` so a tenant cannot starve another tenant's subject slots. Per-agent `agent.concurrency.max_concurrent_executions` is honored from the manifest. |
| G8 | Subflow is in the schema (`steps.type` enum) but never implemented (no `step.invoke` in `register.ts`) | P2 | Open |
| G9 | Manifest schema evolution doesn't help in-flight runs | P2 | Open |
| G10 | Single-process Fastify + SQLite is fine for dev — Postgres swap not architected | P3 | Open |
| H1 | HITL `task.resolved` event is not tenant-scoped — leaked taskId in tenant A could resume tenant B's flow (Principal Engineer flag) | P0/security | **Addressed**: `apps/api/src/routes/v1/tasks.ts` now stamps `tenantId` on the event payload; `packages/runtime/src/register.ts:223` pins the `if`-expression to both `taskId` AND `tenantId == "${ctx.tenantId}"`. |
| H2 | `reregisterInngest` had a clobber race when two callers concurrently rebuilt | P1 | **Addressed**: single-slot mutex chain in `apps/api/src/services/inngest-registry.ts:102-124`. |
| H3 | `AUTH_MODE=dev` + `NODE_ENV=production` was a back-door | P0 | **Addressed**: `assertAuthModeSafe()` at `apps/api/src/plugins/auth.ts:78` refuses to start; also verifies `AGENTIC_DEV_TENANT` slug exists when dev mode is on. |

**Recommended provisioning transaction (informed §4 of this PRD).**

```
POST /v1/tenants
Body: {
  slug, name, subtitle?, color?,
  budget?, starter, admin_email?
}
```

1. Validate (regex + reserved-list)
2. Slug reservation (409 on collision)
3. Insert `tenants`
4. Insert `tenant_budgets`
5. Seed `event_types` + `entity_types`
6. Insert `memberships` admin row
7. Optional starter content
8. Mint scoped `api_tokens`; return plaintext ONCE
9. `mkdir -p data/logs/<slug>/...`, `data/tenants/<slug>/`
10. Audit row inside the same transaction
11. No Inngest re-register needed until a workflow is deployed, but write a
    deployment placeholder

All implemented; see `apps/api/src/routes/v1/tenants.ts:performCreate`.

**Roadmap.**
- **M1 — this PR.** `/v1/tenants` CRUD, SPA bootstrap consumption, "New
  tenant" modal, audit-in-transaction.
- **M2 — next sprint.** G2 (user-scoped tokens), G4 (tenant-keyed code-agent
  registry), G5 (tenant-scoped provider keys), G7 (per-tenant concurrency
  caps).
- **M3 — this quarter.** G3 (tenant code sandboxing via Worker threads), G6
  (canary `traffic_pct` column), G8 (real `subflow` via `step.invoke`),
  Postgres driver, platform-admin layer.
- **M4 — this year.** Template library, multi-process deployment, data
  residency, secret rotation, SOC2-shaped audit export.

---

## Reviewer 2 — Principal Full-stack Engineer

**Brief.** Code review of the existing backend (Fastify + Drizzle + Inngest)
and SPA portal with an eye for what could go wrong when tenant management
ships.

**Top-line assessment.** Solid early-stage shape. Split-Fastify/Next
architecture, Zod-as-source-of-truth, durable Inngest patterns, and
at-most-one-place tenant resolution in `requireAuth` are textbook. Where it
shows its age is exactly where tenant CRUD will live: no `tenants` write
surface, no platform-admin role, no audit on identity events, no enforcement
that the SPA's active tenant matches the authenticated tenant on the API.

**Three risks flagged before tenant CRUD lands.**

1. **Dev auth is one env-var typo from being a back-door.** `AUTH_MODE=dev`
   plus `AGENTIC_DEV_TENANT=<slug>` plus `NODE_ENV=production` gives every
   unauthenticated request full admin against that tenant.
   **(Addressed)** `assertAuthModeSafe()` in `apps/api/src/plugins/auth.ts`
   refuses to start when both flags are set, validates that the dev tenant
   exists, and prints a loud warning when dev mode is on.

2. **Soft-delete is advertised but unused.** `deletedAt` columns exist on
   `events`, `runs`, `tasks` (`schema.ts:222, 287, 370`) but no list query
   filters on `isNull(deletedAt)`. *(Partial fix)* The new
   `listTenantsWithCounts` and `tenantHasActiveWork` in
   `apps/api/src/queries/tenants.ts` correctly add the `isNull(...)`
   predicates for both runs and tasks. Broader retroactive fix is tracked.

3. **HITL `task.resolved` is not tenant-scoped.** `register.ts:213-216`'s
   `if: 'async.data.taskId == "..."'` would let tenant A's UI resolve
   tenant B's task. Open — needs `tenantId` added to the event payload and
   the predicate.

**Required-before-merge checklist (from the reviewer).**

| # | Item | Status |
|---|------|--------|
| 1 | Slug regex `^[a-z][a-z0-9-]{1,31}$` enforced at Zod layer | **Addressed** — `TENANT_SLUG_REGEX` in `packages/contracts/src/tenants.ts` |
| 2 | Reserved-list rejection (`__system`, `system`, `admin`, `api`, `v1`, …) | **Addressed** — `RESERVED_TENANT_SLUGS` + `isReservedSlug()` |
| 3 | `isPlatformAdmin` actually implemented | Open — auth.ts:101 still stub; this milestone allows any auth'd caller |
| 4 | `AUTH_MODE=dev` + `NODE_ENV=production` = exit 1 | **Addressed** — `assertAuthModeSafe()` |
| 5 | Audit row in same transaction | **Addressed** — `performCreate`, update handler, archive handler, restore handler all write `audit_log` inside `db.transaction(...)` |
| 6 | Confirmation token on archive (`confirm: <slug>`) | **Addressed** — `TenantArchiveBody.confirm` enforced server-side |
| 7 | Idempotency-Key support on POST | **Addressed** — in-memory LRU, 1h TTL |
| 8 | Cross-tenant IDOR sweep test | Open — added to test plan (`tc-62-tenants-isolation.test.ts`) |
| 9 | HITL filter expression includes `tenantId` | Open — tracked in `register.ts` follow-up |
| 10 | Mutex around `reregisterInngest` | **Addressed** — `reregisterChain` in `inngest-registry.ts` |
| 11 | SPA "New tenant" flow shows bootstrap token exactly once | **Addressed** — `TenantsTokenRevealModal` with `acked` gate |
| 12 | Document slug immutability; reject `slug` in PUT body | **Addressed** — `TenantUpdateBody.strict()` |
| 13 | Provider-key tenant scope fixed or removed | Open — Reviewer 1 G5 |
| 14 | Membership join in `GET /v1/tenants` | Partial — `forUserId` parameter implemented; `requireAuth` doesn't yet expose a `userId` so the parameter is currently always null |
| 15 | Rate-limit / security headers compliance on new endpoints | Inherited — the `/v1` prefix scope picks up envelope→auth→security registration order from `server.ts:92-94` |

**N+1 hotspots flagged for follow-up.**
- `queries/agents.ts:18-88` runs an unscoped `versionRows` query that grows
  with version history.
- `queries/counts.ts:33-72` pulls all runs into memory then filters.
- `queries/workflows.ts:101-115` same pattern.

The new `listTenantsWithCounts` in `apps/api/src/queries/tenants.ts` is
batched correctly (4 queries regardless of tenant count); the pattern can be
back-ported.

---

## Reviewer 3 — PRD author

The PRD agent produced `docs/prd/agentic-operator-prd.md` (~4,300 words,
12 sections). Two flagged risks from that document:

1. **Schema gap** — current `tenants` table lacked `archivedAt`/`updatedAt`.
   **(Addressed)** Migration `0011_tenant_lifecycle.sql`.
2. **Slug reservation race** — required Idempotency-Key support so retries
   don't double-mint. **(Addressed)** See Implementation Detail §6.

---

## Synthesis

All three reviewers converged on the same milestone scope for P5-TEN-01:
**ship the lifecycle surface and the SPA, deliberately defer identity +
sandbox.** The implementation in this PR matches that scope precisely.

Items marked **(Addressed)** above all have file:line references in
`docs/impl/tenant-management-impl.md`. The remaining items appear as the
"M2 — next sprint" backlog and are tracked in §11 of the implementation
doc.

The reviews disagree on one minor point: Reviewer 1 leans toward letting
the platform-admin gate stay a stub until M2; Reviewer 2 wants it tightened
before any tenant write endpoint ships. The implementation takes a middle
path: every endpoint requires `requireAuth`, but membership-role enforcement
is deferred to P5-TEN-02 (when token → user identity lands). Operators
running in `AUTH_MODE=dev` retain full access, which is acceptable for the
current milestone given the new boot-time guard.

---

## Addendum — M2 hardening landed in the same PR (2026-05-20 PM)

After the initial reviews returned and the core tenant lifecycle work
landed, the same session also closed four further items the Principal
Engineer had flagged as blockers or near-blockers:

- **H1 — HITL cross-tenant resume.** `task.resolved` Inngest events now
  carry `tenantId`, and `step.waitForEvent` predicates pin to both
  `taskId` and `tenantId`. See `apps/api/src/routes/v1/tasks.ts` and
  `packages/runtime/src/register.ts:221-230`.

- **H2 — `reregisterInngest` race.** Single-slot promise-chain mutex in
  `apps/api/src/services/inngest-registry.ts:102-124` serializes concurrent
  rebuilds. The chain's `.catch(() => undefined)` keeps a failed rebuild
  from poisoning every future call.

- **G4 — code-agent registry tenant key (partial).** The newer
  `@agentic/agent-runtime` registry has the `${tenantSlug}:${name}` key
  format with a tenant-aware `get(name, tenantSlug?)` lookup; the legacy
  `@agentic/agents` registry on HEAD still uses the 1-arg signature.
  `agent-invoke.ts` carries a comment marking the swap once the bootstrap
  refactor lands.

- **G5 — provider-key tenant scoping.** New precedence in
  `apps/api/src/services/provider-keys.ts:165-208`: tenant-scope exact
  match → workspace-scope → env. Bare tenant-scoped records without a
  matching `tenantId` are no longer used as platform defaults — closes the
  silent cross-tenant credentials bleed.

- **G7 — per-tenant Inngest concurrency.** Concurrency key composed as
  `${tenantSlug}:${event.data.subject}` in
  `packages/runtime/src/register.ts:75-95`. One tenant cannot consume
  another's subject slots; per-agent `concurrency.max_concurrent_executions`
  from the manifest is honored as the slot count.

The remaining backlog (G2 user identity, G3 sandbox, G6 canary, G8
subflow, G9 schema in-flight, G10 Postgres swap) is unchanged.

— *End of consolidated review.*
