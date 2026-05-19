# End-to-End Test Cases — LLM Gateway, BaseAgent, testAgent

**Framework:** vitest 1.x
**Location:** `apps/api/test/`
**Harness:** `apps/api/test/setup.ts` — boots Fastify on an ephemeral port with an isolated SQLite DB at `data/test/agentic-<random>.db`, runs migrations + seeds, registers code agents (incl. testAgent), and tears down on exit. Default env forces `LLM_DEFAULT_PROVIDER=mock` and `LLM_DEFAULT_MODEL=mock-model-v1` so no real keys are needed.

---

## TC-1 — Provider listing reflects env state

**File:** `apps/api/test/tc-1-llm-providers.test.ts`

**Setup:**
- `LLM_DEFAULT_PROVIDER=mock`
- `ANTHROPIC_API_KEY=test-key-anthropic`
- All other provider keys unset

**Action:**
```http
GET /v1/llm/providers
```

**Asserts:**
- Status 200
- Envelope `{ ok: true, data: ProviderInfo[] }`
- `data.length === 14`
- Entry for `mock`: `{ id: "mock", hasKey: true, ... }` (mock always has key)
- Entry for `anthropic`: `{ id: "anthropic", hasKey: true, ... }`
- Entry for `openai`: `{ id: "openai", hasKey: false, ... }`
- Entry for `openrouter` exists with `id: "openrouter"`
- Entry for `bedrock` has `hasKey: false` (stubbed)
- Each entry has a non-empty `models: string[]`

---

## TC-2 — Model catalog returns provider's models

**File:** `apps/api/test/tc-2-llm-models.test.ts`

**Action 1:**
```http
GET /v1/llm/models?provider=openrouter
```

**Asserts:**
- Status 200
- `data` is a non-empty `string[]`
- At least one entry contains a `/` (prefixed name pattern, e.g. `anthropic/claude-sonnet-4-5`)

**Action 2:**
```http
GET /v1/llm/models?provider=anthropic
```

**Asserts:**
- Status 200
- `data` includes `claude-sonnet-4-5` and `claude-haiku-4-5`

**Action 3:**
```http
GET /v1/llm/models?provider=bogus
```

**Asserts:**
- Status 400
- Envelope `{ ok: false, error: { code: "bad_request" | "model_not_found", message: <non-empty> } }`

**Action 4:**
```http
GET /v1/llm/models
```

**Asserts:**
- Status 200
- `data` is an object keyed by provider id with `string[]` values
- All 14 providers are keys

---

## TC-3 — testAgent happy path (mock provider)

**File:** `apps/api/test/tc-3-test-agent-happy.test.ts`

**Setup:**
- `LLM_DEFAULT_PROVIDER=mock`
- `LLM_DEFAULT_MODEL=mock-model-v1`
- testAgent registered at boot (via bootstrap)

**Action:**
```http
POST /v1/agents/testAgent/invoke
Content-Type: application/json

{}
```

**Asserts (response):**
- Status 200
- `data.runId` is a non-empty string starting with `run-`
- `data.status === "ok"`
- `data.output` is a non-empty string
- `data.output` contains the substring `Agentic Operator` (the mock provider's deterministic output embeds the prompt's key noun)
- `data.tokensIn > 0` and `data.tokensOut > 0`
- `data.provider === "mock"`
- `data.model === "mock-model-v1"`
- `data.durationMs >= 0`

**Asserts (DB):**
- `SELECT * FROM runs WHERE id = <runId>` returns 1 row with:
  - `status === "ok"`
  - `tokens_in > 0`, `tokens_out > 0`
  - `model === "mock-model-v1"`
  - `started_at` and `ended_at` are non-null timestamps
- The run's `agent_id` resolves to an `agents` row with:
  - `kebab_id === "testAgent"`
  - `kind === "code"`
- The run's `tenant_id` resolves to a `tenants` row with `slug === "__system"`
- `SELECT * FROM steps WHERE run_id = <runId>` returns ≥1 row with:
  - `type === "logic"`
  - `status === "ok"`
  - `provider === "mock"`
  - `model === "mock-model-v1"`
  - `tokens_in > 0`, `tokens_out > 0`
  - `input_ref` and `output_ref` are non-null paths

**Asserts (file log):**
- File exists at `<AGENTIC_LOGS_DIR>/__system/runs/<YYYY-MM-DD>/<runId>.log`
- File contains the literal substring `run.start`
- File contains the literal substring `run.ok` (or `run.end` with `status=ok`)

