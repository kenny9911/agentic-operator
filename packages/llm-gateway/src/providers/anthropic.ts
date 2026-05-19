import { defaultModelFor } from "@agentic/contracts";
import type { ProviderAdapter } from "../types";
import type { AdapterEnvSlice } from "../config";
import { createAnthropicAdapter } from "../adapters/anthropic";

export function makeAnthropic(env: AdapterEnvSlice): ProviderAdapter {
  return createAnthropicAdapter({
    apiKey: env.ANTHROPIC_API_KEY,
    defaultModel: defaultModelFor("anthropic") ?? undefined,
  });
}
