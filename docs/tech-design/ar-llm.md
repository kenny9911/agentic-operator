# Tech Design — LLM Gateway

**Module ID:** AR-LLM
**Owner:** AI Software Architect
**Status:** V1.1 design
**Source catalog:** `docs/catalog/02-ai-runtime-catalog.md` § 2 (AR-LLM-01..07)

## 1. Purpose

The LLM gateway is the single chokepoint every LLM call passes through. It owns the provider registry (14 providers), request shaping, error classification, redaction, BYOK key vault, the streaming contract, and the failover policy. Per the design doc `docs/design/llm-gateway-and-baseagent.md:1-120` it is **not** responsible for persistence, audit logging, or cost calculation — those live downstream in the run engine, the audit writer, and the usage aggregator respectively. The gateway is the only file in the runtime that knows what an HTTP call to a third-party LLM looks like.

## 2. V1 state (citable)

- **14 providers** (AR-LLM-01) — `packages/llm-gateway/src/providers/index.ts:26-45` registers `mock`, `anthropic`, `openai`, `openrouter`, `gemini`, `azure`, `groq`, `together`, `mistral`, `deepseek`, `qwen`, `bedrock` (stub), `vertex` (stub), `custom`. Seven providers share `adapters/openai-compatible.ts` (openai, openrouter, groq, together, mistral, deepseek, qwen). Provider model catalog is published from `packages/contracts/src/providers.ts` (`PROVIDER_MODEL_CATALOG`).
- **Singleton wiring** (AR-LLM-02) — `getLLMGateway()` at `apps/api/src/services/llm.ts:19-26` builds the gateway lazily on first access, overlaying `process.env` with the provider-key vault. `setAgentGateway()` (`packages/agents/src/gateway-host.ts`) and `setRuntimeGateway()` (`packages/runtime/src/llm-host.ts`) are called from `apps/api/src/bootstrap.ts`. `resetLLMGateway()` is invoked after `POST /v1/llm/providers/:id/key` so saved keys take effect immediately.
- **Defaults** (AR-LLM-03) — `packages/llm-gateway/src/config.ts:50-99`. Provider: `LLM_DEFAULT_PROVIDER` env → legacy `LLM_PROVIDER` → `"mock"`. Model: `LLM_DEFAULT_MODEL` env → legacy `LLM_MODEL` → `null`. Per-request precedence in `LLMGateway.chat()` at `packages/llm-gateway/src/gateway.ts:71-130`: `req.provider > req.providers[0] > config.defaultProvider`.
- **Error taxonomy** (AR-LLM-04) — `packages/llm-gateway/src/errors.ts:9-18` defines `LLMErrorCode = "auth" | "rate_limit" | "timeout" | "model_not_found" | "bad_request" | "provider_error" | "network" | "not_configured"`. Transient set is `{rate_limit, timeout, network, provider_error}`. `cost_limit_exceeded` is added at the budget layer (`packages/llm-gateway/src/budget.ts`) and is mapped to HTTP 402 by `apps/api/src/routes/v1/agent-invoke.ts:253-271`. `classifyHttpError()` at `errors.ts:65-85` maps upstream status codes.
- **Redaction** (AR-LLM-05) — `packages/llm-gateway/src/redact.ts` strips known header values (`Authorization`, `x-api-key`, `api-key`) before any log write; truncates message bodies >16 KB with a `[…truncated N bytes]` suffix; redacts substrings matching `password=`, `token=`, `bearer ` from tool-result blocks on log only.
- **BYOK vault** (AR-LLM-06) — `apps/api/src/services/provider-keys.ts:1-340` encrypts keys under AES-256-GCM into `data/provider-keys.json` (mode 0600, gitignored). Master key derived via `scrypt(secret, salt, 32)` where `secret = AGENTIC_KEY_VAULT_SECRET` (canonical resolver at `provider-keys.ts:84-87`). Tenant-scoped keys beat workspace-scoped beat env (precedence enforced at `provider-keys.ts:170-211`).
- **Streaming** (AR-LLM-07) — every adapter implements `chatStream()` as an async iterator of `ChatChunk { type: "text" | "tool_use" | "stop", delta?, toolCall? }`. The run engine writes a `llm.delta` log line per chunk (~50/s soft throttle in `log-writer.ts`); the operator sees streaming highlight in `apps/web/app/portal/[tenant]/logs/page.tsx`.

## 3. V1.1 changes

