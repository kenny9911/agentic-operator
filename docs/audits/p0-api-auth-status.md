# Phase 0 API/Auth/DB — implementation status

**Owner.** Senior API Engineer (this PR).
**Date.** 2026-05-19.
**Scope.** IMPLEMENTATION.md §4.2 (Boot + migrations) + §4.3 (Auth + tenant isolation), plus the P0 hardening adds noted in the brief.
**Out of scope.** `packages/runtime/*`, `packages/agents/*`, `packages/contracts/src/agents.ts`, `apps/web/*` — owned by other engineers.

---

## 1. Per-task summary

| ID | Status | Files changed | Test added | Acceptance proof |
|---|---|---|---|---|
| **P0-AUTH-01** | DONE | `apps/api/src/plugins/auth.ts` | `tc-6-p0-auth-isolation.test.ts` (4 tests under `P0-AUTH-01:`) | `NODE_ENV=test` with `AUTH_MODE` unset → 401. `AUTH_MODE=dev` → 200. `authenticate()` returns null without explicit opt-in. |
| **P0-AUTH-02** | DONE | `apps/api/src/routes/v1/runs.ts`, `apps/api/src/routes/v1/runs-logs.ts`, `apps/api/src/plugins/auth.ts` (added `isPlatformAdmin`) | `tc-6` (4 tests under `P0-AUTH-02:`) | raas tenant requesting a `__system` run id → 404, with or without `?include_system=1`. `__system` itself still sees its own runs. /logs follows the same rule. |
| **P0-AUTH-03** | DONE | `apps/api/src/routes/v1/agents.ts` | `tc-6` (1 test under `P0-AUTH-03:`) | `GET /v1/agents?kind=all&tenant=raas` returns the same list as `?kind=all` (param is a no-op). |
| **P0-AUTH-04** | DONE | `apps/api/src/routes/v1/agent-invoke.ts`, new `apps/api/src/config/system-agents.ts` | `tc-6` (2 tests under `P0-AUTH-04:`) | `testAgent` (in the allowlist) runs under `__system` regardless of caller. Any non-allowlisted code agent invoked by a tenant runs under that tenant. |
| **P0-AUTH-05** | PARTIAL — env template only | `.env.example` | n/a (manual rotation step) | See §2 below for the rotation instructions the user must execute by hand. |
| **P0-API-01** | DONE | `apps/api/src/routes/v1/events.ts` | `tc-6` (3 tests under `P0-API-01:`) | The route now calls `makeId("evt")` for the replay id. Static-source check + 1000-iteration uniqueness sweep + smoke integration test. |
| **P0-RT-12** | DONE | `apps/api/src/plugins/auth.ts` | `tc-6` (1 test under `P0-RT-12:`) | `verifyHmac` deleted; `grep -r verifyHmac apps packages` returns nothing. Test asserts the export is undefined. |
| **P0-MIG-01** | DONE | `apps/api/src/bootstrap.ts`, `packages/db/src/migrate.ts`, `packages/db/src/index.ts` | `tc-13-p0-db-migrations.test.ts` | Bootstrap step 0 calls `runMigrations(folder)` from `@agentic/db` before `getLLMGateway`. Confirmed by hitting `/v1/agents?kind=all` after fresh boot (passes). `pnpm db:migrate` separately ran clean on the dev DB. |
| **P0-DB-01** | DONE | `packages/db/src/schema.ts`, new `packages/db/drizzle/0003_temporal_columns.sql`, new `packages/db/drizzle/meta/0003_snapshot.json`, `packages/db/drizzle/meta/_journal.json` (Drizzle-generated) | `tc-13` (7 tests) | All 5 tables (`agents`, `agent_versions`, `event_listeners`, `event_types`, `entity_types`) carry `created_at` + `updated_at` columns. `PRAGMA table_info` confirms columns exist; backfilled rows have non-zero timestamps. |

