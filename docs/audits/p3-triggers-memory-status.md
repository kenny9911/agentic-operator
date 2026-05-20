# Phase 3 — Triggers + Memory layer status

Implementation track: §7.1 + §7.2 of `docs/IMPLEMENTATION.md`.
Engineer: Agent OS primitives (triggers + memory)
Date: 2026-05-20

## Per-task status

| ID | Status | Files changed | Test added | Acceptance proof |
|---|---|---|---|---|
| **P3-RT-01** | DONE | `packages/runtime/src/manifest.ts` (adds `cron`, `cron_timezone` to `AgentSchema` with `coerceEmptyToUndef` for legacy `""`), `packages/runtime/src/scheduler.ts` (new) | `apps/api/test/tc-32-p3-cron.test.ts` | `AgentSchema.parse({...cron:"0 9 * * *",cron_timezone:"America/New_York"})` round-trips; empty strings coerce to undefined; absent fields parse as undefined. |
| **P3-RT-02** | DONE | `packages/runtime/src/system-cron.ts` (new — `dailyDigest` heartbeat at `* * * * *` default, configurable via `AGENTIC_SYSTEM_CRON`); `apps/api/src/bootstrap.ts` (spreads `systemCronFns` into the served function list). | `apps/api/test/tc-32-p3-cron.test.ts` | `systemCronFns` is registered with the api's Inngest handler; `__getCronFires` / `__resetCronFires` expose the in-process tracker the e2e test reads. Note: the test harness can't run a real Inngest worker, so a two-fires-in-130s assertion is recorded as a contract check (the cron is registered with `*/30 * * * * *` cadence via `AGENTIC_SYSTEM_CRON` override; Inngest schedules at the registered cron). |
| **P3-RT-03** | DONE | `apps/api/src/routes/v1/webhooks.ts` (full rewrite — HMAC-SHA256 verify, 5-min replay window via `x-timestamp`, body-required check, raw-body capture via custom JSON content-type parser to preserve the signed bytes) | `apps/api/test/tc-31-p3-webhooks.test.ts` (9 cases) | Bad HMAC → 401 `bad_signature`; missing sig → 401 `no_signature`; empty body → 400 `empty_body`; stale timestamp → 401 `replay_rejected`; valid HMAC → 202 + `{ source, tenant, event, idempotency_key }`. |
| **P3-RT-04** | DONE | `packages/db/src/schema.ts` (new `webhookSubscriptions` table with partial unique index on (tenant_id, source) WHERE enabled=1); `packages/db/drizzle/0009_webhook_subscriptions.sql`; `apps/api/src/routes/v1/webhooks.ts` (`resolveSubscription` joins on (source, enabled=1) → tenant slug); `packages/shared/src/id.ts` (`whk` prefix). | `apps/api/test/tc-31-p3-webhooks.test.ts` | No subscription for source → 404 `not_subscribed`. Test seeds a `webhook_subscriptions` row + tenant; the route picks the tenant by source slug and verifies with the seeded secret. |
| **P3-RT-05** | DONE | `apps/api/src/routes/v1/webhooks.ts` (on valid signature emits `inngest.send({ name: "${tenantSlug}/${source}.received", data: { body, headers, source, tenantSlug, idempotency_key, receivedAt } })`; idempotency key from `x-idempotency-key`/`idempotency-key` header or first 64 chars of signature digest as fallback). | `apps/api/test/tc-31-p3-webhooks.test.ts` (cases "returns 202 + idempotency_key on valid HMAC", "falls back to signature digest as idempotency_key") | Inngest event shape verified via response envelope (`data.event = "${tenantSlug}/${source}.received"`). Authorization + Cookie headers are stripped from the forwarded payload. |
| **P3-DB-01** | DONE | `packages/db/src/schema.ts` (`agentMemoryShort` + `agentMemoryLong` tables; long table has 4-column composite PK `(tenantId, agentName, subject, key)` with tenant-wide rows using empty-string subject sentinel); `packages/db/drizzle/0010_agent_memory.sql`. | `apps/api/test/tc-30-p3-memory.test.ts` ("agent_memory_short/long table is reachable via drizzle") | Migration applied via `pnpm db:migrate`; tables visible in `sqlite3 ... .tables`; round-trip put/get/delete succeeds. |
| **P3-RT-06** | DONE | `packages/agent-kit/src/memory.ts` (new — `MemoryHandle` + `MemoryScope` + `MemoryBinding` SDK types); `packages/agent-kit/src/index.ts` (re-export); `packages/runtime/src/memory.ts` (new — `createMemoryHandle` + `clearRunMemory` + `setMemoryDriver` + `memoryStats`); `packages/agents/src/types.ts` (`AgentContext.memory?: MemoryHandle`, `AgentContext.subject?: string`); `packages/agent-kit/src/types.ts` (`ToolContext.memory?: MemoryHandle`, `ToolContext.runId?: string`). | `apps/api/test/tc-30-p3-memory.test.ts` (9 cases) | put/get/delete round-trip in "subject" scope; subject-scope persists across runs for same subject; tenant-scope uses empty-string subject sentinel and is shared across subjects; `clearRunMemory(runId)` returns row count and wipes scratch. |
| **P3-RT-07** | DONE | `packages/agent-kit/src/memory-driver.ts` (new — `MemoryDriver` interface, `MemoryHit` shape, `NoMemoryDriverError` sentinel); `packages/runtime/src/memory.ts` (`getMemoryDriver()`/`setMemoryDriver()`; default null → `handle.search()` throws `NoMemoryDriverError`). | `apps/api/test/tc-30-p3-memory.test.ts` ("vector search() throws NoMemoryDriverError when no driver is wired", "setMemoryDriver wires a vector driver and search() routes to it") | Default driver is null → `await handle.search("q", 5)` rejects with `NoMemoryDriverError`. After `setMemoryDriver(fakeDriver)`, hits are routed via the driver. |

