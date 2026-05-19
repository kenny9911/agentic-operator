import { defaultModelFor } from "@agentic/contracts";
import type { ProviderAdapter } from "../types";
import type { AdapterEnvSlice } from "../config";
import { createOpenAICompatibleAdapter } from "../adapters/openai-compatible";

export function makeOpenRouter(env: AdapterEnvSlice): ProviderAdapter {
  const extraHeaders: Record<string, string> = {};
  if (env.OPENROUTER_REFERRER) extraHeaders["HTTP-Referer"] = env.OPENROUTER_REFERRER;
  if (env.OPENROUTER_APP_TITLE) extraHeaders["X-Title"] = env.OPENROUTER_APP_TITLE;

  return createOpenAICompatibleAdapter({
    id: "openrouter",
    name: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: env.OPENROUTER_API_KEY,
    extraHeaders,
    defaultModel: defaultModelFor("openrouter"),
  });
}