**Migration numbering note.** Spec asked for `0002_temporal_columns.sql`, but `0002_bright_apocalypse.sql` already exists in the repo (it's the migration that added `kind`/`enabled` to `agents` + `provider`/`model`/`tokens_*` to `steps`). I used the next free slot, `0003_temporal_columns.sql`, and Drizzle's auto-generator wired the journal + snapshot correctly. The semantic intent of the spec is preserved.

---

## 2. P0-AUTH-05 — manual key rotation required

I CANNOT rotate live keys from this sandbox. **You (the user) must do the following manually**:

### Keys found in workstation `.env` (live, treat as compromised)

```text
File: /Users/kenny/CSI-AICOE/agentic-operator/.env
Lines (key values REDACTED — see your local .env for the originals; identifying
suffixes shown below so you can match the right key in each provider console):
  1   OPENROUTER_API_KEY=sk-or-v1-...REDACTED... (ends in ...c9191)
  2   OPENAI_API_KEY=sk-proj-...REDACTED... (ends in ...FVwA)
  3   GOOGLE_API_KEY=AIza...REDACTED... (ends in ...Tm_ww)
  4   KIMI_API_KEY=sk-...REDACTED... (ends in ...wfCs)   # CSI
```

### Action items for you

1. **OpenRouter** — https://openrouter.ai/settings/keys
   - Revoke the `sk-or-v1-...` key whose suffix is `...c9191` immediately.
   - Generate a new key, paste into `.env` only.

2. **OpenAI** — https://platform.openai.com/api-keys
   - Revoke the `sk-proj-...` key listed above (the suffix is `...FVwA`).
   - Generate a new project-scoped key, paste into `.env` only.

3. **Google AI** — https://aistudio.google.com/app/apikey
   - Revoke the `AIza...` key whose suffix is `...Tm_ww`.
   - Generate a new key, paste into `.env` only.

4. **Kimi/Moonshot** — https://platform.moonshot.cn/console/api-keys
   - Revoke the `sk-...` key whose suffix is `...wfCs` (labelled "CSI"; it's listed under both `KIMI_API_KEY` and conceptually `MOONSHOT_API_KEY`).
   - Generate a new key, paste into `.env` only.

5. **`.env` itself**: verify `.env` is in `.gitignore` and was never committed:

   ```bash
   git log --all --source --remotes --pretty=oneline -- .env
   ```

   If anything turns up, the key already leaked into git history — assume it's public, treat every key in it as compromised, and force-rotate as above. Strongly consider rewriting history with `git filter-repo` if any prior commit ever contained `.env`.

6. After rotation, run `apps/api`'s test `tc-1-llm-providers.test.ts` to confirm the new keys load. (The test forces `ANTHROPIC_API_KEY=test-key-anthropic` for its own assertion, but it boots the gateway end-to-end so any malformed real key will surface as a provider misconfiguration.)

### What I changed in `.env.example`

- Prepended a prominent "NEVER COMMIT REAL KEYS" header with the rotation playbook.
- Clarified the `AUTH_MODE=dev` opt-in semantics inline (no more "any non-prod env unlocks dev tenant").
- The actual `.env` file is untouched — your real local credentials are intact (but compromised; rotate them).

---

## 3. Migration run state

`pnpm db:migrate` on the dev DB (`data/agentic.db`): **PASS** (after the SQLite ALTER TABLE constraint).

### Notable detail

SQLite rejects `ALTER TABLE … ADD COLUMN … DEFAULT (unixepoch() * 1000) NOT NULL` because the default expression is non-constant. My fix: add columns with `DEFAULT 0 NOT NULL`, then a follow-up `UPDATE … SET … = unixepoch() * 1000 WHERE created_at = 0` per table.

That means:

- **App-layer inserts via Drizzle** use the schema-side default `now = sql\`(unixepoch() * 1000)\`` and get the correct millisecond timestamp.
- **Raw SQL inserts that omit `created_at`** would get `0`. None of the app code does this today, but if any tooling (seed scripts, manual `sqlite3` work) inserts into one of the 5 affected tables without specifying the temporal columns, it'll get a zero timestamp. Flag for the next engineer.
- **Existing rows** were backfilled to the migration moment via the trailing `UPDATE`. Confirmed by `SELECT created_at FROM agents LIMIT 3` returning non-zero values.

---

## 4. Typecheck state

| Workspace | Command | Result |
|---|---|---|
| `@agentic/db` | `cd packages/db && pnpm typecheck` | PASS |
| `@agentic/api` | `cd apps/api && pnpm typecheck` | PASS |

Full test run from `cd apps/api && pnpm test`: **83/83 tests across 13 files**, including:

- 5 pre-existing `tc-1` through `tc-5` LLM-gateway tests
- 6 manifest-schema tests (`tc-7`) — owned by runtime engineer; pass when reordered correctly
- 7 branch-emit tests (`tc-8`) — runtime engineer's
- 11 condition-eval tests (`tc-9`) — runtime engineer's
- 8 step-engine tests (`tc-10`) — runtime engineer's
- 4 bootstrap-idempotency tests (`tc-11`) — runtime engineer's
- 7 register-helper tests (`tc-12`) — runtime engineer's
- **15 P0 auth/API/DB tests (`tc-6`)** — mine
- **7 P0 migration + temporal-column tests (`tc-13`)** — mine

---

## 5. Files I changed (canonical list)

```
apps/api/src/bootstrap.ts                         (added migrations step 0)
apps/api/src/plugins/auth.ts                      (P0-AUTH-01 + isPlatformAdmin + P0-RT-12)
apps/api/src/routes/v1/agents.ts                  (P0-AUTH-03)
apps/api/src/routes/v1/agent-invoke.ts            (P0-AUTH-04)
apps/api/src/routes/v1/events.ts                  (P0-API-01)
apps/api/src/routes/v1/runs.ts                    (P0-AUTH-02)
apps/api/src/routes/v1/runs-logs.ts               (P0-AUTH-02)
apps/api/src/config/system-agents.ts              (new — P0-AUTH-04 allowlist)
apps/api/test/setup.ts                            (added Inngest test env defaults)
apps/api/test/tc-6-p0-auth-isolation.test.ts      (new — 15 regression tests)
apps/api/test/tc-13-p0-db-migrations.test.ts      (new — 7 regression tests)
packages/db/src/schema.ts                         (P0-DB-01 columns on 5 tables)
packages/db/src/migrate.ts                        (exposed runMigrations() programmatically)
packages/db/src/index.ts                          (re-exported runMigrations)
packages/db/drizzle/0003_temporal_columns.sql     (new migration SQL)
packages/db/drizzle/meta/0003_snapshot.json       (Drizzle-generated)
packages/db/drizzle/meta/_journal.json            (Drizzle-generated update)
.env.example                                      (key rotation warning header)
```

---

## 6. Notes for the next engineer

### 6.1 P0-AUTH-04's system-agent allowlist

`apps/api/src/config/system-agents.ts` is a hand-curated set of agent names that run under `__system`. For v1 the only entry is `testAgent`. **When you add a new system-scoped code agent under `packages/agents/src/system/*`, append its `.name` here too**, or it will write its runs under the calling tenant.

When BaseAgent eventually grows a `scope?: "system" | "tenant"` field (Phase 1+), this allowlist should become the fallback for legacy agents that don't yet declare `scope`. The wiring in `agent-invoke.ts` should then read `agent.scope` first and fall through to `isSystemScopedAgent(name)`.

### 6.2 isPlatformAdmin always returns false in v1

`apps/api/src/plugins/auth.ts:isPlatformAdmin` is a stub that always returns false. The `?include_system=1` escape hatch on `/v1/runs/:id` therefore always 404s — that's intentional. When you add a platform-admin marker to `AuthedContext` (perhaps `platformAdmin?: boolean` populated from a new `platform_memberships` table or a per-token scope), update this helper to read it.

### 6.3 Migration numbering

The spec asked for `0002_temporal_columns.sql` but that slot is taken. I used `0003_temporal_columns.sql`. If anyone is tracking spec-to-file mapping, this is the only deviation.

### 6.4 Test env defaults for Inngest

`apps/api/test/setup.ts` now sets `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `INNGEST_DEV=1`. Tests still don't run an Inngest worker; the keys exist so any route that calls `inngest.send()` can construct the request envelope without crashing at the "missing event key" assertion. Sends that hit the network will still fail in CI — that's why my P0-API-01 integration test accepts both `200` and `500` and asserts the actual fix via static-source + 1000-iteration uniqueness.

### 6.5 P0-AUTH-05 has not actually been rotated

I CANNOT rotate live API keys from this sandbox. The keys listed in §2 are still active at the providers. Treat that as your blocking action item before any production handoff.
