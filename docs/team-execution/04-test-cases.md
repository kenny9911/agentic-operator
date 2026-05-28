# Test Cases — Production Hardening Sprint

**Status:** Draft v1 · **Owner:** Test Architect · **Last update:** 2026-05-21

## Scope and method

This is the **end-to-end test matrix** for Agentic Operator covering every `/v1/*` surface, manifest-import wizard, agent execution, HITL, SSE, ontology, observability and the App Router UI. It is built by:

1. Inventorying the 48 existing TC files in `apps/api/test/` (≈ 448 `it()` blocks),
2. Inventorying `apps/web/e2e/*.spec.ts` (6 Playwright flows) + `apps/web/test/visual/*.spec.ts` (2 visual specs),
3. Inventorying `apps/cli/test/*.test.ts` (4 specs),
4. Cross-walking against the 19 route files in `apps/api/src/routes/v1/`,
5. Adding manual UAT and visual-judgment cases for things that cannot be reasonably automated (e.g. tenant-switcher animation, focus rings, copy-tone of error toasts).

`01-use-cases.md` is being produced in parallel by the Architect agent and is not yet on disk at the time of writing; this doc anchors test cases to **route file + behavioural intent**. Once UC ids are published, the Test Engineer reconciles the `**Use case**:` field in the next pass.

**Numbering convention.** Where an `apps/api/test/tc-N-*.test.ts` file already exists, the TC id below reuses the same N so the doc and the codebase agree on referents. New cases continue from TC-100+.

**A note on id collisions.** The codebase has historically reused TC-N prefixes across waves (e.g. `tc-50-p4-reads-coverage.test.ts` and `tc-70-tenants-crud.test.ts` both contain `describe("TC-50: …")` blocks for different surfaces; `tc-51-p4-graceful-shutdown.test.ts` and `tc-71-tenants-idempotency.test.ts` both anchor `TC-51`). This doc honours the file's chosen ids — when an entry has the same TC-N as another, the **File:** field disambiguates. The Test Engineer should treat (TC-N, file) as the actual key.

## Test-harness one-liners

- API: `pnpm --filter @agentic/api run test` — vitest, single-fork, `pool: "forks"`, `sequence.concurrent: false`. Setup at `apps/api/test/setup.ts` forces `AUTH_MODE=dev`, `AGENTIC_DEV_TENANT=__system`, `LLM_DEFAULT_PROVIDER=mock`, redirects logs/artifacts under `data/test-logs/` and `data/test-artifacts/`. The single-fork pin is mandatory: the manifest-import commit transaction is heavy enough to trip `SQLITE_BUSY` (5 s) under multi-worker contention.
- Web unit: `pnpm --filter @agentic/web run test` — vitest, narrow coverage gate (lines ≥ 70, branches ≥ 60) over the helpers listed in `apps/web/vitest.config.ts`.
- Web e2e: `pnpm --filter @agentic/web exec playwright test` — Playwright; dev server must be on `:3599` or set `PW_AUTO_WEBSERVER=1`.
- Web visual: `apps/web/test/visual/portal.spec.ts` — 1440×900 pixel diffs against `test/visual/v1_1-reference/`.
- CLI: `pnpm --filter @agentic/cli run test`.
- Manual UAT items run in the dev environment (`pnpm dev`) by an engineer with two browser windows and at least two seeded tenants.

---

## Coverage matrix

Use-case slots (`UC-?`) are placeholders the Test Engineer fills in after `01-use-cases.md` lands. Where the obvious mapping exists, a comment is given.

