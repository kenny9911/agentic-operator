import { defaultModelFor } from "@agentic/contracts";
import type { ProviderAdapter } from "../types";
import type { AdapterEnvSlice } from "../config";
import { createOpenAICompatibleAdapter } from "../adapters/openai-compatible";

export function makeQwen(env: AdapterEnvSlice): ProviderAdapter {
  return createOpenAICompatibleAdapter({
    id: "qwen",
    name: "Qwen · DashScope",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: env.QWEN_API_KEY,
    defaultModel: defaultModelFor("qwen"),
  });
}
