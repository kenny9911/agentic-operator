/**
 * @agentic/llm-gateway — public surface.
 *
 * Consumers (apps/api, packages/agents, packages/runtime):
 *   import { LLMGateway, resolveConfig, registerAllProviders } from "@agentic/llm-gateway";
 *   const { gateway: cfg, adapterEnv } = resolveConfig();
 *   const gateway = new LLMGateway(cfg);
 *   registerAllProviders(gateway, adapterEnv);
 *   const response = await gateway.chat({ messages: [...] });
 */

export { LLMGateway } from "./gateway";
export { LLMError, isLLMError, classifyHttpError, type LLMErrorCode } from "./errors";
export { resolveConfig, type ResolvedConfig, type AdapterEnvSlice } from "./config";
export { registerAllProviders } from "./providers/index";
export { redact, redactObject } from "./redact";
export type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ProviderAdapter,
  ProviderInfo,
  GatewayConfig,
  ProviderId,
} from "./types";
