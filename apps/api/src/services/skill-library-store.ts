/** Tenant-owned editing with immutable portable publications. Every write and its audit commit together. */
import {
  and,
  desc,
  eq,
  getTableColumns,
  isNotNull,
  isNull,
  ne,
  or,
} from "drizzle-orm";
import {
  auditLog,
  getDb,
  managedSkills,
  skillDrafts,
  skillDraftRevisions,
  skillVersions,
  tenantScope,
  tenants,
  type DB,
} from "@agentic/db";
import {
  can,
  SkillBundleSchema,
  SkillDetailSchema,
  SkillDraftSchema,
  SkillVersionSchema,
  type GenerateSkillResponse,
  type SkillBundle,
  type SkillDetail,
  type SkillDraft,
  type SkillGenerationProvenance,
  type ManagedSkillSummary,
} from "@agentic/contracts";
import {
  assertValidSkillBundle,
  decodeSkillFile,
  SkillPathIndex,
  SKILL_BUNDLE_LIMITS,
  validateSkillBundle,
} from "@agentic/skills";
import { makeId } from "@agentic/shared";
import type { AuthedContext } from "../plugins/auth";

export type SkillLibraryContext = AuthedContext;
type StoreDb = Pick<DB, "select" | "insert" | "update">;
type SkillRow = typeof managedSkills.$inferSelect;
const { bundleJson: _versionBundle, ...versionColumns } =
  getTableColumns(skillVersions);
const {
  bundleJson: _revisionBundle,
  provenanceJson: _revisionProvenance,
  creatorNotesJson: _revisionNotes,
  ...revisionColumns
} = getTableColumns(skillDraftRevisions);
export class SkillLibraryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SkillLibraryError";
  }
}
function deny(): never {
  throw new SkillLibraryError(
    "forbidden",
    "This Skill operation is not permitted in the active tenant.",
    403,
  );
}
function missing(): never {
  throw new SkillLibraryError(
    "skill_not_found",
    "Skill not found in the available library.",
    404,
  );
}
function permission(
  ctx: SkillLibraryContext,
  action: "skills.read" | "skills.write" | "skills.publish",
) {
  if (!ctx.tenantId || !can(ctx.role, ctx.platformRole, action)) deny();
}
function actor(ctx: SkillLibraryContext) {
  return ctx.userId ?? ctx.credentialId ?? null;
}
function editable(ctx: SkillLibraryContext, row: SkillRow) {
  return (
    privateAccess(ctx, row) && can(ctx.role, ctx.platformRole, "skills.write")
  );
}
function privateAccess(ctx: SkillLibraryContext, row: SkillRow) {
  return row.visibility === "shared"
    ? ctx.platformRole === "superadmin"
    : row.tenantId === ctx.tenantId;
}
function ownerContext(
  ctx: SkillLibraryContext,
  row: SkillRow,
): SkillLibraryContext {
  return { ...ctx, tenantId: row.tenantId };
}
function audit(
  db: StoreDb,
  ctx: SkillLibraryContext,
  id: string,
  action: string,
  meta: Record<string, unknown>,
) {
  db.insert(auditLog)
    .values({
      id: makeId("aud"),
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      targetType: "managed_skill",
      targetId: id,
      action: `skill.${action}`,
      metaJson: { decision: "allow", actorId: actor(ctx), ...meta },
    })
    .run();
}

/** Editable invalid YAML is allowed; path conflicts and all decoded byte limits remain hard admission boundaries. */
export function admitSkillDraft(input: SkillBundle): SkillBundle {
  const bundle = SkillBundleSchema.parse(input);
  const paths = new SkillPathIndex();
  let total = 0;
  for (const file of bundle.files) {
    paths.add(file.path);
    const bytes = decodeSkillFile(file);
    if (
      file.path === "SKILL.md" &&
      bytes.length > SKILL_BUNDLE_LIMITS.maxSkillMdBytes
    )
      throw new SkillLibraryError(
        "skill_md_size",
        "SKILL.md exceeds its entrypoint size limit.",
      );
    total += bytes.length;
    if (total > SKILL_BUNDLE_LIMITS.maxBundleBytes)
      throw new SkillLibraryError(
        "bundle_size",
        "Expanded Skill draft exceeds the bundle size limit.",
      );
  }
  return bundle;
}

