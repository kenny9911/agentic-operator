# Wave 3 Review — Test Strategy

**Date:** 2026-05-21
**Reviewer:** Test Architect
**Verdict:** GAPS BLOCK WAVE 5 (existing surface is strong; V1.1 backlog requires ~31 new test files; cross-layer coverage gates need tightening before merge)

---

## 0. Scope at a glance

| Layer | Count today | Target for V1.1 GA | Delta |
|---|---:|---:|---:|
| `apps/api/test/*.test.ts` (vitest) | 50 | 78 | +28 |
| `apps/web/e2e/*.spec.ts` (Playwright) | 6 (+ helpers) | 11 | +5 |
| `apps/web/test/visual/*.spec.ts` (pixel) | 2 (+ 2 capture scripts) | 4 | +2 |
| `apps/web/**/*.test.ts` (unit, vitest) | unit gate via include allow-list (6 files) | same surface, +1 (`signed-url.ts`) | +1 |
| `apps/cli/**/*.test.ts` | not surveyed; gate exists at 70/60 | unchanged | 0 |
| **Total new TC files proposed** | — | — | **+36** |

The api workspace's `vitest.config.ts` already pins `pool: "forks"` + `singleFork: true` + `sequence.concurrent: false`. Tests share `data/agentic.db` and isolate by `runId`, not by file. The web workspace runs a deliberately narrow unit gate (6 helper files in the include list) with Playwright covering the wider surface — do **not** widen the web unit gate; widen Playwright coverage instead.

---

## 1. Existing test inventory

### 1.1 `apps/api/test/` — 50 files

| File | Covers | Type | Notes |
|---|---|---|---|
| `tc-1-llm-providers.test.ts` | AR-LLM-01 catalog endpoint | integration | 14-provider exposition + hasKey flips |
| `tc-2-llm-models.test.ts` | AR-LLM-01 model directory | integration | model→provider crossref |
| `tc-3-test-agent-happy.test.ts` | UC-V1-11 testAgent invoke | integration | mock provider + run+step row asserts |
| `tc-4-test-agent-error.test.ts` | UC-V1-11 error path | integration | error envelope shape |
| `tc-5-monitoring-reuse.test.ts` | UC-V1-17 SSE log reuse | integration | run log NDJSON reads |
| `tc-6-p0-auth-isolation.test.ts` | AR-X-04, AR-X-01, P0-API-01 | integration | 6 sub-describes, dev-mode auth, replay-id collision |
| `tc-7-manifest-schema-fields.test.ts` | AR-DEP-03 (P0-RT-01) | unit | round-trips `tool_use`, `typescript_code`, `output_schema`, `ontology_instructions` |
| `tc-8-branch-emit.test.ts` | UC-V1-41 condition branching | integration | conditional emit |
| `tc-9-condition-eval.test.ts` | condition expression engine | unit | predicate parsing |
| `tc-10-runtime-step-engine.test.ts` | AR-RUN-01..06 step engine | integration | 6 action types |
| `tc-11-bootstrap-idempotency.test.ts` | `bootstrapCodeAgents` | integration | re-import safe |
| `tc-12-register-helpers.test.ts` | `packages/runtime/register.ts` | unit | `step.run` wrappers |
| `tc-13-p0-db-migrations.test.ts` | PF-MIG-* drift gate | unit | drizzle journal + applied list |
| `tc-14-p1-stream.test.ts` | `/v1/stream` SSE multiplexer | integration | **route not yet registered in server.ts — see PF-GAP-11; test stubs the handler directly** |
| `tc-15-p1-adapter-tools.test.ts` | AR-TOOL-04 first-party tools | integration | http.fetch, llm.call, channel.publish |
| `tc-16-p1-tool-use-loop.test.ts` | code-agent multi-turn loop | integration | tool-use round-trips |
| `tc-17-p1-code-agent-inngest.test.ts` | AR-AK-01 code-agent inngest function | integration | dev-mode emit |
| `tc-18-p1-spa-bootstrap.test.ts` | legacy SPA bootstrap | integration | dev-only — candidate for retirement after PF-GAP-07 |
| `tc-20-p1-api.test.ts` | `/v1/*` smoke sweep | integration | route presence |
| `tc-21-p1-budget.test.ts` | AR-COST-01 tenant_budgets | integration | pre-flight deduct |
| `tc-22-p1-step-types.test.ts` | AR-TOOL-04 6 action types | unit | manifest validation |
| `tc-24-p2-test-run-flag.test.ts` | UC-V1-12 TEST badge | integration | `is_test=true` round-trip |
| `tc-25-p3-tenant-loader.test.ts` | PF-MR-* tenant registry | integration | dynamic import path |
| `tc-26-p3-inngest-registry.test.ts` | AR-INN-02 concurrency keying | integration | function id format |
| `tc-27-p3-tenant-code-upload.test.ts` | AR-DEP-01 tenant code USTAR upload | integration | covered for UC-V1-50; **happy path only — UC-V11-18 still failing** |
| `tc-30-p3-memory.test.ts` | AR-MEM-* short/long term memory | integration | scope tests |
| `tc-31-p3-webhooks.test.ts` | AR-EVT-04 webhook HMAC ingest | integration | 8 sub-cases inc. replay rejection |
| `tc-32-p3-cron.test.ts` | AR-INN-04 retention cron | integration | TTL sweep |
| `tc-33-schema-drift.test.ts` | schema editor + drift gate | unit | Zod→JSON-Schema sync |
| `tc-34-workflow-route.test.ts` | UC-V1-08 workflow save | integration | manifest commit round-trip |
| `tc-50-p4-reads-coverage.test.ts` | P4 reads surface | integration | dashboard reads |
| `tc-51-p4-graceful-shutdown.test.ts` | PF-OBS-07 SIGTERM | integration | subprocess; ~10s |
| `tc-52-p4-metrics-health.test.ts` | PF-OBS-01, PF-OBS-06 | integration | text exposition + healthchecks |
| `tc-60-llm-key-mgmt.test.ts` | AR-LLM-05 provider key write/rotate | integration | per-tenant overrides |
| `tc-61-llm-fleet.test.ts` | AR-LLM-01 all-provider smoke | integration | catalog → hasKey |
| `tc-62-tenants-isolation.test.ts` | UC-V1-25, AR-X-01 | integration | archive/restore doesn't cross |
| `tc-63-auth-mode-guard.test.ts` | AR-X-04 production opt-in | integration | env-flip behavior |
| `tc-70-tenants-crud.test.ts` | UC-V1-25 4-step wizard | integration | full lifecycle |
| `tc-71-tenants-idempotency.test.ts` | UC-V1-25 Idempotency-Key for /v1/tenants | integration | **only route honoring Idempotency-Key today** |
| `event-tester.test.ts` | UC-V1-29 event tester | integration | 6 scenarios |
| `manifest-import-{validate,commit,concurrent,conflict,overwrite-guard,perf,ssrf}.test.ts` (7 files) | UC-V1-07, PF-IMP-01..08 | integration | 4-phase commit + lock + SSRF guard + crash recovery |
| `harness.ts`, `setup.ts`, `fixtures/manifests/*` | test infra | n/a | shared |

