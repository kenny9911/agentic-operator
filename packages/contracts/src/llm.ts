/**
 * API contracts for /v1/llm/* and /v1/agents/:name/invoke endpoints.
 *
 * The actual LLM gateway types live in @agentic/llm-gateway. These schemas
 * are the wire format the frontend and any external API consumer parses
 * against — kept here so both apps/api (server) and apps/web (client) reach
 * the same source of truth.
 */

import { z } from "zod";
import { PROVIDER_IDS } from "./providers";

export const ProviderIdSchema = z.enum(PROVIDER_IDS as unknown as [string, ...string[]]);

export const ChatRoleSchema = z.enum(["system", "user", "assistant"]);

export const ChatMessageSchema = z.object({
  role: ChatRoleSchema,
  content: z.string(),
});

export const ProviderInfoSchema = z.object({
  id: ProviderIdSchema,
  name: z.string(),
  hasKey: z.boolean(),
  defaultModel: z.string().nullable(),
  models: z.array(z.string()),
});

export type ProviderInfoDTO = z.infer<typeof ProviderInfoSchema>;

// ─── POST /v1/agents/:name/invoke ───────────────────────────────────────────

export const InvokeAgentBody = z.object({
  input: z.unknown().optional(),
  provider: ProviderIdSchema.optional(),
  model: z.string().optional(),
  async: z.boolean().optional().default(false),
});
export type InvokeAgentBody = z.infer<typeof InvokeAgentBody>;

export const InvokeAgentResponse = z.object({
  runId: z.string(),
  status: z.enum(["ok", "failed", "queued"]),
  output: z.unknown().optional(),
  provider: ProviderIdSchema.optional(),
  model: z.string().optional(),
  tokensIn: z.number().nullable().optional(),
  tokensOut: z.number().nullable().optional(),
  durationMs: z.number().optional(),
  error: z.string().optional(),
});
export type InvokeAgentResponse = z.infer<typeof InvokeAgentResponse>;

// ─── Agent kind filter for GET /v1/agents ───────────────────────────────────

export const AgentKindSchema = z.enum(["manifest", "code", "all"]);
export type AgentKindFilter = z.infer<typeof AgentKindSchema>;
