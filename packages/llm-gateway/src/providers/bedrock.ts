import type { ProviderAdapter } from "../types";
import { createBedrockStub } from "../adapters/bedrock-stub";

export function makeBedrock(): ProviderAdapter {
  return createBedrockStub();
}