### UC-V11-26 / AR-GAP-16 — Real AWS Bedrock + GCP Vertex adapters
**Site:** `packages/llm-gateway/src/adapters/bedrock-stub.ts` → `bedrock.ts` (replace), and `adapters/vertex-stub.ts` → `vertex.ts` (replace). Provider registration at `packages/llm-gateway/src/providers/bedrock.ts` and `providers/vertex.ts`.
**Bug:** Both adapters today throw `LLMError("not_configured", "Bedrock provider stubbed — v1.1")`. The wiring exists (the providers register fine, appear in `/v1/llm/providers`, accept keys into the vault) — only the upstream HTTP call is missing.
**Fix:**
- **Bedrock.** Add `@aws-sdk/client-bedrock-runtime` as a `peerDependencies` entry in `packages/llm-gateway/package.json` (peer to avoid bloating the install for tenants who don't use Bedrock). Implement `adapters/bedrock.ts` with `InvokeModelCommand` for non-streaming and `InvokeModelWithResponseStreamCommand` for streaming. Map Bedrock's Anthropic body shape (`{anthropic_version, messages, max_tokens, ...}`) for Claude models on Bedrock; map the Cohere/Titan body shape for those families. Auth via `BedrockRuntimeClient({region, credentials: fromEnv()})` so the same `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` env vars work.
- **Vertex.** Add `@google-cloud/vertexai` as a peer. Implement `adapters/vertex.ts` using `VertexAI({project, location}).getGenerativeModel({model})` with `generateContent()` (non-streaming) and `generateContentStream()` (streaming). Auth via Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS` path or `GOOGLE_CLOUD_PROJECT`).
- **Errors.** Both adapters map their native errors through `classifyHttpError()` (or hand-wrap for SDK-level exceptions: AWS `ThrottlingException` → `rate_limit`; GCP `RESOURCE_EXHAUSTED` → `rate_limit`).
- **Pricing.** Mirror Anthropic Sonnet pricing for Bedrock Claude rows in `PRICE_PER_MTOK_CENTS` (`budget.ts:62-77`); Vertex Gemini rows mirror the gemini provider rates. The stub values are already in place — only the adapter dispatch changes.

**New types:** None — the adapter interface is unchanged. Both adapters implement the existing `LLMAdapter` from `packages/llm-gateway/src/types.ts`.
**Migration:** None.
**Tests:** `tc-bedrock-adapter.test.ts` (new) — mocks `BedrockRuntimeClient.send` via `aws-sdk-client-mock`, asserts request shape (region, body), asserts response normalization. `tc-vertex-adapter.test.ts` (new) — mocks `VertexAI.getGenerativeModel().generateContent` via vi-mock. Both must include error-mapping coverage (rate-limit, auth, network).

### Adjacent V1.1 housekeeping (not in UC backlog but coupled)
- **Redaction header allow-list configurable per tenant** (Settings → Integrations → "Additional sensitive headers"). Stored in `tenants.config_json.redaction_headers[]`; `redact.ts` reads it at call site. Default remains the V1 hard-coded set.
- **`cost_limit_exceeded` discriminated explicitly.** Today `costCents()` (`budget.ts:79-87`) computes from `PRICE_PER_MTOK_CENTS` only; V1.1 should refuse to enforce when the provider has no price entry (currently returns 0 → never trips). Add `requirePrice: boolean = true` to `assertBudgetAvailable()` and log a `WARN` when missing rather than silently allow.

## 4. Interfaces (the contract)

**Public types (`packages/llm-gateway/src/types.ts`):**
```ts
export interface ChatRequest {
  messages: ChatMessage[];
  provider?: ProviderId;
  providers?: ProviderId[];     // failover chain
  model?: string;
  jsonMode?: boolean;
  tools?: ToolDef[];
  signal?: AbortSignal;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
  tenantId?: string;             // for budget enforcement
}
export interface ChatResponse {
  text: string;
  toolCalls?: ToolCall[];
  tokensIn: number;
  tokensOut: number;
  provider: ProviderId;
  model: string;
}
export interface ChatChunk {
  type: "text" | "tool_use" | "stop";
  delta?: string;
  toolCall?: ToolCall;
}
```

**Public class:** `LLMGateway` at `packages/llm-gateway/src/gateway.ts` exports `chat(req): Promise<ChatResponse>` and `chatStream(req): AsyncIterable<ChatChunk>`. Plus `register(id, adapter)`, `hasProvider(id)`, `listProviders()`.

**REST shapes (Zod in `packages/contracts/src/llm.ts`):**
- `GET /v1/llm/providers` → `ProviderInfo[]` with `{ id, displayName, models[], requires[], byok: { configured, scope } }`.
- `GET /v1/llm/models?provider=` → `string[]`.
- `GET /v1/llm/catalog` → full `PROVIDER_MODEL_CATALOG`.
- `POST /v1/llm/chat` → `ChatResponse` (Zod-validated).
- `POST /v1/llm/providers/:id/key` body `{ apiKey, scope: "workspace" | "tenant" }` → `{ id, scope, masked }`.
- `POST /v1/llm/providers/:id/test` body `{ apiKey? }` → `{ ok, message }`.
- `DELETE /v1/llm/providers/:id/key` → `204`.

**SSE shape:** the streaming response is encoded into NDJSON log lines on the run-log stream rather than a direct gateway SSE in V1 — see AR-LLM-07.

## 5. Data flow

Single chat call:

```
caller (BaseAgent.run or runtime step engine)
   |
   v
LLMGateway.chat(req)
   |
   v
resolveProviderChain()  ->  [openai, anthropic, ...]
   |
   v
for each provider id:
   |
   +-> adapter.chat(subReq)   --(success)--> ChatResponse, return
   |        |
   |        +--(transient err)--> retry once
   |              |
   |              +--(transient again)--> log, continue loop
   |              +--(non-transient)----> throw immediately
   |
   +-> no more providers -> throw last LLMError
```

BYOK overlay at boot:

```
process.env       provider-keys.json (AES-256-GCM)
     \              /
      \            /
   getEnvForAdapter(provider)
            |
            v
   make<Provider>(env)  ->  Adapter
            |
            v
   gateway.register(id, adapter)
```

## 6. Failure modes

| Code | Cause | HTTP | Transient? | Recovery |
|---|---|---|---|---|
| `auth` | 401/403 from upstream | 401 | no | Rotate key via `POST /v1/llm/providers/:id/key` |
| `rate_limit` | 429 from upstream | 429 | yes | Gateway retries once, then fails over to next provider |
| `timeout` | exceeded `timeoutMs` | 504 | yes | Retry-once, then failover |
| `model_not_found` | 404 / unknown model | 400 | no | Caller must specify a valid model |
| `bad_request` | 400 / invalid params | 400 | no | Fix request body |
| `provider_error` | upstream 5xx | 502 | yes | Retry-once, failover |
| `network` | ECONNRESET / DNS | 502 | yes | Retry-once, failover |
| `not_configured` | adapter is stub / no key | 503 | no | Configure provider via BYOK |
| `cost_limit_exceeded` | budget guard pre-flight | 402 | no | Operator must raise cap or wait for reset |

Failover is *per-call*, not per-process. The gateway does not remember a provider was failing; the next call re-tries it. This is intentional — provider availability is opaque and brittle to model. A genuine outage will surface as repeated `provider_error` log lines feeding `llm_provider_errors_total{tenant,provider,model,code}` (AR-X-06).

**Cross-tenant key bleed (regression-tested).** Pre-P5, a `scope:'tenant'` key from tenant A could leak to tenant B because the resolver returned the first match without re-checking tenant. Fixed by `provider-keys.ts:170-211` which now requires explicit tenant-match. Regression test: TC-20.

## 7. V2 roadmap

- **UC-V2-08** — Stream raw `ChatChunk` to the portal (today gateway streams internally, but the SSE bridge is per-log-line). Needs SSE multiplexing per-run and a new IO-tab streaming widget.
- **UC-V2-15 / AR-GAP-15** — Gateway-level JSON-output enforcement + repair loop. Code agents have `outputSchema?: ZodType` (P1-RT-07) with one repair turn; manifest path has none. Lift the repair into the gateway so both paths benefit.
- **Cost-table consolidation.** Today `PRICE_PER_MTOK_CENTS` (gateway, per-provider) and `MODEL_PRICING` (usage route, per-model) drift. V2 ticket: source both from `@agentic/contracts/providers`.

## 8. Acceptance tests

- `tc-bedrock-adapter.test.ts` — UC-V11-26 Bedrock real call (mocked SDK).
- `tc-vertex-adapter.test.ts` — UC-V11-26 Vertex real call (mocked SDK).
- `tc-13-llm-gateway.test.ts` (existing) — provider registration, default resolution, error classification, redaction `sk-…` grep, BYOK round-trip.
- `tc-15-tool-use-conformance.test.ts` (existing) — per-provider tool-use adapter shape.
- `tc-16-tool-use-loop.test.ts` (existing) — multi-turn tool-use loop end-to-end.
- `tc-20-tenant-key-bleed.test.ts` (existing) — cross-tenant key isolation regression.
- `tc-llm-streaming-throttle.test.ts` (new for V1.1) — assert the ~50/s `llm.delta` line throttle holds for a high-token model.
- `tc-cost-limit-402.test.ts` — budget cap exceeded → `cost_limit_exceeded` → 402.

Coverage gates: every UC-V11-* listed has a paired failing-then-passing test per the TDD mandate in `docs/USE_CASES.md` § 6.
