import { defineTool } from "@agentic/agent-kit";
import { SkillScriptInputSchema } from "@agentic/contracts";
import { z } from "zod";

/** Catalog admission only. The runtime replaces this with a session-bound
 * handler after enforcing the business allowlist and independent host policy. */
export const runSkillScript = {
  ...defineTool({
    name: "skills.run_script",
    description: "Run an active Skill script in the host-approved isolated container. Requires separate agent tool permission and host script configuration.",
    async handler() { throw new Error("Skill scripts require a trusted runtime session and an approved isolated runner"); },
  }),
  inputSchema: z.toJSONSchema(SkillScriptInputSchema) as Record<string, unknown>,
};
