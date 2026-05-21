/**
 * Mock provider — deterministic, no network, no keys required.
 *
 * Returns a synthetic response that echoes the prompt's key terms so tests
 * can assert on substring presence (e.g. "Agentic Operator" appearing in
 * testAgent's output).
 *
 * Always registered as `hasKey: true` so it can serve as the global default
 * when no real provider is configured.
 *
 * P1-LLM-04 — the mock also simulates tool-use loops. When advertising
 * `tools` and the user prompt mentions a tool name, the mock emits a
 * deterministic `tool_use` block with id `mock_tool_<n>`. After the caller
 * sends back a `tool_result` block on the conversation, the mock finishes
 * with plain text containing the sentinel `tool_result_seen` so callers
 * can assert that the loop closed.
 */

import {
  flattenContentToText,
  type ChatContentBlock,
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  type ProviderAdapter,
  type ToolCall,
} from "../types";

const DEFAULT_MODEL = "mock-model-v1";

// Stable id counter, reset between tests via `_resetMockIdSeq()`.
let _mockIdSeq = 0;

function nextToolId(): string {
  _mockIdSeq += 1;
  return `mock_tool_${_mockIdSeq}`;
}

/**
 * Reset the mock's deterministic id counter. Tests call this in `beforeEach`
 * so assertions on `mock_tool_1` etc. line up regardless of test ordering.
 */
export function _resetMockIdSeq(): void {
  _mockIdSeq = 0;
}

function contentToString(content: string | ChatContentBlock[]): string {
  return flattenContentToText(content);
}

function lastUserContent(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return contentToString(messages[i]!.content);
  }
  const last = messages[messages.length - 1];
  return last ? contentToString(last.content) : "";
}

function hasToolResult(messages: ChatMessage[]): boolean {
  for (const m of messages) {
    if (m.role === "tool" && Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b.type === "tool_result") return true;
      }
    }
  }
  return false;
}

function approxTokens(text: string): number {
  return Math.max(8, Math.ceil(text.length / 4));
}

function compose(userPrompt: string, model: string): string {
  const lower = userPrompt.toLowerCase();
  if (lower.includes("agentic operator")) {
    return [
      "Agentic Operator is an event-driven operating system for autonomous agents.",
      "It orchestrates declarative workflows of LLM-powered agents and human-in-the-loop tasks, ",
      "tracking every run, step, and emitted event with full audit trail and live log streaming. ",
      "The platform separates UI (Next.js) from runtime (Fastify + Inngest), uses SQLite for ",
      `state, and ships a multi-provider LLM gateway. (mock response from ${model})`,
    ].join("");
  }
  return `Mock response from ${model}: received ${userPrompt.slice(0, 80)}${
    userPrompt.length > 80 ? "…" : ""
  }`;
}

/**
 * Decide whether the mock should emit a tool_use this turn. The simulation
 * is intentionally simple: if the caller advertised tools AND the user
 * prompt mentions one of their names (case-insensitive), pick that tool.
 * Else fall back to plain text. Once a tool_result block appears anywhere
 * in the conversation, the loop is considered closed and the mock returns
 * plain text containing `tool_result_seen`.
 */
function pickTool(
  prompt: string,
  tools: ChatRequest["tools"] | undefined,
): { tool: NonNullable<ChatRequest["tools"]>[number]; promptHint: string } | null {
  if (!tools || tools.length === 0) return null;
  const lower = prompt.toLowerCase();
  for (const t of tools) {
    if (lower.includes(t.name.toLowerCase())) {
      return { tool: t, promptHint: prompt };
    }
  }
  return null;
}

export class MockAdapter implements ProviderAdapter {
  readonly id = "mock" as const;
  readonly name = "Mock (local)";
  readonly hasKey = true;
  readonly defaultModel = DEFAULT_MODEL;

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const start = Date.now();
    // Tiny simulated latency so durations are non-zero.
    await new Promise((r) => setTimeout(r, 8));
    const promptText = lastUserContent(req.messages);
    const model = req.model ?? DEFAULT_MODEL;
    const tokensIn = req.messages.reduce(
      (n, m) => n + approxTokens(contentToString(m.content)),
      0,
    );

    // If a tool_result has been appended, close the loop with plain text.
    if (hasToolResult(req.messages)) {
      const text = `tool_result_seen — mock acknowledges tool output. (model=${model})`;
      return {
        text,
        provider: "mock",
        model,
        tokensIn,
        tokensOut: approxTokens(text),
        finishReason: "stop",
        latencyMs: Date.now() - start,
      };
    }

    // If the agent advertised tools and the prompt mentions one, emit
    // a deterministic tool_use block.
    const tool = pickTool(promptText, req.tools);
    if (tool) {
      const id = nextToolId();
      const toolCall: ToolCall = {
        id,
        name: tool.tool.name,
        input: { prompt: tool.promptHint },
      };
      return {
        text: "",
        provider: "mock",
        model,
        tokensIn,
        tokensOut: approxTokens(""),
        finishReason: "tool_calls",
        latencyMs: Date.now() - start,
        toolCalls: [toolCall],
      };
    }

    const text = compose(promptText, model);
    return {
      text,
      provider: "mock",
      model,
      tokensIn,
      tokensOut: approxTokens(text),
      finishReason: "stop",
      latencyMs: Date.now() - start,
    };
  }
}
