import { z } from "zod";
import {
  SkillBundleSchema,
  SkillDiagnosticSchema,
  SkillFrontmatterSchema,
  SKILL_BUNDLE_LIMITS,
} from "./skills";
import {
  GenerateSkillBodySchema,
  GenerateSkillResponseSchema,
  SkillGenerationProvenanceSchema,
} from "./skill-generation";

export const SkillVisibilitySchema = z.enum(["tenant", "shared"]);
const Revision = z.number().int().positive();
const Timestamp = z.number().int().nonnegative();
export const ManagedSkillSummarySchema = z
  .object({
    id: z.string(),
    tenantId: z.string(),
    name: z.string(),
    description: z.string(),
    visibility: SkillVisibilitySchema,
    enabled: z.boolean().default(true),
    latestVersionId: z.string().nullable(),
    latestVersionNo: Revision.nullable(),
    archivedAt: Timestamp.nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    canEdit: z.boolean(),
    draftRevision: Revision.nullable(),
  })
  .strict();
export type ManagedSkillSummary = z.infer<typeof ManagedSkillSummarySchema>;
export const SkillCreatorNotesSchema = GenerateSkillResponseSchema.pick({
  assumptions: true,
  suggestedTests: true,
  changeSummary: true,
})
  .extend({
    generatedRevision: Revision,
    evaluationStatus: z.literal("unexecuted"),
  })
  .strict();
export const SkillDraftSchema = z
  .object({
    revision: Revision,
    bundle: SkillBundleSchema,
    diagnostics: z.array(SkillDiagnosticSchema),
    /** Retained notes/provenance describe the last generation at creatorNotes.generatedRevision, not an evaluation of current edits. */
    creatorNotes: SkillCreatorNotesSchema.nullable(),
    provenance: SkillGenerationProvenanceSchema.nullable(),
    updatedAt: Timestamp,
    updatedBy: z.string().nullable(),
  })
  .strict();
export type SkillDraft = z.infer<typeof SkillDraftSchema>;
export const SkillVersionSummarySchema = z
  .object({
    id: z.string(),
    skillId: z.string(),
    versionNo: Revision,
    name: z.string(),
    description: z.string(),
    contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
    draftRevision: Revision,
    createdAt: Timestamp,
    createdBy: z.string().nullable(),
  })
  .strict();
export const SkillVersionSchema = SkillVersionSummarySchema.extend({
  bundle: SkillBundleSchema,
});
export type SkillVersion = z.infer<typeof SkillVersionSchema>;
export const SkillVersionHistorySchema = z
  .object({
    versions: z.array(SkillVersionSummarySchema),
    nextOffset: z.number().int().nullable(),
  })
  .strict();
export const SkillDetailSchema = z
  .object({
    skill: ManagedSkillSummarySchema,
    draft: SkillDraftSchema.nullable(),
    latestVersion: SkillVersionSchema.nullable(),
    versions: z.array(SkillVersionSummarySchema),
  })
  .strict();
export type SkillDetail = z.infer<typeof SkillDetailSchema>;
const booleanQuery = z
  .enum(["true", "false"])
  .transform((value) => value === "true");
export const ListSkillsQuerySchema = z
  .object({
    scope: z.enum(["available", "owned", "shared"]).default("available"),
    archived: booleanQuery.default(false),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export const SkillListResponseSchema = z
  .object({
    skills: z.array(ManagedSkillSummarySchema),
    nextOffset: z.number().int().nullable(),
  })
  .strict();
export const CreateSkillBodySchema = z
  .object({
    bundle: SkillBundleSchema,
    visibility: SkillVisibilitySchema.default("tenant"),
  })
  .strict();
export const SaveSkillDraftBodySchema = z
  .object({ expectedRevision: Revision, bundle: SkillBundleSchema })
  .strict();
export const PublishSkillBodySchema = z
  .object({ expectedRevision: Revision })
  .strict();
export const RestoreSkillDraftBodySchema = PublishSkillBodySchema.extend({
  revision: Revision,
}).strict();
export const ArchiveSkillBodySchema = z
  .object({
    archived: z.boolean(),
    expectedRevision: Revision,
    expectedLatestVersionId: z.string().nullable(),
  })
  .strict();
export const SetSkillEnabledBodySchema = z
  .object({
    enabled: z.boolean(),
    expectedEnabled: z.boolean(),
    expectedRevision: Revision,
    expectedLatestVersionId: z.string().nullable(),
  })
  .strict();
export type SetSkillEnabledBody = z.infer<typeof SetSkillEnabledBodySchema>;
export const ValidateSkillBodySchema = z
  .object({ bundle: SkillBundleSchema })
  .strict();
export const SkillValidationResponseSchema = z
  .object({
    valid: z.boolean(),
    diagnostics: z.array(SkillDiagnosticSchema),
    metadata: SkillFrontmatterSchema.optional(),
  })
  .strict();
export const SkillRevisionSummarySchema = SkillDraftSchema.omit({
  bundle: true,
  provenance: true,
  creatorNotes: true,
}).extend({
  source: z.enum(["create", "import", "manual", "generate", "restore"]),
});
export const SkillRevisionHistorySchema = z
  .object({
    revisions: z.array(SkillRevisionSummarySchema),
    nextOffset: z.number().int().nullable(),
  })
  .strict();
export const SkillHistoryQuerySchema = z
  .object({
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export const SkillExportQuerySchema = z
  .object({
    format: z.enum(["zip", "markdown"]).default("zip"),
    versionId: z.string().min(1).optional(),
    draft: booleanQuery.default(false),
  })
  .strict()
  .refine(
    (value) => !(value.draft && value.versionId),
    "Choose a draft or a published version, not both",
  );
export const ImportSkillBodySchema = z.discriminatedUnion("format", [
  z
    .object({
      format: z.literal("zip"),
      archiveBase64: z
        .string()
        .max(Math.ceil(SKILL_BUNDLE_LIMITS.maxArchiveBytes / 3) * 4),
      visibility: SkillVisibilitySchema.default("tenant"),
    })
    .strict(),
  z
    .object({
      format: z.literal("markdown"),
      content: z.string().max(SKILL_BUNDLE_LIMITS.maxSkillMdBytes),
      visibility: SkillVisibilitySchema.default("tenant"),
    })
    .strict(),
  z
    .object({
      format: z.literal("bundle"),
      bundle: SkillBundleSchema,
      visibility: SkillVisibilitySchema.default("tenant"),
    })
    .strict(),
]);
export const SkillImportPreviewSchema = SkillValidationResponseSchema.extend({
  bundle: SkillBundleSchema,
});
export const CreateGeneratedSkillBodySchema = GenerateSkillBodySchema.extend({
  visibility: SkillVisibilitySchema.default("tenant"),
}).strict();
export const ReviseGeneratedSkillBodySchema = GenerateSkillBodySchema.extend({
  expectedRevision: Revision,
}).strict();
export const ManagedSkillGenerationResponseSchema = z
  .object({
    detail: SkillDetailSchema,
    generation: GenerateSkillResponseSchema,
  })
  .strict();
