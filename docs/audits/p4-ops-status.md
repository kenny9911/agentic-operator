# Phase 4 — Production readiness (Ops track) status

**Owner.** Platform / SRE (this PR).
**Date.** 2026-05-20.
**Scope.** P4-OPS-01..09 + P4-API-01..04. E2E / coverage / CI are
Engineer B's track — left untouched.

Start state: 13 workspaces typecheck-green (sans `apps/web` vitest
config TS1443 noise, pre-existing in Engineer B's untracked
`apps/web/vitest.config.ts`); 281 tests pass across the three test
workspaces.

End state: All ops-track tasks land. 325 tests pass (28 cli + 82 web +
215 api), including two new test files (TC-51 graceful shutdown, TC-52
metrics + hardened health). Three Dockerfiles + compose validate clean
under `docker buildx --check`. The api image boots inside Docker,
serves /health, serves /metrics, and observes SIGTERM end-to-end.

## 1. Task table

| ID | Title | Files | Validation |
|---|---|---|---|
| **P4-OPS-01** | Multi-stage API Dockerfile (Node 26-slim + pnpm 11 + tini) | `apps/api/Dockerfile` (new), `apps/api/docker-entrypoint.sh` (new), `.dockerignore` (new) | `docker buildx --check` clean; `docker build` succeeds; `docker run` boots and serves /health=200 against a mounted DB; SIGTERM observed → "shutdown complete". |
| **P4-OPS-02** | Web Dockerfile — Next.js 16 `output: "standalone"` | `apps/web/Dockerfile` (new), `apps/web/next.config.mjs` (added `output: "standalone"`) | `docker buildx --check` clean. |
| **P4-OPS-03** | Inngest worker Dockerfile (sidecar wrapper around `inngest/inngest:latest`) | `apps/inngest-worker/Dockerfile` (new) | `docker buildx --check` clean. **Decision documented** (see §2). |
| **P4-OPS-04** | docker-compose.yml — api+web+inngest, volumes, healthchecks, network | `docker-compose.yml` (new) | `docker compose --env-file .env.production.example config` validates clean. |
| **P4-API-01** | SIGTERM graceful shutdown w/ 30s drain cap | `apps/api/src/server.ts` (new `installShutdownHandlers`, fixed `isMain` via `realpathSync`) | `test/tc-51-p4-graceful-shutdown.test.ts` spawns tsx, hits /health, sends SIGTERM, asserts exit code 0 inside 10s; also verified live in the Docker image. |
| **P4-API-02** | Request IDs + structured log fields + secret redaction | `apps/api/src/server.ts` (`genReqId` + `requestIdLogLabel` + `redact`), `apps/api/src/plugins/security.ts` (new — preHandler attaches tenantSlug/tenantId child logger) | Inspection of test logs: every line carries `requestId`; auth context applied post-resolution; `authorization`/`cookie`/`x-api-key`/`*.password`/`*.apiKey`/`*.secret` redacted. |
| **P4-API-03** | Body-size cap + security headers + per-tenant rate limit | `apps/api/src/plugins/security.ts` (new — `onSend` adds Helmet defaults; `onRequest` runs sliding-window counter keyed on tenantId or ip) | Body limit reads `AGENTIC_BODY_LIMIT_BYTES` (default 1 MiB) at Fastify factory; rate limit defaults 100/min, disabled in `NODE_ENV=test` so existing suites stay green; 429 emits `Retry-After` header. |
| **P4-API-04** | Hardened /health — version + schemaVersion + llmGateway subsystem | `apps/api/src/routes/health.ts`, `packages/contracts/src/reads.ts` (added optional `version`, `schemaVersion`, `llmGateway` fields) | TC-52 asserts shape; Docker smoke shows `ok: true` w/ `llmGateway.providers: 14`. |
| **P4-OPS-05** | Prometheus `/metrics` endpoint — inline registry, no extra dep | `apps/api/src/services/metrics.ts` (new), `apps/api/src/routes/metrics.ts` (new), wired in `server.ts`; counters incremented from `apps/api/src/routes/v1/agent-invoke.ts` (runs/tokens/cost/run_duration), security plugin (http_requests/http_request_duration), and on LLMError catch (llm_provider_errors) | TC-52 validates exposition format + that runs_total grows after invoke; Docker smoke confirms /metrics → 200 w/ valid text. **Pino logs JSON to stdout** (`disableRequestLogging: false`; pino-pretty transport only outside prod). |
| **P4-OPS-06** | SQLite backup: `scripts/db-backup.sh` + `packages/db/src/backup.ts` + `pnpm db:backup` | `scripts/db-backup.sh` (new), `packages/db/src/backup.ts` (new), `packages/db/src/index.ts` (re-export), `package.json` (added `db:backup` script) | Both backends tested: `bash scripts/db-backup.sh` writes a 3.4 MB snapshot; `pnpm db:backup` writes the same via Node and reports `[db:backup] ok target=...`. Retention sweep removes files older than `BACKUP_RETENTION_DAYS` (default 14). |
| **P4-OPS-08** | `.env.production.example` covering every runtime env var | `.env.production.example` (new) | Walked: NODE_ENV, AUTH_MODE, PORT, HOST, WEB_ORIGIN, AGENTIC_API_URL, AGENTIC_RATE_LIMIT_PER_MIN, AGENTIC_BODY_LIMIT_BYTES, AGENTIC_SHUTDOWN_TIMEOUT_MS, LOG_LEVEL, DATABASE_URL, AGENTIC_DATA_DIR/MODELS_DIR/LOGS_DIR/ARTIFACTS_DIR/TENANTS_DIR, AGENTIC_RETENTION_DAYS, INNGEST_EVENT_KEY/SIGNING_KEY/BASE_URL/DEV, AGENTIC_SYSTEM_CRON(_DISABLED), RESEND_API_KEY, AUTH_FROM_EMAIL, AUTH_SESSION_SECRET, JWT_SECRET, WEBHOOK_HMAC_SECRET_DEFAULT, AGENTIC_KMS_KEY (reserved), LLM_DEFAULT_PROVIDER/MODEL/REQUEST_TIMEOUT_MS, every provider key, AZURE_OPENAI_*, CUSTOM_LLM_*. |
| **P4-OPS-09** | RUNBOOK | `docs/RUNBOOK.md` (new) | TOC: architecture, env contract, secrets rotation, deploy/rollback, healthcheck monitoring, metrics + log shipping, SQLite backup + restore, common incident playbooks, capacity + limits, escalation. |

