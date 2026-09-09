import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ArchiveSkillBodySchema,
  CreateGeneratedSkillBodySchema,
  CreateSkillBodySchema,
  ImportSkillBodySchema,
  ListSkillsQuerySchema,
  ManagedSkillGenerationResponseSchema,
  PublishSkillBodySchema,
  RestoreSkillDraftBodySchema,
  ReviseGeneratedSkillBodySchema,
  SaveSkillDraftBodySchema,
  SetSkillEnabledBodySchema,
  SkillDetailSchema,
  SkillDraftSchema,
  SkillExportQuerySchema,
  SkillHistoryQuerySchema,
  SkillImportPreviewSchema,
  SkillListResponseSchema,
  SkillRevisionHistorySchema,
  SkillValidationResponseSchema,
  SkillVersionSchema,
  SkillVersionHistorySchema,
  ValidateSkillBodySchema,
  CreateSkillEvaluationBodySchema,
  GradeSkillEvaluationBodySchema,
  SkillEvaluationSchema,
  SkillEvaluationListSchema,
} from "@agentic/contracts";
import { SkillBundleError, validateSkillBundle } from "@agentic/skills";
import { isLLMError } from "@agentic/llm-gateway";
import { requirePermission } from "../../plugins/rbac";
import {
  admitSkillDraft,
  SkillLibraryError,
  SkillLibraryStore,
} from "../../services/skill-library-store";
import {
  createGeneratedSkill,
  exportManagedSkill,
  previewSkillImport,
  reviseGeneratedSkill,
  skillCreatorHost,
} from "../../services/skill-library";
import {
  SkillGenerationError,
  type SkillCreatorHost,
} from "../../services/skill-creator";
import { SkillEvaluationService } from "../../services/skill-evaluation";
import { SkillLibraryFileError } from "../../services/skill-library-files";

// Worst-case JSON escaping for an admitted 20 MiB text bundle remains bounded.
export const SKILL_LIBRARY_BODY_LIMIT = 128 * 1024 * 1024;
export interface SkillLibraryRouteOptions {
  store?: SkillLibraryStore;
  evaluations?: SkillEvaluationService;
  creatorHost?: (signal: AbortSignal) => Promise<SkillCreatorHost>;
}
const params = z.object({ id: z.string().min(1).max(160) });
const revisionParams = params.extend({
  revision: z.coerce.number().int().positive(),
});
function modelStatus(code: string) {
  return (
    (
      {
        auth: 401,
        rate_limit: 429,
        timeout: 504,
        bad_request: 400,
        model_not_found: 400,
        not_configured: 503,
      } as Record<string, number>
    )[code] ?? 502
  );
}

