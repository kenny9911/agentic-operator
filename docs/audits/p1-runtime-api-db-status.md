# Phase 1 Runtime + API + DB + LLM Budget — implementation status

**Owner.** Senior Backend Engineer (this PR).
**Date.** 2026-05-19.
**Scope.** IMPLEMENTATION.md §5.1, §5.3, §5.4, §5.6, §5.7 (the runtime / api / db / budget slices).
**Out of scope.** `packages/agents/*` (Agents engineer), `packages/contracts/src/llm.ts` (Agents engineer), `packages/llm-gateway/src/{types,adapters/*}` (Agents engineer), `apps/api/src/routes/v1/agent-invoke.ts` async hook (Agents engineer), `apps/web/*` + `apps/cli/*` (Frontend engineer).

---

## 1. Per-task summary

| ID | Status | Files changed | Test added | Acceptance proof |
|---|---|---|---|---|
| **P1-CON-03** | DONE | `packages/contracts/src/runs.ts` | `tc-14-p1-stream.test.ts` (1 test: `RunStreamEvent zod schema parses every variant`) | Discriminated `RunStreamEvent` union with 8 variants (`run.started`, `run.step.started`, `run.step.completed`, `run.completed`, `run.failed`, `event.emitted`, `task.created`, `task.resolved`) parses + discriminates with full type narrowing. |
| **P1-CON-04** | DONE | `packages/contracts/src/agents.ts` | covered by TC-8 (existing) + prose | New `StepOutputEmit` Zod schema published with docs of the `__emit` discriminator + `__emit_payload` reservation. P0-RT-02's runtime field is now a documented contract. |
| **P1-RT-03** | DONE | `packages/runtime/src/manifest.ts:14-50`, `step-engine.ts:316-385`, `register.ts` (3 new step-type branches), `packages/contracts/src/agents.ts`, `packages/contracts/src/runs.ts`, `packages/db/src/schema.ts` (steps.type enum widened) | `tc-22-p1-step-types.test.ts` (8 tests) | Manifest parses `condition`/`delay`/`subflow`. Step engine dispatches each: condition returns `{ evaluated: true }`, delay sleeps ~delay_ms, subflow returns the placeholder shape. The full Inngest branches in `register.ts` use `step.sleep` for delay and `step.sendEvent + step.waitForEvent('subflow.done', ...)` for subflow. |
| **P1-RT-04** | DONE | `packages/db/src/schema.ts` (`runs.parentRunId`), new `packages/db/drizzle/0004_parent_run.sql`, `register.ts` (reads `__parent_run_id` from trigger event, writes to runs row, also emits `subflow.done` upstream on child run completion) | `tc-22-p1-step-types.test.ts` ("runs.parent_run_id column exists") | `PRAGMA table_info('runs')` includes `parent_run_id`. The runtime threads it through `__parent_run_id` on the trigger-event payload; a child run's `init` step persists it. |
| **P1-RT-05** | DONE | new `packages/runtime/src/broadcast.ts`, `register.ts` (publishStream calls on every lifecycle transition), `packages/runtime/src/index.ts` (re-exports) | `tc-14-p1-stream.test.ts` (4 broadcast unit tests + 1 live-wire SSE smoke) | In-process `EventEmitter` per tenant with `publish`/`subscribe`/`__subscriberCount`/`__resetForTest`. Lifecycle events fire on `run.started`, `run.step.started`/`completed`, `run.completed`, `run.failed`, `event.emitted`, `task.created`/`resolved`. Per-tenant isolation verified — subscriber to ten-a never sees ten-b events. |
| **P1-API-01** | DONE | new `apps/api/src/routes/v1/stream.ts`, registered in `apps/api/src/server.ts` | `tc-14-p1-stream.test.ts` ("delivers a published event to a real SSE client within 1s") | `GET /v1/stream` returns `text/event-stream`, immediately sends an `event: ready` frame, then streams `data: {...JSON...}` for each `RunStreamEvent` published on the caller's tenant channel. 15s keepalive comments defeat idle proxies. Cleanup hooks on `close`/`error` deregister the subscriber. **Smoke proof**: real port, `fetch`-streamed body, `publishStreamEvent` fires `run.started`, the SSE buffer contains `"type":"run.started"` within 1s. |
| **P1-API-02** | DONE | `apps/api/src/plugins/audit.ts` (left untouched — already shape-correct), `apps/api/src/bootstrap.ts` (code-agent register audit), `apps/api/src/routes/v1/agents.ts` (enable/disable + audit), `apps/api/src/routes/v1/runs.ts` (replay audit), `apps/api/src/routes/v1/events.ts` (event replay audit). Pre-existing audit hooks (rollback in `deployments.ts`, task.resolve in `tasks.ts`, manifest.deploy in `agents.ts`) verified intact. | `tc-20-p1-api.test.ts` ("agents/:kebab/disable writes an audit row" + budget.update audit assertions) | New `POST /v1/agents/:kebab/{enable,disable}` writes one `agent.enable`/`agent.disable` row each. Run replay, event replay, code-agent register pass all write audit rows. |
| **P1-API-03** | DONE | new `apps/api/src/routes/v1/audit.ts`, registered in `server.ts` | `tc-20-p1-api.test.ts` (`GET /v1/audit` returns tenant-scoped rows in descending time order) | `GET /v1/audit?since=&until=&actor=&action=&limit=&cursor=`. Tenant-scoped (drizzle `eq(auditLog.tenantId, auth.tenantId)`), descending `at`, exclusive cursor pagination via `nextCursor` (last row's `at` as a stringified unix-ms). Caps at 500 rows per page. |
| **P1-API-04** | DONE | new `apps/api/src/routes/v1/budgets.ts`, registered in `server.ts` | `tc-20-p1-api.test.ts` (GET creates default + PUT updates + reset zeros usage) | `GET /v1/budgets` lazily materializes a default-empty row when missing. `PUT /v1/budgets` accepts `{ monthlyTokenCap?, monthlyUsdCap?, reset? }` and writes an `audit_log` row with `action='budget.update'`. |
| **P1-API-04b** | DONE | `packages/db/src/schema.ts` (`deletedAt` on events/runs/tasks + indices), new `packages/db/drizzle/0007_soft_delete.sql`, `packages/runtime/src/retention.ts` (real `runRetentionSweep` + `retentionSweepFn` cron `30 3 * * *`), `apps/api/src/bootstrap.ts` (registers `retentionSweepFn`) | `tc-22-p1-step-types.test.ts` (retention sweep results + tombstone semantics) | `runRetentionSweep()` returns `{ events, runs, tasks, ranAt, cutoffAt, retentionDays }`. `AGENTIC_RETENTION_DAYS=0` makes the sweep a no-op. Sweep stamps `deleted_at` on aged rows (events: by `received_at`, runs: by `ended_at` + only when `ended_at IS NOT NULL`, tasks: by `created_at` + `status != 'open'`). The cron is registered as an Inngest function and exposed through `/api/inngest`. |
| **P1-DB-01** | DONE | `packages/db/src/schema.ts` (`tenantBudgets` table), new `packages/db/drizzle/0005_tenant_budgets.sql` | `tc-20-p1-api.test.ts` (insert + select round-trip) | Schema includes `{ tenant_id PK, monthly_token_cap, monthly_usd_cap, used_tokens_month, used_usd_month, period_start, updated_at }`. USD stored as integer cents to avoid float drift. FK cascade to tenants. |
| **P1-DB-02** | DONE | `packages/db/src/schema.ts` (`meta` table), new `packages/db/drizzle/0006_schema_meta.sql`, `apps/api/src/bootstrap.ts` (`assertSchemaVersionSupported()` boot guard) | `tc-20-p1-api.test.ts` ("_meta.schema_version is seeded") | `_meta(key PK, value, updated_at)` table seeded with `('schema_version', '6')`. Bootstrap throws when `DB.schema_version > SUPPORTED_SCHEMA_VERSION`. The constant is `6` for this codebase; future migrations bump it. |
| **P1-LLM-05** | DONE | new `packages/llm-gateway/src/budget.ts`, `packages/llm-gateway/src/gateway.ts:71-124+` (pre-call assert + post-call deduct), `packages/llm-gateway/src/errors.ts` (`cost_limit_exceeded` LLMErrorCode), `packages/llm-gateway/package.json` (+ `@agentic/db` + `drizzle-orm` dep) | `tc-21-p1-budget.test.ts` (5 tests: under-cap, over-tokens, over-usd, uncapped no-op, no-tenant disables hook) | Tenant with `monthly_token_cap=5, used=5` and a follow-up `chat()` → `LLMError("cost_limit_exceeded")` BEFORE the adapter runs. Tenant with `monthly_usd_cap=0, used=1c` → same. Tenant with no row → silent unlimited. Tenant without `tenantId` on the request → hook is a no-op. **Strategy**: deduct-then-execute (see `budget.ts` doc-comment for rationale). |

---

## 2. Public-shape changes (called out per quality-bar requirement)

1. **`@agentic/contracts`** — `RunStreamEvent` discriminated union published (8 variants). `StepType` enum widened to 6 values (`condition`, `delay`, `subflow` added). `ActionSpec.type` likewise; new optional fields `delay_ms`, `subflow`, `subflow_input` on `ActionSpec`. New `StepOutputEmit` schema documents the `__emit` field contract.

2. **`@agentic/runtime`** — `StepTypeEnum` widened (mirrors contracts). `ActionSchema` carries `delay_ms`, `subflow`, `subflow_input`. New exports: `publishStreamEvent`, `subscribeStreamEvents`, `__broadcastSubscriberCount`, `__broadcastResetForTest`, `runRetentionSweep`, `retentionSweepFn`, `RetentionResult`.

3. **`@agentic/db`** — New tables: `tenant_budgets`, `_meta`. New columns: `runs.parent_run_id`, `events.deleted_at`, `runs.deleted_at`, `tasks.deleted_at`. Schema export includes `tenantBudgets` and `meta`. Existing imports of `meta`-named exports **must alias** because Vite's SSR transformer confuses bare `meta.<x>` member access with `import.meta`. See note in §6.

4. **`@agentic/llm-gateway`** — `LLMErrorCode` union gains `cost_limit_exceeded`. `ChatRequest` augmented (via TS module declaration in `budget.ts`) with optional `tenantId?: string` — callers attach the tenant to enable the budget hook. New exports: `assertBudgetAvailable`, `recordActualSpend` (consumed only by the gateway).

5. **`apps/api`** — New routes: `GET /v1/stream`, `GET /v1/audit`, `GET/PUT /v1/budgets`, `POST /v1/agents/:kebab/enable`, `POST /v1/agents/:kebab/disable`. Bootstrap pipeline gains a schema-version check and registers `retentionSweepFn` alongside agent functions.

---

## 3. DB migrations: ordinals + caveats

| Ordinal | File | Tables/columns | Notes |
|---|---|---|---|
| 0004 | `0004_parent_run.sql` | `ALTER TABLE runs ADD parent_run_id text;` + `runs_parent_run_idx` | Nullable, no default — backfill leaves `NULL`. SQLite-safe. |
| 0005 | `0005_tenant_budgets.sql` | `CREATE TABLE tenant_budgets (...)` | All caps nullable. `period_start` + `updated_at` default to `unixepoch() * 1000`. |
| 0006 | `0006_schema_meta.sql` | `CREATE TABLE _meta` + `INSERT ('schema_version', '6')` | Seeds the row so the boot guard sees a valid version on a fresh DB. |
| 0007 | `0007_soft_delete.sql` | `ALTER TABLE events/runs/tasks ADD deleted_at` + 3 indices | Nullable, no default. SQLite handles `ALTER TABLE ADD COLUMN` of nullable text/integer just fine. |

**SQLite quirks worth flagging.**

- `ALTER TABLE … ADD COLUMN … DEFAULT (unixepoch() * 1000) NOT NULL` is REJECTED because the default expression isn't constant. The new migrations sidestep this by either using nullable columns (0007) or by allowing the application layer to supply the timestamp (0004 doesn't need one; 0005 is a CREATE TABLE so the default expression is fine in that context).
- The 0006 migration commits an `INSERT` that's idempotent only via the migrator's tag tracking. If `_meta` ever needs an UPDATE, do it in a follow-up migration so the existing applied tag stays untouched.

