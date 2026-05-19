# Refined Prompt — LLM Gateway + BaseAgent + testAgent + Monitoring

**Date:** 2026-05-19
**Refined by:** AI architect / technical PM persona
**Source:** `docs/prompts/01-original-prompt.md`

---

## Goal

Move the Agentic Operator from "UI-complete, LLM-mocked" to "operational" by introducing a real LLM integration layer, a code-level agent abstraction, and the first concrete agent — all while preserving the existing frontend ↔ backend boundary, the existing event-driven manifest runtime, and the existing run/step/log monitoring surface.

## Scope

### 1. LLM Gateway package (`packages/llm-gateway/`)

A new shared package that fronts **all 13 LLM providers** advertised by the frontend Settings UI, plus a deterministic **mock** provider — 14 total:

| Native SDK | OpenAI-compatible (shared adapter) | Stubbed | Mock |
|---|---|---|---|
| Anthropic, Google Gemini | OpenAI, **OpenRouter** (new), Groq, Together AI, Mistral, DeepSeek, Qwen, Azure OpenAI, Custom | AWS Bedrock, Google Vertex | Mock |

**Uniform interface:**
```ts
gateway.chat({ messages, model?, provider?, providers?[], temperature?, maxTokens?, timeoutMs?, signal?, jsonMode? })
  → { text, provider, model, tokensIn, tokensOut, finishReason, latencyMs }
```

**Error model:** single `LLMError` class with discriminated `code`: `auth | rate_limit | timeout | model_not_found | bad_request | provider_error | network | not_configured`.

**Defaults:** Resolved from env at gateway construction time — `LLM_DEFAULT_PROVIDER`, `LLM_DEFAULT_MODEL`. If unset → falls back to `mock`. (Reads legacy `LLM_PROVIDER`/`LLM_MODEL` for backward compat with a deprecation warning.)

**Failover:** Caller-controlled via `providers: ProviderId[]` array. The gateway tries them in order, classifying errors — only falls through on transient codes (`rate_limit | timeout | network | provider_error`). No automatic, gateway-decided fallback chains.

### 2. `BaseAgent` package (`packages/agents/`)

Abstract class encapsulating the prompt → call → parse loop. Pure async, no Inngest dependency. Subclasses implement `buildMessages()` and (optionally) `parseOutput()`; the run engine handles run/step row management, file logs, gateway call, retry, and parse output.

Concrete `TestAgent extends BaseAgent<void, string>` ships in this package.

### 3. Agent registry + bootstrap

A singleton `AgentRegistry` (Map<name, BaseAgent>) is populated at API startup. A new `bootstrapCodeAgents()` runs after the existing manifest bootstrap and, for each registered code agent, upserts the `agents` row (with `kind='code'`), the `agent_versions` row (manifest = `{type:'code', sha: <git-sha>}`), and a `deployments` row (`target='code_agent'`, `status='live'`) for audit.

### 4. Storage — reuse `runs` + `steps`

No new `agent_logs` table. Code-defined agents are first-class `agents` rows with `kind='code'`. Each invocation writes:
- 1 row to `runs` (existing schema — gets `agent_id`, `tenant_id=__system`, `status`, `tokens_in/out`, `model`, `started_at`/`ended_at`, `duration_ms`, `log_path`)
- 1+ rows to `steps` (extended schema — new columns `provider`, `model`, `tokens_in`, `tokens_out`, plus existing `input_ref`/`output_ref` pointing to NDJSON sidecars)
- Continued file-based NDJSON log writes via the existing `writeRunLog()` for SSE tailing

A synthetic `__system` tenant (id=`ten-system`, slug=`__system`) hosts non-tenant agents like `testAgent`.

### 5. API endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/llm/providers` | Returns `ProviderInfo[]` — which providers are registered + whether they have a key set |
| `GET` | `/v1/llm/models?provider=:id` | Returns models for a provider (from `packages/contracts/src/providers.ts`) |
| `POST` | `/v1/agents/:name/invoke` | Invoke a code agent — sync by default; `?async=1` fires Inngest `agent.invoke` |
| `GET` | `/v1/agents?kind=code\|manifest\|all` | Existing `/v1/agents` extended with a `kind` filter |

Monitoring (run history, run detail, SSE log tail) **reuses existing endpoints** unchanged. No new monitoring surface.

### 6. Frontend — single edit + catalog move

- Move `PROVIDER_PRESETS` and `PROVIDER_MODEL_CATALOG` from `apps/web/app/_portal_legacy/settings/_components/data.ts` to `packages/contracts/src/providers.ts` so the frontend and backend share one source of truth.
- Add `openrouter` to the preset array.
- Add a small default model catalog entry for OpenRouter with prefixed model names.

### 7. Cleanup

- Remove the mock `llmCall()` from `packages/tools/src/index.ts`. Keep `httpFetch` + `channelPublish`.
- Replace `llmCall` calls in `packages/runtime/src/step-engine.ts` with `getLLMGateway().chat(...)`. Transparent upgrade for existing manifest runtime — prompts now hit real LLM when configured.

### 8. Testing — vitest + 5 end-to-end tests

Install `vitest` at workspace root. Tests boot a Fastify instance on an ephemeral port with an isolated SQLite DB; default env sets `LLM_DEFAULT_PROVIDER=mock` so no real keys are required:

1. **TC-1** — Provider listing reflects env state
2. **TC-2** — Model catalog returns the right models for a provider
3. **TC-3** — testAgent happy path (mock provider; assert response, DB rows, file log)
4. **TC-4** — testAgent error path (invalid provider, unknown agent)
5. **TC-5** — Monitoring & deployment audit reuse

Full specs in [`docs/test-cases/agent-system-tests.md`](../test-cases/agent-system-tests.md).

### 9. Documentation

Four markdown artifacts under `docs/`:

- `docs/prompts/01-original-prompt.md` — original verbatim
- `docs/prompts/02-refined-prompt.md` — this file
- `docs/design/llm-gateway-and-baseagent.md` — technical design
- `docs/test-cases/agent-system-tests.md` — test specs

### 10. Verification loop

After implementation, drive a test-engineer / principal-engineer bug-fix loop:
1. Run all 5 vitest cases.
2. If any fail, root-cause and fix.
3. Re-run.
4. Loop until all 5 pass or a hard cap (5 iterations) is reached.
5. Final integrity check on persisted run + log + deployment rows.

## Out of Scope (deferred to v2)

- Streaming responses
- Tool/function calling loop (multi-step agents) — abstraction is forward-compatible (`maxSteps` hook), implementation deferred
- Multimodal inputs
- Per-tenant BYOK API key overrides
- Rate limiting, circuit breaker, cost ceiling enforcement
- Prompt caching headers / semantic response cache
- OTEL spans (flag designed; collector deferred)
- Cost-per-call computation + UI usage dashboard wiring
- Embeddings

## Pre-Implementation Security Note

The repo's `.env` currently contains 4 populated live API keys (OPENROUTER, OPENAI, GOOGLE, KIMI). User must rotate these before merge. The gateway implementation itself treats keys as opaque and never logs them.
