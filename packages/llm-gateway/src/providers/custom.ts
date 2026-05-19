/**
 * Custom OpenAI-compatible provider — base URL + API key from env. Operators
 * use this for self-hosted vLLM, llama.cpp servers, etc.
 */

import type { ProviderAdapter } from "../types";
import type { AdapterEnvSlice } from "../config";
import { createOpenAICompatibleAdapter } from "../adapters/openai-compatible";

export function makeCustom(env: AdapterEnvSlice): ProviderAdapter {
  const baseURL = env.CUSTOM_LLM_BASE_URL ?? "";
  // If no base URL is configured, the adapter will still be registered but
  // hasKey reports the absence; an actual call resolves to not_configured
  // via the inner adapter when the key is missing.
  const hasUrl = baseURL.length > 0;
  return createOpenAICompatibleAdapter({
    id: "custom",
    name: "Custom (OpenAI-compatible)",
    baseURL: hasUrl ? baseURL : "https://invalid.local",
    apiKey: hasUrl ? env.CUSTOM_LLM_API_KEY : undefined,
    defaultModel: null,
  });
}
