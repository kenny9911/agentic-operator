/**
 * Mock provider — deterministic, no network, no keys required.
 *
 * Returns a synthetic response that echoes the prompt's key terms so tests
 * can assert on substring presence (e.g. "Agentic Operator" appearing in
 * testAgent's output).
 *
 * Always registered as `hasKey: true` so it can serve as the global default
 * when no real provider is configured.
 */

import type { ChatMessage, ChatRequest, ChatResponse, ProviderAdapter } from "../types";

const DEFAULT_MODEL = "mock-model-v1";

function lastUserContent(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return messages[i]!.content;
  }
  return messages[messages.length - 1]?.content ?? "";
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
    const text = compose(promptText, model);
    const tokensIn = req.messages.reduce((n, m) => n + approxTokens(m.content), 0);
    const tokensOut = approxTokens(text);
    return {
      text,
      provider: "mock",
      model,
      tokensIn,
      tokensOut,
      finishReason: "stop",
      latencyMs: Date.now() - start,
    };
  }
}
