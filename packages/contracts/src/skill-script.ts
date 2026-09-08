import { z } from "zod";

/** Invocation data only. Images, identities, bundles and permissions are host-owned. */
export const SkillScriptInputSchema = z.object({
  id: z.string().min(1).max(240),
  scriptPath: z.string().min(1).max(240).startsWith("scripts/"),
  interpreter: z.enum(["node", "python"]),
  args: z.array(z.string().max(16 * 1024)).max(32).optional(),
  stdin: z.string().max(256 * 1024).optional(),
}).strict();
export type SkillScriptInput = z.infer<typeof SkillScriptInputSchema>;