function draftDto(row: typeof skillDrafts.$inferSelect): SkillDraft {
  return SkillDraftSchema.parse({
    revision: row.revision,
    bundle: row.bundleJson,
    diagnostics: row.diagnosticsJson,
    provenance: row.provenanceJson,
    creatorNotes: row.creatorNotesJson,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt.getTime(),
  });
}
function creatorNotes(
  generation: Pick<
    GenerateSkillResponse,
    "assumptions" | "suggestedTests" | "changeSummary"
  >,
  generatedRevision: number,
): SkillDraft["creatorNotes"] {
  return {
    generatedRevision,
    evaluationStatus: "unexecuted",
    assumptions: generation.assumptions,
    suggestedTests: generation.suggestedTests,
    changeSummary: generation.changeSummary,
  };
}
function versionDto(row: typeof skillVersions.$inferSelect, owner: boolean) {
  return SkillVersionSchema.parse({
    id: row.id,
    skillId: row.skillId,
    versionNo: row.versionNo,
    name: row.name,
    description: row.description,
    contentDigest: row.contentDigest,
    draftRevision: row.draftRevision,
    bundle: row.bundleJson,
    createdAt: row.createdAt.getTime(),
    createdBy: owner ? row.createdBy : null,
  });
}

export class SkillLibraryStore {
  constructor(private readonly db: DB = getDb()) {}