async function withDisconnect<T>(
  req: FastifyRequest,
  reply: FastifyReply,
  work: (signal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController();
  const abort = () =>
    controller.abort(
      new DOMException("Skill generation request disconnected", "AbortError"),
    );
  const close = () => {
    if (!reply.raw.writableEnded) abort();
  };
  req.raw.once("aborted", abort);
  reply.raw.once("close", close);
  if (req.raw.aborted) abort();
  try {
    return await work(controller.signal);
  } finally {
    req.raw.off("aborted", abort);
    reply.raw.off("close", close);
  }
}

export async function skillLibraryRoutes(
  app: FastifyInstance,
  options: SkillLibraryRouteOptions = {},
) {
  const store = () => options.store ?? new SkillLibraryStore();
  const evaluations = () => options.evaluations ?? new SkillEvaluationService();
  app.addHook("onSend", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
  });
  app.setErrorHandler((error, _req, reply) => {
    const evaluationDetails =
      error &&
      typeof error === "object" &&
      "evaluationId" in error &&
      typeof error.evaluationId === "string"
        ? { evaluationId: error.evaluationId }
        : {};
    if (error instanceof SkillLibraryError)
      return reply.fail(
        error.code,
        error.message,
        error.statusCode,
        undefined,
        { ...error.details, ...evaluationDetails },
      );
    if (error instanceof SkillLibraryFileError) {
      app.log.error({ err: error }, "Skill directory synchronization failed");
      return reply.fail(
        "skill_storage_unavailable",
        "Skill directories could not be synchronized. The edit was not saved; check storage and retry.",
        503,
      );
    }
    if (error instanceof SkillBundleError)
      return reply.fail("invalid_skill", error.message, 400, undefined, {
        diagnostics: error.diagnostics,
      });
    if (error instanceof SkillGenerationError)
      return reply.fail(
        error.code,
        error.message,
        error.code === "context_too_large" ? 400 : 502,
        undefined,
        { attempts: error.attempts },
      );
    if (isLLMError(error))
      return reply.fail(
        error.code,
        error.message,
        modelStatus(error.code),
        undefined,
        evaluationDetails,
      );
    if (error instanceof Error && error.name === "AbortError")
      return reply.fail(
        "cancelled",
        error.message,
        499,
        undefined,
        evaluationDetails,
      );
    throw error;
  });
  app.get("/skills", async (req, reply) =>
    reply.ok(
      SkillListResponseSchema.parse(
        store().list(
          requirePermission(req, "skills.read"),
          ListSkillsQuerySchema.parse(req.query),
        ),
      ),
    ),
  );
  app.post("/skills/storage/reconcile", async (req, reply) => {
    const ctx = requirePermission(req, "skills.write");
    if (ctx.platformRole !== "superadmin")
      throw new SkillLibraryError(
        "forbidden",
        "Only a platform superadmin can reconcile Skill directories.",
        403,
      );
    return reply.ok(store().reconcileFiles());
  });
  app.post(
    "/skills",
    { bodyLimit: SKILL_LIBRARY_BODY_LIMIT },
    async (req, reply) =>
      reply.ok(
        SkillDetailSchema.parse(
          store().create(
            requirePermission(req, "skills.write"),
            CreateSkillBodySchema.parse(req.body),
          ),
        ),
        201,
      ),
  );
  app.post(
    "/skills/validate",
    { bodyLimit: SKILL_LIBRARY_BODY_LIMIT },
    async (req, reply) => {
      requirePermission(req, "skills.write");
      const bundle = admitSkillDraft(
        ValidateSkillBodySchema.parse(req.body).bundle,
      );
      const { valid, diagnostics, metadata } = validateSkillBundle(bundle);
      return reply.ok(
        SkillValidationResponseSchema.parse({
          valid,
          diagnostics,
          ...(metadata ? { metadata } : {}),
        }),
      );
    },
  );
  app.post(
    "/skills/import/preview",
    { bodyLimit: SKILL_LIBRARY_BODY_LIMIT },
    async (req, reply) => {
      requirePermission(req, "skills.write");
      return reply.ok(
        SkillImportPreviewSchema.parse(await previewSkillImport(req.body)),
      );
    },
  );
  app.post(
    "/skills/import",
    { bodyLimit: SKILL_LIBRARY_BODY_LIMIT },
    async (req, reply) => {
      const ctx = requirePermission(req, "skills.write");
      const body = ImportSkillBodySchema.parse(req.body);
      const preview = await previewSkillImport(body);
      return reply.ok(
        SkillDetailSchema.parse(
          store().create(
            ctx,
            { bundle: preview.bundle, visibility: body.visibility },
            "import",
          ),
        ),
        201,
      );
    },
  );
  app.post("/skills/generate", async (req, reply) => {
    const ctx = requirePermission(req, "skills.write");
    const body = CreateGeneratedSkillBodySchema.parse(req.body);
    const result = await withDisconnect(req, reply, async (signal) =>
      createGeneratedSkill(store(), ctx, body, {
        ...(await (options.creatorHost ?? skillCreatorHost)(signal)),
        signal,
      }),
    );
    return reply.ok(ManagedSkillGenerationResponseSchema.parse(result), 201);
  });
  app.get("/skills/:id", async (req, reply) =>
    reply.ok(
      SkillDetailSchema.parse(
        store().detail(
          requirePermission(req, "skills.read"),
          params.parse(req.params).id,
        ),
      ),
    ),
  );
  app.put(
    "/skills/:id/draft",
    { bodyLimit: SKILL_LIBRARY_BODY_LIMIT },
    async (req, reply) => {
      const ctx = requirePermission(req, "skills.write");
      const body = SaveSkillDraftBodySchema.parse(req.body);
      return reply.ok(
        SkillDetailSchema.parse(
          store().save(
            ctx,
            params.parse(req.params).id,
            body.expectedRevision,
            body.bundle,
          ),
        ),
      );
    },
  );
  app.post("/skills/:id/publish", async (req, reply) => {
    const ctx = requirePermission(req, "skills.publish");
    const body = PublishSkillBodySchema.parse(req.body);
    return reply.ok(
      SkillDetailSchema.parse(
        store().publish(
          ctx,
          params.parse(req.params).id,
          body.expectedRevision,
        ),
      ),
    );
  });
  app.post("/skills/:id/archive", async (req, reply) =>
    reply.ok(
      SkillDetailSchema.parse(
        store().archive(
          requirePermission(req, "skills.write"),
          params.parse(req.params).id,
          ArchiveSkillBodySchema.parse(req.body),
        ),
      ),
    ),
  );
  app.patch("/skills/:id/enabled", async (req, reply) =>
    reply.ok(
      SkillDetailSchema.parse(
        store().setEnabled(
          requirePermission(req, "skills.write"),
          params.parse(req.params).id,
          SetSkillEnabledBodySchema.parse(req.body),
        ),
      ),
    ),
  );
  app.post("/skills/:id/restore", async (req, reply) => {
    const ctx = requirePermission(req, "skills.write");
    const body = RestoreSkillDraftBodySchema.parse(req.body);
    return reply.ok(
      SkillDetailSchema.parse(
        store().restore(
          ctx,
          params.parse(req.params).id,
          body.expectedRevision,
          body.revision,
        ),
      ),
    );
  });
  app.get("/skills/:id/revisions", async (req, reply) =>
    reply.ok(
      SkillRevisionHistorySchema.parse(
        store().history(
          requirePermission(req, "skills.read"),
          params.parse(req.params).id,
          SkillHistoryQuerySchema.parse(req.query),
        ),
      ),
    ),
  );
  app.get("/skills/:id/revisions/:revision", async (req, reply) => {
    const ctx = requirePermission(req, "skills.read");
    const { id, revision } = revisionParams.parse(req.params);
    return reply.ok(
      SkillDraftSchema.parse(store().historicalDraft(ctx, id, revision)),
    );
  });
  app.get("/skills/:id/versions", async (req, reply) =>
    reply.ok(
      SkillVersionHistorySchema.parse(
        store().versionHistory(
          requirePermission(req, "skills.read"),
          params.parse(req.params).id,
          SkillHistoryQuerySchema.parse(req.query),
        ),
      ),
    ),
  );
  app.get("/skills/:id/versions/:versionId", async (req, reply) => {
    const ctx = requirePermission(req, "skills.read");
    const { id, versionId } = params
      .extend({ versionId: z.string().min(1).max(160) })
      .parse(req.params);
    return reply.ok(
      SkillVersionSchema.parse(store().publishedVersion(ctx, id, versionId)),
    );
  });
  app.get("/skills/:id/evaluations", async (req, reply) =>
    reply.ok(
      SkillEvaluationListSchema.parse(
        evaluations().list(
          requirePermission(req, "skills.read"),
          params.parse(req.params).id,
          SkillHistoryQuerySchema.parse(req.query),
        ),
      ),
    ),
  );
  app.get("/skills/:id/evaluations/:evaluationId", async (req, reply) => {
    const ctx = requirePermission(req, "skills.read");
    const { id, evaluationId } = params
      .extend({ evaluationId: z.string().min(1).max(160) })
      .parse(req.params);
    return reply.ok(
      SkillEvaluationSchema.parse(evaluations().get(ctx, id, evaluationId)),
    );
  });
  app.post("/skills/:id/evaluations", async (req, reply) => {
    const ctx = requirePermission(req, "skills.write");
    const { id } = params.parse(req.params);
    const input = CreateSkillEvaluationBodySchema.parse(req.body);
    const result = await withDisconnect(req, reply, async (signal) =>
      evaluations().evaluate(ctx, id, input, {
        ...(await (options.creatorHost ?? skillCreatorHost)(signal)),
        signal,
      }),
    );
    return reply.ok(SkillEvaluationSchema.parse(result), 201);
  });
  app.post(
    "/skills/:id/evaluations/:evaluationId/grade",
    async (req, reply) => {
      const ctx = requirePermission(req, "skills.write");
      const { id, evaluationId } = params
        .extend({ evaluationId: z.string().min(1).max(160) })
        .parse(req.params);
      return reply.ok(
        SkillEvaluationSchema.parse(
          evaluations().grade(
            ctx,
            id,
            evaluationId,
            GradeSkillEvaluationBodySchema.parse(req.body),
          ),
        ),
      );
    },
  );
  app.get("/skills/:id/export", async (req, reply) => {
    const ctx = requirePermission(req, "skills.read");
    const query = SkillExportQuerySchema.parse(req.query);
    const result = await exportManagedSkill(
      store(),
      ctx,
      params.parse(req.params).id,
      query,
    );
    return reply
      .type(result.contentType)
      .header(
        "Content-Disposition",
        `attachment; filename="${result.filename}"`,
      )
      .header("Content-Length", result.bytes.length)
      .send(result.bytes);
  });
  app.post("/skills/:id/generate", async (req, reply) => {
    const ctx = requirePermission(req, "skills.write");
    const body = ReviseGeneratedSkillBodySchema.parse(req.body);
    const { id } = params.parse(req.params);
    const result = await withDisconnect(req, reply, async (signal) =>
      reviseGeneratedSkill(store(), ctx, id, body, {
        ...(await (options.creatorHost ?? skillCreatorHost)(signal)),
        signal,
      }),
    );
    return reply.ok(ManagedSkillGenerationResponseSchema.parse(result));
  });
}
