import { z } from "zod";

/** Shared transport limits. Byte, archive and YAML expansion checks also run
 * in @agentic/skills before any bundle is admitted or materialized. */
export const SKILL_BUNDLE_LIMITS = Object.freeze({
  maxArchiveBytes: 24 * 1024 * 1024,
  maxBundleBytes: 20 * 1024 * 1024,
  maxFileBytes: 5 * 1024 * 1024,
  // Official SDK/reference Skills can contain several hundred small resources.
  // Keep byte limits independent so full bundles do not broaden memory budgets.
  maxFiles: 512,
  maxSkillMdBytes: 256 * 1024,
  maxPathLength: 240,
  maxPathDepth: 16,
  maxCompressionRatio: 200,
  maxFrontmatterBytes: 32 * 1024,
});

export const SkillNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, digits and single internal hyphens",
  );

/** Portable paths are not host paths. The core admission layer additionally
 * checks cross-file collisions and filesystem containment. */
export const SkillFilePathSchema = z
  .string()
  .min(1)
  .max(SKILL_BUNDLE_LIMITS.maxPathLength)
  .refine((value) => {
    if (value !== value.normalize("NFC")) return false;
    for (const point of value) {
      const code = point.codePointAt(0)!;
      if (code >= 0xd800 && code <= 0xdfff) return false;
    }
    if (/[\\:*?"<>|\u0000-\u001f\u007f-\u009f]/u.test(value)) return false;
    if (
      new TextEncoder().encode(value).length > SKILL_BUNDLE_LIMITS.maxPathLength
    )
      return false;
    const parts = value.split("/");
    return (
      parts.length <= SKILL_BUNDLE_LIMITS.maxPathDepth &&
      parts.every(
        (part) =>
          part !== "" &&
          part !== "." &&
          part !== ".." &&
          part.trim() === part &&
          !part.endsWith(".") &&
          !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part),
      )
    );
  }, "Use a normalized relative file path without traversal or platform separators");

export const SkillFileSchema = z
  .object({
    path: SkillFilePathSchema,
    content: z
      .string()
      .max(Math.ceil(SKILL_BUNDLE_LIMITS.maxFileBytes / 3) * 4),
    encoding: z.enum(["utf8", "base64"]),
  })
  .strict();
export type SkillFile = z.infer<typeof SkillFileSchema>;

export const SkillBundleSchema = z
  .object({
    files: z.array(SkillFileSchema).min(1).max(SKILL_BUNDLE_LIMITS.maxFiles),
  })
  .strict();
export type SkillBundle = z.infer<typeof SkillBundleSchema>;

/** Preserve extension metadata for portable round trips. Descriptive metadata
 * is never authorization to execute a Tool or script. */
export const SkillFrontmatterSchema = z
  .object({
    name: SkillNameSchema,
    description: z
      .string()
      .min(1)
      .max(1024)
      .refine(
        (value) => value.trim().length > 0,
        "Describe when to use this skill",
      ),
    license: z.string().optional(),
    compatibility: z
      .string()
      .min(1)
      .max(500)
      .refine(
        (value) => value.trim().length > 0,
        "Describe the required environment",
      )
      .optional(),
    metadata: z.record(z.string(), z.string()).optional(),
    "allowed-tools": z.string().optional(),
    "disable-model-invocation": z.boolean().optional(),
  })
  .catchall(z.unknown());
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

export const SkillDiagnosticSchema = z
  .object({
    severity: z.enum(["error", "warning"]),
    code: z.string().min(1),
    message: z.string().min(1),
    path: z.string().optional(),
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
  })
  .strict();
export type SkillDiagnostic = z.infer<typeof SkillDiagnosticSchema>;

export const SkillSuggestedTestSchema = z
  .object({
    id: z.string().min(1).max(80),
    prompt: z.string().min(1).max(12_000),
    shouldTrigger: z.boolean(),
    expectedCriteria: z.array(z.string().min(1).max(2000)).min(1).max(20),
  })
  .strict();
export type SkillSuggestedTest = z.infer<typeof SkillSuggestedTestSchema>;

/** Generated text is a proposal, never execution evidence. On revision, files
 * are additions/replacements; omitted files (including binary assets) remain.
 * The editor handles explicit file removal. */
export const SkillCreatorOutputSchema = z
  .object({
    files: z
      .array(SkillFileSchema.extend({ encoding: z.literal("utf8") }))
      .min(1)
      .max(SKILL_BUNDLE_LIMITS.maxFiles),
    assumptions: z.array(z.string().min(1).max(2000)).max(30),
    suggestedTests: z.array(SkillSuggestedTestSchema).max(10),
    changeSummary: z.array(z.string().min(1).max(2000)).max(30),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.files.some((file) => file.path === "SKILL.md")) {
      ctx.addIssue({
        code: "custom",
        path: ["files"],
        message: "The proposed files must include SKILL.md",
      });
    }
    const ids = new Set<string>();
    value.suggestedTests.forEach((test, index) => {
      if (ids.has(test.id))
        ctx.addIssue({
          code: "custom",
          path: ["suggestedTests", index, "id"],
          message: "Each test id must be unique",
        });
      ids.add(test.id);
    });
  });
export type SkillCreatorOutput = z.infer<typeof SkillCreatorOutputSchema>;