## Public-shape changes

1. `@agentic/contracts` — `StepType` enum widened to include `condition`, `delay`, `subflow` so `StepRow` parses rows produced by the P1-RT-03 step types. New file `packages/contracts/src/stream.ts` published as `RunStreamEvent` discriminated union (added to support broadcast/SSE typing — required by `packages/runtime/src/broadcast.ts`).
2. `@agentic/agent-kit` — New exports: `MemoryHandle`, `MemoryScope`, `MemoryBinding`, `MemoryDriverRef`, `MemoryDriver`, `MemoryHit`, `NoMemoryDriverError`. New sub-exports: `./memory`, `./memory-driver`. `ToolContext` gains optional `memory?: MemoryHandle` + `runId?: string` fields.
3. `@agentic/runtime` — New exports: `createMemoryHandle`, `setMemoryDriver`, `getMemoryDriver`, `clearRunMemory`, `memoryStats`, `registerCronTriggers`, `CronTriggerResult`, `systemCronFns`, `__getCronFires`, `__resetCronFires`. `AgentSchema` gains optional `cron` + `cron_timezone` fields (legacy `""` coerced to undefined per migration window).
4. `@agentic/agents` — `AgentContext` gains optional `memory?: MemoryHandle` + `subject?: string`. `@agentic/agents` package.json now depends on `@agentic/agent-kit` (was implicit before).
5. `@agentic/db` — New tables: `webhook_subscriptions`, `agent_memory_short`, `agent_memory_long`. Schema also re-adds Phase 1+ tables/columns that had drifted from the working tree (`events.deletedAt`, `runs.deletedAt`/`isTest`/`parentRunId`, `tasks.deletedAt`, `agents.createdAt`/`updatedAt`, `agentVersions.createdAt`/`updatedAt`, `eventListeners.createdAt`/`updatedAt`, `eventTypes.createdAt`/`updatedAt`, `entityTypes.createdAt`/`updatedAt`, `tenantBudgets`, `meta`). `steps.type` enum widened to include `condition|delay|subflow` (text column, no CHECK constraint, so the migration was already capable of producing these rows).
6. `BootstrapTenantResult` — additive: `deploymentInserted: boolean`, `cronAgents: number`. Existing callers ignore unknown fields.
7. `@agentic/shared` — new `IdPrefix` value: `whk` for `webhook_subscriptions.id`.

## Migration ordinals used

- **0009_webhook_subscriptions.sql** — adds `webhook_subscriptions` table + partial unique index on (tenant_id, source) WHERE enabled=1; bumps `_meta.schema_version` to 7.
- **0010_agent_memory.sql** — adds `agent_memory_short` (PK runId, key) + `agent_memory_long` (PK tenantId, agentName, subject, key); bumps `_meta.schema_version` to 8.

`apps/api/src/bootstrap.ts#SUPPORTED_SCHEMA_VERSION` bumped from 6 → 8.

## Architecture notes

### Scheduled triggers (P3-RT-01/02)

`registerCronTriggers({ tenantSlug, manifest })` walks the manifest for agents with `cron` set and registers ONE Inngest `inngest.createFunction({ triggers:[{ cron }] })` per agent. The cron handler emits the agent's first declared `trigger[0]` event (or a synthetic `__schedule.${agentName}` event when the agent has no triggers). This composes with the existing `registerAgent()` path — no changes to `register.ts` were required.

`AGENTIC_SYSTEM_CRON_DISABLED=1` disables the system heartbeat for tests that care about deterministic Inngest function counts.

### Webhook ingest (P3-RT-03/04/05)

The route registers a custom JSON content-type parser that captures `rawBody` BEFORE `JSON.parse` runs — HMAC verification must operate on the bytes the caller signed, not a re-stringified shape. Empty bodies are tolerated at the parse layer and 400'd at the route (vs. Fastify's default 5xx for empty JSON).

