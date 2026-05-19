/**
 * Gateway host — the agents package holds a *reference* to the gateway,
 * not a constructor of its own. apps/api builds the singleton gateway from
 * env at boot, then calls `setGateway()` so BaseAgent.run() can dispatch.
 *
 * This indirection avoids the agents package owning env-resolution logic
 * (which lives in apps/api), and makes tests trivial: pass a stub gateway.
 */

import type { LLMGateway } from "@agentic/llm-gateway";

let _gateway: LLMGateway | null = null;

export function setGateway(g: LLMGateway): void {
  _gateway = g;
}

export function getGateway(): LLMGateway {
  if (!_gateway) {
    throw new Error(
      "[agents] LLMGateway not initialised — apps/api must call setGateway() at boot",
    );
  }
  return _gateway;
}

export function hasGateway(): boolean {
  return _gateway !== null;
}
