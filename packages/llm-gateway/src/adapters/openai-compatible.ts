/**
 * OpenAI-compatible adapter factory. Most providers expose a `/chat/completions`
 * endpoint with the OpenAI request/response shape; we use the `openai` SDK
 * with a custom baseURL to serve all of them through one implementation.
 *
 * Per-provider differences (extra headers, default models, model-prefix
 * conventions) are passed in as config from the provider wiring file.
 */

import OpenAI from "openai";
import type { ProviderId } from "@agentic/contracts";
import {
  flattenContentToText,
  type ChatRequest,
  type ChatResponse,
  type ProviderAdapter,
} from "../types";
import { LLMError, classifyHttpError } from "../errors";

export interface OpenAICompatibleConfig {
  id: ProviderId;
  name: string;
  baseURL: string;
  apiKey: string | undefined;
  /** Extra HTTP headers attached to every request (e.g. OpenRouter analytics). */
  extraHeaders?: Record<string, string>;
  /** Fallback model when caller omits one. */
  defaultModel: string | null;
}

/**
 * Project the gateway's wide ChatMessage shape onto OpenAI's narrower one.
 * Tool-role messages don't have a 1:1 mapping in the legacy completions API
 * — we collapse them to assistant-role text so the request stays well-formed
 * for providers that don't speak the tool-result protocol.
 */
function mapToOpenAIMessage(
  role: "system" | "user" | "assistant" | "tool",
  content: ChatRequest["messages"][number]["content"],
): { role: "system" | "user" | "assistant"; content: string } {
  const text = flattenContentToText(content);
  const projectedRole: "system" | "user" | "assistant" =
    role === "tool" ? "assistant" : role;
  return { role: projectedRole, content: text };
}

function mapFinishReason(reason: string | null | undefined): ChatResponse["finishReason"] {
  switch (reason) {
    case "stop":
    case "length":
    case "tool_calls":
      return reason;
    case null:
    case undefined:
      return "unknown";
    default:
      return "unknown";
  }
}

export function createOpenAICompatibleAdapter(
  config: OpenAICompatibleConfig,
): ProviderAdapter {
  const hasKey = Boolean(config.apiKey);
  // Lazy-init: only create the SDK client when first used so providers
  // without keys cost nothing.
  let client: OpenAI | null = null;

  function getClient(): OpenAI {
    if (!hasKey) {
      throw new LLMError(
        `${config.name} API key is not configured`,
        "not_configured",
        config.id,
      );
    }
    if (!client) {
      client = new OpenAI({
        apiKey: config.apiKey!,
        baseURL: config.baseURL,
        defaultHeaders: config.extraHeaders,
      });
    }
    return client;
  }

  return {
    id: config.id,
    name: config.name,
    hasKey,
    defaultModel: config.defaultModel,

    async chat(req: ChatRequest): Promise<ChatResponse> {
      const start = Date.now();
      const c = getClient();
      const model = req.model ?? config.defaultModel ?? null;
      if (!model) {
        throw new LLMError(
          `${config.name}: no model specified and no default configured`,
          "bad_request",
          config.id,
        );
      }

      try {
        const completion = await c.chat.completions.create(
          {
            model,
            messages: req.messages.map((m) => mapToOpenAIMessage(m.role, m.content)),
            temperature: req.temperature,
            max_tokens: req.maxTokens,
            stop: req.stop,
            ...(req.jsonMode ? { response_format: { type: "json_object" as const } } : {}),
          },
          {
            signal: req.signal,
          },
        );

        const choice = completion.choices[0];
        const text = choice?.message?.content ?? "";
        const usage = completion.usage;

        return {
          text,
          provider: config.id,
          model: completion.model ?? model,
          tokensIn: usage?.prompt_tokens ?? null,
          tokensOut: usage?.completion_tokens ?? null,
          finishReason: mapFinishReason(choice?.finish_reason),
          latencyMs: Date.now() - start,
          raw: completion,
        };
      } catch (err) {
        throw normalizeError(err, config.id, config.name);
      }
    },
  };
}

function normalizeError(err: unknown, provider: ProviderId, name: string): LLMError {
  if (err instanceof LLMError) return err;

  // openai SDK throws APIError subclasses with .status
  const anyErr = err as { status?: number; message?: string; name?: string };

  if (anyErr.name === "AbortError" || (anyErr.message ?? "").toLowerCase().includes("aborted")) {
    return new LLMError(`${name} request aborted/timeout`, "timeout", provider, err);
  }
  if (anyErr.status !== undefined) {
    return classifyHttpError(anyErr.status, provider, anyErr.message ?? String(err), err);
  }
  if ((anyErr.message ?? "").toLowerCase().includes("network") || (anyErr.message ?? "").toLowerCase().includes("fetch")) {
    return new LLMError(`${name} network error: ${anyErr.message}`, "network", provider, err);
  }
  return new LLMError(
    `${name} error: ${anyErr.message ?? String(err)}`,
    "provider_error",
    provider,
    err,
  );
}