---

## TC-4 — testAgent error path

**File:** `apps/api/test/tc-4-test-agent-error.test.ts`

**Action 1 — invalid provider override:**
```http
POST /v1/agents/testAgent/invoke
Content-Type: application/json

{ "provider": "bogus" }
```

**Asserts:**
- Status 400
- Envelope `{ ok: false, error: { code: "bad_request", message: <matches /unknown provider|invalid/i> } }`
- No new `runs` row is created (the route layer rejects before calling `BaseAgent.run`)

**Action 2 — unknown agent:**
```http
POST /v1/agents/nonexistentAgent/invoke
```

**Asserts:**
- Status 404
- Envelope `{ ok: false, error: { code: "not_found", message: <matches /agent.*not found/i> } }`

**Action 3 — provider that has no key (e.g. bedrock):**
```http
POST /v1/agents/testAgent/invoke
Content-Type: application/json

{ "provider": "bedrock" }
```

**Asserts:**
- Status 400 or 503 (acceptable: gateway returns `not_configured`)
- Envelope `{ ok: false, error: { code: "not_configured" | "auth", ... } }`
- The `runs` row, if any, has `status === "failed"` and `error_message` is non-empty

---

## TC-5 — Monitoring & deployment audit reuse

**File:** `apps/api/test/tc-5-monitoring-reuse.test.ts`

**Pre-condition:** TC-3 has executed and persisted one successful testAgent run.

**Action 1:**
```http
GET /v1/agents?kind=code
```

**Asserts:**
- Status 200
- `data` is an array containing an entry with `kebabId === "testAgent"`
- That entry has `runCount >= 1`

**Action 2:**
```http
GET /v1/agents/testAgent
```

**Asserts:**
- Status 200
- `data.kebabId === "testAgent"`
- `data.recentRuns` is an array with ≥1 entry

**Action 3:**
```http
GET /v1/runs/<runId from TC-3>
```

**Asserts:**
- Status 200
- `data.id === <runId>`
- `data.status === "ok"`
- `data.steps` is an array with ≥1 entry, the first having `provider === "mock"` and `model === "mock-model-v1"`

**Action 4 — SSE log tail (single-shot read):**
```http
GET /v1/runs/<runId>/logs?follow=0
```

**Asserts:**
- Status 200
- Response body (collected event stream) contains the substring `run.start`
- Response body contains either `run.ok` or `run.end`

**Action 5 — Deployment audit row:**
```sql
SELECT *
FROM deployments
WHERE target = 'code_agent'
  AND tenant_id IN (SELECT id FROM tenants WHERE slug = '__system')
ORDER BY deployed_at DESC
LIMIT 1
```

**Asserts:**
- Result has ≥1 row
- `status === "live"`
- `version_id` resolves to an `agent_versions` row whose `agent_id` resolves to an `agents` row with `kebab_id === "testAgent"`

---

## Test harness notes

`apps/api/test/setup.ts` exports:

```typescript
export interface TestEnv {
  app: FastifyInstance;
  baseUrl: string;
  db: BetterSqlite3Database;
  cleanup: () => Promise<void>;
}

export async function buildTestEnv(overrideEnv?: Record<string, string>): Promise<TestEnv>;
```

Each test calls `buildTestEnv()` in `beforeAll`, captures the returned env, calls `await env.cleanup()` in `afterAll`. The harness:

1. Creates a unique `data/test/agentic-<uuid>.db`.
2. Runs migrations.
3. Seeds the 3 standard tenants + `__system` tenant.
4. Boots a single-port Fastify instance.
5. Returns the app + URL + DB handle.

Tests use `fetch(env.baseUrl + path)` (Node 18+ native) — no supertest dependency needed.

---

## Test engineer verification loop

After all 5 tests are written:

1. Run `pnpm --filter @agentic/api test`.
2. Capture PASS/FAIL per test + any failure logs.
3. If any FAIL: capture failure message, stack trace, server logs, agent log files at `data/test-logs/__system/runs/<date>/`.
4. Triage: principal-engineer applies minimal fix.
5. Re-run.
6. Loop until all 5 PASS or a hard cap of 5 iterations.

Final integrity check (after all-pass):
- `data/test-logs/__system/runs/<today>/` contains the testAgent run log file.
- `SELECT count(*) FROM deployments WHERE target='code_agent'` ≥ 1.
- `GET /v1/runs?agent=testAgent` (if filter is supported) or `GET /v1/runs/<runId>` returns the expected payload.