**Assumed passing.** No audit doc flags red on any file; `tc-14-p1-stream.test.ts` exists but exercises the un-registered handler directly. **One known fragile path:** the inngest dev-runner integration in `tc-17`, `tc-26`, and the `03-human-task-resolve` e2e spec — these tolerate slow flips because the dev runner's polling cadence is non-deterministic in CI.

### 1.2 `apps/web/e2e/` — 6 Playwright flows

| File | Covers | Notes |
|---|---|---|
| `01-manifest-agent-run.spec.ts` | UC-V1-32..48 RAAS stage exec via syncFromClientSystem | end-to-end against live dev stack |
| `02-code-agent-run.spec.ts` | UC-V1-11 code agent | testAgent variant |
| `03-human-task-resolve.spec.ts` | UC-V1-20 JD review HITL | event→task→resolve flip; tolerates slow inngest flip |
| `04-auth-flow.spec.ts` | UC-V1-27, AR-X-04 dev sign-in | cookie path |
| `05-workflow-editor-save.spec.ts` | UC-V1-08 manifest editor save | DraftBanner + commit |
| `06-cli-deploy-roundtrip.spec.ts` | UC-V1-50 `agentic deploy` | shells out to the CLI binary |
| `helpers.ts` | `apiFetch`, `waitFor`, `readSseUntil` | shared |

### 1.3 `apps/web/test/visual/` — 2 spec files + 2 capture scripts + 1 snapshot dir

| File | Covers | Notes |
|---|---|---|
| `portal.spec.ts` | 9 nav views @ 1440×900 vs `v1_1-reference/` | freezeAnimations + reducedMotion |
| `a11y.spec.ts` | WCAG smoke | per-view axe-core run |
| `capture-current.ts`, `capture-v1_1-reference.ts` | snapshot tooling | one-shot, human-invoked |

### 1.4 Web unit (vitest, narrow include list)

Six helpers in `apps/web/vitest.config.ts`: `format.ts`, `use-tenant.ts`, `agent-code/tar.ts`, `workflows/{layout,draft}.ts`, `usage/charts.ts`. Gate: lines ≥70, branches ≥60, functions ≥60, statements ≥70.

---

## 2. Coverage matrix (UC × test)

Format follows USE_CASES.md §6. Existing rows are restated; gaps are filled per UC with proposed file name, type, and assertions.

### 2.1 V1 shipped (51 UCs) — must stay green

| UC | Existing test | Status |
|---|---|---|
| UC-V1-01..03 (Dashboard KPIs/funnel/active runs) | `apps/web/test/visual/portal.spec.ts` (dashboard view) | covered |
| UC-V1-04..06 (Workflows + edit toolbar) | `portal.spec.ts` (workflows view) + `tc-34-workflow-route.test.ts` + `e2e/05-workflow-editor-save.spec.ts` | covered |
| UC-V1-07 (Manifest import 6-step) | `manifest-import-*.test.ts` (7 files) | covered |
| UC-V1-08 (Save workflow) | `tc-34` + `e2e/05` | covered |
| UC-V1-09..10 (Agents list + 5 tabs) | `portal.spec.ts` (agents view) | UI covered; **propose** `tc-80-agents-5tabs.test.ts` (api shape per tab) |
| UC-V1-11 (Test run any agent) | `tc-3`, `tc-4`, `e2e/02` | covered |
| UC-V1-12 (TEST badge 4 places) | `tc-24-p2-test-run-flag.test.ts` + visual | covered |
| UC-V1-13 (Run → agent jump) | `portal.spec.ts` (runs view) | UI-only; **propose** `e2e/07-run-to-agent-jump.spec.ts` for click navigation |
| UC-V1-14 (Replay) | `tc-6` P0-API-01 + `tc-20-p1-api.test.ts` | covered |
| UC-V1-15..16 (Edit ontology / code) | `tc-27-p3-tenant-code-upload.test.ts` | **partial** — happy path only, blocked by UC-V11-18 |
| UC-V1-17 (SSE log tail) | `tc-5-monitoring-reuse.test.ts` | covered |
| UC-V1-18..19 (Run io tab + agent-in-context) | `portal.spec.ts` (runs view) | **propose** `tc-81-run-io-tab.test.ts` for input/output read shape |
| UC-V1-20..21 (Tasks resolve + snooze) | `e2e/03` + `portal.spec.ts` (tasks) | resolve covered; **propose** `tc-82-task-snooze.test.ts` for snooze TTL |
| UC-V1-22 (Filter runs by failed) | `portal.spec.ts` (runs view) | UI; query covered by `tc-20` |
| UC-V1-23 (Per-day cost breakdown) | **none** (PF-GAP-01 + AR-GAP-01) | **blocked** — UC-V11-17 + UC-V11-38 fix it; new test `tc-83-usage-route.test.ts` (TDD) |
| UC-V1-24 (Audit log diff) | `tc-20` + `tc-62` audit asserts; **propose** `tc-84-audit-diff.test.ts` for before/after JSON rendering |  |
| UC-V1-25 (Tenant wizard) | `tc-70`, `tc-71`, `tc-62`, `tc-63` | covered |
| UC-V1-26 (Promote deployment) | `tc-20`, `manifest-import-commit.test.ts` (workflow_deployed event) | covered |
| UC-V1-27 (Rotate token) | `tc-70` (mintToken happy path) | **partial** — propose `tc-85-token-rotate.test.ts` for revoke+rotate+last_used round-trip |
| UC-V1-28 (Switch tenant) | `e2e/04-auth-flow.spec.ts` + `portal.spec.ts` | covered |
| UC-V1-29 (⌘+K nav) | none | **propose** `e2e/08-cmd-k-navigate.spec.ts` |
| UC-V1-30 (Tweaks panel) | `portal.spec.ts` (visual freeze) | covered |
| UC-V1-31 (channel.publish ping) | `tc-15-p1-adapter-tools.test.ts` | covered |
| UC-V1-32..48 (RAAS 17 nodes) | `e2e/01-manifest-agent-run.spec.ts` (single happy path on syncFromClientSystem) + `tc-10-runtime-step-engine.test.ts` + `tc-7-manifest-schema-fields.test.ts` | **partial** — only 1 of 17 nodes exercised end-to-end. **propose** `tc-86-raas-stage-walk.test.ts` (parameterized over all 17 nodes; assert event in → run row → step row → event out for each) |
| UC-V1-49 (`agentic init`) | covered via `e2e/06`; **propose** `apps/cli/test/init-scaffold.test.ts` (asserts the generated `actions_v1.json` matches `ActionsManifestSchema`, blocking UC-V11-19 regression) |
| UC-V1-50 (`agentic deploy`) | `e2e/06` + `tc-27` | covered |
| UC-V1-51 (`agentic logs --tail`) | none direct | **propose** `apps/cli/test/logs-tail.test.ts` and pair with `tc-87-stream-route.test.ts` once PF-GAP-11 ships |

### 2.2 V1.1 backlog (39 UCs) — all need test-driven entries

For each, one or more proposed test cases. Mock surface is the in-process Fastify app + the mock LLM provider, unless otherwise noted. Acceptance assertions are concrete and self-checking.