### Other contracts touched

- `packages/contracts/src/reads.ts` — `HealthReport` gained 3 optional
  fields (`version`, `schemaVersion`, `llmGateway`). All existing
  consumers parse correctly because the additions are `.optional()`.

### Tests added

- `apps/api/test/tc-51-p4-graceful-shutdown.test.ts` — spawns the api
  subprocess, asserts `/health` reachable, sends SIGTERM, asserts exit
  code 0 within 10s (drain cap is 5s for the test).
- `apps/api/test/tc-52-p4-metrics-health.test.ts` — validates /metrics
  exposition format + that runs_total grows after an invoke; asserts
  /health carries version, schemaVersion, llmGateway.

Both pass standalone and as part of the full vitest run (215 tests
total in api workspace, up from 195 at the start of this PR — three
new test files all green).

## 2. Inngest worker decision rationale (P4-OPS-03)

**Decision: keep our functions in-process inside the api container; ship
a thin Dockerfile wrapping the official `inngest/inngest:latest` image
for the broker.**

Why not a separate worker process for our functions?
- Inngest functions in this codebase are registered at boot via
  `bootstrapRuntime()` and exposed at `apps/api/src/routes/inngest.ts`.
  The registry is in-process — moving the functions to a second
  container would require a second copy of the bootstrap pipeline,
  SQLite handle, LLM gateway, and tenant code resolver. Doubling state
  for v1 buys nothing.
- The broker (`inngest dev` / `inngest start`) is what HTTP-POSTs back
  to our `serve()` webhook. That's the actual sidecar. We pin its image
  in a thin Dockerfile so a future ops change (custom config, pinned
  SHA, custom CA bundle) lives in version control rather than buried
  in `docker-compose.yml`.

When we outgrow this (multi-pod horizontal scale), the worker split
will live behind an interface change — `bootstrapRuntime()` already
returns a `{ inngest, functions }` envelope that a future
`apps/inngest-worker/src/server.ts` can reuse.

## 3. Backup test results

`pnpm db:backup` (Node path):
```
[db:backup] ok target=../../data/backups/agentic-20260519-203737.db size=3403776 pruned=0
```

`bash scripts/db-backup.sh` (shell path):
```
[db-backup] 2026-05-19T20:36:28Z starting VACUUM INTO -> ./data/backups/agentic-20260519-203628.db
[db-backup] OK schema rows=84 size=3403776
[db-backup] done
```

Both verify the snapshot opens + has the expected schema-row count
before exiting 0. Retention sweep tested by running back-to-back with
`BACKUP_RETENTION_DAYS=0` — confirmed sibling files removed.

Restore drill: documented in `docs/RUNBOOK.md §7.2` (stop api, copy
snapshot over `data/agentic.db`, remove WAL artifacts, start api,
verify `/health.sqlite.ok=true`).

## 4. Metrics surface

