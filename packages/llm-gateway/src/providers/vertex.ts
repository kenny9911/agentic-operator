import type { ProviderAdapter } from "../types";
import { createVertexStub } from "../adapters/vertex-stub";

export function makeVertex(): ProviderAdapter {
  return createVertexStub();
}