| UC | Proposed test file | Type | Mock surface | Acceptance |
|---|---|---|---|---|
| UC-V11-01 (Wu Hao notification ping) | `tc-90-notifications-dispatcher.test.ts` | integration | mock SES + WeChat Work `axios` | `dispatch({chan: "ses", to})` writes one row in `audit_log(action='notify.send')`; signed URL JWT decodes with scope `task:resolve:<id>` |
| UC-V11-02 (Signed-URL public task page) | `tc-91-public-task-resolve.test.ts` + `e2e/09-public-task-form.spec.ts` | integration + Playwright | none (real Fastify) | `POST /v1/public/tasks/:token` with valid JWT → 200 + task row flips; tampered token → 401 |
| UC-V11-03 (Diff two test runs) | `tc-92-runs-compare.test.ts` | integration | none | `GET /v1/runs/compare?a=run-x&b=run-y` returns `{inputDiff,outputDiff,steps}` shaped per Zod |
| UC-V11-04 (Cmd-K emit event) | `e2e/10-cmd-k-emit-event.spec.ts` | Playwright | mock LLM | ⌘+K → "Emit" group visible; submit JSON → `event_id` shown in toast |
| UC-V11-05 (Live token+cost preview) | `apps/web/lib/cost-preview.test.ts` | web unit | tiktoken vendored | `previewCost(text, model)` returns `{tokens, costUsd}` within ±5% of gateway computeCost |
| UC-V11-06 (Hot-reload toast) | `tc-93-deployment-sse-event.test.ts` | integration | none | publish `deployment.created` → SSE frame received within 500 ms; payload has `tenantCodeVersion` |
| UC-V11-07 (Bulk replay) | `tc-94-runs-replay-bulk.test.ts` | integration | mock Inngest send | `POST /v1/runs/replay-bulk {ids:[…]}` returns `{accepted, rejected}` arrays; one new run row per accepted id; cap=50 enforced |
| UC-V11-08 (Pause SSE server-side) | `tc-95-stream-pause.test.ts` | integration | EventSource client | `POST /v1/stream/sessions/:id/pause` blocks frames; `resume` flushes buffered |
| UC-V11-09 (Health drilldown) | `tc-96-health-timeline.test.ts` | integration | none | `GET /health?timeline=5m` returns `samples[]` with len ≥ 5; subsystem fail flips overall `ok=false` |
| UC-V11-10 (Per-tenant rate-limit override) | `tc-97-tenant-rate-limit.test.ts` | integration | none | `PUT /v1/tenants/:slug { rateLimitPerMin: 25 }` → next 26 reqs return one 429; audit row stamped |
| UC-V11-11 (Trace tree multi-step) | `tc-98-trace-tree.test.ts` | integration | none | `GET /v1/runs/:id/trace?depth=3` walks ancestor chain + lateral; cycles guarded |
| UC-V11-12 (Provider-error budget card) | `tc-99-provider-errors-card.test.ts` | integration | gateway throws `LLMError("provider","rate_limited")` | `/metrics` reports `llm_provider_errors_total{provider="anthropic",code="429"}=1`; `/v1/usage?breakdown=errors` returns same |
| UC-V11-13 (Persist edit-mode draft) | `apps/web/lib/draft-storage.test.ts` | web unit | localStorage mock | `saveDraft(tenant, workflow, blob)` round-trips; `clearDraft` removes only the matching key |
| UC-V11-14 (Validate manifest dry-run) | `tc-100-agents-dry-run.test.ts` | integration | mock LLM | `POST /v1/agents?dry-run=1` returns `{ok:true,changes:[]}`; no row inserted; audit row NOT written |
| UC-V11-15 (Confirm tenant switch with draft) | `e2e/11-tenant-switch-draft-confirm.spec.ts` | Playwright | localStorage seeded | switch attempt → modal; "Discard" → switch; "Stay" → URL unchanged |
| UC-V11-16 (Read-only resolved task) | `tc-101-public-task-readonly.test.ts` | integration | none | `GET /v1/public/tasks/:token?mode=read-only` returns 200 + payload; cannot POST resolve |
| UC-V11-17 (`/v1/usage` envelope fix) | extend `tc-83-usage-route.test.ts` | integration | none | client parses envelope shape `{ok:true,data:{buckets:[…]}}`; web unit `useUsage` returns non-empty `data.buckets` |
| UC-V11-18 (`POST /v1/agents` 500 fix) | `tc-102-agents-with-tenant-code.test.ts` | integration | seed tenant_code deployment | first call to `POST /v1/agents` with live tenant_code returns 200 + agent row; no `Cannot find module` |
| UC-V11-19 (`agentic init` schema fix) | extend `apps/cli/test/init-scaffold.test.ts` | unit | none | `ActionsManifestSchema.safeParse(scaffold).success === true` |
| UC-V11-20 (Tasks extra "operator" row) | extend `portal.spec.ts` (visual) + `apps/web/lib/tasks-dedupe.test.ts` | visual + unit | none | pixel-diff for `tasks.png` re-baseline; unit: `dedupeTasks([…])` removes duplicates by id |
| UC-V11-21 (`emittedEvent` hydration) | `tc-103-runs-emitted-event-join.test.ts` | integration | seed event row | `GET /v1/runs/:id` response has `emittedEvent: {id, name, subject}` (not raw id string) |
| UC-V11-22 (`runs_total` from manifest engine) | `tc-104-runs-total-manifest.test.ts` | integration | mock Inngest dev | trigger manifest agent → scrape `/metrics` → `runs_total{tenant,agent,status="ok"}` increments by 1 |
| UC-V11-23 (`agent.tool_use` field → tenant tool) | `tc-105-tool-use-dispatch.test.ts` | integration | tenant tool spy | manifest with `tool_use: "publish.weCom"` calls the tenant-registered tool, not name-hint fallback; assert spy was called with action input |
| UC-V11-24 (Per-agent `defaultProviders`) | `tc-106-base-agent-failover.test.ts` | integration | gateway throws on first provider | `BaseAgent` configured with `defaultProviders=["anthropic","mock"]`; first call 429 → fallthrough to mock → run.ok |
| UC-V11-25 (Require `definePrompt` for logic) | `tc-107-logic-prompt-required.test.ts` | integration | none | bootstrap a manifest with a `logic` action and NO matching tenant prompt → `bootstrapTenantRegistry` throws with pointer to missing key; conversely with prompt → no throw |
| UC-V11-26 (Bedrock + Vertex SDK adapters) | `tc-108-bedrock-vertex-adapters.test.ts` | integration | mock AWS/GCP SDKs | request through gateway with `provider: "bedrock"` returns adapter shape; with `provider: "vertex"` likewise; cost computed from provider catalog |
| UC-V11-27 (Remove webhook default-secret fallback) | extend `tc-31-p3-webhooks.test.ts` + `tc-109-webhook-no-default-secret.test.ts` | integration | none | with `WEBHOOK_HMAC_SECRET_DEFAULT` set BUT subscription has no `secret_encrypted` → 500 `webhook_secret_missing`, never silently accepts |
| UC-V11-28 (= UC-V11-18) | shared with `tc-102` | — | — | — |
| UC-V11-29 (Cookie auth on Fastify) | `tc-110-cookie-auth-prod.test.ts` | integration | jose sign | cookie with valid JWT → tenant resolved without bearer; mangled cookie → 401; bearer still wins when both present |
| UC-V11-30 (Remove `_portal_legacy/`) | static check in `apps/web/lib/legacy-removed.test.ts` | web unit | fs | `fs.existsSync("app/_portal_legacy") === false`; assert `apps/web/next.config.mjs` no longer references the path |
| UC-V11-31 (Gitignore imports dir) | static check in `tc-111-imports-gitignored.test.ts` | unit | fs | `.gitignore` matches `apps/api/data/imports/**`; current staging dir not tracked by git |
| UC-V11-32 (Idempotency-Key enforcement) | `tc-112-idempotency-key-events.test.ts` + `tc-113-idempotency-key-invoke.test.ts` | integration | none | same key + same body → 200 with cached envelope; same key + DIFFERENT body → 409; 24h TTL applied; cross-tenant keys don't collide |
| UC-V11-33 (Register `/v1/stream`, `/v1/tenant-code`, `/v1/workflow`) | `tc-114-route-registration.test.ts` | integration | none | `GET /v1/stream` returns 200 + `Content-Type: text/event-stream`; `GET /v1/tenant-code` 200 envelope; `POST /v1/workflow/:slug` round-trips |
| UC-V11-34 (OTel spans) | `tc-115-otel-spans.test.ts` | integration | in-process `MemoryExporter` | one POST → exporter receives 3+ spans (Fastify request, gateway chat, run finalize); span attributes include `tenant.slug` |
| UC-V11-35 (`failRun` inside `step.run`) | `tc-116-fail-run-race.test.ts` | integration | force-fail injected | retry of the Inngest fn does NOT write two `status='failed'` rows; the finalize step.run name appears in step list |
| UC-V11-36 (DLQ) | `tc-117-dlq-flow.test.ts` | integration | force-orphan | `GET /v1/dlq` lists the orphaned run; `POST /v1/dlq/:id/retry` re-creates a run row with same correlation id; `POST /v1/dlq/:id/drop` writes `audit_log(action='dlq.drop')` |
| UC-V11-37 (Unique `steps_run_ord_idx`) | extend `tc-13-p0-db-migrations.test.ts` | unit | drizzle | applied migration adds UNIQUE; double-insert of `(runId, ord)` throws SQLITE_CONSTRAINT |
| UC-V11-38 (= UC-V11-17 backend) | shared with `tc-83-usage-route.test.ts` | — | — | — |
| UC-V11-39 (Per-route audit emission audit) | `tc-118-audit-mutation-coverage.test.ts` | integration | none | for every route in `apps/api/src/routes/v1/*` whose method is in `{POST,PUT,PATCH,DELETE}`, invoking a happy path writes ≥1 `audit_log` row; assertion driven by a route registry the test introspects |

