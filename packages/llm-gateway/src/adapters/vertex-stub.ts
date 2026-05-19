/**
 * Google Vertex AI — stubbed in v1. Vertex uses Google ADC + per-region URL
 * pattern; a real adapter requires google-auth-library wiring. The stub keeps
 * the provider visible in the catalog.
 */

import type { ProviderAdapter } from "../types";
import { LLMError } from "../errors";

export function createVertexStub(): ProviderAdapter {
  return {
    id: "vertex",
    name: "Google Vertex",
    hasKey: false,
    defaultModel: null,
    async chat() {
      throw new LLMError(
        "Google Vertex adapter is not implemented in v1 — configure Google ADC and request implementation",
        "not_configured",
        "vertex",
      );
    },
  };
}