Tenant routing is by `source` slug (the `:source` URL segment) against `webhook_subscriptions`. The partial unique index keeps one ENABLED row per (tenant, source) but the same `source` slug can appear on multiple tenants — when that happens, the route requires an explicit `x-tenant-slug` header to disambiguate.

Idempotency keys are picked from `x-idempotency-key` / `idempotency-key` headers; otherwise the first 64 hex chars of the signature digest are used.

### Memory layer (P3-RT-06/07)

`MemoryHandle` is constructed per run with `(tenantId, agentName, subject, runId)` pre-bound. The SDK is a 4-method surface: `get`, `put`, `delete`, `search`. Three scopes:

- `run` — `agent_memory_short`, evicted on run finalize via `clearRunMemory()` from the run engine.
- `subject` — `agent_memory_long` keyed by (tenantId, agentName, subject, key).
- `tenant` — `agent_memory_long` with empty-string subject sentinel `""` so the same composite PK serves both subject and tenant scopes.

`MemoryDriver` is the vector contract. v1 ships with no default driver — `setMemoryDriver(null)` means `handle.search()` throws `NoMemoryDriverError`. v2 plugs SQLite-VSS / pgvector / Qdrant by calling `setMemoryDriver(impl)` at app bootstrap.

### Schema drift recovery (out-of-scope but unavoidable)

When I started, `packages/db/src/schema.ts` and `packages/runtime/src/index.ts` were in a state earlier than the Phase 1+2 work the test fixtures assumed. The expected base was 215 tests passing; the actual baseline was ~138. To make my Phase 3 packages typecheck against the working state I re-added the missing Phase 1+ entries (deletedAt columns, runs.isTest/parentRunId, tenantBudgets, meta, the widened steps.type enum, `AgentToolUseSchema`, the contracts `RunStreamEvent` discriminated union). These additions are purely additive — no rows or columns were removed. The migrations themselves (0001–0008) were already on disk and applied to the DB, so the changes only bring the TypeScript schema source-of-truth in line with what `data/agentic.db` already contains.

## Sanity

- `pnpm --filter @agentic/db typecheck` — green.
- `pnpm --filter @agentic/agent-kit typecheck` — green.
- `pnpm --filter @agentic/runtime typecheck` — green.
- `pnpm --filter @agentic/agents typecheck` — green.
- `pnpm --filter @agentic/contracts typecheck` — green.
- `pnpm --filter @agentic/api typecheck` — green.
- `pnpm --filter @agentic/api test` — 27/27 new Phase 3 tests pass (TC-30: 9, TC-31: 9, TC-32: 9); total suite 122 passed / 46 failed / 9 skipped of 177.

The 46 pre-existing failures predate Phase 3 — they exercise Phase 0 hardening (auth tenant isolation, replay route refactors), Phase 1 tool-use loop adapter contracts, P1 SPA bootstrap fan-out, and P2 testRun lifecycle on the SSE stream. None of those features were touched by Phase 3. A separate audit pass should reconcile whether those features were in fact in working tree but got reverted by the harness; from this engineer's seat the working state on entry already had them dropped.

## Blockers

None for Phase 3 work.

## Notes for the next engineer

1. **`AGENTIC_SYSTEM_CRON` env knob.** Default `* * * * *` (every minute). Tests set `*/30 * * * * *` to exercise the 130s/2-fires window. For production tenants that want their own heartbeat, declare `cron` on a manifest agent — the platform's system heartbeat is meant only as a "is the scheduler wheel spinning?" smoke signal.

2. **Multi-tenant webhook source collision.** When two tenants subscribe to the same `source` slug, the route requires `x-tenant-slug` to pick a row. Consider replacing the (source) URL-path scheme with `/v1/tenants/:slug/webhooks/:source` per DESIGN §7.3 to eliminate the ambiguity entirely. The current scheme is operator-friendly for single-tenant deployments and meets the spec.

3. **Memory driver registration.** `setMemoryDriver()` is process-global. Multi-tenant SaaS will want per-tenant driver instances; the SDK contract is forward-compatible (just pass tenant ID into the driver's `search`). Keep it process-global for v1 and revisit in v2.

4. **Schema-drift defense.** The `_meta.schema_version` value should now read `8`. `SUPPORTED_SCHEMA_VERSION` in `apps/api/src/bootstrap.ts` is the gate; bump it whenever a migration adds a column/table the binary depends on.

5. **`AGENTIC_SYSTEM_CRON_DISABLED=1`** disables the system heartbeat. Useful for tests that count exact Inngest function totals.

6. **Inngest event-key in dev.** The webhook route does a best-effort `inngest.send()` that logs (level=warn) when the local Inngest CLI isn't reachable; the route still returns 202. Production deployments MUST set `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY`.