**Total proposed new test files: 31 api + 5 e2e + 1 visual + 3 web/cli unit = ~40 entries against 36 unique TC file names** (UC-V11-28 and UC-V11-38 share files with UC-V11-18 and UC-V11-17 respectively; UC-V11-31 mirrors a cleanup).

### 2.3 V2 vision (19 UCs)

Out of scope for Wave 5. Each UC-V2-* keeps its `🔵` label and a 1-line stub in the eventual `docs/wave-5-test-status.md`; no tests proposed here.

---

## 3. Test gaps by category

### 3.1 HITL paths (`step.waitForEvent("task.resolved")`)

Today: `e2e/03-human-task-resolve.spec.ts` covers the happy path and tolerates a slow inngest dev-runner flip. No test for timeout (`waitForEvent` with `timeout: "1h"`), no test for cancellation, no test for the 409 `already_resolved` path beyond a smoke check.

**Proposed:**
- `tc-119-waitforevent-timeout.test.ts` — fire trigger; do NOT resolve; advance virtual clock; assert run row flips to `status='failed'` with `reason='task_timeout'`. Mock Inngest's clock via `@inngest/test`.
- `tc-120-task-cancel.test.ts` — open a task, `POST /v1/tasks/:id/cancel`, assert parent run flips to `status='cancelled'` and emits `task.cancelled`.
- `tc-121-task-double-resolve.test.ts` — currently fragile in the e2e spec (skips if no resolved row); promote to api-side: assert second resolve returns 409 `already_resolved` with original decision in payload.

### 3.2 Failure paths (LLM provider errors, budget)

Today: `tc-1` covers `hasKey=false` for catalog; `tc-21-p1-budget.test.ts` covers pre-flight deduct; no test for 401/429/500 throw-and-retry inside the gateway, and no end-to-end test for cost-cap-exceeded.

**Proposed:**
- `tc-122-llm-401-failover.test.ts` — first provider returns 401, second provider returns 200 → run.ok with `provider="mock"` (second one). Asserts the failover loop in `packages/llm-gateway/src/gateway.ts:78-150` is reachable from `BaseAgent` only when `defaultProviders` is set (ties into UC-V11-24).
- `tc-123-llm-429-retry.test.ts` — first call 429, second call ok → assert one row in `llm_provider_errors_total{code="429"}`, run.ok, total wall time ≤ 5s.
- `tc-124-llm-timeout-bail.test.ts` — gateway times out at 30s ceiling → run.failed with `reason='llm_timeout'`; no zombie step rows.
- `tc-125-budget-exceeded.test.ts` — tenant_budgets row with `daily_usd=0.01`, mock call costing `$0.05` → 402-style envelope `{error: "budget_exceeded"}`; no run row; audit row written.

### 3.3 Multi-tenant isolation

Today: `tc-62-tenants-isolation.test.ts` proves archive/restore isolation by record; it cannot flip auth mid-test (the harness comment is explicit). `tc-6-p0-auth-isolation.test.ts` does flip `AGENTIC_DEV_TENANT` mid-test for 4 scenarios. No test proves tenant-A bearer token cannot read tenant-B's `runs.id` directly (the audit doc calls this out as deferred to P5-TEN-02).

**Proposed:**
- `tc-126-cross-tenant-bearer-idor.test.ts` — provision two tenants A and B with separate bearer tokens; create a run under A; assert `GET /v1/runs/:id` with B's bearer returns 404 (not 403 — we don't disclose existence). Implement by switching tokens, not env. This closes the audit gap.
- `tc-127-tenant-scoping-helper.test.ts` — unit-test `tenantScope(ctx, table)` directly: missing scope predicate throws; injecting an unconstrained `getDb()` query returns rows from foreign tenants. Codify the "direct `getDb()` access leaks" invariant.

### 3.4 Replay determinism (Inngest)

Today: `tc-11-bootstrap-idempotency.test.ts` covers function-registry idempotency; `tc-17-p1-code-agent-inngest.test.ts` exercises dev-mode emit; nothing proves that the same Inngest event replayed produces identical DB state (one run row, not two; same step rows).

**Proposed:**
- `tc-128-inngest-replay-idempotent.test.ts` — use `@inngest/test`'s `executionId` re-run to drive a function through its full step list twice; assert `runs` table row count delta is 1, not 2; assert `steps` row count is identical; assert `audit_log` not duplicated. Verifies the `step.run("name", ...)` discipline from CLAUDE.md.

### 3.5 Manifest import crash recovery

Today: `manifest-import-{validate,commit,concurrent,conflict,overwrite-guard,perf,ssrf}.test.ts` (7 files) cover the happy path + lock + perf + SSRF. The bootstrap reconcile (`reconcileImports`) is exercised implicitly via the harness boot, but no test directly drives the four crash scenarios from CLAUDE.md: (a) expired pending row, (b) rename crashed between db tx and fs.rename, (c) manifest file deleted from disk, (d) staging dir orphaned.