`pnpm db:migrate` against the dev DB ran clean. `PRAGMA table_info` confirms all new columns exist; `SELECT * FROM _meta` returns the seeded `('schema_version', '6')` row.

---

## 4. SSE design notes

**Subscription model.** A per-tenant `EventEmitter`. `subscribe(tenantId, listener) → unsub()` returns an unsubscribe function the caller MUST invoke on socket close — otherwise listeners leak for the life of the process. The SSE route registers cleanup on `req.raw.on('close')`, `raw.on('close')`, `raw.on('error')`.

**Tenant scoping.** The route derives tenant from `requireAuth`. There is no `?tenant=` query override. Cross-tenant streams will eventually live behind a platform-admin marker, which is out of scope for Phase 1 (the marker isn't wired yet — `isPlatformAdmin()` returns `false`).

**Backpressure.** EventEmitter delivers synchronously and the listener performs an unbuffered `raw.write`. Node's stream backpressure protocol is opt-in for `write()` callers; we currently ignore the `false` return value. The trade-off:

- v1 publish volume is low (~10 events per run × ~10 concurrent runs = ~100 events/sec peak across the whole API). For a single subscriber the socket can drain ~100k frames/sec, so we're 1000× under the threshold.
- Phase 4 should swap the `EventEmitter` for a real queue with a high-water mark, drop-oldest semantics, and per-subscriber buffer accounting. The current API contract (`publish`/`subscribe`) is intentionally stable so that swap is a one-file change.

**Reconnect / replay.** Subscribers that join mid-run only see future events. They should backfill via `GET /v1/runs/:id` first then start streaming. The frontend's `useStream()` hook in Phase 2 will implement this pattern.

**Frame format.** Standard SSE: `data: <json>\n\n` for events, `: <comment>\n\n` for keepalives. The route emits a `ready` event immediately so clients can confirm the handshake before the first business event arrives.

---

## 5. Budget hook design notes

**Strategy: deduct-then-execute** (NOT reserve-then-execute).

- `assertBudgetAvailable(tenantId, provider)` does a pure read: it compares `used_tokens_month` to `monthly_token_cap` and `used_usd_month` to `monthly_usd_cap`. Throws `LLMError("cost_limit_exceeded")` when either is exceeded.
- `recordActualSpend({ tenantId, provider, tokensIn, tokensOut })` does the deduction AFTER the call, using the actual tokens + the catalog USD price for `(provider, model)`. USD price is per-million-token cents stored in a static `PRICE_PER_MTOK_CENTS` map; updates as provider pricing shifts.

**Why deduct-then-execute?**

- Simple — no in-flight reservation bookkeeping; failures are cheap (we don't have to refund unspent reservations).
- Bounded overshoot — a single tenant can race up to `concurrent_calls × max_cost_per_call` past the cap before any deduction lands. For v1's 8-concurrent-runs limit and Claude Sonnet pricing the worst case is a few cents.

**Why not reserve-then-execute?**

- Requires a row-level lock per `chat()` call. SQLite's `BEGIN IMMEDIATE` would serialize all gateway calls across the process. Acceptable for v1 (low volume) but the simpler path is fine for the same scale.
- Phase 4 can opt into reserve-then-execute by adding a `reserveBudget()` that takes a writer lock, plus a `releaseBudget()` on the success / error paths. The public surface stays the same.

**`tenantId` flow.** Callers attach `tenantId` to `ChatRequest`. Today only Step 1 / 2 callers exist:

- The runtime's `step-engine.ts::callLLM` doesn't carry tenantId yet — that's a downstream wiring task (a 1-line change to thread `ctx.tenantId` through `StepInput`). Marked for the Agents engineer to do alongside the tool-use loop work since it touches the same callsites.
- The `agents/run-engine.ts` flow (BaseAgent.run) doesn't carry tenantId yet either; same plan.

In practice both callsites will pass `tenantId = ctx.tenantId` once the Agents track wires it through. For now the budget hook is exercised purely via direct gateway construction in the test (and a follow-up integration test will confirm the runtime flow once the Agents engineer threads the field).

---

## 6. Notes for the verifier / next engineer

### 6.1 `meta` import alias in `apps/api/src/bootstrap.ts`

Vite's SSR transformer (used by vitest) misinterprets bare identifiers named `meta` as `import.meta` when they appear as member-access targets (`meta.key`, `meta.url`, etc.). The symptom is a confusing "Cannot split a chunk that has already been edited (X:Y – import.meta)" error at test-load time.

**Fix.** In `bootstrap.ts` I alias the import: `import { meta as metaTbl } from "@agentic/db"`. The drizzle schema export name stays `meta` — only consumers in bootstrap or tests need to alias.

If anyone else imports the table, do the same. A more permanent fix is to rename the schema export to `schemaMeta` or `metaTable` — left as a follow-up because it would force every future migration tag to track the rename.

### 6.2 SSE testing in vitest

`fastify.inject()` buffers the response body and is unsuitable for streaming. The TC-14 wire test binds a real port on `127.0.0.1` and uses `fetch` with `body.getReader()`. The test never `app.close()`s — the harness Fastify singleton stays open across the file so sibling tests aren't disrupted. If a future test needs strict teardown, build a dedicated app instance with `await build()` and close it explicitly.

### 6.3 Soft-delete reads

Existing list queries (`/v1/runs`, `/v1/events`, `/v1/tasks`) do NOT yet filter by `deleted_at IS NULL`. Today the sweep only stamps rows ≥30 days old (default), so reads are unaffected for the test workloads. When tombstones become visible, update the queries in `apps/api/src/queries/*.ts` to add the filter. I left this for the queries owner because it touches multiple files and isn't on the P1 critical path.

### 6.4 `subflow.done` event wiring

A `subflow` step in a parent run fires the child agent's normal trigger event with `__parent_run_id` + `__subflow_step_ord` piggy-backed. The child's `init` step persists `parent_run_id`. After the child run finalizes, it emits `subflow.done` with the same correlator payload. The parent's `step.waitForEvent('subflow.done', ...)` resolves and continues.

This is a deliberate v1 simplification — Inngest's `step.invoke` would give a more direct fan-out semantic, but it requires a typed function reference at the call site, which the runtime doesn't have without a registry lookup. Phase 2 can switch to `step.invoke` once we expose a `getAgentFunction(slug, name)` accessor.

### 6.5 New routes are tenant-scoped via `requireAuth`

`/v1/stream`, `/v1/audit`, `/v1/budgets`, `/v1/agents/:kebab/enable`, `/v1/agents/:kebab/disable` all call `requireAuth(req)` first. Cross-tenant access is impossible from these surfaces; a platform-admin layer would have to add explicit `?tenant=` or `?global=1` opt-ins. Out of scope for Phase 1.

### 6.6 Code-agent register audit is best-effort

The `code_agent.register` audit row is only written when `bootstrapCodeAgents` reports `deploymentsWritten > 0`. A no-op reboot doesn't create churn. This is by design — the audit log isn't meant to record every server restart, only events that change runtime behavior.

---

## 7. Final state

### Typecheck

| Workspace | Result |
|---|---|
| `@agentic/contracts` | PASS |
| `@agentic/db` | PASS |
| `@agentic/llm-gateway` | PASS |
| `@agentic/runtime` | PASS |
| `@agentic/agents` | PASS |
| `@agentic/api` | PASS |
| `@tenants/raas` | PASS |
| all other packages | PASS |

`pnpm -r typecheck` is fully green.

### Tests

`cd apps/api && pnpm test`:

```
Test Files  21 passed (21)
     Tests  133 passed (133)
```

Including:

- 83 pre-existing baseline tests (Phase 0)
- 10 from Agents-engineer P1 tracks (TC-15/16/17/18)
- New from this track:
  - **TC-14** (5 tests): broadcast channel unit tests + RunStreamEvent zod parse + live SSE wire smoke
  - **TC-20** (8 tests): schema_version, tenant_budgets insert, GET/PUT /v1/budgets, /v1/audit pagination, /v1/agents/:kebab/disable audit
  - **TC-21** (5 tests): budget hook over-cap rejection (tokens), over-cap rejection (USD), under-cap deduction, no-row no-op, no-tenant disabled
  - **TC-22** (8 tests): condition/delay/subflow step engine dispatch, parent_run_id + deleted_at column existence, retention sweep returns structured result

### Acceptance proofs

| Criterion | Proof |
|---|---|
| condition + delay + subflow work on a manifest fixture | TC-22 "step engine dispatches new types" — condition returns evaluated:true, delay sleeps ≥95ms for delay_ms:100, subflow returns the placeholder shape |
| SSE smoke: trigger an event, assert SSE emits `run.started` within 1s | TC-14 "delivers a published event to a real SSE client within 1s" — real port, fetch streaming, `publishStreamEvent({type:'run.started',…})` shows up in the SSE buffer within ~50ms |
| Budget cap rejects overspend with `LLMError("cost_limit_exceeded")` | TC-21 "over-cap tenant throws cost_limit_exceeded BEFORE the adapter runs" — `monthly_token_cap=5, used=5`, next call throws `LLMError` with code `cost_limit_exceeded` |
| All 83 existing tests still pass | 133/133 pass; this includes the original 83 baseline + new tests added by this track and the Agents engineer's parallel track |

---

## 8. Files I changed (canonical list)

### Contracts
```
packages/contracts/src/runs.ts        (+RunStreamEvent union, widened StepType)
packages/contracts/src/agents.ts      (+StepOutputEmit doc schema, widened ActionSpec.type + delay_ms/subflow fields)
```

### Runtime
```
packages/runtime/src/broadcast.ts     (new — per-tenant EventEmitter pub/sub)
packages/runtime/src/retention.ts     (real implementation — sweep + cron fn)
packages/runtime/src/manifest.ts      (StepTypeEnum widened, ActionSchema fields)
packages/runtime/src/step-engine.ts   (condition/delay/subflow dispatch branches)
packages/runtime/src/register.ts      (lifecycle publishStream calls, parent_run_id, new step-type Inngest branches, subflow.done emit)
packages/runtime/src/index.ts         (re-exports)
```

### DB
```
packages/db/src/schema.ts             (parentRunId, deletedAt on 3 tables, tenantBudgets, meta)
packages/db/drizzle/0004_parent_run.sql
packages/db/drizzle/0005_tenant_budgets.sql
packages/db/drizzle/0006_schema_meta.sql
packages/db/drizzle/0007_soft_delete.sql
packages/db/drizzle/meta/_journal.json (updated entries 4..7)
```

### LLM gateway
```
packages/llm-gateway/src/budget.ts    (new — assertBudgetAvailable + recordActualSpend)
packages/llm-gateway/src/gateway.ts   (pre-call assert + post-call deduct in chat())
packages/llm-gateway/src/errors.ts    (+cost_limit_exceeded LLMErrorCode)
packages/llm-gateway/package.json     (+@agentic/db, +drizzle-orm)
```

### API
```
apps/api/src/server.ts                (registers /v1/stream, /v1/audit, /v1/budgets)
apps/api/src/bootstrap.ts             (schema-version guard, code-agent register audit, retentionSweepFn registration, alias meta→metaTbl)
apps/api/src/routes/v1/stream.ts      (new — SSE handler)
apps/api/src/routes/v1/audit.ts       (new — paginated audit list)
apps/api/src/routes/v1/budgets.ts     (new — GET/PUT)
apps/api/src/routes/v1/agents.ts      (POST /:kebab/{enable,disable} + audit)
apps/api/src/routes/v1/runs.ts        (audit on /replay)
apps/api/src/routes/v1/events.ts      (audit on /:id/replay)
```

### Tests
```
apps/api/test/tc-14-p1-stream.test.ts       (5 tests — broadcast + SSE wire smoke)
apps/api/test/tc-20-p1-api.test.ts          (8 tests — _meta, tenant_budgets, audit, budgets, enable/disable)
apps/api/test/tc-21-p1-budget.test.ts       (5 tests — budget hook)
apps/api/test/tc-22-p1-step-types.test.ts   (8 tests — new step types, parent_run_id, retention)
```

### Status doc
```
docs/audits/p1-runtime-api-db-status.md     (this file)
```

No files in the out-of-scope tracks were touched.
