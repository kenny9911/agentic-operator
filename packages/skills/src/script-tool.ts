import { defineTool } from "@agentic/agent-kit";
import { SkillScriptInputSchema } from "@agentic/contracts";
import { z } from "zod";
import type { SkillSession } from "./session";

export const SKILL_SCRIPT_TOOL_NAME = "skills.run_script";
export const SKILL_SCRIPT_TOOL_DESCRIPTION = "Run a script from an active immutable Skill in the approved isolated container. Requires this business tool in the agent allowlist and an independent host script policy. Images, credentials and permissions cannot be supplied as arguments.";
/** This is a business tool, never included among read-only Skill intrinsics. */
export function buildSessionSkillScriptTool(session: SkillSession) {
  return {
    ...defineTool({
      name: SKILL_SCRIPT_TOOL_NAME,
      description: SKILL_SCRIPT_TOOL_DESCRIPTION,
      async handler(ctx) { return { data: await session.runScript(SkillScriptInputSchema.parse(ctx.event?.data), ctx.signal) }; },
    }),
    inputSchema: z.toJSONSchema(SkillScriptInputSchema) as Record<string, unknown>,
  };
}