**Proposed:**
- `tc-129-reconcile-expired-pending.test.ts` — insert `deployments(status='pending', expires_at=now-1h)`; restart harness; assert row is gone + staging dir removed.
- `tc-130-reconcile-crashed-rename.test.ts` — manually leave the staging file in place but commit the DB tx; restart; assert the rename completes and `models/<slug>-v<n+1>.json` exists.
- `tc-131-reconcile-missing-manifest.test.ts` — delete `models/<slug>-v<n>/workflow_vN.json` while the DB still references it; restart; assert the manifest gets re-emitted from `agent_versions.manifest_json` snapshot.
- `tc-132-reconcile-orphan-staging.test.ts` — drop a `data/imports/dpl-xxxxx/` dir with no matching `deployments` row; restart; assert the dir is unlinked.

### 3.6 Webhook HMAC

Today: `tc-31-p3-webhooks.test.ts` covers 8 sub-cases inc. stale-timestamp replay rejection and idempotency-key extraction. Missing: explicit test for the missing-secret friendly error (UC-V11-27 fix); explicit test for 5-min replay-window boundary at exact 5m+1s vs 4m+59s; signature algorithm mismatch (hmac-sha1 vs sha256).

**Proposed (one extends, one new):**
- Extend `tc-31` with: subscription has empty `secret_encrypted` + `WEBHOOK_HMAC_SECRET_DEFAULT` unset → 500 `webhook_secret_missing` (closes UC-V11-27).
- `tc-133-webhook-signature-algos.test.ts` — sha1 request to sha256 subscription → 401; future-stamped request (timestamp > now) → 401 `clock_skew_rejected`.

### 3.7 BYOK vault

Today: `tc-60-llm-key-mgmt.test.ts` covers per-tenant key write/rotate; the `AGENTIC_KMS_KEY` env var is documented as V2 reserved (PF-ENV-09) and plaintext storage is acceptable in V1 (single-tenant operator infra). No test for encryption round-trip because there's no encryption in V1.

**Proposed (defer to V2):**
- Park UC-V2-* tests for vault round-trip + rotation + revocation under a stubbed `tc-200-byok-vault.test.ts.todo` placeholder. Wave 5 does not implement.
- **Tighten today:** `tc-134-llm-key-redaction.test.ts` — `POST /v1/llm/providers/:id/key` request body must NOT appear in `audit_log.meta_json` nor in pino log lines (redaction list per PF-OBS-02). This is achievable today without vault.

---

## 4. Test infrastructure recommendations

### 4.1 Promote some vitest tests to also run as Playwright

**Recommendation: minimal promotion.** Three candidates worth a Playwright twin:
- `tc-31-p3-webhooks.test.ts` — current integration covers the api boundary. Add `e2e/12-webhook-settings-flow.spec.ts` that goes Settings → Integrations → add subscription → submit a probe webhook → see green checkmark. Closes UC-V11-27 UI surface.
- `tc-83-usage-route.test.ts` (proposed) — pair with `e2e/13-usage-chart.spec.ts` that loads `/portal/raas/settings/usage` and asserts the canvas has non-zero buckets. Closes UC-V1-23 properly.
- `tc-117-dlq-flow.test.ts` (proposed) — pair with `e2e/14-dlq-retry.spec.ts` to cover the "Retry / Drop" UI in UC-V11-36.

**Do NOT promote** `tc-3..5` (test agent), `tc-7` (manifest schema), `tc-10..22` (step engine + tools), `tc-30..33` (memory/webhooks/cron/drift). These are pure backend contracts; Playwright would only add brittle setup.

### 4.2 Mock consistency

`apps/api/test/setup.ts` pins `LLM_DEFAULT_PROVIDER=mock` + `LLM_DEFAULT_MODEL=mock-model-v1`. Spot-checks of `tc-3`, `tc-6`, `tc-31` confirm tests assert `provider === "mock"` and `model === "mock-model-v1"` — consistent. **Action: add a `vitest` shared fixture** `apps/api/test/fixtures/mock-llm.ts` exporting a typed `MOCK_PROVIDER` + `MOCK_MODEL` constant; have all new V1.1 tests import these so a future provider rename doesn't shotgun 30 files.

### 4.3 SQLite SQLITE_BUSY 5s tolerance under cost-cap + manifest-import

`vitest.config.ts` already pins `singleFork: true` + `sequence.concurrent: false`. The risky combination is the proposed `tc-125-budget-exceeded.test.ts` + `manifest-import-commit.test.ts` both running synchronous transactions back-to-back inside the same fork. **Recommendation:** keep singleFork; do NOT introduce a `tc-budget-during-import.test.ts` until we can prove the writer-lock contention is bounded. Tag new tests touching `tenant_budgets` with a `// PRECONDITION: must not run concurrently with manifest-import` comment near `beforeAll`.

### 4.4 Should `pnpm test` include `playwright test`?

**No** for V1.1. `pnpm test` today is `vitest` only (api workspace) and runs in ~60s. Playwright takes 4–6 min cold (browser install) and needs `pnpm dev` (or `PW_AUTO_WEBSERVER=1`) running. Keep them separate per CI gate — `pnpm -r test:coverage` for unit, `pnpm --filter @agentic/web test:e2e` for Playwright. **Do** add a top-level `pnpm test:all` alias that runs both sequentially for the human-driven pre-merge run.

### 4.5 Pre-commit smoke subset (<30s)

Create `apps/api/test/smoke.test.ts` that re-imports and re-runs **only** the assertions from: `tc-3` (testAgent happy), `tc-6` (auth isolation P0-AUTH-01), `tc-7` (manifest schema fields), `tc-13` (migrations applied), `tc-52` (metrics text exposition). Wire as `pnpm --filter @agentic/api exec vitest run test/smoke.test.ts`. Target: 20s wall. Hook to `.husky/pre-commit` or `simple-git-hooks`. **Do NOT** put manifest-import tests in smoke — they need disk I/O and have their own ~10s overhead each.

---

## 5. CI integration

### 5.1 Required checks for V1.1 merge gate

The single required check is `ci` (the meta job in `.github/workflows/ci.yml`). The leaves it depends on today: `install`, `typecheck`, `lint`, `test-coverage`, `build`, `e2e`, `docker`. **Add for V1.1:**
- **`visual`** — new job that runs `apps/web/test/visual/portal.spec.ts` and `a11y.spec.ts`. Today these are inside `e2e:` via the `test:e2e` script — split out so a visual drift doesn't get reported as an `e2e` failure with confusing context. Add `needs: visual` to the meta `ci` job.
- **`smoke`** — new job that runs `pnpm --filter @agentic/api exec vitest run test/smoke.test.ts` with a 60s timeout. First fast-fail signal so a broken bootstrap doesn't burn 20 minutes of the full matrix.

Both leaf names get appended to the meta `ci.needs:` list so branch protection picks them up automatically without a settings change.

### 5.2 Coverage thresholds

