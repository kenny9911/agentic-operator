/**
 * AWS Bedrock — stubbed in v1. AWS Sigv4 + per-region URL pattern + per-model
 * request shape (Anthropic, Llama, Titan all differ) make a real adapter a
 * dedicated piece of work. The stub keeps the provider registered so the
 * frontend shows it as a known option, but any call throws not_configured.
 */

import type { ProviderAdapter } from "../types";
import { LLMError } from "../errors";

export function createBedrockStub(): ProviderAdapter {
  return {
    id: "bedrock",
    name: "AWS Bedrock",
    hasKey: false,
    defaultModel: null,
    async chat() {
      throw new LLMError(
        "AWS Bedrock adapter is not implemented in v1 — configure AWS credentials and request implementation",
        "not_configured",
        "bedrock",
      );
    },
  };
}
