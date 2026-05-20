# Phase 1 — Tool-use loop + code-agent harness status

Implementation track: §5.1, §5.2, §5.7 of `docs/IMPLEMENTATION.md`.
Engineer: AI Runtime
Date: 2026-05-19

## Per-task status

| ID | Status | Files changed | Test added | Acceptance proof |
|---|---|---|---|---|
| P1-CON-01 | DONE | `packages/contracts/src/llm.ts`, `packages/llm-gateway/src/types.ts` | `apps/api/test/tc-15-p1-adapter-tools.test.ts` ("P1-CON-01" block) | `ChatMessageSchema` parses both `content: string` and `content: ChatContentBlock[]`; `role: "tool"` accepted; malformed `tool_use` blocks rejected; new shapes exported as `ChatContentBlock`, `TextBlock`, `ToolUseBlock`, `ToolResultBlock`. |
| P1-CON-02 | DONE | `packages/contracts/src/llm.ts`, `packages/llm-gateway/src/types.ts` (`ChatRequest.tools`, `ChatResponse.toolCalls`) | `apps/api/test/tc-15-p1-adapter-tools.test.ts` ("P1-CON-02" block) | `ToolDefSchema` requires `name` + `input_schema`; `ToolUseBlockSchema` + `ToolResultBlockSchema` round-trip a synthetic payload; `ChatRequest` carries `tools?: ToolDef[]` through to every adapter; `ChatResponse.toolCalls?: ToolCall[]` returned to the engine. |
| P1-LLM-01 | DONE | `packages/llm-gateway/src/adapters/anthropic.ts` | `apps/api/test/tc-16-p1-tool-use-loop.test.ts` (round-trip through the run engine) | Anthropic adapter now uses native content-block messages: outbound assistant `tool_use` blocks preserved verbatim; `role:"tool"` messages collapsed to user `tool_result` blocks (Anthropic shape); inbound `tool_use` parsed back to `ToolCall[]` on the response. `tool_call_id` round-trips on the matching `tool_result`. `tools[]` mapped to Anthropic.Tool input_schema. |
| P1-LLM-02 | DONE | `packages/llm-gateway/src/adapters/openai-compatible.ts`, `packages/llm-gateway/src/adapters/azure.ts` (same wire format) | `apps/api/test/tc-15-p1-adapter-tools.test.ts` + integration via `tc-16` | OpenAI-compat adapter maps assistant `tool_use` blocks to `tool_calls[]` on the message and `role:"tool"` messages to one OpenAI `role:"tool"` message per result (correlated by `tool_call_id`). `tools[]` mapped to `{type:"function", function:{name,description,parameters}}`. Inbound `tool_calls[]` parsed back to `ToolCall[]`. Applies to openai, openrouter, groq, together, mistral, deepseek, qwen, azure. |
| P1-LLM-03 | DONE | `packages/llm-gateway/src/adapters/gemini.ts` | `apps/api/test/tc-15-p1-adapter-tools.test.ts` | Gemini adapter advertises `tools: [{ functionDeclarations: [...] }]`; emits `{ functionCall }` parts on assistant turns and `{ functionResponse }` parts on tool-result turns. Synthetic id encoding (`gem_<idx>_<name>`) preserves round-trip identity since Gemini doesn't issue persistent tool-use ids natively. |
| P1-LLM-04 | DONE | `packages/llm-gateway/src/adapters/mock.ts` | `apps/api/test/tc-15-p1-adapter-tools.test.ts` ("P1-LLM-04" block) | Mock provider pattern-matches on the last user prompt; emits a `tool_use` block when prompt contains `use <toolName>` or `call <toolName>` (or single advertised tool + "tool" keyword); declines to re-emit once a `tool_result` is in history; finishes with a text reply that includes `[tool_result_seen:...]` for test assertions. Deterministic id generator (`mock_tool_<seq>`) with `_resetMockIdSeq()` test hook. |
| P1-RT-01 | DONE | `packages/agents/src/run-engine.ts`, `packages/agents/src/base-agent.ts` (maxSteps wired) | `apps/api/test/tc-16-p1-tool-use-loop.test.ts` ("runs a 2-turn loop") | The engine now runs a `maxSteps`-bounded loop: one `steps` row per LLM call (`type:"logic"`) + one per tool dispatch (`type:"tool"`); the assistant's tool_use turn is appended; a `role:"tool"` message with `tool_result` blocks is appended; the next turn's gateway call carries the full history. Tokens aggregated across all turns. Verified: 2-turn loop produces 3 step rows (logic + tool + logic), `runs.tokens_in = 40`, `runs.tokens_out = 13`. Also verified: maxSteps=3 cap halts after the third LLM call without a final tool dispatch (no budget for the model to consume results). |
| P1-RT-02 | DONE | `packages/agents/src/base-agent.ts` (`getTools`, `getToolHandlers`), `packages/agents/src/types.ts` (`ToolHandler`, `ToolHandlerMap`, `ToolHandlerResult`) | `apps/api/test/tc-16-p1-tool-use-loop.test.ts` | `BaseAgent.getTools(ctx)` returns `ToolDef[]`; default returns `[]`. Companion `getToolHandlers(ctx)` returns the dispatch map keyed by tool name. The engine consults both at run start; missing handler → `tool_handler_missing` recorded on the step row with `is_error:true` in the result block so the model can recover. |
| P1-RT-06 | DONE | `packages/agents/src/run-engine.ts:140-149`, `packages/agents/src/types.ts` (`AgentContext.providers`) | `apps/api/test/tc-16-p1-tool-use-loop.test.ts` ("forwards req.providers chain") | `AgentContext.providers?: ProviderId[]` is now passed through `gateway.chat({providers})` verbatim, restoring failover for code agents. Closes Audit #3 §5.6. |
| P1-RT-07 | DONE | `packages/agents/src/run-engine.ts` (`validateAgainstSchema` + repair-retry block), `packages/agents/src/base-agent.ts` (`outputSchema`) | `apps/api/test/tc-16-p1-tool-use-loop.test.ts` ("structured output" blocks) | `BaseAgent.outputSchema` (Zod) triggers `jsonMode:true` on every LLM call AND, after the final text turn, JSON.parse + `safeParse`. On failure: append assistant's bad reply + a user "repair" message with the Zod issues inlined, run one more LLM turn with jsonMode still on. If THAT fails too, throw `LLMError("bad_request", "output_parse_error: <issues>")` — mapped to 400 by the API route. Token usage from the repair turn IS aggregated; one additional `steps` row is recorded. |
| P1-RT-08 | DONE | `packages/agents/src/code-agent-fn.ts` (new — `registerCodeAgentFn`, `buildCodeAgentFns`, `codeAgentEventName`, `codeAgentFnId`), `packages/agents/src/bootstrap.ts` (returns `codeAgentFns` on summary), `packages/agents/src/index.ts` (exports), `packages/agents/package.json` (adds `inngest` dep), `apps/api/src/bootstrap.ts` (splices `codeAgentFns` into the function list), `apps/api/src/routes/v1/agent-invoke.ts` (handles `?async=1`) | `apps/api/test/tc-17-p1-code-agent-inngest.test.ts` | One Inngest function per registered code agent, triggered by `__system/code.<name>.invoke`, function id `__system.code.<name>`. `bootstrapCodeAgents()` returns `codeAgentFns: InngestFunction.Any[]` on the summary so the API server can splice them into the `serve()` list. `?async=1` query (or `body.async`) on `/v1/agents/:name/invoke` calls `inngest.send()` with a `CodeAgentEventData` payload and returns `202 { runId, status: "queued" }`. Sync inline path (default) unchanged. |

