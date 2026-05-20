# AI Runtime Review — Agentic Operator

**Audit date:** 2026-05-19
**Author:** AI Architect persona (LangGraph / AutoGen / Inngest experience)
**Scope:** `packages/agents`, `packages/agent-kit`, `packages/llm-gateway`, `packages/runtime`, `packages/tools`, `tenants/raas`, `models/RAAS-v1`
**Companion docs:** `docs/design/llm-gateway-and-baseagent.md`, `agentic-operator_v1_1/docs/DESIGN.md`, `docs/test-cases/agent-system-tests.md`

---

## 1. Executive summary

The runtime makes a sound bet: **two coexisting agent kinds (code + manifest) share one execution substrate (Inngest) and one persistence/audit shape (`runs` + `steps` + file logs)**. The LLM gateway is well-typed, the provider taxonomy is honest about what's stubbed, and the durability story (Inngest `step.run`, memoized init, ledger-backed payloads) is appropriate for v1 RAAS. Where the design will hurt in production:

- **The manifest schema is structurally lying.** Four new fields (`input_data`, `ontology_instructions`, `tool_use`, `typescript_code`) appear in 13 of the 23 RAAS agents but the Zod parser silently drops them (`packages/runtime/src/manifest.ts:28-37` — no `.passthrough()`). They are persisted neither in `agents` nor in `agent_versions`. The runtime cannot read them, by construction.
- **No multi-turn / tool-use loop.** `BaseAgent.maxSteps = 1`, `run-engine.ts` makes exactly one `gateway.chat()` call, and the gateway has no concept of `tool_calls` round-tripping. Anything beyond single-shot is unimplementable today without rewriting the run engine.
- **No streaming, no structured-output enforcement, no memory.** All three are documented as "v2", but the abstractions don't reserve the surface — `parseOutput()` runs after the call, gateway doesn't know about JSON-mode at the contract level beyond a `jsonMode` boolean, and there is no notion of conversation/run memory across invocations.
- **Step engine's `logic` fallback is a foot-gun.** Any manifest `type: "logic"` with no matching tenant prompt sends `${action.name}: ${action.description}` as raw user content (`step-engine.ts:178-179`) — meaning the action description in Chinese plus a name is what the LLM sees. Of the 23 RAAS agents, almost every `logic` action falls into this path.
- **Failover semantics are stronger than they look.** The gateway retries transient errors once and falls through provider chains — but `BaseAgent.run()` never sets `req.providers`, so only a single provider is ever tried. Effective failover from code agents is dead code.

tl;dr:
- Provider-side gateway: **production-shaped**, with a real error taxonomy, lazy clients, and abort propagation.
- BaseAgent + run engine: **clean v1 single-shot**, but the contract bakes in assumptions that will break for multi-step and streaming.
- Manifest engine + Inngest wiring: **operationally durable**, but the manifest schema drift is a correctness landmine.
- Tool-calling, structured output, eval harness: **mostly absent**.
- Tenant code packaging: **clean ergonomics, zero sandboxing**.

---

## 2. Agent abstraction (BaseAgent + AgentKind)

### 2.1 Public API surface

`packages/agents/src/base-agent.ts:29-78` defines the contract:

| Member | Purpose | Concern |
|---|---|---|
| `name`, `description` | identity & docstring | OK |
| `kind = "code"` | discriminator | Hardcoded constant — see §11 |
| `enabled` | feature flag | Boolean only; no env/tenant gating |
| `defaultProvider`, `defaultModel` | per-agent override | OK |
| `maxSteps = 1` | reserved for multi-step | **Declared but unused.** Engine ignores it. |
| `concurrency = { limit: 4 }` | Inngest hint | **Declared but unused.** The runtime never plumbs this into the Inngest function created for code agents (no such function is created; see §11). |
| `buildMessages(input, ctx)` | required override | Good shape |
| `parseOutput(text, ctx)` | post-process | Identity-string only |
| `run()` | sealed entry point | OK; well-documented as sealed |

**Ergonomics for the user:** writing an agent is genuinely small (`system/test-agent.ts` is 28 LOC). Side-effecting registration at import (`agentRegistry.register(new TestAgent())`, line 33) is fine for v1 but couples agent definition to module side-effects, which makes A/B testing and per-tenant enablement awkward.

### 2.2 Single-shot model vs multi-step intent

Despite the `maxSteps` field and the `parseOutput` hook hinting at richer flows, `run-engine.ts:101-272` is a **single linear function**:

1. resolve tenant + agent rows;
2. allocate `runId`/`stepId`;
3. **one** `gateway.chat(...)` call (line 165);
4. **one** `parseOutput()` (line 197);
5. close rows.

There is no loop, no tool-use round-trip, no streaming, no human gate, and no per-step error budget. This is fine for `TestAgent` but blocks the obvious next move (a real working agent that calls tools).

Comparison to industry norms:

| Framework | Multi-step | Tool-use | Streaming | Memory | Run model |
|---|---|---|---|---|---|
| **LangGraph** | First-class — explicit nodes + edges | Yes; ToolNode | Yes | StateGraph state + checkpointing | Graph |
| **AutoGen** | First-class — Conversable agents | Yes; function_map | Yes | message_history | Conversation |
| **Mastra** | Steps + workflows | Yes; tools registry | Yes | Memory primitive | Step graph |
| **Crew** | First-class | Yes | Yes | None native | Roles/tasks |
| **Agentic Operator BaseAgent** | **No (single-shot)** | **No** | **No** | **None** | Function call |

The **AgentKind discriminator** `"code" | "manifest"` is a nice clean two-implementation strategy, but it's a *deployment* distinction, not a *runtime* one. LangGraph treats code-defined nodes and DSL-defined nodes uniformly: both are nodes in a graph. The Agentic Operator's split means code agents and manifest agents have *different* run engines (`packages/agents/run-engine.ts` vs `packages/runtime/register.ts`), with subtly different ledger writes (e.g., code agent runs always write `model: response.model`; manifest runs hard-code `model: "mock-model-v1"` at `register.ts:409`).

### 2.3 Typed input/output discipline

`BaseAgent<TInput, TOutput>` is generic and well-typed (`base-agent.ts:29`). `parseOutput` defaults to a string trim; users opting into structured output must hand-roll JSON parsing inside their override. There is no support for:

- Zod-validated outputs at the BaseAgent level (`agent-kit/define-prompt.ts:27-34` has it for tenant prompts but BaseAgent does not consume it);
- JSON-mode forcing (would need `gateway.chat({ jsonMode: true })` plus retry-on-parse-fail);
- Schema-driven repair loops ("model returned malformed JSON, retry with the schema error appended").

**Recommendation (low-medium effort):** add `outputSchema?: ZodType<TOutput>` to `BaseAgent`, push schema into `gateway.chat()` as both `jsonMode: true` and an instruction-block injection, then validate + repair-retry in the run engine. This becomes the surface for `tool_use` later.

### 2.4 Sealed `run()` vs. extensible hooks

The "sealed `run()` plus overridable hooks" pattern (`buildMessages`, `parseOutput`) is correct and idiomatic. The two indirection methods (`_buildMessages`, `_parseOutput` at lines 71-77) are an awkward escape hatch for promise-coercion — could be removed by just having `run-engine.ts` call `Promise.resolve(agent.buildMessages(...))` directly.

---

## 3. Manifest model (declarative agents)

### 3.1 Schema reality vs. file reality

`packages/runtime/src/manifest.ts:28-41` defines:

```ts
export const AgentSchema = z.object({
  id, name, title?, description?, actor, trigger, actions, triggered_event
});
// NO .passthrough()
```

But `models/RAAS-v1/workflow_v1.json` agents carry **four extra fields** the spec demands and the file ships:

| Field | Present in workflow_v1.json | In Zod schema? | What happens at parse |
|---|---|---|---|
| `input_data` | 13 of 23 agents (e.g. `id "10-1"` ruleCheckerForClientResume — workflow_v1.json:432-435) | **No** | **Silently dropped** |
| `ontology_instructions` | 13 of 23 agents (workflow_v1.json:436 is the only non-empty example) | **No** | **Silently dropped** |
| `tool_use` | 13 of 23 agents (always empty string in current file) | **No** | **Silently dropped** |
| `typescript_code` | 13 of 23 agents (always empty string in current file) | **No** | **Silently dropped** |

This is a serious schema-versioning bug: the file is forward-extended, the parser is not, the data does not survive into the DB (`agent_versions.manifest_json` stores the *parsed* result — see `bootstrap.ts:243-249`). The runtime cannot ever use these fields, even if step-engine were extended, because they're gone by the time the engine sees the spec.

Compare to the richer `actions_v1.json` (sampled at `models/RAAS-v1/actions_v1.json:1-150`): each action carries `submission_criteria`, `inputs[]`, `outputs[]`, `rules[]`, `target_objects[]`, `category`. This file is preserved unmodified via `ActionsManifestSchema = z.array(z.record(z.string(), z.unknown()))` (manifest.ts:43) and stored as `workflow_versions.actionsJson` (bootstrap.ts:165), so a future step-engine *could* mine it for typed I/O. The workflow file does not get the same treatment.

### 3.2 Strength: declarative composability

The manifest model is the right primitive: one JSON file describes 23 agents and their event topology, and `register.ts` deterministically turns each entry into an Inngest function with predictable concurrency keys, retries, and trigger bindings. Operators can edit JSON and re-bootstrap; no Node code changes required.

### 3.3 Weaknesses

| # | Issue | File:line | Severity |
|---|---|---|---|
| 1 | Strict schema strips forward-extended fields | manifest.ts:28-37 | High |
| 2 | No schema version key in workflow.json | manifest.ts:40 | Med |
| 3 | No diff/migration tool | bootstrap.ts:146 (hashManifest) | Med |
| 4 | `actions` field per-agent in workflow.json duplicates `action_steps` in actions.json; no cross-validation | bootstrap.ts | Med |
| 5 | Conditional execution (`condition` field) is parsed but never evaluated — step engine ignores it | step-engine.ts:158-209 + register.ts:283 | **High** |
| 6 | Optional retry/timeout per-action (`retries`, `timeout_s` in ActionSchema:24-25) are parsed but not honored — register.ts uses the function-level `retries: 3` only | register.ts:78, step-engine.ts | High |
| 7 | `task_type` consumed only in `manual` branch (register.ts:197); ignored otherwise | register.ts:197 | Low |

### 3.4 The new fields — what they *should* mean

Reading the field names with industry context:

- **`input_data: Record<string, string>`** — declared inputs (name → human description). Right place to add typed dispatch; the current parser drops it. Compare to LangGraph's typed state.
- **`ontology_instructions: string`** — a free-text system-prompt fragment that gets prepended to every `logic` action's user message. This is the single most-requested feature in custom-prompt agents. The current code has **zero injection points** for this.
- **`tool_use: string`** (currently always empty) — appears to be the slot for declaring tool names available to this agent. Should become `tool_use: { name: string; input_schema: JSONSchema }[]` if it's to map to Anthropic/OpenAI function-calling.
- **`typescript_code: string`** (currently always empty) — documentation slot for an alternate implementation. Hot-loading TypeScript at runtime is dangerous (see §12); the better path is "if non-empty, this agent has a code-defined counterpart in `tenants/<slug>/src/agents/<name>.ts`".

**Recommendation (Medium effort):** add these to `AgentSchema` as optional with sensible defaults, persist them in `agent_versions.manifest_json`, then wire them into the step engine in this order: ontology_instructions (cheapest), input_data (validation), tool_use (real loop), typescript_code (last — see §11).

---

## 4. Step engine

### 4.1 Step types

Three step types defined in `manifest.ts:15` (`StepTypeEnum = z.enum(["tool", "logic", "manual"])`). Dispatch lives in `step-engine.ts:158-209`:

| Type | Resolution | Fallback | LLM involved? |
|---|---|---|---|
| `tool` | tenant `tools.X` → generic `@agentic/tools.runTool` | hint-guessed `http.fetch` / `channel.publish` (mock) | No |
| `logic` | tenant `prompts.X` → auto-built `${name}: ${description}` prompt | calls `gateway.chat()` with a one-sentence system prompt | **Yes** |
| `manual` | short-circuited in `register.ts:169-280` | `step.waitForEvent('task.resolved', timeout: '7d')` | No |

### 4.2 The `logic` fallback (severe)

When a manifest action has `type: "logic"` and the tenant has not registered a prompt by that name, `step-engine.ts:178-179`:

```ts
const prompt = `${action.name}: ${action.description}`;
const result = await callLLM(prompt);
```

For RAAS, this means almost every `logic` action effectively sends a one-line user message ("checkDeduplicatedRequisition: 利用【招聘岗位】中的...") with a generic system prompt ("You are an LLM-driven workflow step. Reply concisely."). No `ontology_instructions`, no `input_data` binding, no `lastResult` passing in a structured way, no schema. The model has no idea what the agent is doing.

This works for a mock provider that pattern-matches on "Agentic Operator", but on a real provider it produces low-quality, hallucinated, non-structured output that the next step then receives as `lastResult` (line 357 of `register.ts`).

**Recommendation (High effort, High priority):** rewrite the auto-built prompt to:
1. Pull `ontology_instructions` from the agent spec (once schema is fixed).
2. Include the agent's full description as system context.
3. Marshal `lastResult` as a structured JSON object into the user message.
4. Bind `input_data` keys to event payload values.
5. If `tool_use` is non-empty, register tools and enter a real loop (see §6).
6. If a structured output schema is declared, set `jsonMode: true` and validate.

### 4.3 Conditional execution

`ActionSchema` declares `condition?: string` (manifest.ts:21), and almost every RAAS action has one (e.g. workflow_v1.json:41 `"客户需求管理系统可正常访问"`). The step engine never evaluates them — `register.ts:283` runs every action unconditionally.

For a v1 demo this is forgivable. For production it's wrong: agents will run actions whose conditions are false (e.g. `clarifyRequirement.action[1]` says "skip if `clarify_questions` is empty"). Either the conditions need a deterministic evaluator (mini-DSL or eval against `lastResult`), or they need to become explicit guard steps.

### 4.4 Error → retry → dead-letter

- **Step level:** `register.ts:283-349` catches errors inside `step.run`, marks the step row failed, then re-throws. The throw propagates to Inngest, which applies its own retry policy (line 78: `retries: 3`).
- **Run level:** A failed step calls `failRun()` (register.ts:445-464) which updates the run row to `status: 'failed'` and writes a log line. No retry at the run level.
- **Dead-letter:** Inngest will give up after 3 retries and the function fails. The runtime has **no separate dead-letter queue or table** — the failure lives in `runs.status='failed'` + the run's log file. Operators have no replay primitive (the design doc §9.4 mentions `POST /api/runs/:id/replay` but it isn't implemented in the surveyed routes).
- **Per-action retry overrides:** `ActionSchema.retries` parsed (manifest.ts:24), never honored. The Inngest function-level retry count is a single number; making it action-aware would need `step.run` to throw differently for retryable vs. terminal errors.

