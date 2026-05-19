import type { ProviderAdapter } from "../types";
import { MockAdapter } from "../adapters/mock";

export function makeMock(): ProviderAdapter {
  return new MockAdapter();
}
