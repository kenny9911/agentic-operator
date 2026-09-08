import { z } from "zod";
import { ModelRouteIdSchema } from "./llm-settings";
import { ProviderIdSchema } from "./llm";

export const CreateSkillEvaluationBodySchema = z
  .object({
    prompt: z.string().trim().min(1).max(16_000),
    expectations: z.array(z.string().trim().min(1).max(2000)).min(1).max(10),
    modelRoute: ModelRouteIdSchema.optional(),
    expectedRevision: z.number().int().positive().optional(),
    versionId: z.string().min(1).max(160).optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.expectedRevision !== undefined) !==
      (value.versionId !== undefined),
    "Choose an exact saved draft revision or published version",
  );
export type CreateSkillEvaluationBody = z.infer<
  typeof CreateSkillEvaluationBodySchema
>;
export const SkillEvaluationSourceSchema = z
  .object({
    kind: z.enum(["draft", "version"]),
    skillId: z.string(),
    name: z.string(),
    contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
    draftRevision: z.number().int().positive(),
    versionId: z.string().nullable(),
  })
  .strict();
export const SkillEvaluationAttemptSchema = z
  .object({
    status: z.enum(["completed", "failed"]),
    provider: ProviderIdSchema.nullable(),
    model: z.string().nullable(),
    text: z.string().max(65536).nullable(),
    tokensIn: z.number().int().nonnegative().nullable(),
    tokensOut: z.number().int().nonnegative().nullable(),
    latencyMs: z.number().nonnegative().nullable(),
    providerRequestId: z.string().nullable(),
    effectiveRoute: z.string().nullable(),
    finishReason: z.string().nullable(),
    error: z
      .object({ code: z.string(), message: z.string().max(4000) })
      .strict()
      .nullable(),
  })
  .strict();
export type SkillEvaluationAttempt = z.infer<
  typeof SkillEvaluationAttemptSchema
>;
export const SkillEvaluationGradeSchema = z
  .object({
    revision: z.number().int().positive(),
    verdict: z.enum(["pass", "fail"]),
    comment: z.string().max(4000),
    actorId: z.string().nullable(),
    gradedAt: z.number().int(),
  })
  .strict();
export const GradeSkillEvaluationBodySchema = z
  .object({
    expectedGradeRevision: z.number().int().nonnegative(),
    verdict: z.enum(["pass", "fail"]),
    comment: z.string().trim().max(4000),
  })
  .strict();
export type GradeSkillEvaluationBody = z.infer<
  typeof GradeSkillEvaluationBodySchema
>;
export const SkillEvaluationSchema = z
  .object({
    id: z.string(),
    skillId: z.string(),
    status: z.enum(["running", "completed", "failed", "cancelled"]),
    createdAt: z.number().int(),
    completedAt: z.number().int().nullable(),
    createdBy: z.string().nullable(),
    source: SkillEvaluationSourceSchema,
    prompt: z.string(),
    expectations: z.array(z.string()),
    requestedRoute: ModelRouteIdSchema.nullable(),
    requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
    baseline: SkillEvaluationAttemptSchema.nullable(),
    withSkill: SkillEvaluationAttemptSchema.nullable(),
    error: z
      .object({ code: z.string(), message: z.string().max(4000) })
      .strict()
      .nullable(),
    grade: SkillEvaluationGradeSchema.nullable(),
    limitations: z.array(z.string()),
  })
  .strict();
export type SkillEvaluation = z.infer<typeof SkillEvaluationSchema>;
export const SkillEvaluationListSchema = z
  .object({
    evaluations: z.array(SkillEvaluationSchema),
    nextOffset: z.number().int().nullable(),
  })
  .strict();
