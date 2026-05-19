import { defaultModelFor } from "@agentic/contracts";
import type { ProviderAdapter } from "../types";
import type { AdapterEnvSlice } from "../config";
import { createGeminiAdapter } from "../adapters/gemini";

export function makeGemini(env: AdapterEnvSlice): ProviderAdapter {
  return createGeminiAdapter({
    apiKey: env.GOOGLE_API_KEY,
    defaultModel: defaultModelFor("gemini") ?? undefined,
  });
}
