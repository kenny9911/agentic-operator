/** Model-facing adapters. Business Tool authorization remains owned by the
 * calling harness; registering these descriptors grants no Tool access. */
import { basename, dirname } from "node:path";
import { defineTool, type ToolDescriptor } from "@agentic/agent-kit";
import { z } from "zod";
import { assertValidSkillBundle } from "./bundle";
import { readSkillBundleFromDirectory, type SkillDescriptor } from "./loader";
import {
  type SkillActivationOrigin,
  type SkillSelector,
  type SkillSession,
} from "./session";

const pageSchema = z
  .object({
    cursor: z.string().max(4096).optional(),
    limit: z.number().int().positive().max(100).optional(),
  })
  .strict();
const selectionFields = {
  name: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe(
      "A name from the available skill catalog; use name or id, not both.",
    ),
  id: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .describe(
      "An id from the available skill catalog; use id or name, not both.",
    ),
};
const selected = (value: { name?: string; id?: string }) =>
  Boolean(value.name) !== Boolean(value.id);
const selectionSchema = z
  .object(selectionFields)
  .strict()
  .refine(selected, "Specify exactly one skill name or id");
const resourcesSchema = z
  .object({ ...selectionFields, ...pageSchema.shape })
  .strict()
  .refine(selected, "Specify exactly one skill name or id");
const resourceSchema = z
  .object({ ...selectionFields, path: z.string().min(1).max(240) })
  .strict()
  .refine(selected, "Specify exactly one skill name or id");

// Model schemas use one required selector. A refinement on two optional
// fields disappears in JSON Schema and caused real models to send both.
// Trusted SDK/legacy callers may still use a name through the strict parser.
const modelSelectionFields = {
  id: z
    .string()
    .min(1)
    .max(512)
    .describe(
      "Exact Skill id from the available catalog or already active instructions.",
    ),
};
const modelSelectionSchema = z.object(modelSelectionFields).strict();
const modelResourcesSchema = z
  .object({ ...modelSelectionFields, ...pageSchema.shape })
  .strict();
const modelResourceSchema = z
  .object({ ...modelSelectionFields, path: z.string().min(1).max(240) })
  .strict();

function selector(value: { name?: string; id?: string }): SkillSelector {
  return value.id ? { id: value.id } : { name: value.name! };
}

function withInput<T>(
  tool: ToolDescriptor<T>,
  schema: z.ZodType,
): ToolDescriptor<T> {
  return {
    ...tool,
    inputSchema: z.toJSONSchema(schema) as Record<string, unknown>,
  };
}

/** Compatibility tools use a fixed validated source snapshot, never a mutable
 * path read during an Agent turn. No activation state is shared across Runs.
 * New harness integrations should use buildSessionSkillTools instead. */
export function buildSkillTools(
  skills: SkillDescriptor[],
): Record<string, ToolDescriptor> {
  const byName = new Map<string, ReturnType<typeof assertValidSkillBundle>>();
  for (const source of skills) {
    if (basename(source.path) !== "SKILL.md")
      throw new Error("Skill descriptors must identify SKILL.md");
    const bundle = readSkillBundleFromDirectory(dirname(source.path));
    const validated = assertValidSkillBundle(bundle);
    if (validated.metadata.name !== source.name)
      throw new Error("Skill descriptor name no longer matches its source");
    if (byName.has(source.name))
      throw new Error(`Duplicate skill '${source.name}'`);
    byName.set(source.name, validated);
  }
  const catalog = [...byName.values()]
    .filter((entry) => entry.metadata["disable-model-invocation"] !== true)
    .sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));

  const list = withInput(
    defineTool({
      name: "skills.list_skills",
      description:
        "List skill names and descriptions available to this agent. Load the relevant skill when its procedure is needed.",
      async handler() {
        return {
          data: {
            skills: catalog.map((entry) => ({
              name: entry.metadata.name,
              description: entry.metadata.description,
              metadata: structuredClone(entry.metadata),
            })),
          },
          meta: { skillsCount: catalog.length },
        };
      },
    }),
    z.object({}).strict(),
  );

  const loadInput = z.object({ name: z.string().min(1).max(64) }).strict();
  const load = withInput(
    defineTool({
      name: "skills.load_skill",
      description:
        "Load the instructions for an available skill by name. Skill instructions do not grant tools or other permissions.",
      async handler(ctx) {
        // Keep the historical bare-name and `skill` alias call shape accepted.
        const raw: unknown = ctx.event?.data;
        const candidate =
          typeof raw === "string"
            ? { name: raw }
            : raw &&
                typeof raw === "object" &&
                "skill" in raw &&
                !("name" in raw)
              ? { name: (raw as Record<string, unknown>).skill }
              : raw;
        const { name } = loadInput.parse(candidate);
        const entry = byName.get(name);
        if (!entry || entry.metadata["disable-model-invocation"] === true)
          throw new Error(
            "Requested skill is not available for model invocation",
          );
        return {
          data: {
            name: entry.metadata.name,
            body: entry.body,
            bytes: Buffer.byteLength(entry.body, "utf8"),
          },
          meta: { skill: entry.metadata.name, contentDigest: entry.digest },
        };
      },
    }),
    loadInput,
  );

  return { [list.name]: list, [load.name]: load };
}

