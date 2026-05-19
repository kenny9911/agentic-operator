/**
 * @agentic/agents — public surface.
 *
 * Consumers (apps/api):
 *   import { BaseAgent, agentRegistry, bootstrapCodeAgents, setGateway } from "@agentic/agents";
 *   import "@agentic/agents/system"; // registers TestAgent + future system agents
 */

export { BaseAgent } from "./base-agent";
export { agentRegistry } from "./registry";
export { setGateway, getGateway, hasGateway } from "./gateway-host";
export { bootstrapCodeAgents } from "./bootstrap";
export type { AgentContext, AgentResult, AgentKind } from "./types";