  private row(
    ctx: SkillLibraryContext,
    id: string,
    db: StoreDb = this.db,
  ): SkillRow {
    permission(ctx, "skills.read");
    const row = db
      .select()
      .from(managedSkills)
      .where(
        and(
          eq(managedSkills.id, id),
          or(
            and(
              tenantScope(ctx, managedSkills)(),
              eq(managedSkills.visibility, "tenant"),
            ),
            and(
              eq(managedSkills.visibility, "shared"),
              ...(ctx.platformRole === "superadmin"
                ? []
                : [
                    isNotNull(managedSkills.latestVersionId),
                    isNull(managedSkills.archivedAt),
                  ]),
            ),
          ),
        ),
      )
      .get();
    return row ?? missing();
  }
  private writable(
    ctx: SkillLibraryContext,
    id: string,
    db: StoreDb = this.db,
    allowArchived = false,
  ) {
    permission(ctx, "skills.write");
    const row = this.row(ctx, id, db);
    if (!editable(ctx, row)) deny();
    if (row.archivedAt && !allowArchived)
      throw new SkillLibraryError(
        "skill_archived",
        "Restore this archived Skill before editing or publishing.",
        409,
      );
    return row;
  }
  private draft(ctx: SkillLibraryContext, id: string, db: StoreDb = this.db) {
    const row = db
      .select()
      .from(skillDrafts)
      .where(tenantScope(ctx, skillDrafts)(eq(skillDrafts.skillId, id)))
      .get();
    return row ?? missing();
  }
  private revision(
    ctx: SkillLibraryContext,
    id: string,
    expected: number,
    db: StoreDb = this.db,
  ) {
    const current = this.draft(ctx, id, db);
    if (current.revision !== expected)
      throw new SkillLibraryError(
        "revision_conflict",
        "The draft changed. Reload it before applying this edit.",
        409,
        { currentRevision: current.revision },
      );
    return current;
  }
  private availableName(
    ctx: SkillLibraryContext,
    name: string,
    except?: string,
    db: StoreDb = this.db,
  ) {
    const conflict = db
      .select({ id: managedSkills.id })
      .from(managedSkills)
      .where(
        tenantScope(
          ctx,
          managedSkills,
        )(
          and(
            eq(managedSkills.name, name),
            except ? ne(managedSkills.id, except) : undefined,
          ),
        ),
      )
      .get();
    if (conflict)
      throw new SkillLibraryError(
        "skill_name_conflict",
        `A Skill named '${name}' already exists in this tenant. Choose another name in SKILL.md.`,
        409,
        { name, existingSkillId: conflict.id },
      );
  }
  private summary(
    ctx: SkillLibraryContext,
    row: SkillRow,
    db: StoreDb = this.db,
  ): ManagedSkillSummary {
    const version = row.latestVersionId
      ? db
          .select({
            versionNo: skillVersions.versionNo,
            createdAt: skillVersions.createdAt,
          })
          .from(skillVersions)
          .where(
            tenantScope(
              { tenantId: row.tenantId },
              skillVersions,
            )(eq(skillVersions.id, row.latestVersionId)),
          )
          .get()
      : undefined;
    const draft = privateAccess(ctx, row)
      ? db
          .select({ revision: skillDrafts.revision })
          .from(skillDrafts)
          .where(
            tenantScope(
              ownerContext(ctx, row),
              skillDrafts,
            )(eq(skillDrafts.skillId, row.id)),
          )
          .get()
      : undefined;
    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      description: row.description,
      visibility: row.visibility,
      latestVersionId: row.latestVersionId,
      latestVersionNo: version?.versionNo ?? null,
      archivedAt: row.archivedAt?.getTime() ?? null,
      createdAt: row.createdAt.getTime(),
      updatedAt:
        !privateAccess(ctx, row) && version
          ? version.createdAt.getTime()
          : row.updatedAt.getTime(),
      canEdit: editable(ctx, row),
      draftRevision: draft?.revision ?? null,
    };
  }
  list(
    ctx: SkillLibraryContext,
    query: {
      scope: "available" | "owned" | "shared";
      archived: boolean;
      offset: number;
      limit: number;
    },
  ) {
    permission(ctx, "skills.read");
    const own = and(
      tenantScope(ctx, managedSkills)(),
      eq(managedSkills.visibility, "tenant"),
    );
    const publicShared = and(
      eq(managedSkills.visibility, "shared"),
      ...(ctx.platformRole === "superadmin"
        ? []
        : [
            isNotNull(managedSkills.latestVersionId),
            isNull(managedSkills.archivedAt),
          ]),
    );
    const access =
      query.scope === "owned"
        ? own
        : query.scope === "shared"
          ? and(eq(managedSkills.visibility, "shared"), or(own, publicShared))
          : or(own, publicShared);
    const rows = this.db
      .select()
      .from(managedSkills)
      .where(
        and(
          access,
          query.archived
            ? isNotNull(managedSkills.archivedAt)
            : isNull(managedSkills.archivedAt),
        ),
      )
      .orderBy(desc(managedSkills.updatedAt), managedSkills.id)
      .limit(query.limit + 1)
      .offset(query.offset)
      .all();
    return {
      skills: rows.slice(0, query.limit).map((row) => this.summary(ctx, row)),
      nextOffset: rows.length > query.limit ? query.offset + query.limit : null,
    };
  }
  detail(
    ctx: SkillLibraryContext,
    id: string,
    db: StoreDb = this.db,
  ): SkillDetail {
    const row = this.row(ctx, id, db);
    const owner = privateAccess(ctx, row);
    const versions = db
      .select(versionColumns)
      .from(skillVersions)
      .where(
        tenantScope(
          { tenantId: row.tenantId },
          skillVersions,
        )(eq(skillVersions.skillId, id)),
      )
      .orderBy(desc(skillVersions.versionNo))
      .limit(100)
      .all();
    const current = row.latestVersionId
      ? db
          .select()
          .from(skillVersions)
          .where(
            tenantScope(
              { tenantId: row.tenantId },
              skillVersions,
            )(
              and(
                eq(skillVersions.skillId, id),
                eq(skillVersions.id, row.latestVersionId),
              ),
            ),
          )
          .get()
      : undefined;
    return SkillDetailSchema.parse({
      skill: this.summary(ctx, row, db),
      draft: owner
        ? draftDto(this.draft(ownerContext(ctx, row), id, db))
        : null,
      latestVersion: current ? versionDto(current, owner) : null,
      versions: versions.map(({ tenantId: _tenant, ...version }) => ({
        ...version,
        createdAt: version.createdAt.getTime(),
        createdBy: owner ? version.createdBy : null,
      })),
    });
  }
  versionHistory(
    ctx: SkillLibraryContext,
    id: string,
    query: { offset: number; limit: number },
  ) {
    const skill = this.row(ctx, id);
    const rows = this.db
      .select(versionColumns)
      .from(skillVersions)
      .where(
        tenantScope(
          { tenantId: skill.tenantId },
          skillVersions,
        )(eq(skillVersions.skillId, id)),
      )
      .orderBy(desc(skillVersions.versionNo))
      .limit(query.limit + 1)
      .offset(query.offset)
      .all();
    return {
      versions: rows
        .slice(0, query.limit)
        .map(({ tenantId: _tenant, ...version }) => ({
          ...version,
          createdAt: version.createdAt.getTime(),
          createdBy: privateAccess(ctx, skill) ? version.createdBy : null,
        })),
      nextOffset: rows.length > query.limit ? query.offset + query.limit : null,
    };
  }
  publishedVersion(ctx: SkillLibraryContext, id: string, versionId?: string) {
    const skill = this.row(ctx, id);
    const target = versionId ?? skill.latestVersionId;
    if (!target)
      throw new SkillLibraryError(
        "skill_unpublished",
        "This Skill has no published version.",
        409,
      );
    const row = this.db
      .select()
      .from(skillVersions)
      .where(
        tenantScope(
          { tenantId: skill.tenantId },
          skillVersions,
        )(and(eq(skillVersions.skillId, id), eq(skillVersions.id, target))),
      )
      .get();
    if (!row) missing();
    return versionDto(row, privateAccess(ctx, skill));
  }
  draftForRead(ctx: SkillLibraryContext, id: string) {
    const row = this.row(ctx, id);
    if (!privateAccess(ctx, row)) missing();
    return draftDto(this.draft(ownerContext(ctx, row), id));
  }
  draftForGeneration(ctx: SkillLibraryContext, id: string, expected: number) {
    const row = this.writable(ctx, id);
    return draftDto(this.revision(ownerContext(ctx, row), id, expected));
  }
  create(
    ctx: SkillLibraryContext,
    input: { bundle: SkillBundle; visibility: "tenant" | "shared" },
    source: "create" | "import" | "generate" = "create",
    generation?: GenerateSkillResponse,
  ) {
    permission(ctx, "skills.write");
    if (input.visibility === "shared" && ctx.platformRole !== "superadmin")
      deny();
    if (input.visibility === "shared") {
      const owner = this.db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.slug, "__system"))
        .get();
      if (!owner)
        throw new SkillLibraryError(
          "shared_library_unavailable",
          "The system tenant is not configured.",
          503,
        );
      ctx = { ...ctx, tenantId: owner.id };
    }
    const bundle = admitSkillDraft(input.bundle);
    const validation = assertValidSkillBundle(bundle);
    return this.db.transaction((db) => {
      this.availableName(ctx, validation.metadata.name, undefined, db);
      const id = makeId("skl");
      const now = new Date();
      db.insert(managedSkills)
        .values({
          id,
          tenantId: ctx.tenantId,
          name: validation.metadata.name,
          description: validation.metadata.description,
          visibility: input.visibility,
          createdBy: actor(ctx),
          createdAt: now,
          updatedAt: now,
        })
        .run();
      const draft = {
        skillId: id,
        tenantId: ctx.tenantId,
        revision: 1,
        bundleJson: bundle,
        diagnosticsJson: generation?.diagnostics ?? validation.diagnostics,
        provenanceJson: generation?.provenance ?? null,
        creatorNotesJson: generation ? creatorNotes(generation, 1) : null,
        updatedAt: now,
        updatedBy: actor(ctx),
      };
      db.insert(skillDrafts).values(draft).run();
      db.insert(skillDraftRevisions)
        .values({ ...draft, id: makeId("skr"), source })
        .run();
      audit(db, ctx, id, source, {
        revision: 1,
        visibility: input.visibility,
        contentDigest: validation.digest,
      });
      return this.detail(ctx, id, db);
    });
  }
  save(
    ctx: SkillLibraryContext,
    id: string,
    expected: number,
    input: SkillBundle,
    source: "manual" | "generate" | "restore" = "manual",
    generation?: {
      diagnostics: GenerateSkillResponse["diagnostics"];
      provenance: SkillGenerationProvenance | null;
      creatorNotes?: SkillDraft["creatorNotes"];
    } & Partial<
      Pick<
        GenerateSkillResponse,
        "assumptions" | "suggestedTests" | "changeSummary"
      >
    >,
    restoredRevision?: number,
  ) {
    const bundle = admitSkillDraft(input);
    const validation = validateSkillBundle(bundle);
    return this.db.transaction((db) => {
      const skill = this.writable(ctx, id, db);
      ctx = ownerContext(ctx, skill);
      const current = this.revision(ctx, id, expected, db);
      const now = new Date();
      const notes =
        source === "generate" &&
        generation?.assumptions &&
        generation.suggestedTests &&
        generation.changeSummary
          ? creatorNotes(generation as GenerateSkillResponse, expected + 1)
          : source === "restore"
            ? (generation?.creatorNotes ?? null)
            : current.creatorNotesJson;
      const draft = {
        skillId: id,
        tenantId: ctx.tenantId,
        revision: expected + 1,
        bundleJson: bundle,
        diagnosticsJson: generation?.diagnostics ?? validation.diagnostics,
        provenanceJson: generation
          ? generation.provenance
          : current.provenanceJson,
        creatorNotesJson: notes,
        updatedAt: now,
        updatedBy: actor(ctx),
      };
      db.update(skillDrafts)
        .set(draft)
        .where(
          tenantScope(
            ctx,
            skillDrafts,
          )(
            and(
              eq(skillDrafts.skillId, id),
              eq(skillDrafts.revision, expected),
            ),
          ),
        )
        .run();
      db.insert(skillDraftRevisions)
        .values({ ...draft, id: makeId("skr"), source })
        .run();
      db.update(managedSkills)
        .set({ updatedAt: now })
        .where(tenantScope(ctx, managedSkills)(eq(managedSkills.id, id)))
        .run();
      audit(db, ctx, id, `draft.${source}`, {
        previousRevision: expected,
        revision: expected + 1,
        valid: validation.valid,
        ...(restoredRevision ? { restoredRevision } : {}),
        ...(generation?.provenance
          ? {
              requestDigest: generation.provenance.requestDigest,
              outputDigest: generation.provenance.outputDigest,
            }
          : {}),
      });
      return this.detail(ctx, id, db);
    });
  }
  publish(ctx: SkillLibraryContext, id: string, expected: number) {
    permission(ctx, "skills.publish");
    return this.db.transaction((db) => {
      const skill = this.writable(ctx, id, db);
      ctx = ownerContext(ctx, skill);
      const draft = this.revision(ctx, id, expected, db);
      const bundle = SkillBundleSchema.parse(draft.bundleJson);
      const validation = assertValidSkillBundle(bundle);
      this.availableName(ctx, validation.metadata.name, id, db);
      const previous = db
        .select({ versionNo: skillVersions.versionNo })
        .from(skillVersions)
        .where(tenantScope(ctx, skillVersions)(eq(skillVersions.skillId, id)))
        .orderBy(desc(skillVersions.versionNo))
        .limit(1)
        .get();
      const versionId = makeId("skv");
      const versionNo = (previous?.versionNo ?? 0) + 1;
      const now = new Date();
      db.insert(skillVersions)
        .values({
          id: versionId,
          skillId: id,
          tenantId: ctx.tenantId,
          versionNo,
          draftRevision: expected,
          bundleJson: bundle,
          contentDigest: validation.digest,
          name: validation.metadata.name,
          description: validation.metadata.description,
          createdBy: actor(ctx),
          createdAt: now,
        })
        .run();
      db.update(managedSkills)
        .set({
          name: validation.metadata.name,
          description: validation.metadata.description,
          latestVersionId: versionId,
          updatedAt: now,
        })
        .where(tenantScope(ctx, managedSkills)(eq(managedSkills.id, id)))
        .run();
      audit(db, ctx, id, "publish", {
        versionId,
        versionNo,
        draftRevision: expected,
        contentDigest: validation.digest,
      });
      return this.detail(ctx, id, db);
    });
  }
  archive(
    ctx: SkillLibraryContext,
    id: string,
    input: {
      archived: boolean;
      expectedRevision: number;
      expectedLatestVersionId: string | null;
    },
  ) {
    return this.db.transaction((db) => {
      const skill = this.writable(ctx, id, db, true);
      ctx = ownerContext(ctx, skill);
      const draft = this.revision(ctx, id, input.expectedRevision, db);
      if (skill.latestVersionId !== input.expectedLatestVersionId)
        throw new SkillLibraryError(
          "revision_conflict",
          "The publication changed. Reload before changing availability.",
          409,
          {
            currentRevision: draft.revision,
            latestVersionId: skill.latestVersionId,
          },
        );
      const now = new Date();
      db.update(managedSkills)
        .set({ archivedAt: input.archived ? now : null, updatedAt: now })
        .where(tenantScope(ctx, managedSkills)(eq(managedSkills.id, id)))
        .run();
      audit(db, ctx, id, input.archived ? "archive" : "unarchive", {
        revision: draft.revision,
        latestVersionId: skill.latestVersionId,
      });
      return this.detail(ctx, id, db);
    });
  }
  history(
    ctx: SkillLibraryContext,
    id: string,
    query: { offset: number; limit: number },
  ) {
    this.draftForRead(ctx, id);
    ctx = ownerContext(ctx, this.row(ctx, id));
    const rows = this.db
      .select(revisionColumns)
      .from(skillDraftRevisions)
      .where(
        tenantScope(
          ctx,
          skillDraftRevisions,
        )(eq(skillDraftRevisions.skillId, id)),
      )
      .orderBy(desc(skillDraftRevisions.revision))
      .limit(query.limit + 1)
      .offset(query.offset)
      .all();
    return {
      revisions: rows.slice(0, query.limit).map((row) => ({
        revision: row.revision,
        diagnostics: row.diagnosticsJson,
        updatedBy: row.updatedBy,
        updatedAt: row.updatedAt.getTime(),
        source: row.source,
      })),
      nextOffset: rows.length > query.limit ? query.offset + query.limit : null,
    };
  }
  historicalDraft(ctx: SkillLibraryContext, id: string, revision: number) {
    this.draftForRead(ctx, id);
    ctx = ownerContext(ctx, this.row(ctx, id));
    const row = this.db
      .select()
      .from(skillDraftRevisions)
      .where(
        tenantScope(
          ctx,
          skillDraftRevisions,
        )(
          and(
            eq(skillDraftRevisions.skillId, id),
            eq(skillDraftRevisions.revision, revision),
          ),
        ),
      )
      .get();
    if (!row)
      throw new SkillLibraryError(
        "revision_not_found",
        "Draft revision not found.",
        404,
      );
    return draftDto(row);
  }
  restore(
    ctx: SkillLibraryContext,
    id: string,
    expected: number,
    revision: number,
  ) {
    const previous = this.historicalDraft(ctx, id, revision);
    return this.save(
      ctx,
      id,
      expected,
      previous.bundle,
      "restore",
      previous,
      revision,
    );
  }
}