/** Bind descriptors to ONE host-owned execution session. Model arguments
 * cannot choose an activation origin, authorizer, catalog or version. */
export function buildSessionSkillTools(
  session: SkillSession,
  options: { activationOrigin?: SkillActivationOrigin } = {},
): Record<string, ToolDescriptor> {
  // Only a trusted harness supplies this option. It never comes from tool args.
  const origin = options.activationOrigin ?? "model";
  const list = withInput(
    defineTool({
      name: "skills.list_skills",
      description:
        "List available skill names, descriptions and exact versions. Use nextCursor to continue a large catalog.",
      async handler(ctx) {
        const data = await session.list({
          ...pageSchema.parse(ctx.event?.data ?? {}),
          origin,
        });
        return { data };
      },
    }),
    pageSchema,
  );
  const load = withInput(
    defineTool({
      name: "skills.load_skill",
      description:
        "Activate an available skill's instructions by its exact catalog id. Already active instructions do not need loading again. Read supporting resources only when relevant; activation grants no business tools or execution permissions.",
      async handler(ctx) {
        const input = selectionSchema.parse(ctx.event?.data);
        const data = await session.activate(selector(input), { origin });
        return {
          data,
          meta: {
            skill: data.name,
            skillVersionId: data.versionId,
            contentDigest: data.contentDigest,
          },
        };
      },
    }),
    modelSelectionSchema,
  );
  const resources = withInput(
    defineTool({
      name: "skills.list_resources",
      description:
        "List resource paths and sizes in an activated skill by its exact id; paginate with nextCursor.",
      async handler(ctx) {
        const input = resourcesSchema.parse(ctx.event?.data);
        const data = await session.listResources(selector(input), {
          cursor: input.cursor,
          limit: input.limit,
        });
        return { data };
      },
    }),
    modelResourcesSchema,
  );
  const read = withInput(
    defineTool({
      name: "skills.read_resource",
      description:
        "Read one relative resource path from an activated skill. Returns UTF-8 text or base64 binary bytes with limits. Reading a script does not execute it.",
      async handler(ctx) {
        const input = resourceSchema.parse(ctx.event?.data);
        const data = await session.readResource(selector(input), input.path);
        return {
          data,
          meta: {
            skill: data.skill.name,
            skillVersionId: data.skill.versionId,
            contentDigest: data.skill.contentDigest,
            resourcePath: data.path,
          },
        };
      },
    }),
    modelResourceSchema,
  );
  return Object.fromEntries(
    [list, load, resources, read].map((tool) => [tool.name, tool]),
  );
}

/** Compatibility prompt helper. New sessions provide their own paginated
 * catalog. Metadata is serialized so descriptions cannot corrupt formatting. */
export function buildSkillsPromptHint(skills: SkillDescriptor[]): string {
  const catalog = skills
    .filter((entry) => entry.metadata?.["disable-model-invocation"] !== true)
    .map(({ name, description }) => ({ name, description }));
  if (!catalog.length) return "";
  return (
    "Available skills (load applicable instructions with skills.load_skill; skills grant no Tool permissions):\n" +
    JSON.stringify(catalog)
  );
}
