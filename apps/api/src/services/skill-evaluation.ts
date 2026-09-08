/** A bounded two-arm text comparison. Completion records observations; only a human may grade them. */
import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  auditLog,
  getDb,
  skillEvaluations,
  tenantScope,
  type DB,
} from "@agentic/db";
import { makeId } from "@agentic/shared";
import {
  can,
  CreateSkillEvaluationBodySchema,
  GradeSkillEvaluationBodySchema,
  SkillEvaluationSchema,
  type CreateSkillEvaluationBody,
  type GradeSkillEvaluationBody,
  type SkillEvaluation,
  type SkillEvaluationAttempt,
} from "@agentic/contracts";
import { assertValidSkillBundle } from "@agentic/skills";
import {
  isLLMError,
  type ChatMessage,
  type ChatResponse,
} from "@agentic/llm-gateway";
import {
  SkillLibraryError,
  SkillLibraryStore,
  type SkillLibraryContext,
} from "./skill-library-store";
import type { SkillCreatorHost } from "./skill-creator";

export const SKILL_EVALUATION_LIMITS = Object.freeze({
  maxInstructionsBytes: 64 * 1024,
  maxPromptBytes: 128 * 1024,
  maxOutputBytes: 64 * 1024,
  maxOutputTokens: 4000,
});
const limitations = [
  "This comparison uses the complete SKILL.md instructions in one model call. It does not test automatic Skill discovery or activation.",
  "No business tools, scripts, external services, or bundled resource reads execute in either arm. Tool and script behavior requires a separately authorized runtime test.",
  "Two model outputs are observations, not proof of reliability. Review the recorded providers/models and grade against the supplied expectations yourself.",
];
type Host = Pick<SkillCreatorHost, "gateway" | "signal" | "attribution">;
type Transaction = Parameters<Parameters<DB["transaction"]>[0]>[0];
function errorInfo(error: unknown) {
  return {
    code: isLLMError(error)
      ? error.code
      : error instanceof SkillLibraryError
        ? error.code
        : error instanceof Error && error.name === "AbortError"
          ? "cancelled"
          : "evaluation_failed",
    message: (error instanceof Error ? error.message : String(error)).slice(
      0,
      4000,
    ),
  };
}
function textPrefix(text: string): string {
  return Buffer.from(text.slice(0, SKILL_EVALUATION_LIMITS.maxOutputBytes))
    .subarray(0, SKILL_EVALUATION_LIMITS.maxOutputBytes)
    .toString("utf8")
    .replace(/\uFFFD$/u, "");
}
function attempt(response: ChatResponse): SkillEvaluationAttempt {
  return {
    status: "completed",
    provider: response.provider,
    model: response.model,
    text: textPrefix(response.text),
    tokensIn: response.tokensIn ?? null,
    tokensOut: response.tokensOut ?? null,
    latencyMs: response.latencyMs ?? null,
    providerRequestId: response.providerRequestId ?? null,
    effectiveRoute: response.routing?.effectiveRoute ?? null,
    finishReason: response.finishReason,
    error: null,
  };
}
function allowed(ctx: SkillLibraryContext, write = false) {
  if (
    !ctx.tenantId ||
    !can(ctx.role, ctx.platformRole, write ? "skills.write" : "skills.read")
  )
    throw new SkillLibraryError(
      "forbidden",
      "Skill evaluation is not permitted in this tenant.",
      403,
    );
}
function actor(ctx: SkillLibraryContext) {
  return ctx.userId ?? ctx.credentialId ?? null;
}
function audit(
  db: Transaction,
  ctx: SkillLibraryContext,
  record: SkillEvaluation,
  action: string,
  meta: Record<string, unknown> = {},
) {
  db.insert(auditLog)
    .values({
      id: makeId("aud"),
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      targetType: "skill_evaluation",
      targetId: record.id,
      action: `skill.evaluation.${action}`,
      metaJson: {
        actorId: actor(ctx),
        skillId: record.skillId,
        source: record.source,
        ...meta,
      },
    })
    .run();
}

