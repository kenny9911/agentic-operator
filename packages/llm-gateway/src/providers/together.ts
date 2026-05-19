import { defaultModelFor } from "@agentic/contracts";
import type { ProviderAdapter } from "../types";
import type { AdapterEnvSlice } from "../config";
import { createOpenAICompatibleAdapter } from "../adapters/openai-compatible";

export function makeTogether(env: AdapterEnvSlice): ProviderAdapter {
  return createOpenAICompatibleAdapter({
    id: "together",
    name: "Together AI",
    baseURL: "https://api.together.xyz/v1",
    apiKey: env.TOGETHER_API_KEY,
    defaultModel: defaultModelFor("together"),
  });
}
