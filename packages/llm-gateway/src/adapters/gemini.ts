/**
 * Google Gemini adapter — uses @google/generative-ai. Key shape differences:
 *   - System messages map to `systemInstruction`.
 *   - User/assistant alternate; the SDK uses role "user" | "model".
 *   - Token counts come from response.usageMetadata.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  flattenContentToText,
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  type ProviderAdapter,
} from "../types";
import { LLMError, classifyHttpError } from "../errors";

const DEFAULT_MODEL = "gemini-2.5-flash";

export interface GeminiAdapterConfig {
  apiKey: string | undefined;
  defaultModel?: string;
}

function partitionForGemini(messages: ChatMessage[]): {
  systemInstruction: string | undefined;
  contents: { role: "user" | "model"; parts: { text: string }[] }[];
} {
  const systemParts: string[] = [];
  const contents: { role: "user" | "model"; parts: { text: string }[] }[] = [];
  for (const m of messages) {
    const flat = flattenContentToText(m.content);
    if (m.role === "system") {
      systemParts.push(flat);
    } else {
      contents.push({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: flat }],
      });
    }
  }
  return {
    systemInstruction: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    contents,
  };
}

function mapFinishReason(r: string | undefined): ChatResponse["finishReason"] {
  switch (r) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
    case "RECITATION":
      return "error";
    default:
      return r ? "unknown" : "stop";
  }
}

export function createGeminiAdapter(config: GeminiAdapterConfig): ProviderAdapter {
  const hasKey = Boolean(config.apiKey);
  const defaultModel = config.defaultModel ?? DEFAULT_MODEL;
  let client: GoogleGenerativeAI | null = null;

  function getClient(): GoogleGenerativeAI {
    if (!hasKey) {
      throw new LLMError("Google API key is not configured", "not_configured", "gemini");
    }
    if (!client) client = new GoogleGenerativeAI(config.apiKey!);
    return client;
  }

  return {
    id: "gemini",
    name: "Google Gemini",
    hasKey,
    defaultModel,

    async chat(req: ChatRequest): Promise<ChatResponse> {
      const start = Date.now();
      const c = getClient();
      const model = req.model ?? defaultModel;
      const { systemInstruction, contents } = partitionForGemini(req.messages);

      if (contents.length === 0) {
        throw new LLMError(
          "Gemini requires at least one user message",
          "bad_request",
          "gemini",
        );
      }

      try {
        const m = c.getGenerativeModel({
          model,
          systemInstruction,
          generationConfig: {
            temperature: req.temperature,
            maxOutputTokens: req.maxTokens,
            stopSequences: req.stop,
            responseMimeType: req.jsonMode ? "application/json" : undefined,
          },
        });
        const result = await m.generateContent({ contents });
        const response = result.response;
        const text = response.text();
        const usage = response.usageMetadata;
        const finishReason = response.candidates?.[0]?.finishReason as string | undefined;

        return {
          text,
          provider: "gemini",
          model,
          tokensIn: usage?.promptTokenCount ?? null,
          tokensOut: usage?.candidatesTokenCount ?? null,
          finishReason: mapFinishReason(finishReason),
          latencyMs: Date.now() - start,
          raw: response,
        };
      } catch (err) {
        throw normalizeGeminiError(err);
      }
    },
  };
}

function normalizeGeminiError(err: unknown): LLMError {
  if (err instanceof LLMError) return err;
  const anyErr = err as { status?: number; message?: string; name?: string };
  if (anyErr.name === "AbortError" || (anyErr.message ?? "").toLowerCase().includes("aborted")) {
    return new LLMError("Gemini request aborted/timeout", "timeout", "gemini", err);
  }
  if (anyErr.status !== undefined) {
    return classifyHttpError(anyErr.status, "gemini", anyErr.message ?? String(err), err);
  }
  const msg = (anyErr.message ?? "").toLowerCase();
  if (msg.includes("api key") || msg.includes("permission")) {
    return new LLMError(`Gemini auth: ${anyErr.message}`, "auth", "gemini", err);
  }
  return new LLMError(
    `Gemini error: ${anyErr.message ?? String(err)}`,
    "provider_error",
    "gemini",
    err,
  );
}