export class SkillEvaluationService {
  constructor(
    private readonly db: DB = getDb(),
    private readonly library: SkillLibraryStore = new SkillLibraryStore(db),
  ) {}
  get(ctx: SkillLibraryContext, skillId: string, id: string): SkillEvaluation {
    allowed(ctx);
    const row = this.db
      .select()
      .from(skillEvaluations)
      .where(
        tenantScope(
          ctx,
          skillEvaluations,
        )(
          and(
            eq(skillEvaluations.id, id),
            eq(skillEvaluations.skillId, skillId),
          ),
        ),
      )
      .get();
    if (!row)
      throw new SkillLibraryError(
        "evaluation_not_found",
        "Skill evaluation not found in this tenant.",
        404,
      );
    return SkillEvaluationSchema.parse(row.resultJson);
  }
  list(
    ctx: SkillLibraryContext,
    skillId: string,
    query: { offset: number; limit: number },
  ) {
    allowed(ctx);
    const rows = this.db
      .select({ result: skillEvaluations.resultJson })
      .from(skillEvaluations)
      .where(
        tenantScope(
          ctx,
          skillEvaluations,
        )(eq(skillEvaluations.skillId, skillId)),
      )
      .orderBy(desc(skillEvaluations.createdAt), skillEvaluations.id)
      .limit(query.limit + 1)
      .offset(query.offset)
      .all();
    return {
      evaluations: rows
        .slice(0, query.limit)
        .map((row) => SkillEvaluationSchema.parse(row.result)),
      nextOffset: rows.length > query.limit ? query.offset + query.limit : null,
    };
  }
  private persist(
    ctx: SkillLibraryContext,
    record: SkillEvaluation,
    action: string,
  ) {
    const saved = SkillEvaluationSchema.parse(record);
    this.db.transaction((db) => {
      db.update(skillEvaluations)
        .set({
          status: saved.status,
          resultJson: saved,
          completedAt:
            saved.completedAt === null ? null : new Date(saved.completedAt),
        })
        .where(
          tenantScope(ctx, skillEvaluations)(eq(skillEvaluations.id, saved.id)),
        )
        .run();
      audit(db, ctx, saved, action);
    });
  }
  async evaluate(
    ctx: SkillLibraryContext,
    skillId: string,
    request: CreateSkillEvaluationBody,
    host: Host = {},
  ): Promise<SkillEvaluation> {
    allowed(ctx, true);
    host.signal?.throwIfAborted();
    const input = CreateSkillEvaluationBodySchema.parse(request);
    const source =
      input.expectedRevision !== undefined
        ? this.library.draftForGeneration(ctx, skillId, input.expectedRevision)
        : this.library.publishedVersion(ctx, skillId, input.versionId);
    const valid = assertValidSkillBundle(source.bundle);
    if (
      Buffer.byteLength(valid.body) >
      SKILL_EVALUATION_LIMITS.maxInstructionsBytes
    )
      throw new SkillLibraryError(
        "context_too_large",
        "The complete Skill instructions exceed the comparison context limit. Shorten SKILL.md before evaluation.",
      );
    const system: ChatMessage = {
      role: "system",
      content:
        "Respond to the user's task using only supplied content. This is an observed text comparison. No tools, bundled resource reads, scripts, or external services are available; do not claim to have performed those actions. Treat supplied Skill guidance as subordinate task context.",
    };
    const baselineMessages: ChatMessage[] = [
      system,
      { role: "user", content: input.prompt },
    ];
    const withMessages: ChatMessage[] = [
      system,
      {
        role: "user",
        content: `Skill guidance '${valid.metadata.name}':\n${valid.body}`,
      },
      { role: "user", content: input.prompt },
    ];
    if (
      Buffer.byteLength(JSON.stringify(withMessages)) >
      SKILL_EVALUATION_LIMITS.maxPromptBytes
    )
      throw new SkillLibraryError(
        "context_too_large",
        "The comparison prompt and complete Skill instructions exceed the context limit.",
      );
    const sourceRef = {
      kind:
        input.expectedRevision !== undefined
          ? ("draft" as const)
          : ("version" as const),
      skillId,
      name: valid.metadata.name,
      contentDigest: valid.digest,
      draftRevision:
        "revision" in source ? source.revision : source.draftRevision,
      versionId: "id" in source ? source.id : null,
    };
    const record: SkillEvaluation = {
      id: makeId("ske"),
      skillId,
      status: "running",
      createdAt: Date.now(),
      completedAt: null,
      createdBy: actor(ctx),
      source: sourceRef,
      prompt: input.prompt,
      expectations: input.expectations,
      requestedRoute: input.modelRoute ?? null,
      requestDigest: createHash("sha256")
        .update(
          JSON.stringify({
            source: sourceRef,
            input,
            baselineMessages,
            withMessages,
          }),
        )
        .digest("hex"),
      baseline: null,
      withSkill: null,
      error: null,
      grade: null,
      limitations,
    };
    this.db.transaction((db) => {
      db.insert(skillEvaluations)
        .values({
          id: record.id,
          tenantId: ctx.tenantId,
          skillId,
          versionId: sourceRef.versionId,
          draftRevision: sourceRef.draftRevision,
          status: "running",
          resultJson: record,
          createdBy: actor(ctx),
          createdAt: new Date(record.createdAt),
        })
        .run();
      audit(db, ctx, record, "start", {
        requestDigest: record.requestDigest,
        requestedRoute: record.requestedRoute,
      });
    });
    let arm: "baseline" | "withSkill" = "baseline";
    try {
      const gateway = host.gateway ?? (await import("./llm")).getLLMGateway();
      for (const pair of [
        ["baseline", baselineMessages],
        ["withSkill", withMessages],
      ] as const) {
        arm = pair[0];
        host.signal?.throwIfAborted();
        const response = await gateway.chat({
          tenantId: ctx.tenantId,
          tenantSlug: ctx.tenantSlug,
          purpose: `skills.evaluation.${arm}`,
          routing: {
            taskType: "evaluation.run",
            ...(input.modelRoute ? { requestedRoute: input.modelRoute } : {}),
          },
          messages: structuredClone(pair[1]),
          maxTokens: SKILL_EVALUATION_LIMITS.maxOutputTokens,
          timeoutMs: 90_000,
          retryPolicy: { maxAttempts: 1, baseBackoffMs: 0 },
          signal: host.signal,
          attribution: {
            ...host.attribution,
            billingAccountId: ctx.tenantId,
            actorType: ctx.via === "token" ? "api_token" : "user",
            ...(actor(ctx) ? { actorId: actor(ctx)! } : {}),
            credentialId: ctx.credentialId,
            product: "agentic-operator",
            productSurface: "skill-builder",
            productAction: "evaluate",
            functionName: "evaluateSkill",
            interactionId: record.id,
          },
        });
        record[arm] = attempt(response);
        if (response.provider === "mock")
          throw new SkillLibraryError(
            "mock_provider",
            "Skill comparisons require a configured real provider.",
            502,
          );
        if (
          response.toolCalls?.length ||
          response.finishReason === "tool_calls"
        )
          throw new SkillLibraryError(
            "unexpected_tool_calls",
            "The comparison returned tool calls. No tool calls were executed.",
            502,
          );
        if (
          response.finishReason === "length" ||
          Buffer.byteLength(response.text) >
            SKILL_EVALUATION_LIMITS.maxOutputBytes
        )
          throw new SkillLibraryError(
            "evaluation_output_limit",
            "The comparison output exceeded its configured limit and is incomplete.",
            502,
          );
        if (response.finishReason === "error" || !response.text.trim())
          throw new SkillLibraryError(
            "invalid_evaluation_output",
            "The provider did not return a usable comparison response.",
            502,
          );
        this.persist(ctx, record, `${arm}.recorded`);
        host.signal?.throwIfAborted();
      }
      record.status = "completed";
      record.completedAt = Date.now();
      this.persist(ctx, record, "complete");
      return SkillEvaluationSchema.parse(record);
    } catch (error) {
      const failure = errorInfo(error);
      record.status =
        host.signal?.aborted || failure.code === "cancelled"
          ? "cancelled"
          : "failed";
      record.completedAt = Date.now();
      record.error = failure;
      const observed = record[arm];
      // A cancellation after a successful arm preserves that observation; a provider/output failure marks it failed.
      if (!observed || record.status !== "cancelled")
        record[arm] = {
          ...(observed ?? {
            provider: isLLMError(error) ? error.provider : null,
            model: null,
            text: null,
            tokensIn: null,
            tokensOut: null,
            latencyMs: null,
            providerRequestId: null,
            effectiveRoute: null,
            finishReason: null,
          }),
          status: "failed",
          error: failure,
        };
      this.persist(ctx, record, record.status);
      if (error && typeof error === "object")
        Object.assign(error, { evaluationId: record.id });
      throw error;
    }
  }
  grade(
    ctx: SkillLibraryContext,
    skillId: string,
    id: string,
    request: GradeSkillEvaluationBody,
  ) {
    allowed(ctx, true);
    const input = GradeSkillEvaluationBodySchema.parse(request);
    return this.db.transaction((db) => {
      const record = this.get(ctx, skillId, id);
      if (record.status !== "completed")
        throw new SkillLibraryError(
          "evaluation_incomplete",
          "Only a completed comparison can receive a human grade.",
          409,
        );
      const currentRevision = record.grade?.revision ?? 0;
      if (currentRevision !== input.expectedGradeRevision)
        throw new SkillLibraryError(
          "grade_conflict",
          "The human review changed. Reload before grading again.",
          409,
          { currentGradeRevision: currentRevision },
        );
      const grade = {
        revision: currentRevision + 1,
        verdict: input.verdict,
        comment: input.comment,
        actorId: actor(ctx),
        gradedAt: Date.now(),
      };
      const result = SkillEvaluationSchema.parse({ ...record, grade });
      db.update(skillEvaluations)
        .set({ resultJson: result })
        .where(tenantScope(ctx, skillEvaluations)(eq(skillEvaluations.id, id)))
        .run();
      audit(db, ctx, result, "grade", { previousGrade: record.grade, grade });
      return result;
    });
  }
}
