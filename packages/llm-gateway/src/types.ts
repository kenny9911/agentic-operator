/**
 * Public types for the LLM gateway. Imported by adapters, the gateway class,
 * and any caller that wants to build a ChatRequest.
 *
 * Wire-format equivalents (Zod schemas) for these types live in
 * @agentic/contracts so the frontend can parse responses without depending
 * on this package.
 */

import type { ProviderId } from "@agentic/contracts";

export type { ProviderId };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  /** Conversation history. Must contain at least one user-role message. */
  messages: ChatMessage[];
  /** Provider-native model name. Falls back to gateway default. */
  model?: string;
  /** Single provider to use. Mutually exclusive with `providers` (the array wins). */
  provider?: ProviderId;
  /** Ordered fallback chain. Tries each until one returns or all fail with non-transient errors. */
  providers?: ProviderId[];
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  /** Default 60_000 ms. */
  timeoutMs?: number;
  /** Caller-controlled abort. Combined with timeoutMs via AbortSignal.any-like helper. */
  signal?: AbortSignal;
  /** Hint the model to return JSON. Each adapter maps this to its native flag. */
  jsonMode?: boolean;
}

export interface ChatResponse {
  text: string;
  provider: ProviderId;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  finishReason: "stop" | "length" | "tool_calls" | "error" | "unknown";
  latencyMs: number;
  /** Provider-specific extras (e.g. tool calls). Opaque in v1. */
  raw?: unknown;
}

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  hasKey: boolean;
  defaultModel: string | null;
  models: string[];
}

/**
 * Adapter contract. Each concrete provider (anthropic, openai, …) ships an
 * adapter that conforms to this. Adapters never see the env directly — they
 * receive a typed config at construction time.
 */
export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly name: string;
  readonly hasKey: boolean;
  readonly defaultModel: string | null;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

export interface GatewayConfig {
  defaultProvider: ProviderId;
  defaultModel: string | null;
  timeoutMs: number;
}
