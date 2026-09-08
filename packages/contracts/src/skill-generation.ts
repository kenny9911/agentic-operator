import { z } from "zod";
import { ProviderIdSchema, ReasoningConfigSchema } from "./llm";
import { ModelRouteIdSchema } from "./llm-settings";
import { SkillBundleSchema, SkillDiagnosticSchema, SkillSuggestedTestSchema } from "./skills";

/** Select an existing configured route, or use the host's explicit Pro authoring default. */
export const GenerateSkillBodySchema = z.object({
  purpose: z.string().trim().min(1).max(16_000),
  examples: z.array(z.string().trim().min(1).max(4000)).max(10).optional(),
  modelRoute: ModelRouteIdSchema.optional(),
}).strict();
export type GenerateSkillBody = z.infer<typeof GenerateSkillBodySchema>;

export const SkillGenerationAttemptSchema = z.object({
  taskType: z.enum(["agent.author", "output.repair"]),
  provider: ProviderIdSchema,
  model: z.string(),
  tokensIn: z.number().int().nonnegative().nullable(),
  tokensOut: z.number().int().nonnegative().nullable(),
  finishReason: z.enum(["stop", "length", "tool_calls", "error", "unknown"]),
  latencyMs: z.number().nonnegative(),
  providerRequestId: z.string().optional(),
  effectiveRoute: z.string().optional(),
  /** Effective controls returned by the gateway; native OpenAI Pro retains its base model id. */
  reasoning: ReasoningConfigSchema.optional(),
  /** Observed on the provider's raw response, never reconstructed from requested controls. */
  reportedReasoningMode: z.enum(["standard", "pro"]).optional(),
  /** Raw provider model field; normalized model may otherwise fall back to the requested id. */
  reportedModel: z.string().optional(),
}).strict();
export type SkillGenerationAttempt = z.infer<typeof SkillGenerationAttemptSchema>;

export const SkillGenerationProvenanceSchema = z.object({
  mode: z.literal("ai-assisted"),
  tenantId: z.string().min(1),
  actorType: z.enum(["user", "api_token"]),
  actorId: z.string().nullable(),
  requestedRoute: ModelRouteIdSchema.nullable(),
  creatorPolicyDigest: z.string().regex(/^[a-f0-9]{64}$/),
  creatorPolicyVersion: z.string().nullable(),
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  /** SHA-256 of a sorted path/byte-length/file-hash manifest. Works for unfinished drafts too. */
  baseFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  outputDigest: z.string().regex(/^[a-f0-9]{64}$/),
  generatedAt: z.string().datetime(),
  attempts: z.array(SkillGenerationAttemptSchema).min(1).max(2),
  /** Null if any attempt lacked authoritative usage; attempts retain individually known values. */
  tokensIn: z.number().int().nonnegative().nullable(),
  tokensOut: z.number().int().nonnegative().nullable(),
}).strict();
export type SkillGenerationProvenance = z.infer<typeof SkillGenerationProvenanceSchema>;

export const GenerateSkillResponseSchema = z.object({
  bundle: SkillBundleSchema,
  diagnostics: z.array(SkillDiagnosticSchema),
  // Thirty model assumptions plus bounded host capability disclosures.
  assumptions: z.array(z.string().min(1).max(2000)).max(35),
  suggestedTests: z.array(SkillSuggestedTestSchema).max(10),
  changeSummary: z.array(z.string().min(1).max(2000)).max(30),
  provenance: SkillGenerationProvenanceSchema,
}).strict();
export type GenerateSkillResponse = z.infer<typeof GenerateSkillResponseSchema>;