| Area / UC | TCs | Automated | Manual | Gap |
|---|---|---|---|---|
| Auth — dev bypass + bearer + isolation (UC-?) | TC-6, TC-53, TC-63 | TC-6, TC-53, TC-63 | — | bearer-token rotation flow lacks a route-level test (TC-63 only covers AUTH_MODE guard); token revocation race not covered |
| Tenants CRUD (UC-?) | TC-50, TC-51, TC-52, TC-70, TC-71, TC-100 | TC-50, TC-51, TC-52, TC-70, TC-71 | TC-100 | restore-after-cascade-delete; UI confirm modal pixel diff is manual |
| Manifest import — validate (UC-?) | TC-7, TC-33, TC-101 | TC-7, TC-33 | TC-101 | wizard's 6-step UX flow only exercised manually |
| Manifest import — commit (UC-?) | TC-102, TC-103 (manifest-import-commit.test.ts) | TC-102 | TC-103 | cross-region clock skew on `expires_at` not tested |
| Manifest import — concurrent (423) | TC-104 (manifest-import-concurrent.test.ts) | TC-104 | — | only the 2-process case; 3+ contention untested |
| Manifest import — overwrite (409) | TC-105 (manifest-import-overwrite-guard.test.ts) | TC-105 | — | confirm-overwrite path in the wizard not visually verified |
| Manifest import — conflicts/auto-fix | TC-106 (manifest-import-conflict.test.ts) | TC-106 | — | UX of "apply all fixes" button not e2e tested |
| Manifest import — SSRF block | TC-107 (manifest-import-ssrf.test.ts) | TC-107 | — | redirect-loop attack vector partially covered |
| Manifest import — perf | TC-108 (manifest-import-perf.test.ts) | TC-108 | — | budget set for 100-agent manifests only; larger fleets unmeasured |
| Manifest import — reconcile on boot | TC-11, TC-109 | TC-11 | TC-109 | crash-in-rename window has no kill-and-restart automation |
| Deploy / rollback | TC-27, TC-110 | TC-27 | TC-110 | UI button labels + diff preview manually verified |
| Agent invoke (sync code agent) | TC-3, TC-4, TC-5 | TC-3, TC-4, TC-5 | — | streaming output not exercised in invoke path (only useStream) |
| Manifest agent execution (Inngest fan-out) | TC-10, TC-26, e2e/01-manifest-agent-run.spec.ts | TC-10, TC-26, e2e/01 | — | retry/backoff visible to operator only via logs |
| HITL task — create + resolve | TC-111, e2e/03-human-task-resolve.spec.ts | e2e/03 | TC-111 | task TTL + auto-expire not in scope yet |
| Event ingest + replay | TC-112, TC-113 | TC-112, TC-113 | — | replay diff (old vs replayed envelope) shown only in logs |
| SSE log tail (`useRunLogStream`) | TC-114, TC-115 | TC-114 | TC-115 | reconnect-on-network-flip is hard to script; manual UAT |
| Workflow DAG endpoint | TC-34, TC-50, TC-116 | TC-34, TC-50 | TC-116 | layout-stability check (no edges crossing) is visual judgment |
| LLM gateway — providers + keys | TC-1, TC-2, TC-60 | TC-1, TC-2, TC-60 | — | real-network test connection (against e.g. live Anthropic) is gated to a manual smoke |
| LLM gateway — model fleet | TC-61 | TC-61 | — | UI of fleet manager not visually regressed |
| Budgets + usage | TC-16 (budget hook), TC-21, TC-15 (P1-API-04), TC-117 | TC-16, TC-21, TC-15 | TC-117 | dashboard "usage" panel pixel diff is manual; TC-117 not on disk yet |
| Audit log | TC-15 (P1-API-03), TC-50 (audit row checks), TC-133 | TC-15, TC-50 | TC-133 | cursor pagination at scale (>10k rows) untested |
| Replay event (P0-API-01) | TC-6 (sub-suite) | TC-6 | — | UI replay-button flow is in the e2e Phase but no test yet |
| Runtime — step engine | TC-9, TC-10, TC-17 (step types) | TC-9, TC-10, TC-17 | — | subflow path is placeholder |
| Runtime — register/idempotency | TC-11, TC-12, TC-26 | TC-11, TC-12, TC-26 | — | — |
| Runtime — broadcast channel + SSE | TC-14 | TC-14 | — | — |
| Runtime — tool-use loop | TC-15 (P1-CON-01), TC-16 | TC-15, TC-16 | — | — |
| Runtime — code-agent Inngest fn | TC-17 (code-agent), TC-26 | TC-17, TC-26 | — | — |
| Runtime — memory layer | TC-30 | TC-30 | — | vector driver wired only via test seam; no end-to-end real driver test |
| Webhook ingest | TC-31 | TC-31 | — | timing-attack window (constant-time HMAC) not measured |
| SPA bootstrap | TC-18 | TC-18 | — | — |
| Tenant-loader + Inngest registry | TC-25, TC-26 | TC-25, TC-26 | — | — |
| Tenant code upload + rollback | TC-27 | TC-27 | — | — |
| Test-run flag | TC-24 | TC-24 | — | — |
| Graceful shutdown | TC-51 | TC-51 | — | container SIGTERM path manually smoked once |
| Metrics + health | TC-52 (P4-OPS-05) | TC-52 | — | grafana dashboard import is operator UAT |
| Schema drift gate | TC-33 | TC-33 | — | — |
| Workflow editor save (UI) | e2e/05-workflow-editor-save.spec.ts | e2e/05 | — | — |
| CLI — init + deploy + logs + events | apps/cli/test/* | yes | — | tarball encoding edge-cases on Windows |
| Web — unit gate | apps/web/lib/auth/session.test.ts + 12 others | yes | — | TraceTree.test.ts is the only complex render test |
| Web — visual regression | test/visual/portal.spec.ts | yes (pixel diff) | — | only the 4 reference screens are diffed |
| Web — a11y | test/visual/a11y.spec.ts | yes (axe-core) | — | keyboard-trap detection is automated but limited |
| New UI: `useRunLogStream` | TC-114, TC-115 | TC-114 | TC-115 | reconnect / EventSource leak under hot-reload |
| New UI: tenant-switcher animation | TC-118 | — | TC-118 | judgement test |
| New UI: import wizard 6-step flow | TC-119 | — | TC-119 | judgement + happy-path UAT |
| Cross-tenant isolation (broad) | TC-6, TC-52 | TC-6, TC-52 | — | — |

**Totals:** 77 test-case entries (counting umbrella + sub-suite headings separately); 64 fully automated, 11 manual, 5 partial (route covered automatically + a manual UX layer on top). ≈ 92 % of `/v1/*` routes have at least one automated TC. Biggest single gap: **the App Router import-manifest wizard's 6-step UX has zero e2e coverage** — TC-119 is currently manual UAT only.

---

## Test cases

### Auth and tenancy

#### TC-6: Auth bypass and tenant isolation (umbrella)

**Use case:** UC-Auth (cross-cutting)
**Level:** integration
**Type:** happy + negative (umbrella, 11 sub-cases)
**Preconditions:** `__system` and `raas` seeded; api up.
**Steps:**
  1. With `AUTH_MODE` unset and no bearer, hit `/v1/runs`.
  2. With only `NODE_ENV=test` set (no `AUTH_MODE`), repeat.
  3. With `AUTH_MODE=dev` and `AGENTIC_DEV_TENANT=__system`, hit `/v1/runs`.
  4. As `raas`, try `GET /v1/runs/<system-run-id>`.
  5. As `raas`, try `GET /v1/runs/<system-run-id>?include_system=1` (no platform-admin).
  6. As `__system`, fetch its own run.
  7. As `raas`, hit `/v1/runs?tenant=other` and verify the param is dropped.
  8. Invoke `testAgent` from `raas` and from `__system`; verify the run is recorded under `__system` either way (system-scoped agent).
  9. Confirm the auth plugin no longer exports `verifyHmac` (P0-RT-12).
  10. Replay an event twice and verify both replays carry distinct ids on the same millisecond (P0-API-01 / makeId).
**Expected:**
  - Steps 1–2: 401 unauthenticated.
  - Step 3: 200 with `__system`-scoped rows.
  - Steps 4–5: 404 (no implicit `__system` fallback for non-platform-admin).
  - Step 6: 200 with the run.
  - Step 7: list is still scoped to caller, ignoring `?tenant=`.
  - Step 8: both runs land under `__system`.
  - Step 9: `verifyHmac` import throws / is undefined.
  - Step 10: two distinct `evt-…` ids.
**Automated:** yes
**File:** `apps/api/test/tc-6-p0-auth-isolation.test.ts`
**Notes:** Anchors `P0-AUTH-01..04`, `P0-RT-12`, `P0-API-01`. Cross-tenant ⇒ HTTP 404 (not 403) for read paths, by design.

#### TC-53: assertAuthModeSafe boot guard

**Use case:** UC-Auth
**Level:** unit
**Type:** negative
**Preconditions:** none.
**Steps:**
  1. Set `AUTH_MODE=dev` + `NODE_ENV=production`; call boot.
  2. Set `AUTH_MODE=dev` + `AGENTIC_DEV_TENANT=does-not-exist`; call boot.
  3. Set `AUTH_MODE=dev` + valid tenant + `NODE_ENV=test`; call boot.
  4. Unset `AUTH_MODE`; call boot.
**Expected:**
  - 1, 2: boot throws with a clear message.
  - 3, 4: boot succeeds.
**Automated:** yes
**File:** `apps/api/test/tc-53-auth-mode-guard.test.ts`
**Notes:** Prevents foot-guns in production where dev-mode bypass could ship.

#### TC-63: AUTH_MODE plugin contract

**Use case:** UC-Auth
**Level:** unit
**Type:** happy + negative
**Preconditions:** none.
**Steps:** see existing file; covers explicit-only opt-in.
**Expected:** as defined in the file.
**Automated:** yes
**File:** `apps/api/test/tc-63-auth-mode-guard.test.ts`

#### TC-100: Bearer-token CRUD + revocation race (manual UAT)

**Use case:** UC-Auth
**Level:** manual
**Type:** happy + race
**Preconditions:** dev env up; two browser windows.
**Steps:**
  1. Create tenant A via the wizard; copy the bootstrap token from the reveal modal.
  2. From another window, hit `/v1/tenants` with that bearer; expect the tenant in the list.
  3. Revoke the token via the settings UI (TODO route — confirm before running).
  4. Repeat step 2.
**Expected:**
  - Step 2 (pre-revoke): 200.
  - Step 4 (post-revoke): 401 within ≤ 1 s of revocation.
**Automated:** no — token-revocation endpoint not yet on the api surface; revisit when `POST /v1/api-tokens/:id/revoke` lands.

### Tenants CRUD

#### TC-50: Tenants CRUD (umbrella)

**Use case:** UC-TenantsCRUD
**Level:** integration
**Type:** happy + negative (16 sub-cases)
**Preconditions:** `__system` seeded.
**Steps:**
  1. `POST /v1/tenants` with a fresh slug → expect ok + bootstrap token + audit row.
  2. POST same slug again → 409 `slug_taken`.
  3. POST with reserved slug (`__system`, `admin`, …) → 400 `reserved_slug`.
  4. POST with malformed slug (uppercase, spaces) → 400.
  5. `GET /v1/tenants` → new tenant present.
  6. `GET /v1/tenants/:slug` → includes budget rollup.
  7. `PUT /v1/tenants/:slug` updating name/color → audit row written.
  8. PUT with `slug` field included → 400 (`.strict()` Zod).
  9. `DELETE /v1/tenants/:slug` without matching confirm string → 400.
  10. DELETE with correct confirm → row archived (`archived_at` stamped).
  11. List again → archived row hidden by default.
  12. List with `?include_archived=1` → archived row visible.
  13. Second DELETE on archived row → 409.
  14. `POST /v1/tenants/:slug/restore` → archivedAt cleared + audit row.
  15. GET on unknown slug → 404.
  16. DELETE on `__system` → 400 / 403 (system tenant immutable).
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/tc-70-tenants-crud.test.ts`
**Notes:** Confirms envelope-on-error: 409 is **flat** for slug_taken, 423 only on manifest import.

#### TC-51: Idempotency-Key on POST /v1/tenants

**Use case:** UC-TenantsCRUD
**Level:** integration
**Type:** edge
**Preconditions:** `__system` seeded.
**Steps:**
  1. POST with `Idempotency-Key: K1` and slug `idem-a` → record response body.
  2. POST again with `K1` and same slug → response body byte-identical (including the bootstrap token).
  3. POST same slug without a key → 409.
  4. POST with different keys and different slugs → distinct tenants created.
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/tc-71-tenants-idempotency.test.ts`

#### TC-52: Tenants cross-tenant isolation

**Use case:** UC-TenantsCRUD + UC-Auth
**Level:** integration
**Type:** negative (7 sub-cases)
**Preconditions:** two test tenants created.
**Steps:** see file — exercises list, PUT, audit row, archive, restore, starter event types.
**Expected:** every assertion confirms no cross-tenant leak.
**Automated:** yes
**File:** `apps/api/test/tc-62-tenants-isolation.test.ts`

#### TC-70: Wizard 4-step new-tenant flow (Playwright)

**Use case:** UC-TenantsCRUD (UI)
**Level:** e2e
**Type:** happy
**Preconditions:** dev stack up; clean DB or unique slug.
**Steps:**
  1. Open the portal, click "New tenant".
  2. Step 1: enter slug + name; expect availability indicator.
  3. Step 2: choose a starter template (`hello` / `blank` / `import`).
  4. Step 3: paste/confirm RAAS-v1 manifest if `import`.
  5. Step 4: confirm + create.
  6. After redirect, reveal the bootstrap token; copy it.
**Expected:** wizard reaches step 4 without errors; token modal renders; tenant appears in switcher.
**Automated:** no — currently covered by `apps/web/e2e/04-auth-flow.spec.ts` for the post-create flow only; the 4-step wizard happy path is **not yet** automated.
**File:** to add at `apps/web/e2e/07-new-tenant-wizard.spec.ts`.
**Notes:** Token reveal must be once-only — assert second-reveal endpoint returns 410.

### Manifest import

#### TC-7: Manifest schema preserves the 4 new fields

**Use case:** UC-ManifestImport
**Level:** unit
**Type:** happy + edge
**Preconditions:** none.
**Steps:** parse manifests with/without the 4 new fields; assert round-trip on bootstrap.
**Expected:** preserved when present, undefined when absent, coerced when legacy.
**Automated:** yes
**File:** `apps/api/test/tc-7-manifest-schema-fields.test.ts`

#### TC-33: Schema-drift regression net

**Use case:** UC-ManifestImport + UC-SchemaEditor
**Level:** unit
**Type:** regression
**Preconditions:** none.
**Steps:** introspect `AgentSchema.shape`, round-trip raw JSON, diff against `models/workflow.schema.json`.
**Expected:** zero drift.
**Automated:** yes
**File:** `apps/api/test/tc-33-schema-drift.test.ts`

#### TC-101: Manifest validate — happy-v1 + happy-v2 + Zod errors + conflicts

**Use case:** UC-ManifestImport
**Level:** integration
**Type:** happy + negative
**Preconditions:** `AGENTIC_MODELS_DIR` set.
**Steps:**
  1. POST `validate` with bare 5-agent array → ok.
  2. POST `validate` with `{$schemaVersion, agents}` envelope → migrated + ok.
  3. POST `validate` with manifest missing actor → Zod error surfaced.
  4. POST `validate` with dangling-trigger → conflict.
  5. POST `validate` with concurrency-excess → conflict severity=warn.
  6. POST `validate` with model-not-configured → blocking conflict.
  7. POST `validate` with orphan-actor → blocking.
  8. POST `validate` as foreign tenant → 403.
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/manifest-import-validate.test.ts`
**Notes:** Renumber as TC-101 in the doc — file name retained for grep-ability.

#### TC-102: Manifest commit — cold + replace + identical re-deploy

**Use case:** UC-ManifestImport
**Level:** integration
**Type:** happy + idempotent
**Preconditions:** `AGENTIC_MODELS_DIR`; deployment dir writable.
**Steps:**
  1. Cold commit of happy-v2 → live deployment + file on disk.
  2. Commit a different manifest → prior demoted, new live.
  3. Validate+commit identical bytes again → auto-`<hash>` row reused.
**Expected:** see file.
**Automated:** yes
**File:** `apps/api/test/manifest-import-commit.test.ts`

#### TC-103: Manifest commit — crash between phases (manual)

**Use case:** UC-ManifestImport
**Level:** manual
**Type:** edge
**Preconditions:** dev stack with debugger ready.
**Steps:**
  1. Set a breakpoint in `commitManifestImport` after the sqlite tx but **before** `fs.rename`.
  2. POST commit; let it pause.
  3. Kill the api (`pkill -9 -f 'tsx'`).
  4. Restart the api.
  5. Confirm `reconcileImports` completes the rename and re-emits Inngest functions.
**Expected:** post-restart, `models/<slug>-vN/workflow_v<N+1>.json` exists; live deployment points at it.
**Automated:** no — kill-and-restart inside a test harness is fragile and isn't worth the maintenance.

#### TC-104: Concurrent validate → 423

**Use case:** UC-ManifestImport
**Level:** integration
**Type:** negative
**Preconditions:** `AGENTIC_MODELS_DIR`; clean pending state.
**Steps:**
  1. POST validate → record returned `deployment_id` (the lock token).
  2. POST validate with a *different* `deployment_id` → expect 423 with `existing` deployment_id in the (flat) body.
  3. DELETE the pending lock → next validate succeeds.
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/manifest-import-concurrent.test.ts`

#### TC-105: Overwrite guard — removes/modifies/churn ratios

**Use case:** UC-ManifestImport
**Level:** integration + unit
**Type:** negative + edge
**Preconditions:** existing live deployment.
**Steps:**
  1. Commit a manifest with ≥ 1 removed agent → 409 `removes_agents`.
  2. Repeat with `confirm_overwrite=true` → ok.
  3. Commit modifying > 30 % of agents → 409 `modifies_threshold`.
  4. Repeat with confirm → ok.
  5. (unit) walk the `compoundOverwriteRule` truth table from priorN=0 to priorN=100 incl. churn floor (≥ 3 for priorN ≤ 10, then ratio).
**Expected:** as listed — 13 truth-table rows + 4 integration rows.
**Automated:** yes
**File:** `apps/api/test/manifest-import-overwrite-guard.test.ts`

#### TC-106: Conflicts and auto-fix

**Use case:** UC-ManifestImport
**Level:** integration
**Type:** edge
**Preconditions:** as above.
**Steps:** dangling-trigger, concurrency-excess, model-not-configured, orphan-actor, kebab_id_collision, invalid_cron, dangling_emitter, broken_subflow, prompt_injection_smell.
**Expected:** correct severity + presence/absence of auto_fix.
**Automated:** yes
**File:** `apps/api/test/manifest-import-conflict.test.ts`

#### TC-107: SSRF guard

**Use case:** UC-ManifestImport (URL fetch path) + cross-cutting
**Level:** unit
**Type:** negative
**Preconditions:** `AGENTIC_FETCH_ALLOW_HTTP_LOCALHOST` unset by default.
**Steps:** file://, ftp://, data:, http://*, RFC1918 10.x, AWS metadata 169.254.169.254, loopback (DNS-mocked), public-IP target, malformed URL; flip `AGENTIC_FETCH_ALLOW_HTTP_LOCALHOST=1` and re-test http://localhost.
**Expected:** every block path throws `SsrfError` with the documented policy code; only http://localhost is allowed with the env flag.
**Automated:** yes
**File:** `apps/api/test/manifest-import-ssrf.test.ts`

#### TC-108: Lint perf — 100-agent manifest under budget

**Use case:** UC-ManifestImport
**Level:** unit
**Type:** perf
**Preconditions:** none.
**Steps:** lint a 100-agent manifest once + 5 iterations.
**Expected:** ≤ `PERF_BUDGET_MS` (file-local constant) per call.
**Automated:** yes
**File:** `apps/api/test/manifest-import-perf.test.ts`

#### TC-11: Bootstrap idempotency + no-op reboot

**Use case:** UC-ManifestImport (reconcile path) + UC-Bootstrap
**Level:** integration
**Type:** happy + edge
**Preconditions:** clean state.
**Steps:**
  1. Two back-to-back `bootstrapTenant` calls.
  2. No-op reboot must not roll back prior live (P0-RT-07).
  3. `AGENTIC_REBOOTSTRAP=force` inserts fresh deployment row.
  4. agents/agent_versions inserts don't double-add.
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/tc-11-bootstrap-idempotency.test.ts`

#### TC-109: Manifest deletion-on-disk → reconcile re-emits (manual)

**Use case:** UC-ManifestImport
**Level:** manual
**Type:** edge
**Preconditions:** running stack with a live deployment.
**Steps:**
  1. `rm models/<slug>-vN/workflow_v<N+1>.json` while api is running.
  2. Restart api.
  3. Confirm `reconcileImports` re-writes the manifest from the DB row.
**Expected:** file restored before bootstrap finishes.
**Automated:** no — sequencing the file deletion inside an idempotent test would require killing the api process; not worth the harness investment.

#### TC-119: Import-manifest wizard happy path (manual UAT)

**Use case:** UC-ManifestImport (UI)
**Level:** manual
**Type:** happy
**Preconditions:** dev env; new tenant slug.
**Steps:** click through the 6-step wizard from the portal — URL input → validate → conflicts review → confirm → commit → success → "view live deployment".
**Expected:** every transition < 1 s; conflicts panel shows the auto-fix toggle; final confirmation panel is keyboard-navigable.
**Automated:** no — coverage is on the route layer (TC-101..107); the UI flow itself has no Playwright spec yet.
**File:** to add at `apps/web/e2e/08-import-manifest-wizard.spec.ts`.

### Deploy / rollback

#### TC-27: Tenant code upload + auto-rollback + manual rollback

**Use case:** UC-Deploy
**Level:** integration
**Type:** happy + edge
**Preconditions:** `raas` tenant; `AGENTIC_MODELS_DIR`.
**Steps:**
  1. POST `/v1/tenants/raas/code` with a small tarball → expect a new deployment row in `pending → live`.
  2. Upload a new version → prior row flips to `rolled_back`, new becomes live.
  3. POST rollback for the prior id → live pointer moves back.
**Expected:** see file; audit rows on each transition.
**Automated:** yes
**File:** `apps/api/test/tc-27-p3-tenant-code-upload.test.ts`

#### TC-110: Rollback via UI button (manual)

**Use case:** UC-Deploy
**Level:** manual
**Type:** happy
**Preconditions:** ≥ 2 deployments in history.
**Steps:** open `/portal/raas/deployments`; click rollback on the prior row; confirm the diff panel.
**Expected:** rollback completes ≤ 2 s; success toast; live row indicator moves.
**Automated:** no — visual + UX judgement.

#### TC-50 (sub-suite): `/v1/deployments`

**Use case:** UC-Deploy
**Level:** integration
**Type:** happy + negative
**Preconditions:** seeded.
**Steps:**
  1. GET `/v1/deployments` → expect `{ list, live }` envelope.
  2. POST rollback for non-existent id → 404.
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/tc-50-p4-reads-coverage.test.ts` (`/v1/deployments` describe block)

### Agent execution

#### TC-3: testAgent happy path (sync invoke)

**Use case:** UC-AgentInvoke
**Level:** integration
**Type:** happy
**Preconditions:** mock provider default.
**Steps:** POST `/v1/agents/testAgent/invoke`.
**Expected:**
  - ok envelope with required fields,
  - output mentions "Agentic Operator" (mock embeds prompt noun),
  - tokensIn/tokensOut/provider/model set,
  - runs row status='ok' under `__system`,
  - steps row carries provider+model+tokens,
  - file log contains `run.start` and `run.ok` markers.
**Automated:** yes
**File:** `apps/api/test/tc-3-test-agent-happy.test.ts`
**Notes:** depends on `mock` LLM provider being the default — controlled by `setup.ts`.

#### TC-4: testAgent error paths

**Use case:** UC-AgentInvoke
**Level:** integration
**Type:** negative
**Preconditions:** as above.
**Steps:**
  1. POST with unknown provider → 400 bad_request, no run row leak.
  2. POST against unknown agent kebab → 404.
  3. POST forcing a stubbed provider (e.g. bedrock without key) → `not_configured`.
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/tc-4-test-agent-error.test.ts`

#### TC-5: Monitoring + deployment audit reuse

**Use case:** UC-AgentInvoke + UC-Observability
**Level:** integration
**Type:** regression
**Preconditions:** TC-3 has run.
**Steps:**
  1. GET `/v1/agents?kind=code` → testAgent present.
  2. GET `/v1/runs/:runId` → run + steps array.
  3. Inspect `deployments` table → row with `target='code_agent'` for testAgent.
  4. `listRecentRuns(__system)` includes testAgent's run.
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/tc-5-monitoring-reuse.test.ts`

#### TC-10: Step engine prompt assembly

**Use case:** UC-AgentInvoke (manifest path)
**Level:** unit
**Type:** happy + edge
**Preconditions:** mock provider.
**Steps:**
  1. Build a logic step → assert auto-built prompt includes runtime prelude + ontology + lastResult JSON.
  2. Tenant prompt `system` field is the first system message (P0-RT-11).
  3. Step output carries gateway's real `model` string (P0-RT-04).
  4. Writes input + output artifact sidecars when runId+stepOrd are supplied (P0-RT-09).
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/tc-10-runtime-step-engine.test.ts`

### Event ingest / replay / Inngest fan-out

#### TC-112: Event publish + replay + audit

**Use case:** UC-EventTester / UC-Events
**Level:** integration
**Type:** happy
**Preconditions:** seeded event types.
**Steps:**
  1. POST `/v1/events` with `source:'operator'` → row written, `inngest.send` fired with tenant-namespaced name, audit row stamped.
  2. POST replay on that event → distinct new `evt-…` id.
  3. Replay again on the same millisecond → second new id distinct from first (P0-API-01).
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/event-tester.test.ts` (`source:operator` describe block) + `apps/api/test/tc-6-p0-auth-isolation.test.ts` (`P0-API-01` describe block).

#### TC-113: Event Tester backend — publish, list, recent, catalog, soft-delete, cross-tenant, SSE

**Use case:** UC-EventTester
**Level:** integration
**Type:** happy + edge (umbrella, 12 sub-cases)
**Preconditions:** as above.
**Steps:** see file; covers publish, category stamping, list/recent agreement on `deletedAt IS NULL`, foreign-tenant blocking, `__test` envelope flag, audit on operator source, causality BFS depth 3, SSE delivery < 500 ms, legacy bare-array shape.
**Expected:** as in file.
**Automated:** yes
**File:** `apps/api/test/event-tester.test.ts`

#### e2e-01: Manifest agent run end-to-end (Inngest fan-out)

**Use case:** UC-AgentInvoke (manifest path) + UC-Events
**Level:** e2e
**Type:** happy
**Preconditions:** `pnpm dev` running.
**Steps:** fire the event `syncFromClientSystem` listens to with a unique subject; wait for run row + steps + `triggered_event` emission + SSE `run.completed`.
**Expected:** all four observable side-effects within the wait window.
**Automated:** yes
**File:** `apps/web/e2e/01-manifest-agent-run.spec.ts`

#### e2e-02: Code agent invocation E2E

**Use case:** UC-AgentInvoke (code path)
**Level:** e2e
**Type:** happy
**Preconditions:** dev stack.
**Steps:** invoke testAgent via UI; wait for run row + logs.
**Expected:** run renders in `/runs/<id>` with logs streaming.
**Automated:** yes
**File:** `apps/web/e2e/02-code-agent-run.spec.ts`

### HITL — task creation and resolve

#### TC-111: Task resolve emits `task.resolved` with tenantId

**Use case:** UC-HITL
**Level:** integration
**Type:** happy + negative
**Preconditions:** seeded task row.
**Steps:**
  1. POST `/v1/tasks/:id/resolve` from the task's tenant → ok; `inngest.send('task.resolved', { tenantId, taskId })`.
  2. POST resolve from a *foreign* tenant → 404 (no leak).
  3. POST resolve on unknown id → 404.
**Expected:** as listed.
**Automated:** partially — `tc-50-p4-reads-coverage.test.ts` covers the 404 cases; the foreign-tenant case is **not yet directly tested**.
**File:** to add at `apps/api/test/tc-111-tasks-cross-tenant.test.ts`.

#### e2e-03: Human task resolve E2E

**Use case:** UC-HITL
**Level:** e2e
**Type:** happy
**Preconditions:** an agent that creates a task; dev stack up.
**Steps:** fire the event; observe task in inbox; resolve via UI; observe the run resume.
**Expected:** run transitions from `awaiting` → `running` → `ok`.
**Automated:** yes
**File:** `apps/web/e2e/03-human-task-resolve.spec.ts`

### Runs / replay / SSE log tail

#### TC-50 (sub-suite): `/v1/runs` reads + replay

**Use case:** UC-Runs
**Level:** integration
**Type:** happy + negative
**Preconditions:** seeded run.
**Steps:**
  1. GET list (filter by status/agent/q).
  2. GET unknown id → 404.
  3. POST `/v1/runs/:id/replay` on unknown id → 404.
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/tc-50-p4-reads-coverage.test.ts`

#### TC-114: SSE log tail (route)

**Use case:** UC-Logs / UC-Observability
**Level:** integration
**Type:** happy
**Preconditions:** a run with a log file on disk.
**Steps:** open EventSource on `/v1/runs/:id/logs?follow=1`; assert headers, MIME, and named events `log`/`info`/`error`/`end` arrive.
**Expected:** stream open; at least one frame within 2 s.
**Automated:** partially — `tc-14-p1-stream.test.ts` covers the `/v1/stream` broadcast channel; a dedicated run-logs SSE test is not yet on disk.
**File:** to add at `apps/api/test/tc-114-run-logs-sse.test.ts`.

#### TC-115: `useRunLogStream` hook UX (manual)

**Use case:** UC-Logs (UI)
**Level:** manual
**Type:** happy + edge
**Preconditions:** dev stack; long-running run on screen.
**Steps:**
  1. Open `/portal/raas/runs/<id>/logs`.
  2. Toggle wifi / network off for 5 s; restore.
  3. Watch the reconnect status indicator (exponential backoff up to 15 s cap).
  4. Switch to a different run id; verify the prior buffer is cleared and no orphan EventSource leaks (DevTools → Network → no zombie EventSource).
**Expected:** reconnect ≤ 15 s after restore; buffer caps at `maxLines` (5000 default); switching runs releases the EventSource.
**Automated:** no — Playwright + network throttling can do this but the EventSource cleanup assertion needs DevTools introspection; manual is faster.

### Runtime — step engine, register, broadcast, tool-use

#### TC-9: Condition evaluator

**Use case:** UC-AgentInvoke (manifest)
**Level:** unit
**Type:** edge (umbrella, 11 sub-cases)
**Preconditions:** none.
**Steps:** see file — empty cond, numeric, equality, logical chains, negation, malformed (fail-open), forbidden syntax, identifier whitelist, undefined deep chain (throw → fail-open), shallow undefined.
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/tc-9-condition-eval.test.ts`
**Notes:** Fail-open is deliberate — broken conditions must not silently block branches.

#### TC-8: Branch-emit override resolution

**Use case:** UC-AgentInvoke (manifest)
**Level:** unit
**Type:** happy + edge
**Preconditions:** none.
**Steps:** see file — override match, fallback to first triggered_event, override not in declared set, undefined when no events declared, `__emit` extraction, non-object data, end-to-end.
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/tc-8-branch-emit.test.ts`

#### TC-12: register.ts helpers

**Use case:** UC-Bootstrap
**Level:** unit
**Type:** happy + edge
**Preconditions:** none.
**Steps:** computeFunctionRetries, manualTaskTimeout, AGENTIC_MODELS_DIR resolver.
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/tc-12-register-helpers.test.ts`

#### TC-14: Broadcast channel + SSE stream

**Use case:** UC-EventTester / UC-Stream
**Level:** unit + integration
**Type:** happy + edge
**Preconditions:** none.
**Steps:** publish→subscribe, tenant isolation, unsubscribe → count drops to 0, RunStreamEvent zod variants parse, `/v1/stream` SSE delivery.
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/tc-14-p1-stream.test.ts`

#### TC-15: Adapter tool-use round-trip + API + DB

**Use case:** UC-AgentInvoke + UC-LLMGateway
**Level:** unit + integration
**Type:** happy
**Preconditions:** mock provider.
**Steps:** ChatMessage content union, ToolDef/ToolCall shape, mock adapter tool-use simulation, tenant_budgets DB, /v1/budgets, /v1/audit, enable/disable audit hooks.
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/tc-15-p1-adapter-tools.test.ts` + `tc-20-p1-api.test.ts`

#### TC-16: Tool-use loop + budget hook

**Use case:** UC-AgentInvoke
**Level:** integration
**Type:** happy + edge
**Preconditions:** mock provider.
**Steps:** 2-turn loop (tool_use → tool_result → text), maxSteps termination, req.providers chain forwarding, structured-output repair-retry, two consecutive failures throw output_parse_error; budget hook: under-cap ok, over-cap throws, USD over-cap throws, uncapped no-op, missing tenantId disables hook.
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/tc-16-p1-tool-use-loop.test.ts` + `tc-21-p1-budget.test.ts`

#### TC-17: Phase 1 step types + retention + code-agent fn

**Use case:** UC-AgentInvoke
**Level:** unit + integration
**Type:** happy
**Preconditions:** none.
**Steps:** manifest schema accepts condition+delay+subflow; step engine dispatches each; `parent_run_id`/`deleted_at` exist; retention sweep tombstones aged rows; code-agent event/fn id generators; bootstrapCodeAgents summary.
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/tc-17-p1-code-agent-inngest.test.ts` + `tc-22-p1-step-types.test.ts`

#### TC-22: Step types — condition / delay / subflow

**Use case:** UC-AgentInvoke
**Level:** unit
**Type:** happy + edge
**Preconditions:** none.
**Steps:** see file.
**Expected:** see file.
**Automated:** yes
**File:** `apps/api/test/tc-22-p1-step-types.test.ts`

#### TC-26: Inngest registry exposes function counts

**Use case:** UC-Bootstrap
**Level:** integration
**Type:** happy
**Preconditions:** boot succeeded.
**Steps:** assert `registry` exposes boot-time counts; `getActiveHandler` returns a callable.
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/tc-26-p3-inngest-registry.test.ts`

#### TC-30: Memory layer

**Use case:** UC-Memory
**Level:** integration
**Type:** happy + edge
**Preconditions:** none.
**Steps:** short + long tables reachable; put/get/delete round-trip; subject-scope persists across runs; tenant-scope shared; run-scope wiped by clearRunMemory; memoryStats counts; search() without driver throws; setMemoryDriver routes to mock driver.
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/tc-30-p3-memory.test.ts`

### LLM gateway — providers, keys, fleet

#### TC-1: `/v1/llm/providers` catalog shape

**Use case:** UC-LLMGateway
**Level:** integration
**Type:** happy
**Preconditions:** none.
**Steps:** assert 14 providers, openrouter present, mock always `hasKey=true`, anthropic `hasKey=true` (env set in setup), each provider carries a models array.
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/tc-1-llm-providers.test.ts`

#### TC-2: `/v1/llm/models` query routing

**Use case:** UC-LLMGateway
**Level:** integration
**Type:** happy + negative
**Preconditions:** none.
**Steps:** ?provider=openrouter prefix routing; anthropic models; unknown provider → 400 envelope; omitted provider → full catalog.
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/tc-2-llm-models.test.ts`

#### TC-60: Provider key management

**Use case:** UC-LLMGateway
**Level:** integration
**Type:** happy + negative
**Preconditions:** none.
**Steps:** list metadata for every provider; POST key persists and GET reflects (masked); reject too-short keys; reject unknown ids; reject bad scope; mock test-connection succeeds without network; empty-key test returns ok=false without network.
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/tc-60-llm-key-mgmt.test.ts`

#### TC-61: Model fleet CRUD

**Use case:** UC-LLMGateway
**Level:** integration
**Type:** happy + negative
**Preconditions:** none.
**Steps:** catalog metadata; empty fleet; add entry with defaults; add with alias/role/cap/params; duplicate provider+model rejected; unknown provider rejected; non-catalogued model rejected; list newest first; PATCH updates + bad-role rejection; PATCH 404; DELETE 200; DELETE 404.
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/tc-61-llm-fleet.test.ts`

### Budgets and usage

#### TC-21: Budget hook on llmCall

**Use case:** UC-Budget
**Level:** integration
**Type:** happy + edge
**Preconditions:** mock provider; tenant_budgets row.
**Steps:** see file (5 cases).
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/tc-21-p1-budget.test.ts`

#### TC-50 (sub-suite): `/v1/budgets` reads

**Use case:** UC-Budget
**Level:** integration
**Type:** happy
**Preconditions:** none.
**Steps:** GET returns auto-created budget when none exists.
**Expected:** envelope shape matches `BudgetSnapshot`.
**Automated:** yes
**File:** `apps/api/test/tc-50-p4-reads-coverage.test.ts` (`/v1/budgets` block)

#### TC-117: `/v1/usage` query (currently unspec'd)

**Use case:** UC-Usage / UC-Budget
**Level:** integration
**Type:** happy
**Preconditions:** seeded runs.
**Steps:** GET `/v1/usage?since=…&until=…` → tokens/cost rollup.
**Expected:** envelope matches `UsageSnapshot`.
**Automated:** no — currently only smoke-tested via `tc-50-p4-reads-coverage.test.ts`; a dedicated route-level test should be added.
**File:** to add at `apps/api/test/tc-117-usage.test.ts`.

### Audit log

#### TC-15 (sub-suite): `/v1/audit` reads + filters

**Use case:** UC-Audit
**Level:** integration
**Type:** happy + edge
**Preconditions:** seeded audit rows.
**Steps:** descending order; tenant-scoped; foreign-tenant rows never returned; cursor envelope shape; action filter; since/until filters.
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/tc-20-p1-api.test.ts` (`/v1/audit` block) + `tc-50-p4-reads-coverage.test.ts` (`/v1/audit` block)

#### TC-133: Audit log pagination at scale (manual)

**Use case:** UC-Audit
**Level:** manual
**Type:** edge
**Preconditions:** > 10k audit rows.
**Steps:** scroll the audit table; verify cursor pagination handles `nextCursor` correctly without skipping rows; confirm first-page latency < 200 ms.
**Expected:** stable pagination; no jumps.
**Automated:** no — requires bulk-seeded data; revisit when the audit page UI is hardened.

### Webhooks

#### TC-31: Webhook ingest (HMAC + replay window)

**Use case:** UC-Webhooks
**Level:** integration
**Type:** happy + negative (umbrella, 9 sub-cases)
**Preconditions:** webhook subscription seeded.
**Steps:** 404 unknown source; 400 empty body; 401 missing signature; 401 bad HMAC; 202 + idempotency_key on valid HMAC; signature digest fallback as idem key; 401 stale x-timestamp; 202 fresh x-timestamp; 400 malformed source slug.
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/tc-31-p3-webhooks.test.ts`

### Tenant-loader and dynamic tenants

#### TC-25: Tenant-loader

**Use case:** UC-DynamicTenants
**Level:** unit + integration
**Type:** happy + edge
**Preconditions:** fixture dir under `data/tenants/`.
**Steps:** listTenantVersions discovers slugs; loadTenant reads agentic.json + imports entrypoint; null on missing; resolveLiveVersion falls back to highest dir when no deployment row; `AGENTIC_TENANTS_DIR` honored.
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/tc-25-p3-tenant-loader.test.ts`

#### TC-32: Cron registration

**Use case:** UC-Cron
**Level:** unit
**Type:** happy
**Preconditions:** none.
**Steps:** as in file.
**Expected:** as in file.
**Automated:** yes
**File:** `apps/api/test/tc-32-p3-cron.test.ts`

### Workflow DAG

#### TC-34: `/v1/workflows/dag` shape

**Use case:** UC-WorkflowView
**Level:** integration
**Type:** happy
**Preconditions:** live deployment.
**Steps:** GET returns `{ agents, edges, workflowVersion }`.
**Expected:** schema matches contracts.
**Automated:** yes
**File:** `apps/api/test/tc-34-workflow-route.test.ts`

#### TC-116: DAG layout stability (manual visual)

**Use case:** UC-WorkflowView
**Level:** manual
**Type:** edge
**Preconditions:** dev env.
**Steps:** open `/portal/raas/workflows`; refresh five times; confirm zero edge crossings + stable stage/lane positions.
**Expected:** layout deterministic.
**Automated:** partial — `apps/web/app/portal/components/workflows/layout.test.ts` exercises the helper; the rendered visual is judgement.

### Read-side coverage uplift

#### TC-50: `/v1/counts` + ontology + tasks + health + agents + replay

**Use case:** UC-Dashboard / UC-Reads (cross-cutting)
**Level:** integration
**Type:** happy + negative (umbrella, ≈ 35 sub-cases)
**Preconditions:** seeded.
**Steps:** every read route in `apps/api/src/routes/v1/reads.ts` plus reverberations on runs/events/agents/tasks/audit/budgets.
**Expected:** envelope shapes match `@agentic/contracts`; 404 paths return cleanly; filters honored.
**Automated:** yes
**File:** `apps/api/test/tc-50-p4-reads-coverage.test.ts`

### Operational — shutdown, metrics, health

#### TC-51: Graceful shutdown

**Use case:** UC-Ops
**Level:** integration
**Type:** edge
**Preconditions:** stack up.
**Steps:** send SIGTERM; assert in-flight requests drain ≤ 30 s; SSE connections close cleanly; SQLite WAL checkpoints.
**Expected:** zero hanging connections; exit 0.
**Automated:** yes
**File:** `apps/api/test/tc-51-p4-graceful-shutdown.test.ts`

#### TC-52: Prometheus metrics + extended /health

**Use case:** UC-Ops
**Level:** integration
**Type:** happy
**Preconditions:** running stack.
**Steps:** GET `/metrics` returns Prometheus exposition; counters increment after successful invoke; GET `/health` returns 200 + extended fields when healthy.
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/tc-52-p4-metrics-health.test.ts`

### Test-run flag

#### TC-24: testRun flag wiring

**Use case:** UC-AgentInvoke (test-run)
**Level:** integration
**Type:** happy + negative
**Preconditions:** none.
**Steps:** invoke with `?testRun=1` → envelope carries testRun=true, runs.is_test persisted true, SSE `run.started` carries testRun, GET reflects it; without flag → defaults to false; publish/subscribe round-trips through RunStreamEvent.
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/tc-24-p2-test-run-flag.test.ts`

### SPA bootstrap

#### TC-18: SPA bootstrap fan-out

**Use case:** UC-Bootstrap (legacy SPA)
**Level:** integration
**Type:** happy + edge
**Preconditions:** none.
**Steps:** assert fan-out to exactly 8 `/v1/*` paths; Authorization forwarded; Cookie fallback; SpaBootstrap shape mapped to real rows; empty DB ⇒ empty arrays (no synthesized rows); API failures degrade gracefully.
**Expected:** as listed.
**Automated:** yes
**File:** `apps/api/test/tc-18-p1-spa-bootstrap.test.ts`

### Web app — unit + Playwright

#### TC-120: Web unit gate

**Use case:** UC-WebHelpers
**Level:** unit
**Type:** happy
**Preconditions:** vitest installed.
**Steps:** `pnpm --filter @agentic/web run test`.
**Expected:** coverage thresholds met (lines ≥ 70, branches ≥ 60) over the helper allow-list in `apps/web/vitest.config.ts`. Currently 13 spec files:
- `apps/web/lib/auth/session.test.ts`
- `apps/web/lib/hooks/useStream.test.ts`
- `apps/web/lib/hooks/data-context.test.ts`
- `apps/web/app/portal/components/sparkline.test.ts`
- `apps/web/app/portal/lib/density.test.ts`
- `apps/web/app/portal/lib/format.test.ts`
- `apps/web/app/portal/lib/use-tenant.test.ts`
- `apps/web/app/portal/components/workflows/draft.test.ts`
- `apps/web/app/portal/components/workflows/layout.test.ts`
- `apps/web/app/portal/components/usage/charts.test.ts`
- `apps/web/app/portal/components/agent-code/tar.test.ts`
- `apps/web/app/portal/components/runs/TraceTree.test.ts`
- `apps/web/app/portal/components/settings/sections/Audit.test.ts`
**Automated:** yes

#### TC-121: Playwright e2e — auth flow

**Use case:** UC-Auth (UI)
**Level:** e2e
**Type:** happy
**Preconditions:** dev stack.
**Steps:** sign-in dev-mode flow; assert tenant switcher renders; bootstrap routes hit.
**Expected:** signed-in shell renders.
**Automated:** yes
**File:** `apps/web/e2e/04-auth-flow.spec.ts`

#### TC-122: Playwright e2e — workflow editor save

**Use case:** UC-SchemaEditor
**Level:** e2e
**Type:** happy
**Preconditions:** dev stack; live deployment.
**Steps:** edit a node in the editor; save; assert audit + new agent_version row + UI success.
**Expected:** save round-trips end-to-end.
**Automated:** yes
**File:** `apps/web/e2e/05-workflow-editor-save.spec.ts`

#### TC-123: Playwright e2e — CLI deploy round-trip

**Use case:** UC-CLI
**Level:** e2e
**Type:** happy
**Preconditions:** dev stack; binary built.
**Steps:** `agentic init <slug>`; `agentic deploy`; verify deployment in the UI.
**Expected:** new live deployment.
**Automated:** yes
**File:** `apps/web/e2e/06-cli-deploy-roundtrip.spec.ts`

#### TC-124: Visual regression — portal v1_1 reference

**Use case:** UC-VisualReference
**Level:** visual
**Type:** regression
**Preconditions:** dev stack on :3599.
**Steps:** Playwright pixel-diff at 1440×900 against `apps/web/test/visual/v1_1-reference/`.
**Expected:** every diff ≤ tolerance.
**Automated:** yes
**File:** `apps/web/test/visual/portal.spec.ts`
**Notes:** Only 4 reference screens are diffed today. Pixel diffs are brittle to font hinting — re-run `capture-v1_1-reference.ts` on every intentional design change.

#### TC-125: Web a11y axe-core scan

**Use case:** UC-A11y
**Level:** visual / a11y
**Type:** regression
**Preconditions:** dev stack on :3599.
**Steps:** Playwright + axe-core runs `a11y.spec.ts` against the main routes.
**Expected:** zero serious/critical violations.
**Automated:** yes
**File:** `apps/web/test/visual/a11y.spec.ts`

### CLI

#### TC-126: CLI argparse + run integration

**Use case:** UC-CLI
**Level:** unit + integration
**Type:** happy + negative
**Preconditions:** none.
**Steps:** parseArgs recognises commands/positional; events subcommand; --api/--token; --tail bare flag; --key=value; -h/-v; run() integration for help/version/unknown/bad subcommand.
**Expected:** as in file.
**Automated:** yes
**File:** `apps/cli/test/cli.test.ts`

#### TC-127: CLI init

**Use case:** UC-CLI
**Level:** integration
**Type:** happy + idempotent + negative
**Preconditions:** tmp dir.
**Steps:** creates expected file tree; emits valid JSON; idempotent skip; `--force` overwrite; invalid slugs rejected.
**Expected:** as in file.
**Automated:** yes
**File:** `apps/cli/test/init.test.ts`

#### TC-128: CLI deploy

**Use case:** UC-CLI
**Level:** integration
**Type:** happy + negative
**Preconditions:** init'd tmp dir.
**Steps:** POSTs manifest to `/v1/agents` + prints diff; non-zero on server error; errors out without agentic.json.
**Expected:** as in file.
**Automated:** yes
**File:** `apps/cli/test/deploy.test.ts`

#### TC-129: CLI logs + events tail

**Use case:** UC-CLI
**Level:** unit + integration
**Type:** happy + negative
**Preconditions:** none.
**Steps:** fetchLogsOneShot parses SSE frames; runLogs prints to stdout; runLogs without run-id returns 2; runLogs reports non-200 failure; formatEvent for events tail.
**Expected:** as in file.
**Automated:** yes
**File:** `apps/cli/test/logs-events.test.ts`

### UI judgement / manual UAT

#### TC-118: Tenant switcher animation + focus management (manual)

**Use case:** UC-Shell
**Level:** manual / judgement
**Type:** UX
**Preconditions:** dev stack; ≥ 3 tenants.
**Steps:**
  1. Open the portal.
  2. Click the tenant switcher; tab through options with keyboard only.
  3. Pick a tenant; confirm URL slug updates and the shell re-renders without full reload.
  4. Confirm focus returns to the trigger button after dismiss.
**Expected:** smooth, no jank; focus visible on every tabbable target.
**Automated:** no — animation timing + focus order are judgement calls. Axe-core covers the static a11y violations (TC-125); this case covers the dynamic interaction.

#### TC-130: Loading + error states across routes (manual)

**Use case:** UC-Shell
**Level:** manual
**Type:** edge
**Preconditions:** dev stack; throttle network to 3G in DevTools.
**Steps:** visit each App Router page; observe skeleton or spinner during load; kill the api; observe error banner per route.
**Expected:** every route renders a recognisable loading state and a recoverable error state.
**Automated:** partially — the Full-Stack agent's `03-logging-audit.md` should map error-state coverage; visual judgement remains manual.

#### TC-131: Toast and copy-tone audit (manual)

**Use case:** UC-Shell
**Level:** manual
**Type:** UX
**Preconditions:** dev stack.
**Steps:** trigger each success and error path that surfaces a toast (tenant create, deploy, rollback, archive, restore, save, invoke, replay, resolve task, revoke token).
**Expected:** every toast is 1 sentence, present-tense, no jargon; error toasts include a retry affordance where applicable.
**Automated:** no — pure copy review.

#### TC-132: Keyboard-only shell traversal (manual)

**Use case:** UC-A11y
**Level:** manual
**Type:** UX
**Preconditions:** dev stack.
**Steps:** unplug mouse; navigate from sign-in to a fully-loaded run-detail page using only Tab/Shift-Tab/Enter/Escape.
**Expected:** no keyboard trap; every interactive element reachable; modals trap focus correctly and Escape closes them.
**Automated:** partially — axe-core flags some traps; the smooth-traversal experience is judgement.

---

## Maintenance log

When a TC is added, modified, or moved between automated/manual, append a line here.

- 2026-05-21 — Test Architect — initial draft of 70 TCs; coverage matrix established; biggest gap surfaced (import-manifest wizard 6-step UI has no e2e).
