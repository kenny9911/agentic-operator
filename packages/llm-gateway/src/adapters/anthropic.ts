/**
 * Anthropic adapter — uses the official @anthropic-ai/sdk. Notable contract
 * differences vs OpenAI:
 *   - System message is a top-level `system` param, not a role.
 *   - User/assistant must alternate; the SDK rejects malformed sequences.
 *   - finish_reason maps to `stop_reason`: "end_turn" | "max_tokens" | "tool_use" | "stop_sequence".
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, ChatRequest, ChatResponse, ProviderAdapter } from "../types";
import { LLMError, classifyHttpError } from "../errors";

const DEFAULT_MODEL = "claude-haiku-4-5";

export interface AnthropicAdapterConfig {
  apiKey: string | undefined;
  defaultModel?: string;
}

function partitionSystem(messages: ChatMessage[]): { system: string | undefined; rest: ChatMessage[] } {
  const systemParts: string[] = [];
  const rest: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") systemParts.push(m.content);
    else rest.push(m);
  }
  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    rest,
  };
}

function mapStopReason(r: string | null | undefined): ChatResponse["finishReason"] {
  switch (r) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    default:
      return "unknown";
  }
}

export function createAnthropicAdapter(config: AnthropicAdapterConfig): ProviderAdapter {
  const hasKey = Boolean(config.apiKey);
  const defaultModel = config.defaultModel ?? DEFAULT_MODEL;
  let client: Anthropic | null = null;

  function getClient(): Anthropic {
    if (!hasKey) {
      throw new LLMError(
        "Anthropic API key is not configured",
        "not_configured",
        "anthropic",
      );
    }
    if (!client) client = new Anthropic({ apiKey: config.apiKey! });
    return client;
  }

  return {
    id: "anthropic",
    name: "Anthropic",
    hasKey,
    defaultModel,

    async chat(req: ChatRequest): Promise<ChatResponse> {
      const start = Date.now();
      const c = getClient();
      const model = req.model ?? defaultModel;
      const { system, rest } = partitionSystem(req.messages);

      if (rest.length === 0) {
        throw new LLMError(
          "Anthropic requires at least one user message",
          "bad_request",
          "anthropic",
        );
      }

      try {
        const response = await c.messages.create(
          {
            model,
            max_tokens: req.maxTokens ?? 1024,
            temperature: req.temperature,
            stop_sequences: req.stop,
            system,
            messages: rest.map((m) => ({
              role: m.role === "assistant" ? "assistant" : "user",
              content: m.content,
            })),
          },
          {
            signal: req.signal,
          },
        );

        const textBlocks = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text);
        const text = textBlocks.join("");

        return {
          text,
          provider: "anthropic",
          model: response.model,
          tokensIn: response.usage.input_tokens,
          tokensOut: response.usage.output_tokens,
          finishReason: mapStopReason(response.stop_reason),
          latencyMs: Date.now() - start,
          raw: response,
        };
      } catch (err) {
        throw normalizeAnthropicError(err);
      }
    },
  };
}

function normalizeAnthropicError(err: unknown): LLMError {
  if (err instanceof LLMError) return err;
  const anyErr = err as { status?: number; message?: string; name?: string };
  if (anyErr.name === "AbortError" || (anyErr.message ?? "").toLowerCase().includes("aborted")) {
    return new LLMError("Anthropic request aborted/timeout", "timeout", "anthropic", err);
  }
  if (anyErr.status !== undefined) {
    return classifyHttpError(anyErr.status, "anthropic", anyErr.message ?? String(err), err);
  }
  return new LLMError(
    `Anthropic error: ${anyErr.message ?? String(err)}`,
    "provider_error",
    "anthropic",
    err,
  );
}
