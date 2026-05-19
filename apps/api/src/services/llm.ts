/**
 * Singleton LLM gateway for the API process.
 *
 * Constructed lazily on first access from process.env. Each adapter
 * reads only what it needs (key presence + base URL); the gateway
 * itself stores no secrets beyond the adapter references.
 */

import { LLMGateway, registerAllProviders, resolveConfig } from "@agentic/llm-gateway";

let _gateway: LLMGateway | null = null;

export function getLLMGateway(): LLMGateway {
  if (_gateway) return _gateway;
  const { gateway: cfg, adapterEnv } = resolveConfig();
  const g = new LLMGateway(cfg);
  registerAllProviders(g, adapterEnv);
  _gateway = g;
  return g;
}

/** Test-only — replace the singleton with a custom instance. */
export function _setLLMGatewayForTests(g: LLMGateway | null): void {
  _gateway = g;
}