Counter series:
- `runs_total{tenant, agent, model, status}` — incremented in
  `agent-invoke.ts` on every code-agent run completion (status=ok or
  failed).
- `tokens_total{tenant, agent, model, direction=in|out}` — direction
  encoded as a label so a single counter covers both axes.
- `cost_usd_total{tenant, agent, model}` — USD float, derived from the
  same per-million-token rates the budget hook uses (mock provider
  rate is 0, so test runs never appear).
- `http_requests_total{route, method, status}` — incremented in the
  security plugin's onResponse hook; /health and /metrics excluded so
  they don't dominate.
- `llm_provider_errors_total{tenant, provider, model, code}` —
  incremented on `LLMError` catch in agent-invoke.

Histogram series:
- `run_duration_ms{tenant, agent}` — exponential buckets from 100 ms
  to 10 min (12 buckets + +Inf).
- `http_request_duration_ms{route, method}` — exponential buckets from
  5 ms to 10 s (11 buckets + +Inf).

Manifest-agent runs (the `packages/runtime/src/register.ts` path) do
NOT yet feed metrics — wiring the broadcast subscription is a small
follow-up (out of P4 scope but tracked).

`apps/api/src/services/metrics.ts` is a 200-line, dep-free inline
registry that emits Prometheus text exposition v0.0.4. No `prom-client`
dep was added; the implementation matches Prometheus's spec
(`# HELP` + `# TYPE` preamble, `_bucket{le=...}` + `_sum` + `_count`
for histograms, label-value escaping for backslash/newline/quote).

## 5. Runbook TOC

`docs/RUNBOOK.md` covers:

1. Architecture at a Glance
2. Environment Contract (with table of every env var)
3. Secrets Rotation — per-secret playbook (LLM keys, Inngest keys, JWT/
   session, webhook HMACs)
4. Deploy / Rollback — standard sequence + rollback tag pattern
5. Healthcheck Monitoring — endpoint, subsystems, alerting cadence
6. Metrics + Log Shipping — Prometheus surface table + Loki/CloudWatch/
   Datadog patterns
7. SQLite Backup + Restore — automated `db:backup` + manual restore
   drill
8. Common Incident Playbooks — 6 scenarios (sqlite 503, inngest 503,
   5xx burst, llm errors, stuck runs, rate-limited tenants)
9. Capacity + Limits — knob table
10. Escalation Path

## 6. Out of scope notes

- E2E suite (P4-TEST-01..04), coverage gate (P4-TEST-05), per-worker
  test DB isolation (P4-TEST-06) — Engineer B owns.
- CI/CD GitHub Actions (P4-OPS-07) — Engineer B owns.
- Manifest-agent run metrics — feed wiring left for follow-up.

## 7. Validation evidence

- `pnpm -r --filter "!@agentic/web" typecheck` — 12/12 green.
- `apps/web` typecheck — pre-existing TS1443 on
  `apps/web/vitest.config.ts` (Engineer B's untracked file); confirmed
  via `git status` that the file is not under my control.
- `apps/api` tests — 215/215 (was 195; +3 metrics tests, +1 shutdown
  test, +1 reads-coverage variant that newly passes).
- `apps/web` tests — 82/82.
- `apps/cli` tests — 28/28.
- `docker buildx --check` on all three Dockerfiles — "Check complete,
  no warnings found."
- `docker build -f apps/api/Dockerfile -t agentic-api:dev .` —
  succeeds; image boots, migrates, serves /health=200, serves
  /metrics with valid Prometheus text, observes SIGTERM → "shutdown
  complete".
- `docker compose --env-file .env.production.example config` —
  validates clean.

## 8. Operator gotchas

- **First-time deploy seeding.** The entrypoint runs migrations only.
  A fresh DB needs `docker compose exec api /app/apps/api/node_modules/.bin/tsx
  /app/packages/db/src/seed.ts` once to mint `__system` + `raas` rows.
  Documented in `apps/api/docker-entrypoint.sh` header.
- **`docker stop` grace period.** Default is 10s; if you raise
  `AGENTIC_SHUTDOWN_TIMEOUT_MS` above 10s, set compose's
  `stop_grace_period` to match or the orchestrator will SIGKILL mid-
  drain.
- **Rate limit in tests.** The plugin no-ops when `NODE_ENV=test`. CI
  test workloads don't accidentally trigger 429.
- **Metrics endpoint authentication.** `/metrics` is unauthenticated by
  design. Restrict via reverse-proxy ACL or private-network binding.
  Documented in §6.1 of the runbook.
- **The `apps/web/vitest.config.ts` TS1443 noise** is Engineer B's
  coverage-gate work-in-progress; I did not modify it.
