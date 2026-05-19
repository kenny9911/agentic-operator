/**
 * Gateway host for the runtime. apps/api builds the singleton LLMGateway
 * from env at boot and calls setRuntimeGateway() so the step engine can
 * dispatch LLM calls for manifest-defined agents' `logic`-type actions.
 *
 * Mirrors the same pattern as packages/agents/src/gateway-host.ts.
 */

import type { LLMGateway } from "@agentic/llm-gateway";

let _gateway: LLMGateway | null = null;

export function setRuntimeGateway(g: LLMGateway): void {
  _gateway = g;
}

export function getRuntimeGateway(): LLMGateway | null {
  return _gateway;
}
