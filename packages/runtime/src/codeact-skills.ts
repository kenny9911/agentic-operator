/** Host-only adapter: no catalog, resolver, origin or session crosses the RPC. */
import { z } from "zod";
import { buildSessionSkillTools, type ActiveSkillInstructions, type SkillResourceResult, type SkillSession } from "@agentic/skills";
import type { CodeActRpcMethod } from "./codeact-worker";

export interface GeneratedCodeSkillAccess {
  operation: "list" | "load" | "listResources" | "readResource";
  skillId?: string;
  skillVersionId?: string;
  contentDigest?: string;
  resourcePath?: string;
  bytes?: number;
}

const selector = z.object({
  id: z.string().min(1).max(512).optional(),
  name: z.string().min(1).max(64).optional(),
}).strict().refine((value) => Boolean(value.id) !== Boolean(value.name), "Specify exactly one catalog id or name");
const page = z.object({ cursor: z.string().max(4096).optional(), limit: z.number().int().positive().max(100).optional() }).strict();
const methods = {
  "skills.list": "skills.list_skills",
  "skills.load": "skills.load_skill",
  "skills.listResources": "skills.list_resources",
  "skills.readResource": "skills.read_resource",
} as const;

export function createCodeActSkillDispatch(
  session: SkillSession | undefined,
  record: (access: GeneratedCodeSkillAccess) => void,
) {
  const tools = session ? buildSessionSkillTools(session, { activationOrigin: "model" }) : {};
  async function intrinsic(name: string, input: unknown): Promise<unknown> {
    const tool = tools[name];
    if (!tool) throw new Error("[skills_not_bound] CodeAct Skills require a host-authorized SkillSession");
    const result = await tool.handler({
      agentName: "codeact", actionName: name, correlationId: "", tenantSlug: "",
      event: { name: "codeact.skill", data: input as Record<string, unknown> },
    });
    const operation = name === "skills.load_skill" ? "load" : name === "skills.read_resource" ? "readResource"
      : name === "skills.list_resources" ? "listResources" : "list";
    const data = result.data as ActiveSkillInstructions | SkillResourceResult;
    const skill = operation === "load" ? data as ActiveSkillInstructions : "skill" in data ? data.skill : undefined;
    record({ operation, ...(skill ? { skillId: skill.id, skillVersionId: skill.versionId, contentDigest: skill.contentDigest } : {}),
      ...(operation === "load" || operation === "readResource" ? { bytes: data.bytes } : {}),
      ...(operation === "readResource" ? { resourcePath: (data as SkillResourceResult).path } : {}),
    });
    return result;
  }
  async function rpc(method: CodeActRpcMethod, args: unknown[]): Promise<unknown> {
    if (!(method in methods)) throw new Error("Unknown CodeAct Skill RPC");
    const key = method as keyof typeof methods;
    const expected = key === "skills.listResources" || key === "skills.readResource" ? 2 : 1;
    if (args.length > expected) throw new Error("Unexpected CodeAct Skill RPC arguments");
    const input = key === "skills.list" ? page.parse(args[0] ?? {})
      : key === "skills.load" ? selector.parse(args[0])
      : key === "skills.listResources" ? { ...selector.parse(args[0]), ...page.parse(args[1] ?? {}) }
      : { ...selector.parse(args[0]), path: z.string().min(1).max(240).parse(args[1]) };
    const result = await intrinsic(methods[key], input) as { data: unknown };
    return result.data;
  }
  return { intrinsic, rpc };
}
