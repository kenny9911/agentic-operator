/**
 * @agentic/agent-runtime — public surface.
 *
 * Consumers (apps/api):
 *   import { BaseAgent, agentRegistry, bootstrapCodeAgents, setGateway } from "@agentic/agent-runtime";
 *   import "@agentic/agent-runtime/system"; // registers TestAgent + future system agents
 */

export { BaseAgent } from "./base-agent";
export { agentRegistry } from "./registry";
export { setGateway, getGateway, hasGateway } from "./gateway-host";
export { bootstrapCodeAgents } from "./bootstrap";
export {
  registerCodeAgentFn,
  buildCodeAgentFns,
  codeAgentEventName,
  codeAgentFnId,
  type CodeAgentEventData,
} from "./code-agent-fn";
export type {
  AgentContext,
  AgentResult,
  AgentKind,
  ToolHandler,
  ToolHandlerMap,
  ToolHandlerResult,
} from "./types";
