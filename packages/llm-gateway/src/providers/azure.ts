import type { ProviderAdapter } from "../types";
import type { AdapterEnvSlice } from "../config";
import { createAzureAdapter } from "../adapters/azure";

export function makeAzure(env: AdapterEnvSlice): ProviderAdapter {
  return createAzureAdapter({
    apiKey: env.AZURE_OPENAI_API_KEY,
    endpoint: env.AZURE_OPENAI_ENDPOINT,
    apiVersion: env.AZURE_OPENAI_API_VERSION,
    defaultDeployment: env.AZURE_OPENAI_DEPLOYMENT,
  });
}
