/**
 * P0-AUTH-04 — allowlist of code-defined agents that run under the
 * synthetic `__system` tenant rather than the caller's own tenant.
 *
 * These are cross-tenant operator/admin utilities (e.g. testAgent for
 * smoke-testing the LLM gateway). Any code agent NOT on this list runs
 * under the invoking tenant — so per-tenant code agents do not silently
 * pool under `__system`.
 *
 * To add a new system-scoped agent: register it under
 * `data/system-agents/*` (which already calls
 * `agentRegistry.register(new XAgent())`) and append the agent's `name`
 * here. The agent's class declaration itself does NOT yet carry a
 * `scope` field — when Phase 1 lands the explicit BaseAgent.scope marker
 * this allowlist becomes the fallback for legacy agents.
 */

const SYSTEM_SCOPED_AGENT_NAMES: ReadonlySet<string> = new Set([
  "testAgent",
]);

/** Return true iff the agent is scoped to the synthetic `__system` tenant. */
export function isSystemScopedAgent(agentName: string): boolean {
  return SYSTEM_SCOPED_AGENT_NAMES.has(agentName);
}
