import { defaultModelFor } from "@agentic/contracts";
import type { ProviderAdapter } from "../types";
import type { AdapterEnvSlice } from "../config";
import { createOpenAICompatibleAdapter } from "../adapters/openai-compatible";

export function makeOpenAI(env: AdapterEnvSlice): ProviderAdapter {
  return createOpenAICompatibleAdapter({
    id: "openai",
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    apiKey: env.OPENAI_API_KEY,
    defaultModel: defaultModelFor("openai"),
  });
}
