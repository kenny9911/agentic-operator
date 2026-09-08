import { z } from "zod";

const SkillSelectionsSchema = z.array(z.object({
      id: z.string().trim().min(1).max(240),
      versionId: z.string().trim().min(1).max(240).optional(),
      activate: z.boolean().optional(),
    }).strict()).max(1000).superRefine((entries, ctx) => {
      const ids = new Set<string>();
      entries.forEach((entry, index) => {
        if (ids.has(entry.id)) ctx.addIssue({ code: "custom", path: [index, "id"], message: "Duplicate Skill selection" });
        ids.add(entry.id);
      });
    });

/** A selection narrows the inherited catalog. It never grants business tools. */
export const SkillBindingsSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("inherit"), skills: SkillSelectionsSchema.optional() }).strict(),
  z.object({ mode: z.literal("disabled"), skills: SkillSelectionsSchema.optional() }).strict(),
  z.object({
    mode: z.literal("selected"),
    skills: SkillSelectionsSchema,
  }).strict(),
]);
export type SkillBindings = z.infer<typeof SkillBindingsSchema>;
