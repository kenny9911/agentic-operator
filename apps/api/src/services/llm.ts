/**
 * Singleton LLM gateway for the API process.
 *
 * Constructed lazily on first access from `process.env` overlaid with the
 * provider-key vault (so keys saved via the Settings UI take effect without
 * editing `.env`). `resetLLMGateway()` drops the singleton so the next call
 * picks up vault changes — invoked after POST /v1/llm/providers/:id/key.
 */

import { LLMGateway, registerAllProviders, resolveConfig } from "@agentic/llm-gateway";
import { getProviderKeyEnvOverlay } from "./provider-keys";

let _gateway: LLMGateway | null = null;

function buildEnv(): Record<string, string | undefined> {
  return { ...process.env, ...getProviderKeyEnvOverlay() };
}

export function getLLMGateway(): LLMGateway {
  if (_gateway) return _gateway;
  const { gateway: cfg, adapterEnv } = resolveConfig(buildEnv());
  const g = new LLMGateway(cfg);
  registerAllProviders(g, adapterEnv);
  _gateway = g;
  return g;
}

/**
 * Drop the cached gateway so the next `getLLMGateway()` call rebuilds with
 * the current vault contents. Called after a provider key is saved/rotated.
 */
export function resetLLMGateway(): void {
  _gateway = null;
}

/** Test-only — replace the singleton with a custom instance. */
export function _setLLMGatewayForTests(g: LLMGateway | null): void {
  _gateway = g;
}
