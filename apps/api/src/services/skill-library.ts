import {
  GenerateSkillBodySchema,
  ImportSkillBodySchema,
  type GenerateSkillBody,
  type SkillBundle,
} from "@agentic/contracts";
import {
  decodeSkillFile,
  exportSkillArchive,
  importSkillArchive,
  importSkillMarkdown,
  validateSkillBundle,
} from "@agentic/skills";
import { generateSkill, type SkillCreatorHost } from "./skill-creator";
import {
  admitSkillDraft,
  SkillLibraryError,
  SkillLibraryStore,
  type SkillLibraryContext,
} from "./skill-library-store";

function authorizedCreatorHost(
  store: SkillLibraryStore,
  ctx: SkillLibraryContext,
  host: SkillCreatorHost,
): SkillCreatorHost {
  return {
    ...host,
    authorizePolicy: async () => {
      await host.authorizePolicy?.();
      store.assertCreatorEnabled(ctx);
    },
  };
}

export async function previewSkillImport(input: unknown) {
  const body = ImportSkillBodySchema.parse(input);
  let bundle: SkillBundle;
  if (body.format === "zip") {
    const bytes = Buffer.from(body.archiveBase64, "base64");
    if (bytes.toString("base64") !== body.archiveBase64)
      throw new SkillLibraryError(
        "invalid_archive_encoding",
        "ZIP input must use canonical base64.",
      );
    bundle = await importSkillArchive(bytes);
  } else if (body.format === "markdown") {
    bundle = importSkillMarkdown(body.content);
  } else bundle = admitSkillDraft(body.bundle);
  const { valid, diagnostics, metadata } = validateSkillBundle(bundle);
  return { bundle, valid, diagnostics, ...(metadata ? { metadata } : {}) };
}

export async function exportManagedSkill(
  store: SkillLibraryStore,
  ctx: SkillLibraryContext,
  id: string,
  query: { format: "zip" | "markdown"; draft: boolean; versionId?: string },
) {
  const detail = query.draft
    ? store.draftForRead(ctx, id)
    : store.publishedVersion(ctx, id, query.versionId);
  const bundle = detail.bundle;
  const validation = validateSkillBundle(bundle);
  const name = validation.metadata?.name ?? "skill-draft";
  if (query.format === "zip")
    return {
      bytes: await exportSkillArchive(bundle),
      filename: `${name}.zip`,
      contentType: "application/zip",
    };
  const entrypoint = bundle.files.find((file) => file.path === "SKILL.md");
  if (!entrypoint)
    throw new SkillLibraryError(
      "missing_skill_md",
      "This draft has no SKILL.md to export.",
    );
  return {
    bytes: decodeSkillFile(entrypoint),
    filename: "SKILL.md",
    contentType: "text/markdown; charset=utf-8",
  };
}

/** Capabilities describe actually registered tools; imported metadata never creates grants. */
export async function skillCreatorHost(
  signal?: AbortSignal,
): Promise<SkillCreatorHost> {
  const { listGlobalTools } = await import("@agentic/tools");
  return {
    signal,
    capabilities: {
      tools: listGlobalTools()
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 200)
        .map((tool) => ({
          name: tool.name,
          description: tool.summary.slice(0, 1000),
        })),
    },
  };
}

export async function createGeneratedSkill(
  store: SkillLibraryStore,
  ctx: SkillLibraryContext,
  input: GenerateSkillBody & { visibility: "tenant" | "shared" },
  host: SkillCreatorHost,
) {
  // Authorize before incurring provider cost. The create method rechecks during commit.
  const { can } = await import("@agentic/contracts");
  if (
    !ctx.tenantId ||
    !can(ctx.role, ctx.platformRole, "skills.write") ||
    (input.visibility === "shared" && ctx.platformRole !== "superadmin")
  )
    throw new SkillLibraryError(
      "forbidden",
      "Skill creation is not permitted.",
      403,
    );
  const { visibility, ...request } = input;
  const generation = await generateSkill(
    ctx,
    GenerateSkillBodySchema.parse(request),
    authorizedCreatorHost(store, ctx, host),
  );
  host.signal?.throwIfAborted();
  return {
    detail: store.create(
      ctx,
      { bundle: generation.bundle, visibility },
      "generate",
      generation,
    ),
    generation,
  };
}

export async function reviseGeneratedSkill(
  store: SkillLibraryStore,
  ctx: SkillLibraryContext,
  id: string,
  input: GenerateSkillBody & { expectedRevision: number },
  host: SkillCreatorHost,
) {
  const { expectedRevision, ...request } = input;
  const base = store.draftForGeneration(ctx, id, expectedRevision);
  const generation = await generateSkill(
    ctx,
    GenerateSkillBodySchema.parse(request),
    { ...authorizedCreatorHost(store, ctx, host), baseBundle: base.bundle },
  );
  host.signal?.throwIfAborted();
  return {
    detail: store.save(
      ctx,
      id,
      expectedRevision,
      generation.bundle,
      "generate",
      generation,
    ),
    generation,
  };
}
