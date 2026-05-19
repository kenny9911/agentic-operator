import { defaultModelFor } from "@agentic/contracts";
import type { ProviderAdapter } from "../types";
import type { AdapterEnvSlice } from "../config";
import { createOpenAICompatibleAdapter } from "../adapters/openai-compatible";

export function makeGroq(env: AdapterEnvSlice): ProviderAdapter {
  return createOpenAICompatibleAdapter({
    id: "groq",
    name: "Groq",
    baseURL: "https://api.groq.com/openai/v1",
    apiKey: env.GROQ_API_KEY,
    defaultModel: defaultModelFor("groq"),
  });
}
