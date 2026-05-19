import { defaultModelFor } from "@agentic/contracts";
import type { ProviderAdapter } from "../types";
import type { AdapterEnvSlice } from "../config";
import { createOpenAICompatibleAdapter } from "../adapters/openai-compatible";

export function makeMistral(env: AdapterEnvSlice): ProviderAdapter {
  return createOpenAICompatibleAdapter({
    id: "mistral",
    name: "Mistral",
    baseURL: "https://api.mistral.ai/v1",
    apiKey: env.MISTRAL_API_KEY,
    defaultModel: defaultModelFor("mistral"),
  });
}