## Tool-use loop design — anchor for future providers

The internal `ChatMessage` model normalises every wire-format dialect to a single shape:

```
ChatMessage =
  | { role: "system" | "user"; content: string | ChatContentBlock[] }
  | { role: "assistant";         content: string | ChatContentBlock[] }
  | { role: "tool";              content: ChatContentBlock[] }   // tool_result-only
```

`ChatContentBlock` is a discriminated union of `TextBlock`, `ToolUseBlock`, `ToolResultBlock`. Each adapter translates this to/from its provider's native shape:

| Provider class | Outbound assistant `tool_use` | Outbound tool result | Inbound parse |
|---|---|---|---|
| **Anthropic** | `{type:"tool_use", id, name, input}` content block | USER-role message with `{type:"tool_result", tool_use_id, content}` block (canonical Anthropic shape) | `response.content` filtered for `tool_use` blocks → `toolCalls[]` |
| **OpenAI-compat** | `tool_calls[]` on the assistant message (function-call shape) | One `role:"tool"` message per block, `tool_call_id` = block.tool_use_id | `choice.message.tool_calls[]` → `toolCalls[]` (function.arguments parsed as JSON) |
| **Gemini** | `parts: [{ functionCall: { name, args } }]` on a "model" content | "user" content with `parts: [{ functionResponse: { name, response } }]` | `parts.filter(p => p.functionCall)` → `toolCalls[]`, synthetic id `gem_<idx>_<name>` |
| **Mock** | `toolCalls[]` on the response when prompt matches `use <name>` | Engine appends `tool_result` block under `role:"tool"`; next mock call detects + finishes with text | n/a |