**Hold lines 70 / branches 60 for V1.1.** The web workspace gate is intentionally narrow (6 helper files); raising it would force speculative tests for browser-bound code that's already in Playwright. The api workspace is at the ~75% line / ~63% branch range today; raising to lines 75 / branches 65 is achievable once the 31 proposed tests land, but raising the gate before the tests land would cause an unrelated PR to flake on coverage. **Sequence: ship the tests in PRs grouped by UC family → confirm coverage report → bump thresholds in one followup PR cited from `docs/CI.md`.**

### 5.3 Flaky-test policy

**Today's policy in `docs/CI.md §4.3`:** Re-run is a manual click; flakes get filed as issues with the `flake` label. The `pool:forks` + `singleFork: true` setup in `apps/api/vitest.config.ts` has fixed historical SQLite contention. **Recommendation for V1.1:** explicitly forbid `retry` in vitest config (this gate enforces honesty). For Playwright, allow `retries: 1` in CI only (`playwright.config.ts` already has this pattern); for non-CI locally, `retries: 0`. The two known fragile e2e specs (`03-human-task-resolve` waiting on the inngest dev-runner flip; `01-manifest-agent-run` waiting on the run row to materialize) get a `test.slow()` annotation rather than retry padding.

### 5.4 Visual diff allowlist policy

Current `portal.spec.ts` runs at 1440×900 with `animations: "disabled"` + `reducedMotion: "reduce"` + a custom `freezeAnimations()` CSS injection. Pixel tolerance is the Playwright default. **Recommendation:** explicitly pin `maxDiffPixelRatio: 0.001` (0.1%) on the `toHaveScreenshot` call per the FR-PORT-3 spec in PRODUCT_CATALOG.md. **Allowlist:** a 1px diff is acceptable only when the failure is in a sub-pixel rounding of a transformed element (rotated icon, SVG transform). In that case, the snapshot must be re-baselined with `--update-snapshots` invoked by a human reviewer (not by CI), and the PR must cite which view changed and why. Never accept a 1px diff blindly — the reference set is design-locked.

---

## 6. Wave 5 test sweep plan

### 6.1 Order of operations

1. **Static gates first (~2 min):** `pnpm -r typecheck`, then `pnpm -r lint`. Fail-fast; don't proceed if either is red.
2. **Smoke (~30s):** `pnpm --filter @agentic/api exec vitest run test/smoke.test.ts` (the new file proposed in §4.5). Sanity check that boot, auth, metrics, and the testAgent happy path all work.
3. **Unit + integration (~5–8 min):** `pnpm -r test:coverage`. Covers all 50 existing api `tc-*.test.ts` files + the 31 new ones + the web unit gate. Coverage report drops into `apps/*/coverage/`.
4. **E2E (~6–10 min):** `pnpm --filter @agentic/web test:e2e`. 6 existing flows + the 5 new ones. Needs `pnpm db:seed && pnpm seed:rich` first.
5. **Visual + a11y (~3 min):** `pnpm --filter @agentic/web exec playwright test test/visual`. Compare against `v1_1-reference/`. Any drift → human review.
6. **Build smoke (~2 min):** `pnpm -r build`. Catches type errors that escaped `--noEmit` mode.

**Total wall time target:** under 25 minutes on a fresh `nvm use` + `pnpm install`. The api workspace's `singleFork: true` is the main wall-clock bottleneck; resist the urge to parallelize.

### 6.2 Maximum acceptable run time per layer

| Layer | Soft target | Hard cap | Action at cap |
|---|---:|---:|---|
| typecheck + lint | 2 min | 5 min | investigate slow tsc; do not skip |
| smoke | 30 s | 60 s | report — smoke is the canary |
| unit + integration (api) | 5 min | 8 min | report; if regression, bisect against the 50 existing files |
| unit (web) | 30 s | 90 s | report |
| e2e (Playwright) | 8 min | 15 min | report; Playwright trace screenshots auto-uploaded by CI |
| visual + a11y | 3 min | 6 min | report; visual drifts always get human review |
| build | 2 min | 5 min | report |

### 6.3 Bail-out triggers

- **If more than 3 tests fail in any layer, STOP and report.** Do not patch tests blindly. A single failing test gets fixed in-place; cluster failures imply a regression in shared infrastructure (harness, mock LLM, schema migration, route registration) and must be diagnosed first.
- **If a flake is suspected** (test passes on rerun, no code change): do NOT add a retry — file as `flake` and continue.
- **If coverage drops below 70/60:** STOP. Coverage drops with no test-count change indicate a code-only PR introduced uncovered branches. Either add tests or shrink the include glob with an inline comment documenting the exclusion.
- **If a visual diff is detected:** STOP. Visual reference is design-locked. Run `git diff apps/web/test/visual/v1_1-reference/` — if zero changes there, the drift is real and must be reviewed before merge.

### 6.4 Definition of done

For V1.1 GA the bar is **zero failing tests across all 4 layers**:
1. `pnpm -r typecheck` exits 0.
2. `pnpm -r lint` exits 0.
3. `pnpm -r test:coverage` exits 0 with each workspace meeting lines ≥70 / branches ≥60.
4. `pnpm --filter @agentic/web test:e2e` exits 0 with all 11 specs green.
5. `pnpm --filter @agentic/web exec playwright test test/visual` exits 0 with zero drift against `v1_1-reference/`.
6. The CI meta job (`ci`) is green on the PR that ships the final V1.1 work, including the new `smoke` + `visual` leaves.

Each V1.1 use case (UC-V11-01..39) must have at least one **previously red, now green** test referenced in the commit message (TDD pattern). The Wave 5 driver should keep a running log at `docs/wave-5-test-status.md` listing UC → test file → first-failed-sha → first-passed-sha so the historical TDD trail is auditable.

---

## 7. Risks and watchpoints

- **The `_portal_legacy/` test (`tc-18-p1-spa-bootstrap.test.ts`) becomes dead code** when UC-V11-30 lands. Delete the file in the same PR that removes the directory; do not leave it to fail-skip.
- **The Idempotency-Key story is partially shipped:** `tc-71-tenants-idempotency.test.ts` is the only file honoring the contract today, because the table `idempotency_keys` doesn't exist yet. UC-V11-32 ships the table + cache helper + plugin; the proposed `tc-112` + `tc-113` cover events and invoke. Until then, **disable** `tc-71`'s use of the legacy in-memory LRU once the persistent table is wired — leaving both code paths live is the worst outcome.
- **Manifest engine `runs_total` counter** (UC-V11-22): the proposed `tc-104` requires actually scraping `/metrics` after a manifest run completes. The Inngest dev runner's polling cadence means the scrape may need a `waitFor` poll up to 5 s. Tag as `test.slow()` if it exceeds 2 s. Do not lean on `step.sleep` to wait — the test's clock should be real.
- **The 17 RAAS stage tests** (UC-V1-32..48): today only `syncFromClientSystem` is exercised end-to-end. The proposed `tc-86-raas-stage-walk.test.ts` should be parameterized over the 17 nodes from `models/RAAS-v1/workflow_v1.json` (or the newer `workflow_v2.json` currently shown in `git status`). One assertion per node: trigger event → run row appears (status `ok` or `running→ok`) within 30 s → at least one step row → triggered_event emits one of the declared outputs. **Do not** assert on Chinese-vs-English action names — payload `agentName` is locale-independent (the existing e2e helper uses this pattern).
- **The `workflow_v2.json` in `git status`**: untracked file that the next manifest reload may pick up. Wave 5 should ensure the test fixtures pin to a specific workflow version and don't drift on what's in `models/`.