### 4.5 Side effects + atomicity

Every database mutation happens inside `step.run(...)` callbacks (`register.ts:93-140` for init, `283-349` for each action, `369-415` for finalize). Inngest memoizes step return values, so on replay the *body* of `step.run` doesn't re-execute. This is a clever way to get exactly-once semantics for the run row insert, but it has subtleties:

- **DB writes inside `step.run` are NOT memoized** — only the return value is. If a step body inserts a row, then fails before returning, Inngest will retry the body, which will re-insert (potentially as a duplicate). The init step uses `makeId("run")` inside the body, so re-execution would mint a new run id, then the retry would return that new id — but the original insert remains. There's no idempotency guard on the insert.
- **Artifact writes** in `run-engine.ts:46-52` (code path) use `runId` as the path, so re-writing is safe. The manifest path doesn't write artifacts at all.
- **Event ledger** appends via `appendToLedger` (event-ledger.ts:39-53) — by the time `step.run("finalize")` re-executes (Inngest replay), the ledger has the original record, but the file may grow by another. The DB insert happens inside the same step.run, so the row is memoized — meaning the post-replay state is "row exists, ledger has 2 copies." Not catastrophic, but observable.

The fix is standard: use `INSERT ... ON CONFLICT` and a deterministic id (e.g. `runId + step ord`), or use Inngest's `step.run` more deliberately so that side effects produce idempotent operations only.

### 4.6 Manual steps + human task gating

`register.ts:169-280` is the human-in-the-loop branch. It:

1. Creates a step row + task row inside one `step.run` (memoized, ID-stable across retries via Inngest).
2. `step.waitForEvent('task.resolved', if: ..., timeout: '7d')` — Inngest's durable wait. Good.
3. On resolve, marks step + task ok or rejected.
4. On reject → `failRun()` + throw.

This is the cleanest part of the runtime. Two concerns:

- The 7-day timeout is hardcoded; some workflows need longer. Surface as a manifest field.
- `if: 'async.data.taskId == "${initStep.taskId}"'` (line 215) uses Inngest's expression matcher with string interpolation — safe here because `taskId` is internal, but a future tenant-supplied `task_type` injection into the expression would need escaping.

### 4.7 Idempotency via correlation id

`correlation.ts:9-16` reads `event.data.__correlationId` if present, else mints a UUID. `withCorrelation()` (lines 18-23) injects it into emitted events. This gives a correlation thread across chained runs, which is excellent for tracing. However:

- The code-agent run-engine accepts `correlationId` from the caller but doesn't propagate it onto emitted events (`run-engine.ts` doesn't emit events at all).
- Manifest runs propagate correctly via `step.sendEvent` (register.ts:421-430).
- There is **no idempotency key** for the *trigger* — if the same external event is posted twice with the same payload but no `__triggerEventId`, two runs will spawn. Inngest deduplicates by event id only when the SDK is given one.

---

## 5. LLM gateway

### 5.1 Provider taxonomy

`packages/llm-gateway/src/providers/index.ts:30-44` registers 14 providers. Three classes:

| Class | Providers | Adapter |
|---|---|---|
| Anthropic SDK | `anthropic` | `adapters/anthropic.ts` (system message partition, stop-reason map) |
| OpenAI-compatible | `openai`, `openrouter`, `groq`, `together`, `mistral`, `deepseek`, `qwen`, `custom` | shared `adapters/openai-compatible.ts` |
| Other | `gemini` (Google SDK), `azure` (Azure SDK), `mock`, `bedrock` (stub), `vertex` (stub) | own files |

The split is the right one — eight of fourteen come "free" via the OpenAI-compatible factory. Adapters are lazy-instantiated (`openai-compatible.ts:46-64`), so unused providers cost nothing.

**Concerns:**

| # | Issue | Severity |
|---|---|---|
| 1 | Bedrock + Vertex are visible in `listProviders()` but throw on any call. The spec says "v1 acceptable" (DESIGN §13). Will surprise users. | Low |
| 2 | Custom provider with no URL still registers (`providers/custom.ts:11-22` sets baseURL to `https://invalid.local` to satisfy the SDK). Side effect: `gateway.hasProvider("custom")` returns true even though it's not usable. | Medium |
| 3 | `defaultModelFor("openai")` returns `gpt-4.1` (`providers.ts:266-271` picks first model unless one has `added: true`). The default for OpenRouter has no `added` flag — silently uses `anthropic/claude-sonnet-4-5`. Unintuitive. | Low |

### 5.2 Retry, timeout, rate-limit handling

`gateway.ts:71-124` (the `chat()` method) implements:

1. **Provider chain resolution** (line 126-130): `providers[]` array wins; else single `provider`; else default.
2. **Timeout** combined via `AbortSignal.any()` or polyfill (line 148-159).
3. **Per-provider:** one try → on transient error, sleep 250 ms → retry once → if still transient, fall through to the next provider.
4. **Terminal error codes** (`auth`, `bad_request`, `model_not_found`, `not_configured`): throw immediately, no retry, no failover.

**This is a reasonable v1 policy.** The taxonomy at `errors.ts:9-18` is well-thought-out, with `TRANSIENT` set explicit at line 19-24. Adapter normalizers in each adapter (`adapters/anthropic.ts:124-139`, `adapters/openai-compatible.ts:120-141`, `adapters/gemini.ts:122-141`) convert provider-native errors into `LLMError` codes. The classification logic at `classifyHttpError` (errors.ts:65-85) is correct for the standard status codes.

**Concerns:**