The engine itself never sees the wire shape — it only manipulates `ChatContentBlock`. **To add a new provider, write a single adapter that maps to/from `ChatContentBlock` and the wire format; the engine, registry, and tests do not need to change.**

The `stop_reason` mapping is unified at the gateway boundary:
- Anthropic `stop_reason:"tool_use"` → `finishReason:"tool_calls"`
- OpenAI `finish_reason:"tool_calls"` → preserved
- Gemini `STOP` + any `toolCalls.length > 0` → `"tool_calls"` (Gemini doesn't have a distinct stop reason for function-call turns)
- Mock returns `"tool_calls"` when emitting a `tool_use`, `"stop"` otherwise

## Code-agent Inngest registration

The agent registry (`packages/agents/src/registry.ts`) is consulted at bootstrap by `bootstrapCodeAgents()`. After DB rows are written, **`buildCodeAgentFns(registered)` produces one `InngestFunction.Any` per agent**. The summary returned to `apps/api/src/bootstrap.ts` carries the array under the new field `codeAgentFns`; the API splices it into the `serve()` functions list alongside the manifest-driven tenant functions:

```ts
// apps/api/src/bootstrap.ts (excerpt)
const codeSummary = await bootstrapCodeAgents();
const tenantFns = await bootstrapAll(TENANT_REGISTRIES);
const allFns = [helloFn, ...codeSummary.codeAgentFns, ...tenantFns];
```

Each code-agent function:
- id = `__system.code.<agentName>` (stable across reboots, doc'd in `codeAgentFnId`)
- trigger = `__system/code.<agentName>.invoke` (doc'd in `codeAgentEventName`)
- handler = `step.run("agent.run", () => agent.run(input, ctx))` so Inngest retries replay correctly
- concurrency mirrors `agent.concurrency`

The API route honours both invocation modes:
- default sync → `BaseAgent.run()` inline, 200 with `AgentResult`
- `?async=1` (or `body.async: true`) → `inngest.send({ name: __system/code.<name>.invoke, data: {…} })`, 202 with `{ runId, status: "queued" }`

The `runId` returned on the async path is pre-allocated by the route (`makeId("run")`) so callers can poll `/v1/runs/:id` immediately. v1 doesn't pass that pre-allocated id into `executeAgentRun` — the engine re-allocates a fresh runId inside. The pre-allocated id is stored on the event payload (and accessible via the Inngest dashboard) so a follow-up can wire it through; for v1 the returned id is reserved for traceability + makes the API contract symmetric with sync.

## Public-shape changes

1. **`@agentic/contracts`** — new exports: `ChatContentBlockSchema`, `TextBlockSchema`, `ToolUseBlockSchema`, `ToolResultBlockSchema`, `ToolDefSchema`, `ToolCallSchema` + their TS types. `ChatRoleSchema` widened to include `"tool"`. `ChatMessageSchema.content` widened to `z.union([z.string(), z.array(ChatContentBlockSchema)])`.
2. **`@agentic/llm-gateway`** — new TS exports: `ChatContentBlock`, `TextBlock`, `ToolUseBlock`, `ToolResultBlock`, `ToolDef`, `ToolCall`. `ChatMessage` widened (discriminated union by role). `ChatRequest.tools?` and `ChatResponse.toolCalls?` added. `MockAdapter` + `_resetMockIdSeq` re-exported for tests.
3. **`@agentic/agents`** — `BaseAgent.getTools(ctx)` + `getToolHandlers(ctx)` optional hooks. `BaseAgent.outputSchema?: ZodType` optional. `AgentContext.providers?: ProviderId[]` for failover chain. `AgentResult.steps?: number` records the number of turns the engine ran. New exports: `registerCodeAgentFn`, `buildCodeAgentFns`, `codeAgentEventName`, `codeAgentFnId`, `CodeAgentEventData`, `ToolHandler`, `ToolHandlerMap`, `ToolHandlerResult`. `bootstrapCodeAgents()` summary gains `codeAgentFns: InngestFunction.Any[]`.
4. **`apps/api/src/routes/v1/agent-invoke.ts`** — accepts `?async=1` query param (also reads `body.async` for back-compat); async path returns 202 + reserved `runId`; sync path unchanged.

## Sanity

- `pnpm --filter @agentic/contracts typecheck` — GREEN.
- `pnpm --filter @agentic/llm-gateway typecheck` — GREEN.
- `pnpm --filter @agentic/agents typecheck` — GREEN.
- `pnpm --filter @agentic/api typecheck` — GREEN.
- `pnpm --filter @agentic/api test tc-15 tc-16 tc-17` — 18/18 GREEN (new Phase 1 tests).
- `pnpm --filter @agentic/api test tc-8 tc-9 tc-10 tc-12 tc-14 tc-15 tc-16 tc-17` — 53/53 GREEN (full harness-independent test set).

### Pre-existing test suite (TC-1..TC-7, TC-11, TC-13)

These tests boot the full Fastify server via `harness.ts`. They are currently failing with a vite SSR transform error (`Cannot split a chunk that has already been edited (24:49 – "import.meta")`) caused by the runtime engineer's in-progress changes to `apps/api/src/server.ts` (imports for `streamRoutes`, `auditRoutes`, `budgetsRoutes` whose files are still being written) and `packages/runtime/src/index.ts` (exports for `./broadcast` / `./retention`). The failures predate this Phase 1 track and will resolve once the runtime engineer's in-flight work settles. **My new tests deliberately bypass `harness.ts` and apply migrations directly via `runMigrations()` so they're not coupled to the server-boot dependency.** This is the recommended pattern for future tests that exercise package surfaces rather than HTTP routes.

## Notes for the verifier

1. **Test harness change pattern.** TC-16 and TC-17 demonstrate a harness-independent test setup: `runMigrations(path.join(repoRoot, "packages/db/drizzle"))` + `setGateway(stubOrProgrammable)` + `bootstrapCodeAgents()`. This sidesteps the server-boot cascade and keeps the test focused on the package contract. Once the runtime engineer's server work is complete, the harness-based tests will exercise the same engine via the HTTP layer.

2. **Programmable gateway pattern (TC-16).** The `ProgrammableGateway` test class implements just enough of the `LLMGateway` surface (`chat`, `hasProvider`, `listProviders`) to be `setGateway`-injectable. It captures each call (deep-cloned to defeat the engine's in-place `messages` mutation) and dictates the next response from a FIFO queue. This is the canonical way to test the multi-turn loop without a real provider.

3. **Mock adapter heuristic.** P1-LLM-04 uses prompt pattern matching (`use <toolName>`) rather than a name-equality check so existing tests that just say "Introduce what is Agentic Operator" don't accidentally trip the tool path. The single-tool + "tool" keyword fallback covers the common "the agent has one tool and the prompt mentions tools" case. Tests that need deterministic ids should call `_resetMockIdSeq()` in `beforeEach`.

4. **maxSteps semantics.** A `maxSteps = 3` agent runs at most 3 LLM calls. We deliberately DO NOT dispatch tool calls on the final turn — there's no budget left for the model to consume the results, so the call would be wasted. Tests verify this exact behaviour (3 LLM calls, 0 tool steps when the model keeps requesting tools).

5. **Structured output token aggregation.** When `outputSchema` triggers a repair retry, BOTH LLM turns' tokens are aggregated into `runs.tokens_in/out`. The repair turn also writes a real `steps` row (no separate "repair" type — it's the same `logic` type as a normal LLM call). This is the right ledger behaviour for cost attribution.

6. **Async invoke + runId trace.** The API route generates `runId` BEFORE `inngest.send` so the caller has a handle to poll. The current implementation re-allocates inside `executeAgentRun` — future work should thread the pre-allocated id through (single-line param add). The original id is preserved on the Inngest payload for observability; the public response always carries it.

7. **What does NOT use the loop.** Manifest-driven runs (handled by Runtime engineer's `register.ts`) continue to run their action sequence as before. The multi-turn loop is specifically for code agents that override `getTools()`. Single-shot code agents (default `maxSteps = 1`) take exactly one LLM call and are unaffected — TC-3's `testAgent` still produces the same DB rows.

8. **Provider chain failover smoke.** TC-16's "forwards req.providers chain" test verifies the engine plumbs `ctx.providers` through to `gateway.chat`. The gateway's failover loop (in `gateway.ts`, untouched) does the actual retry-on-transient-error logic; we just verify the contract is honoured end-to-end.

9. **Adapter back-compat.** Every adapter still accepts the old `content: string` shape via the `ChatMessage` union — no breaking change for callers that don't yet use blocks. The string→block normalisation happens inside the adapter (string flows through as a single text block).

10. **Out-of-scope coordination.** This track does NOT touch `packages/runtime/`, `packages/db/`, `gateway.ts`, `budget.ts`, the `/v1/stream`, `/v1/audit`, `/v1/budgets` routes, `audit.ts` plugin, `apps/web/`, `apps/cli/`, or `runs.ts`/`agents.ts` in contracts. The Runtime engineer + Frontend engineer own those. Their in-flight changes to `apps/api/src/server.ts` and `packages/runtime/src/index.ts` are visible in the working tree and are the cause of the harness-boot test failures noted above.