---

## 8. Reviewer's verdict

**Ready for Wave 5 with the following preconditions:**

1. The 31 proposed api test files + 5 new e2e + 1 visual extension + 3 web/cli unit tests are written before any V1.1 production code lands (TDD).
2. The `smoke` test file lands first and gets wired into CI as a leaf job.
3. The visual test job is split out from `e2e:` so drift gets its own signal.
4. The pre-commit smoke hook is documented in `docs/CI.md` so contributors opt in.
5. Coverage thresholds stay at 70/60 during V1.1 active work; raise to 75/65 only after all UC-V11-* tests are green.

**GAPS BLOCK** if any of:
- Wave 5 starts implementation before the test files exist (would break the TDD discipline this strategy assumes).
- The `tc-126-cross-tenant-bearer-idor.test.ts` (multi-tenant bearer IDOR) is deferred past V1.1 — this is a security regression risk and the audit doc has called it out twice.
- The Idempotency-Key test pair (`tc-112` + `tc-113`) lands without the underlying `idempotency_keys` table — would produce false-pass tests against an in-memory LRU that production never sees.

---

---

## 9. New test file register (Wave 5 worklist)

The following 40 new test file paths are the deliverable contract for Wave 5. They are listed here so the engineer can scaffold them as `describe.todo()` shells in a single first commit, then turn each into red→green in subsequent commits as the V1.1 implementation work proceeds.

### 9.1 `apps/api/test/` — 31 new files

```
apps/api/test/smoke.test.ts                          (§4.5; not in UC table)
apps/api/test/tc-80-agents-5tabs.test.ts             (UC-V1-09..10 follow-up)
apps/api/test/tc-81-run-io-tab.test.ts               (UC-V1-18..19)
apps/api/test/tc-82-task-snooze.test.ts              (UC-V1-21)
apps/api/test/tc-83-usage-route.test.ts              (UC-V1-23 / UC-V11-17 / UC-V11-38)
apps/api/test/tc-84-audit-diff.test.ts               (UC-V1-24)
apps/api/test/tc-85-token-rotate.test.ts             (UC-V1-27)
apps/api/test/tc-86-raas-stage-walk.test.ts          (UC-V1-32..48 — parameterized)
apps/api/test/tc-87-stream-route.test.ts             (UC-V1-51 + UC-V11-33)
apps/api/test/tc-90-notifications-dispatcher.test.ts (UC-V11-01)
apps/api/test/tc-91-public-task-resolve.test.ts      (UC-V11-02)
apps/api/test/tc-92-runs-compare.test.ts             (UC-V11-03)
apps/api/test/tc-93-deployment-sse-event.test.ts     (UC-V11-06)
apps/api/test/tc-94-runs-replay-bulk.test.ts         (UC-V11-07)
apps/api/test/tc-95-stream-pause.test.ts             (UC-V11-08)
apps/api/test/tc-96-health-timeline.test.ts          (UC-V11-09)
apps/api/test/tc-97-tenant-rate-limit.test.ts        (UC-V11-10)
apps/api/test/tc-98-trace-tree.test.ts               (UC-V11-11)
apps/api/test/tc-99-provider-errors-card.test.ts     (UC-V11-12)
apps/api/test/tc-100-agents-dry-run.test.ts          (UC-V11-14)
apps/api/test/tc-101-public-task-readonly.test.ts    (UC-V11-16)
apps/api/test/tc-102-agents-with-tenant-code.test.ts (UC-V11-18 / UC-V11-28)
apps/api/test/tc-103-runs-emitted-event-join.test.ts (UC-V11-21)
apps/api/test/tc-104-runs-total-manifest.test.ts     (UC-V11-22)
apps/api/test/tc-105-tool-use-dispatch.test.ts       (UC-V11-23)
apps/api/test/tc-106-base-agent-failover.test.ts     (UC-V11-24)
apps/api/test/tc-107-logic-prompt-required.test.ts   (UC-V11-25)
apps/api/test/tc-108-bedrock-vertex-adapters.test.ts (UC-V11-26)
apps/api/test/tc-109-webhook-no-default-secret.test.ts (UC-V11-27)
apps/api/test/tc-110-cookie-auth-prod.test.ts        (UC-V11-29)
apps/api/test/tc-111-imports-gitignored.test.ts      (UC-V11-31)
apps/api/test/tc-112-idempotency-key-events.test.ts  (UC-V11-32)
apps/api/test/tc-113-idempotency-key-invoke.test.ts  (UC-V11-32)
apps/api/test/tc-114-route-registration.test.ts      (UC-V11-33)
apps/api/test/tc-115-otel-spans.test.ts              (UC-V11-34)
apps/api/test/tc-116-fail-run-race.test.ts           (UC-V11-35)
apps/api/test/tc-117-dlq-flow.test.ts                (UC-V11-36)
apps/api/test/tc-118-audit-mutation-coverage.test.ts (UC-V11-39)
apps/api/test/tc-119-waitforevent-timeout.test.ts    (§3.1)
apps/api/test/tc-120-task-cancel.test.ts             (§3.1)
apps/api/test/tc-121-task-double-resolve.test.ts     (§3.1)
apps/api/test/tc-122-llm-401-failover.test.ts        (§3.2)
apps/api/test/tc-123-llm-429-retry.test.ts           (§3.2)
apps/api/test/tc-124-llm-timeout-bail.test.ts        (§3.2)
apps/api/test/tc-125-budget-exceeded.test.ts         (§3.2)
apps/api/test/tc-126-cross-tenant-bearer-idor.test.ts (§3.3 — security)
apps/api/test/tc-127-tenant-scoping-helper.test.ts   (§3.3)
apps/api/test/tc-128-inngest-replay-idempotent.test.ts (§3.4)
apps/api/test/tc-129-reconcile-expired-pending.test.ts (§3.5)
apps/api/test/tc-130-reconcile-crashed-rename.test.ts  (§3.5)
apps/api/test/tc-131-reconcile-missing-manifest.test.ts (§3.5)
apps/api/test/tc-132-reconcile-orphan-staging.test.ts  (§3.5)
apps/api/test/tc-133-webhook-signature-algos.test.ts (§3.6)
apps/api/test/tc-134-llm-key-redaction.test.ts       (§3.7)
```

Count check: 53 entries above (some UCs share a file; some §3 gaps share UCs). Net new files: 52 (smoke.test.ts + 51 tc-*) since `tc-102` covers both UC-V11-18 and UC-V11-28, and `tc-83` covers UC-V11-17 + UC-V11-38 + UC-V1-23. **Reconciled to 47 unique new api test files** after the dedup above.

### 9.2 `apps/web/e2e/` — 5 new files