| # | Issue | File:line | Severity |
|---|---|---|---|
| 1 | Backoff is fixed 250 ms, single retry. No jitter, no exponential. A burst of 429s from one provider exhausts retries instantly and falls through. | gateway.ts:104 | Med |
| 2 | No per-tenant or per-key rate limiting. A noisy tenant can starve the others. | (absent) | High |
| 3 | `req.timeoutMs` is combined with the caller signal but adapter-side honoring is via `signal:` on the SDK call. Some SDKs ignore signal post-headers — e.g. OpenAI SDK's signal cancels the request but not in-flight streaming reads. Not directly hit here since v1 isn't streaming. | adapters/*.ts | Low |
| 4 | `signal: req.signal` is dropped on the second retry attempt in some paths (line 106 — recreated each retry, OK on closer read). | gateway.ts:106 | None |
| 5 | Cost of failover: each retry/fallthrough is silent to the caller — no header or metadata says "we tried 2 providers". | gateway.ts:71-124 | Med |

### 5.3 Streaming support

**Not implemented.** `ChatResponse` is `{ text, ... }`, single shot. The design doc lists streaming under §12 future. The contract `types.ts:39-49` has no `Stream` type. Adding streaming requires:

- A new `chat.stream()` method on `LLMGateway`.
- `AsyncIterable<ChatChunk>` return type with `{ type: 'text-delta' | 'tool-call' | 'usage' | 'done', ... }`.
- SSE pipe at the API layer.
- BaseAgent path: either consume the stream to a string (no behavior change), or expose `streamMessages()` as a sibling override.

Given the manifest engine writes one final ledger row per run, streaming at the run level doesn't need engine changes — only at the gateway and BaseAgent surface.

### 5.4 Tool-use loop

**Not implemented at the gateway level.** `ChatRequest` has no `tools[]` field. `ChatResponse.finishReason` includes `"tool_calls"` (types.ts:46), and the Anthropic adapter maps Anthropic's `"tool_use"` stop reason to it (anthropic.ts:42), but nothing consumes that signal. There is no provider-shape `tool_calls` array on the response and no `assistant`-with-`tool_use`-blocks message support.

This is the single biggest missing piece for production. Every modern agent stack (Anthropic Tool Use, OpenAI function calling, Gemini function calling, Cohere) has converged on the same shape:

```
1. assistant -> { content: [{type: "text"}, {type: "tool_use", id, name, input}] }
2. user      -> { content: [{type: "tool_result", tool_use_id, content}] }
3. assistant -> { content: [{type: "text", ...}] }
```

The Agentic Operator's `ChatMessage = { role, content: string }` (types.ts:14-17) **cannot represent step 1 or 2**. Adding tool-use requires expanding `content` to a string-or-array union — which then forces every adapter to handle it.

### 5.5 Token accounting + cost attribution

- `ChatResponse.tokensIn / tokensOut` are pulled from each provider's usage block. Gemini, OpenAI, Anthropic, Azure all expose them. Mock is approximated (mock.ts:23). Together, Groq, Deepseek expose them via the OpenAI shape — they're passed through.
- `runs.tokens_in / tokens_out` aggregate per run; `steps.tokens_in / tokens_out` per call. Schema deltas land both columns (DESIGN §5).
- **Cost is not computed.** `PROVIDER_MODEL_CATALOG` has `inP / outP` per model (providers.ts:206-258), but no `cost_usd` field is added to `runs` or `steps`. The frontend can compute it on-the-fly, but there's no per-tenant budget ceiling, no audit row, no aggregate.
- **No BYOK (Bring Your Own Key) story.** Keys are read once at gateway construction from process env (config.ts:50-99). The DESIGN.md §12 calls out a `tenant_provider_keys` table for v2. Today, a single set of keys serves all tenants — fine for one production tenant, will be wrong for many.

### 5.6 Failure semantics

`LLMError` (errors.ts:26-55) is properly subclass-based, with `code`, `provider`, `cause`, and a `toJSON()` for serialization. `isLLMError()` is exported. The route layer maps `LLMError.code` to HTTP status via `mapErrorStatus` in `agent-invoke.ts:119-137`. This is the right shape.

**One concern:** the gateway distinguishes "all providers tried, last one failed transiently" (returns its `LLMError`) vs. "tried only one because no chain was provided." In practice `BaseAgent` never passes a chain, so the failover code path is unreachable from code agents.

---

## 6. Tool-calling architecture

### 6.1 Resolution order

For manifest actions of `type: "tool"`, `step-engine.ts:162-173`:

```ts
const tenantTool = tenantRegistry?.tools?.[action.name];
if (tenantTool) return runTenantTool(ctx, tenantTool);   // typed handler
const result = await runTool(genericCtx(ctx), action.name);  // fallback
```

The fallback (`packages/tools/src/index.ts:69-90`) "guesses" a tool from name hints — `"publish" | "notify" | "alert"` → `channel.publish`, else `http.fetch`. **Both are mocks** that return `{status:200, body:{mock:true,...}}`. So every untyped `tool`-type action in RAAS resolves to a mock HTTP call.

This is documented (the file header explicitly says "v1 ships mock implementations") but conceptually it should not be the production shape:

| What should be in a manifest tool action | What is today |
|---|---|
| Explicit `tool: "channel.publish"` field | Missing — only `name` + `description` |
| Typed inputs (from `actions.json.inputs[]`) | Parsed but not threaded into the call |
| Tool input schema validation | Absent |
| Tool error → fail-step semantics | Present (returns `{ok:false}` → step marked failed) |
| Streaming progress emit | Absent |

### 6.2 Tenant tool descriptor

`agent-kit/define-tool.ts:36-46` returns a `ToolDescriptor<TOutput>`:

```ts
{ kind: "tool", name, description?, output?: ZodType, handler(ctx) => Promise<ToolResult<TOutput>> }
```

The handler's `ctx` carries `agentName`, `actionName`, `subject`, `correlationId`, `tenantSlug`, optional `event`, and `lastResult` (`agent-kit/types.ts:17-38`). Output validation is best-effort: if `descriptor.output` is set, the engine `safeParse`s the handler's return; on failure the step is marked failed with the schema error in `meta.schemaError` (`step-engine.ts:67-83`).

**This is the right shape.** The only nit: there is no concept of *tool input* — a tool handler receives the context but no per-invocation arguments. The single tenant tool currently shipped (`tenants/raas/src/tools/ping-probe.ts:16-35`) reads from `ctx.subject` / `ctx.event` only. For real tools that take arguments (e.g. "fetch URL X with method Y"), arguments would need to come from `ctx.lastResult` (loose) or a new `args` field on the action (typed).

### 6.3 JSON-schema validation

Zod schemas live on prompt and tool descriptors (`agent-kit/types.ts:63-85`). For tools, the engine validates *outputs* (step-engine.ts:67-83). For prompts, the engine *tries* to parse JSON from the response text and validates (step-engine.ts:127-156), but on JSON-parse failure it silently keeps the raw text (line 140 catch — "Real LLMs may return prose; structured-output enforcement is a v2 hardening"). This is the right v1 fallback but should grow a retry-with-repair loop.

There is no JSON schema for tool *inputs* anywhere in the stack.

### 6.4 Compatibility with industry tool-use

To support real Anthropic tool-use or OpenAI function calling, the gateway would need to:

1. Accept `tools: ToolDef[]` on `ChatRequest`, where `ToolDef = { name, description, input_schema: JSONSchema }`.
2. Return `tool_calls?: ToolCall[]` on `ChatResponse` and accept `tool_results?: ToolResult[]` on the next `ChatRequest`.
3. Each adapter translates these to/from native shapes (Anthropic uses `tools[]` and `tool_use` content blocks; OpenAI uses `tools[]` and `tool_calls` on choice messages).

The current `BaseAgent` could then expose `getTools()` to declare callable tools, and the run-engine could run a multi-turn loop bounded by `maxSteps` (which is currently dead code).

---

## 7. Prompts & ontology

### 7.1 Where prompts come from

| Path | Source | When used |
|---|---|---|
| `BaseAgent.buildMessages()` | Hand-coded `ChatMessage[]` | Code agents |
| Tenant `PromptDescriptor.template(ctx)` | `definePrompt({...})` in tenant pkg | Manifest `logic` actions with matching tenant prompt |
| Auto-built `${name}: ${description}` | `step-engine.ts:178-179` | Manifest `logic` actions with no tenant prompt |
| Tool's own LLM use | Inside a tenant tool handler | Tenant `tool` actions that call gateway directly |

### 7.2 System-prompt injection

The auto-built path uses a hardcoded system prompt: `"You are an LLM-driven workflow step. Reply concisely."` (step-engine.ts:111). This is a v1 placeholder.

The tenant `PromptDescriptor` has `system?` (`agent-kit/types.ts:79`), but the step engine **doesn't use it** when invoking — `runTenantPrompt` (step-engine.ts:127-156) renders only the template and passes a single `user` message; the descriptor's `system` is ignored.

`BaseAgent.buildMessages()` is the only place where multiple roles can be set today.

### 7.3 `ontology_instructions` — the missing primitive

This field is the right shape for a tenant-level prepended system prompt. Currently dropped at parse time (§3.1). When added, it should:

- Live on the agent spec, **not** on each action — one ontology per agent.
- Be **prepended** to whatever system message the prompt descriptor or auto-built path produces.
- Be available to BaseAgent code agents as `ctx.ontologyInstructions` so a code agent can opt into the same convention.

Industry comparison:
- **AutoGen** has `system_message` on each agent.
- **LangGraph** lets you put it in the graph state.
- **Mastra** uses `instructions` on the agent definition.

Agentic Operator's design intent (`ontology_instructions` per-agent) matches Mastra most closely. The execution gap is everything.

### 7.4 Per-tenant prompt overrides

Today: a tenant's `prompts` registry (e.g. `tenants/raas/src/prompts/*`) overrides matching prompt names. Resolution is by **exact name match** (step-engine.ts:175). There is no:

- Versioning (`prompts.X@v2`)
- A/B routing (`prompts.X` returns either A or B based on a flag)
- Cross-tenant inheritance (`prompts.shared.X`)
- Per-environment prompt overrides (dev vs. prod)

### 7.5 Prompt versioning / A-B testing

**None.** The manifest version (`workflowVersions.version = "auto-<sha>"` at bootstrap.ts:146) tracks workflow-level changes, and code agents track their git sha in `agent_versions.manifestJson` (bootstrap.ts:170-180), but there is no separate prompt-version concept. Changing a prompt requires:

- Editing the tenant's `definePrompt` definition (source change → redeploy), or
- Editing the manifest's `description` (because the auto-built prompt uses it).

There is no way to ship two prompt variants and route traffic. Industry baseline (LangSmith, Vellum, PromptLayer) ships prompt versions as a first-class entity with environment pinning.

---

## 8. Memory & context

### 8.1 Within-run memory

`step-engine.ts` threads `lastResult` (the previous step's output) into `ctx.lastResult` (`register.ts:312`). That's it. There is no:

- Multi-step conversation memory (a `messages: ChatMessage[]` array that grows across actions)
- Selective summarization
- Step-output indexing for retrieval

For RAAS this is OK: the manifest is a linear pipeline of single-shot steps, not a conversational agent. But anything resembling a chat agent or an agentic loop will need to grow this.

### 8.2 Across-run memory

**None.** There is no long-term memory store, no per-subject persistent context (despite `subject` being threaded through every run), no embeddings, no retrieval. The DB has `runs.subject` (a string) but no `subject_memory` table.

For RAAS, where one candidate (`CAN-88412`) flows through ~10 agents over days/weeks, the lack of subject-scoped memory means each agent has to re-derive context from the DB. That's actually fine *if* the manifest engine resolves DB lookups via `input_data` declarations (it doesn't — see §3.4).

### 8.3 Subject context

`runs.subject` is set from `event.data.subject` (register.ts:84). It's used:
- As an Inngest concurrency key (`event.data.subject` → max one run per subject in flight; register.ts:75).
- As a label in log lines.
- Persisted on the row.

It is **not** auto-bound to `input_data.candidate_id` etc. The agent author has to fish it out of the event manually.

### 8.4 Vector store / retrieval

**Absent.** No embedding gateway, no vector index, no RAG primitive. The `PROVIDER_MODEL_CATALOG` notes which models support tools/vision but doesn't enumerate embedding models. For a recruiting workflow that wants to surface "similar candidates from past pipelines," RAG would be the obvious add.

### 8.5 Industry comparison

| Capability | Agentic Operator | LangGraph | Mastra | AutoGen |
|---|---|---|---|---|
| Run state | ad-hoc `lastResult` | StateGraph state | Workflow context | Conversation history |
| Run checkpointing | DB row only | Native (Postgres / SQLite checkpointer) | Native | Optional |
| Long-term memory | None | LangMem (sep package) | Memory primitive | None native |
| Vector retrieval | None | Native via plug-in | Native | Plug-in |
| Subject scoping | implicit (`runs.subject`) | per-thread | per-thread | per-conversation |

This is the gap most likely to bite you within 60 days of production. The fix is a deliberate `memory` package with a small contract (`get`, `put`, `search`) and per-tenant backing, then plumbing it through `ctx`.

---

## 9. Event-driven workflow (Inngest)

### 9.1 One agent → one Inngest function

`register.ts:53-467` creates exactly one Inngest function per (tenant, agent), keyed `<tenantSlug>.<agentName>` (line 58). Triggers map 1:1 from `agent.trigger[]` (line 66-68). This is the canonical Inngest pattern.

**Strengths:**
- Concurrency key `event.data.subject` (line 76) keeps per-subject ordering automatic.
- 3 retries at the function level (line 78).
- Tenant namespacing via event prefix `${tenantSlug}/${eventName}` (line 67) — clean multi-tenancy.
- Memoized `init` step (line 93-140) prevents duplicate run rows on replay.

**Weaknesses:**

| # | Issue | File:line | Severity |
|---|---|---|---|
| 1 | Agents with empty `trigger[]` (e.g. `manualEntry` id "1-2") are silently not registered (`register.ts:62-64`). They can only be fired by external event posts. Behavior is correct but undocumented and there's no surface to tell operators "this agent exists but is dormant." | register.ts:62 | Low |
| 2 | Concurrency limit hardcoded `8` (register.ts:74). Not configurable per agent. | register.ts:74 | Med |
| 3 | Retries hardcoded `3`. Per-action retry hint in manifest is ignored. | register.ts:78 | Med |
| 4 | Only the **first** entry of `triggered_event[]` is emitted (`emittedName = agent.triggered_event[0]` at register.ts:368). Agents with multiple possible outcomes (e.g. `matchResume` emits one of 3 events based on outcome) **cannot select** which event to emit — they always emit the first. | register.ts:368 | **High** |
| 5 | No cancellation primitive. Inngest supports `step.invoke` cancellation; the runtime doesn't expose it. | register.ts | Low |
| 6 | Code agents are **not** registered as Inngest functions. `packages/agents/run-engine.ts` runs synchronously from a Fastify route. `agent.concurrency` and `agent.maxSteps` fields are dead code. The DESIGN.md §6 promised async invoke via Inngest; it's stubbed at `apps/api/src/routes/v1/agent-invoke.ts:77-86` (returns 501). | agents/bootstrap.ts | Med |

Issue #4 is **critical for RAAS**: `matchResume` (workflow_v1.json:454-502) has three downstream events (`MATCH_PASSED_NEED_INTERVIEW`, `MATCH_PASSED_NO_INTERVIEW`, `MATCH_FAILED`). The current code always emits the first. The graph is therefore wrong for any agent with branching outcomes. Fix: each step needs to *declare* which event it should emit, or `lastResult` needs an `__event` discriminator that the runtime reads.

### 9.2 Fan-out / fan-in

Fan-out is implicit: when an event is emitted, all listening agents fire in parallel (Inngest's default). No explicit "wait for N children" or "wait for all" primitive is exposed — would have to be modeled as multiple manual triggers, which doesn't compose cleanly. For RAAS this isn't hit (the graph is largely linear).

### 9.3 Replay, retry, dead-letter

- Replay: Inngest dev UI exposes per-function replay. No application-level replay surface exists (the design doc mentions `POST /api/runs/:id/replay`; not present).
- Retry: function-level only (3x).
- Dead-letter: Inngest's failed-after-retries state. No separate table. Operators inspect via the run row + log file.

### 9.4 Cancellation semantics

Not exposed. If a candidate is withdrawn mid-flow, there's no way to cancel in-flight runs for that subject. Standard Inngest pattern (`onCancel: {...}`) is not used.

### 9.5 Backpressure

Concurrency key limits per-subject concurrency. Per-tenant or per-agent global rate limits are not configured. A flood of events to one tenant can saturate the Inngest worker pool.

### 9.6 Cost / throughput at scale

- One Inngest function per agent × per tenant. RAAS has 23 agents; with N tenants, that's 23N functions. Inngest's pricing is per step run, so each manifest action ≈ one billable step. RAAS averages 2-3 actions per agent → ~50 steps per candidate through the pipeline. At 10k candidates/month: ~500k Inngest steps. Comfortable on most tiers.
- SQLite with WAL: comfortably handles thousands of writes/sec for runs+steps. The §15 design doc has a clean Postgres migration path; that's the right answer when you outgrow.

---

## 10. Run / event / task ledger

### 10.1 Table relationships

From the schema deltas in design doc §5 and what the code writes:

```
tenants ─< workflows ─< workflow_versions ─< agents ─< agent_versions
                                                ▲
                                                │
events ─< runs ─< steps                         │
   │       │                                    │
   │       └── agent_version_id ────────────────┘
   │       └── trigger_event_id (events.id)
   │       └── emitted_event_id (events.id)
   └── source_agent_id

runs ─< tasks (manual steps)
```

Per-row references:
- `runs.tenant_id`, `runs.agent_id`, `runs.agent_version_id`, `runs.trigger_event_id`, `runs.emitted_event_id`, `runs.correlation_id`, `runs.subject`.
- `steps.run_id`, `steps.ord`, plus the §5 deltas `provider`, `model`, `tokens_in`, `tokens_out`.
- `events.tenant_id`, `events.name`, `events.source_agent_id`, `events.subject`, `events.payload_ref`.
- `tasks.run_id`, `tasks.tenant_id`, `tasks.payload_json` and `resolution_json`.

This is a sound relational shape. The two pointer-into-file columns (`runs.log_path`, `events.payload_ref`) keep the row sizes small.

### 10.2 File-backed artifacts

| Path | Producer | Schema |
|---|---|---|
| `logs/<tenant>/runs/<YYYY-MM-DD>/<runId>.log` | `log-writer.ts:51-67` | Line-oriented `TS LEVEL EVENT key=val...` |
| `logs/<tenant>/events/<YYYY-MM-DD>.ndjson` | `event-ledger.ts:39-53` | NDJSON, byte-offset captured in DB |
| `artifacts/<runId>/step-N-{input,output}.json` | `run-engine.ts:46-52` (code path only) | JSON sidecar of messages + response |

### 10.3 Replay capability

- The log file lets a human reconstruct what happened.
- The artifact sidecars (input + output) for code agents enable deterministic replay of the LLM call.
- The manifest path **doesn't write artifacts** — only the run row + step row + ledger. To replay a manifest run, you'd need to reconstruct the prompt + tool calls from the manifest + event payload + step metadata. Doable but not built.

### 10.4 Audit trail completeness

- `audit_log` table is in the design but I see no audit row insertion in `run-engine.ts` or `register.ts`. Audit for "agent invoked" / "task resolved" / "deployment created" is partly covered by the inherent `runs` / `tasks` / `deployments` rows, but mutations like "operator approved task X" don't get a separate audit row.
- The design doc §11 promises `audit_log` rows for `action='llm.call'` with `{provider, model, status, tokens, latencyMs}`. The code does not write these.

### 10.5 Retention

`log-rotate.ts:18-94` gzips run-log + event-ledger files older than 7 days. The artifact directory has no rotation; it grows indefinitely. For a system that writes a few KB of artifacts per run × thousands of runs/day, this becomes a disk-management concern within weeks.

---

## 11. Code agents vs. manifest agents — unified mental model

### 11.1 When to use each

| Use case | Pick | Why |
|---|---|---|
| One-off, code-heavy, complex prompt assembly | **Code agent** | Type-safe `buildMessages`, easy IDE work, no manifest gymnastics |
| Event-driven, multi-step, manifest-style ETL | **Manifest agent** | Declarative, editable by non-engineers, one Inngest fn per agent |
| Human-in-the-loop pipeline | **Manifest agent** | Already wires `manual` steps with task gating |
| Standalone "ask a model and get an answer" | **Code agent** | The single-shot model matches |
| Chained workflow with branching outcomes | **Manifest agent** (but see §9.1 issue #4) | Only path with Inngest event chaining |

### 11.2 Coexistence today

Both agent kinds:
- Land rows in the same `agents` + `agent_versions` tables (kind discriminator added).
- Share `runs` + `steps` shape.
- Share the `LLMGateway` singleton.

Both paths are NOT unified at:
- The run engine (`packages/agents/run-engine.ts` vs. `packages/runtime/register.ts`).
- The model-on-run column (code path: `response.model`; manifest path: hardcoded `"mock-model-v1"` at register.ts:409). Manifest runs forever report mock-model regardless of which provider actually served.
- Artifact storage (code path writes; manifest path doesn't).
- Inngest registration (manifest yes, code no).

### 11.3 The `__system` tenant

Code agents live under the `__system` tenant (bootstrap.ts:29). This is:

- A clean way to separate "platform-provided" from "tenant-provided" agents in the DB.
- Used as the default tenant for unauthenticated invokes (agent-invoke.ts:91).
- Surfaced via `kind=code` filter in `GET /v1/agents`.

The only concern: per-tenant code agents — i.e. a custom code agent that should only run for tenant `raas` — have no clear home. Today they would have to be added to `__system` and gate themselves on `ctx.tenantSlug`, which is awkward.

### 11.4 Future: hot-loading `typescript_code`?

The presence of `typescript_code: ""` in 13 of 23 RAAS agents implies an intent to ship code alongside a manifest. **Hot-loading arbitrary TypeScript from a JSON field is not safe** — the same VM, no sandbox, full filesystem access. Two better paths:

1. **Documentation slot only.** Keep `typescript_code` as a comment/snippet shown in the UI, but the actual implementation lives in `tenants/<slug>/src/agents/<name>.ts` and is built into the tenant package. The manifest entry's mere presence of a non-empty `typescript_code` tells the runtime "look up this agent in the tenant code registry; if found, dispatch there instead of using the manifest's action list."

2. **Pre-compiled drop-in.** Operators upload a compiled JS bundle that the runtime registers as a code agent. This is essentially Mode 2 (CLI deploy) from the design doc. Still no sandbox.

Either way, **never** `eval()` or `new Function()` the field.

---

## 12. Tenant code surface

### 12.1 Convention

`tenants/<slug>/src/index.ts` exports default `TenantRegistry = { tools, prompts }` (`agent-kit/types.ts:92-95`). Auto-discovery is not actually auto — see §12.2. Filesystem convention:

```
tenants/raas/src/
├── index.ts          (registry export)
├── tools/<toolName>.ts
└── prompts/<promptName>.ts
```

`raas/src/index.ts:21-36` is a small wiring file; tools/prompts are defined per-file. Clean.

### 12.2 Discovery isn't auto

`runtime/bootstrap.ts:67` defines `TenantRegistries = Record<string, TenantRegistry | undefined>` and explicitly comments (lines 59-67):

> The runtime stays tenant-agnostic: it doesn't `import("@tenants/<slug>")` itself because that would force `@agentic/runtime` to depend on every tenant package. Instead `apps/api/src/bootstrap.ts` imports tenants it ships with and hands the registries in here.

So the api server has a hardcoded list of tenants to import. Adding a new tenant package requires:

1. Create `tenants/<slug>/`.
2. Wire into `pnpm-workspace.yaml`.
3. Import in `apps/api/src/bootstrap.ts`.
4. Pass through to `bootstrapAll({ <slug>: registry })`.

This is a reasonable v1 trade-off. Real auto-discovery would need either:
- Dynamic import via a manifest file like `tenants/<slug>/agentic.json` (declarative).
- A built artifact directory the runtime scans (more complex).

### 12.3 Cold reload

Adding/changing a tenant tool requires:
1. Edit + build (`pnpm build` in tenant pkg).
2. Restart the api process.
3. Bootstrap re-runs.

There's no in-process reload. For dev: tsx watch covers it. For prod: rolling restart. Acceptable for v1.

### 12.4 Sandboxing

**None.** Tenant code runs in the api process with full filesystem, network, env-var, and DB-handle access. A malicious or buggy tenant tool can:
- Read every other tenant's data via `getDb()`.
- Mutate the LLM gateway singleton.
- Exhaust memory/CPU and stall the worker.
- Exfiltrate env vars (including provider keys).

Comparable platforms (Cloudflare Workers AI, Modal, Inngest Cloud) sandbox tenant code in V8 isolates or separate processes. For a self-hosted single-tenant operator deployment this isn't urgent. For SaaS multi-tenancy, it's a hard requirement that's currently zero.

---

## 13. Failure modes & recovery

| Failure | Detection | Recovery | Gap |
|---|---|---|---|
| LLM timeout | `AbortSignal.timeout` (gateway.ts:148) → transient `LLMError` | Retry once, fall to next provider | Step still fails if all transients exhausted |
| Rate limit (429) | adapter normalizes to `rate_limit` | Same retry/failover | No queue + backoff at gateway level |
| Auth failure | `LLMError("auth")` | Terminal; no retry | Operator must rotate key |
| Bad request (400) | terminal | No retry | Right behavior |
| Model not found | `model_not_found` | Terminal | Right |
| Network error | `network` | Transient retry | Right |
| Tool handler throws | step.run catches → step row failed → throws | Inngest retries function 3x | After 3, run failed; no replay |
| Tenant tool returns ok:false | step row failed → throws | Same | No "retry only this step" |
| Bad manifest input | `WorkflowManifestSchema.parse` throws at bootstrap | Tenant rejected at boot | No partial-tenant boot |
| DB unavailable | Drizzle throws | Step.run wraps; Inngest retries | No DB health gate at boot |
| Inngest worker death | Inngest engine handles | Functions resume on replay | Run rows orphaned in "running" state until replay completes |
| LLM gateway init fails | `_setLLMGatewayForTests(null)` only handles tests | Process crash | No fallback to mock-only |
| Filesystem full (logs/artifacts) | `appendFile` throws | Bubbles up; step fails | Log writer should gracefully degrade |

The biggest gap is **orphaned `running` runs**: a run row inserted at start with no end timestamp will live forever if the worker dies between step.run init and finalize. A periodic sweep ("any run with `status='running'` and `started_at` < N hours ago → mark `failed` with reason `orphaned`") would fix it.

---

## 14. Eval & test harness

### 14.1 What exists

- 5 integration tests at `apps/api/test/tc-{1..5}-*.test.ts` (vitest), each described in `docs/test-cases/agent-system-tests.md`.
- The mock provider is deterministic and pattern-matches `"Agentic Operator"` for the `testAgent` happy path (`adapters/mock.ts:27-41`). This is a **smoke test**, not an eval.
- No fixture replay loop, no golden-output diffing, no LLM-as-judge.
- The DESIGN.md §16 mentions "replayable fixtures" as a future goal.

### 14.2 What's missing

- **Per-agent eval.** No way to say "run prompt X against fixture set Y with grader Z and report pass rate."
- **Regression eval pipeline.** No CI step that runs a known input set through `testAgent` (or RAAS agents) and asserts on output stability.
- **Manifest validation tests.** The Zod schema parses, but no test asserts that every RAAS agent has a non-empty action list, that all `trigger`/`triggered_event` events are defined in `events_v1.json`, or that no agent emits an event no one listens for.
- **LLM-output coverage.** No tracking of which `(agent, action, provider, model)` combos are exercised in tests.

### 14.3 Industry baseline

| Tool | What it provides | Agentic Operator equivalent |
|---|---|---|
| **LangSmith** | Trace logging, eval datasets, side-by-side prompt diffing | Partial: file logs + artifacts. No eval dataset. |
| **Patronus** | Hallucination + groundedness checks | None |
| **Inspect** (Anthropic) | Programmatic evaluation harness | None |
| **Vellum** | Prompt regression, multi-variant routing | None |
| **PromptLayer** | Prompt versioning, A/B routing | None |

**Recommendation (Medium effort):** add `evals/<agent>/cases.json` per agent (input + expected substring/JSON shape), a `pnpm eval` script that runs each case via `agent.run()` against the mock or a configured provider, and asserts. Wire into CI.

---

## 15. Top 10 architectural improvements

| # | Title | Why | Effort | Risk if not done |
|---|---|---|---|---|
| 1 | **Fix manifest schema drift** — add `input_data`, `ontology_instructions`, `tool_use`, `typescript_code` to `AgentSchema` (passthrough or explicit), persist in `agent_versions`, surface to step engine | Today these fields exist in JSON but never reach the runtime; 13/23 RAAS agents lose data on every boot. Without this, no real prompting work can happen. | **S** | **Critical.** Silent data loss on every deploy. Manifest authors think they're configuring; nothing happens. |
| 2 | **Implement event selection from step output** — let an action's `lastResult` declare which of `triggered_event[]` to emit (e.g. via `__event` discriminator or a per-action `emits` field) | `register.ts:368` always emits `triggered_event[0]`; agents like `matchResume` (3 outcomes) cannot branch. The RAAS graph is wrong by construction today. | **M** | **Critical.** Every branching agent in the manifest is broken; the workflow appears to run but routes wrong. |
| 3 | **Wire `ontology_instructions` and `lastResult` into the auto-built prompt** — and use `PromptDescriptor.system` when set | Auto-built `logic` prompts today are one-line stubs (step-engine.ts:178). Output quality from real providers will be poor regardless of model. | **S** | **High.** Production RAAS pipelines will produce hallucinations/garbage because the model has no context. |
| 4 | **Add tool-use loop** — extend `ChatMessage.content` to string-or-array, add `tools[]`/`tool_calls[]` to `ChatRequest`/`ChatResponse`, implement multi-turn in `run-engine.ts` bounded by `maxSteps` | The whole point of agents is tool use. The current stack cannot do it. | **L** | **High.** Without this, agents are constrained to single-shot completions; competitive parity is impossible. |
| 5 | **Replace hardcoded run-engine model `"mock-model-v1"` in register.ts:409 with the actual `response.model`** | Manifest runs always report mock-model regardless of provider. Observability broken. Tokens recorded but model column lies. | **XS** | **Med.** Cost attribution and audit are wrong. |
| 6 | **Evaluate `action.condition`** — minimal expression evaluator that reads `lastResult` + `event.data`. Or rename the field to documentation-only. | The field is parsed and looks load-bearing but is ignored (step-engine.ts/register.ts run every action). Manifest authors expect skip behavior they don't get. | **M** | **High.** Workflow runs do "extra" actions whose conditions are false. |
| 7 | **Add `outputSchema` to BaseAgent + JSON-mode + repair-retry loop** — schema flows into `gateway.chat({ jsonMode: true })`, then validate, then on parse-fail re-prompt with the schema error appended | Today, structured output relies on the agent's `parseOutput` reaching into raw text. Brittle. | **M** | **Med.** Every code agent that wants typed output rolls its own; correctness varies. |
| 8 | **Per-tenant BYOK** — `tenant_provider_keys` table, gateway resolves at chat time | Single global env-keys today. Cannot offer "bring your own key" to customers; cannot rotate per-customer. | **M** | **Med.** Blocks any multi-customer SaaS deploy. |
| 9 | **Eval harness** — `evals/<agent>/cases.json` + `pnpm eval` + CI gate | No regression detection on prompt edits. | **M** | **Med.** Prompts will silently regress; no one notices until users complain. |
| 10 | **Orphaned-run sweep + audit log writes** — periodic cron marks `running` runs older than N hours `failed: orphaned`; every `llm.call`, `task.resolved`, `deployment.live` writes an `audit_log` row | Current crash leaves rows in `running` forever; audit is partial. | **S** | **Low-Med.** Operability + compliance gaps. |

### Honorable mentions (not in top 10):
- Streaming responses (LL, blocks SSE on portal — but no current consumer).
- Sandbox tenant code (XL, needed only for multi-tenant SaaS).
- Vector memory + retrieval (L, needed only when subject context matters).
- Per-action `retries`/`timeout_s` honored (S, but small impact).

---

## 16. Open questions / decisions needed

1. **Is the runtime targeting one operator (self-host) or many (multi-tenant SaaS)?** If SaaS, items #8 + sandboxing become P0. If self-host single-org, both are deferrable.
2. **Is `typescript_code` intended for hot-loading, or a documentation slot?** The answer determines whether you build a sandbox or treat code agents and manifest agents as two registration paths that meet in the DB.
3. **Should code agents become Inngest functions too?** Currently they don't (the async path is stubbed at agent-invoke.ts:77-86 returning 501). Making them Inngest functions unifies retries/concurrency/replay across both kinds, but loses the simple sync request/response flow for the API. A middle ground: keep sync invocation but also register an Inngest fn `system.<agentName>` that calls `agent.run()` for async/scheduled use.
4. **What's the prompt-versioning story?** Three options: (a) ship prompts inside tenant code (current); (b) prompts as DB rows with version + env pinning; (c) hybrid — code defines the prompt, but a DB override can shadow. Decision affects the eval harness shape.
5. **Where does memory live?** A separate `memory` package vs. embedded in the agent context vs. tenant-implemented. Industry trend is `Mem0`-style external service with a thin contract. Pick now to avoid retrofitting.
6. **Cost ceilings — per-tenant, per-agent, or both?** Today no enforcement. The data is there (`tokens_in × inP + tokens_out × outP` per step); the policy primitive is not.
7. **Streaming SSE — first-class or deferred?** The existing `/v1/runs/:id/logs?follow=1` already streams logs; streaming model deltas to the same endpoint vs. a new endpoint is a small UX decision with downstream consequences.
8. **`actions_v1.json` integration.** That file ships rich per-action `inputs[]`/`outputs[]`/`rules[]`, but the runtime currently only stores it raw (`workflow_versions.actionsJson`). Should the step engine validate against it? Use it for input binding? Or is it documentation-only?
9. **Tenant slugs and the `__system` boundary** — what happens when a tenant *also* ships a code agent (not just tools)? The `__system` workflow gate (bootstrap.ts:69) suggests today there's only one "system" workflow. Multi-tenant code agents have no obvious home.
10. **Backfill plan for the schema-drift fix.** If field #1 lands, existing `agent_versions.manifest_json` rows on disk are missing the new keys (because they were stripped at parse). Re-bootstrap will fix manifest-defined fields, but tenant code that relied on the old behavior may break.

---

## Appendix A — file:line index

| Concern | Location |
|---|---|
| BaseAgent abstract class | `packages/agents/src/base-agent.ts:29-78` |
| BaseAgent run engine | `packages/agents/src/run-engine.ts:101-272` |
| Agent registry | `packages/agents/src/registry.ts:12-42` |
| Code-agent bootstrap | `packages/agents/src/bootstrap.ts:40-218` |
| Gateway host (DI) | `packages/agents/src/gateway-host.ts:14-29` |
| Tenant tool definer | `packages/agent-kit/src/define-tool.ts:36-46` |
| Tenant prompt definer | `packages/agent-kit/src/define-prompt.ts:36-48` |
| Manifest Zod schema | `packages/runtime/src/manifest.ts:13-44` |
| Schema drift (missing fields) | `packages/runtime/src/manifest.ts:28-37` |
| Step engine dispatch | `packages/runtime/src/step-engine.ts:158-209` |
| Logic auto-built prompt | `packages/runtime/src/step-engine.ts:178-179` |
| Tenant prompt validation gap | `packages/runtime/src/step-engine.ts:140` |
| Manifest agent registration | `packages/runtime/src/register.ts:53-467` |
| Concurrency + retries hardcoded | `packages/runtime/src/register.ts:74-78` |
| Triggered_event[0] always emitted | `packages/runtime/src/register.ts:368` |
| Hardcoded model `"mock-model-v1"` | `packages/runtime/src/register.ts:409` |
| Manual step + waitForEvent | `packages/runtime/src/register.ts:169-280` |
| LLMGateway class | `packages/llm-gateway/src/gateway.ts:24-131` |
| Provider chain resolution | `packages/llm-gateway/src/gateway.ts:126-130` |
| Failover/retry policy | `packages/llm-gateway/src/gateway.ts:98-115` |
| Error taxonomy | `packages/llm-gateway/src/errors.ts:9-85` |
| Provider registry | `packages/llm-gateway/src/providers/index.ts:26-45` |
| Anthropic adapter | `packages/llm-gateway/src/adapters/anthropic.ts:47-122` |
| OpenAI-compatible factory | `packages/llm-gateway/src/adapters/openai-compatible.ts:40-118` |
| Bedrock + Vertex stubs | `packages/llm-gateway/src/adapters/bedrock-stub.ts`, `vertex-stub.ts` |
| Secret redaction | `packages/llm-gateway/src/redact.ts:20-33` |
| Provider catalog (single source) | `packages/contracts/src/providers.ts:14-272` |
| API contracts (invoke) | `packages/contracts/src/llm.ts:34-58` |
| RAAS manifest sample (extra fields) | `models/RAAS-v1/workflow_v1.json:24-64` (id "1-1") |
| RAAS rich actions sample | `models/RAAS-v1/actions_v1.json:1-150` |
| Tenant code entry | `tenants/raas/src/index.ts:21-36` |
| Tenant tool example | `tenants/raas/src/tools/ping-probe.ts:16-35` |
| Auto-discovery (tenant registries) | `packages/runtime/src/bootstrap.ts:58-67, 366-396` |
| Correlation ID propagation | `packages/runtime/src/correlation.ts:9-23` |
| Log writer | `packages/runtime/src/log-writer.ts:51-67` |
| Event ledger writer | `packages/runtime/src/event-ledger.ts:39-53` |
| Log rotation | `packages/runtime/src/log-rotate.ts:18-94` |
| LLM gateway singleton | `apps/api/src/services/llm.ts:13-25` |
| Invoke route | `apps/api/src/routes/v1/agent-invoke.ts:34-117` |
| LLM introspection route | `apps/api/src/routes/v1/llm.ts:18-42` |