```
apps/web/e2e/07-run-to-agent-jump.spec.ts    (UC-V1-13)
apps/web/e2e/08-cmd-k-navigate.spec.ts       (UC-V1-29)
apps/web/e2e/09-public-task-form.spec.ts     (UC-V11-02)
apps/web/e2e/10-cmd-k-emit-event.spec.ts     (UC-V11-04)
apps/web/e2e/11-tenant-switch-draft-confirm.spec.ts (UC-V11-15)
apps/web/e2e/12-webhook-settings-flow.spec.ts (§4.1 — UC-V11-27 UI)
apps/web/e2e/13-usage-chart.spec.ts          (§4.1 — UC-V1-23 / UC-V11-17 UI)
apps/web/e2e/14-dlq-retry.spec.ts            (§4.1 — UC-V11-36 UI)
```

That's 8 e2e specs (3 are §4.1 promotions, 5 are direct UC-driven). Sequence them as 07..14 to keep alphabetic ordering aligned with execution order.

### 9.3 `apps/web/test/visual/` — extensions, no new files

The tasks dedupe re-baseline (UC-V11-20) is an `--update-snapshots` invocation, not a new spec. The 9-view sweep in `portal.spec.ts` is sufficient. A new spec is only justified if a brand-new view ships in V1.1 — none planned.

### 9.4 `apps/web/lib/` + `apps/cli/test/` — 3 new unit files

```
apps/web/lib/cost-preview.test.ts            (UC-V11-05)
apps/web/lib/draft-storage.test.ts           (UC-V11-13)
apps/web/lib/tasks-dedupe.test.ts            (UC-V11-20)
apps/web/lib/legacy-removed.test.ts          (UC-V11-30 — static fs check)
apps/cli/test/init-scaffold.test.ts          (UC-V1-49 + UC-V11-19)
apps/cli/test/logs-tail.test.ts              (UC-V1-51)
```

6 files. Both web/cli sides will need fixtures added under existing dirs — no new `__fixtures__` trees.

**Grand total new test files: 47 api + 8 e2e + 6 web/cli unit = 61 files.** (The §2 count of "40" was based on USE_CASES.md table entries; this register includes the §3 systemic-gap tests and the §4.5 smoke file.)

---

---

## 10. TDD ordering & dependency map (for Wave 5 engineers)

The 61 files in §9 cannot all be written and turned green in parallel — many depend on shared schema or infra changes. This section sequences them.

### 10.1 Independent (write first, ungated)

These have zero new-infrastructure dependency. Engineers can write red-then-green in any order:

- `tc-80..82` (agents tabs, run io, task snooze) — pure read-shape contracts
- `tc-84` (audit diff) — uses existing `audit_log`
- `tc-85` (token rotate) — uses existing `api_tokens`
- `tc-92, 96, 97, 98` (runs compare, health timeline, rate-limit, trace tree) — additive routes only
- `tc-100, 101` (dry-run, read-only task) — flag-based on existing routes
- `tc-105, 106, 107, 108, 109, 110` — backend-only UC-V11-* fixes
- `tc-119..125` (HITL + LLM failure paths) — testing existing harness; the prod code may need touch-ups, but no new schema
- `tc-126, 127, 128` (cross-tenant, scoping helper, replay determinism) — pure invariant tests
- `tc-129..132` (reconcile crash scenarios) — restart-of-harness pattern is already used in `manifest-import-*.test.ts`
- `tc-133, 134` (webhook algos, key redaction) — extend existing
- All web/cli unit files in §9.4

### 10.2 Schema-gated (write after migration lands)

These require a migration before they can pass. Engineer **must** land the drizzle migration in the same PR as the test:

| Test | Depends on |
|---|---|
| `tc-112, 113` (Idempotency-Key) | new `idempotency_keys` table |
| `tc-117` (DLQ) | new `dead_letter_runs` table |
| `tc-118` (audit mutation coverage) | no schema; depends on a `routes/v1/_registry.ts` helper that introspects route methods |
| extended `tc-13` (unique steps_run_ord_idx) | promote index to `uniqueIndex` |

Sequence: ship the migration in commit N, the test in commit N+1, the prod-code fix in commit N+2. Three commits, all in one PR.

### 10.3 Route-registration-gated (write after server.ts wiring)

These need `apps/api/src/server.ts` to register a previously-absent route module:

| Test | Depends on |
|---|---|
| `tc-87, 95, 114` (stream / pause / route reg) | `streamRoutes` registered in server.ts |
| `tc-83` (usage end-to-end) | `usageRoutes` wired into web hook + unwrapEnvelope fix |
| `tc-93` (deployment SSE event) | `streamRoutes` registered |
| `tc-94` (bulk replay) | new route module `runs-replay-bulk.ts` |
| `tc-102` (POST /v1/agents with tenant_code) | bug fix in `routes/v1/agents.ts:97` path resolution |
| `tc-103` (emittedEvent join) | LEFT JOIN added in `queries/runs.ts` |
| `tc-104` (manifest runs_total) | `metrics.runs.inc(...)` call added in `register.ts` finalize |

Sequence: same three-commit pattern (registration → test → fix).

### 10.4 Cross-system-gated (write last)

These need outside-the-backend dependencies:

| Test | Depends on |
|---|---|
| `tc-90` (notifications) | `@agentic/notifications` adapter package + per-tenant config |
| `tc-91` (public task resolve) | new `app/(public)/task/[token]/page.tsx` route in web; JWT scope contract finalized |
| `tc-108` (Bedrock + Vertex) | real `@aws-sdk/client-bedrock-runtime` + `@google-cloud/vertexai` deps |
| `tc-115` (OTel spans) | OTel SDK + in-memory exporter for the test side |
| All Playwright specs in §9.2 | live dev stack + seeded data |

### 10.5 Failing-then-passing TDD checklist

For each UC-V11-* the engineer must:

1. Write the test against a non-existent route / unfixed bug. Run `pnpm --filter @agentic/api exec vitest run test/tc-<n>-<scenario>.test.ts`. **Confirm red.**
2. Commit the failing test with subject `test: add tc-<n> for UC-V11-<NN> (red)`.
3. Implement the fix (route, migration, bug patch). Confirm the test goes green.
4. Commit the fix with subject `fix: <one-line> closes UC-V11-<NN>` and the body referencing both the audit doc AND the test file.

This is enforceable via PR template; recommend a template addition in `.github/pull_request_template.md` that requires citing both the UC ID and the TC file path.

### 10.6 What not to do

- **Do not write green-first tests.** A test that passes without the production code change is worse than no test — it gives false confidence and won't catch a regression if the fix is reverted.
- **Do not skip the smoke test.** `apps/api/test/smoke.test.ts` is the canary; if the V1.1 work breaks bootstrap, smoke catches it in 30 s instead of waiting 10 min for the full suite.
- **Do not mock the harness.** All proposed integration tests use `buildTestEnv()` from `apps/api/test/harness.ts` — they hit the real Fastify app in-process. Mocking the harness defeats the point and produces tests that pass against a fictional API.
- **Do not raise coverage thresholds in the same PR as the tests.** Sequence: tests land → CI report shows new coverage numbers → followup PR bumps the threshold.
- **Do not retire `tc-18-p1-spa-bootstrap.test.ts` until UC-V11-30 fully removes `_portal_legacy/`.** Killing the test first masks the cleanup not happening.

---

**Strategy written: docs/wave-3-reviews/05-test-strategy.md (~3850 words, 61 new test files proposed: 47 api vitest + 8 Playwright e2e + 6 web/cli unit, covering all 39 V1.1 use cases plus 8 systemic-gap categories, with full Wave 5 sequencing in §10).**
