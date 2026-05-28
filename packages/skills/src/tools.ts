/**
 * Built-in skill tools — every tenant that exports `skills: SkillDescriptor[]`
 * gets these two tools registered automatically by the runtime bootstrap.
 *
 * The progressive-disclosure pattern:
 *   1. The agent's system prompt lists skill names + one-line descriptions
 *      (metadata only, cheap to ship to the LLM).
 *   2. When the model needs a skill's full body, it calls `load_skill`
 *      with the name; the runtime returns the SKILL.md body verbatim.
 *
 * This mirrors Anthropic's Skills design (markdown that loads on demand)
 * so future migration to Anthropic's hosted Skills API is a thin shim.
 */

import { defineTool } from "@agentic/agent-kit";
import type { ToolDescriptor } from "@agentic/agent-kit";
import { z } from "zod";

import { readSkillBody, type SkillDescriptor } from "./loader";

/**
 * Build the `skills.list_skills` and `skills.load_skill` tools, closed
 * over the tenant's skill set. Returns descriptors keyed by qualified
 * tool name so the runtime can spread them straight into
 * `tenantRegistry.tools`.
 *
 * `qualified` names use the `skills.` prefix so a tenant tool named
 * `list_skills` (unlikely but possible) doesn't collide.
 */
export function buildSkillTools(
  skills: SkillDescriptor[],
): Record<string, ToolDescriptor> {
  // Snapshot the descriptor list so later mutations to the input array
  // don't leak into the closure. Cheap — descriptors are tiny.
  const byName = new Map<string, SkillDescriptor>();
  for (const s of skills) byName.set(s.name, s);

  const listSkills = defineTool({
    name: "skills.list_skills",
    description:
      "Return the catalogue of skills (name + one-line description) available to this agent. Call this FIRST before requesting any specific skill body.",
    output: z.object({
      skills: z.array(
        z.object({
          name: z.string(),
          description: z.string(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        }),
      ),
    }),
    async handler() {
      return {
        data: {
          skills: skills.map((s) => ({
            name: s.name,
            description: s.description,
            metadata: s.metadata,
          })),
        },
        meta: { skillsCount: skills.length },
      };
    },
  });

  const loadSkill = defineTool({
    name: "skills.load_skill",
    description:
      "Load the full SKILL.md body for one skill by name. Use this only after `list_skills` confirms the skill exists and you actually need its detailed guidance.",
    output: z.object({
      name: z.string(),
      body: z.string(),
      bytes: z.number(),
    }),
    async handler(ctx) {
      // The tool-use loop puts the model's `arguments` under `ctx.event.data`
      // (set in step-engine's loop). Accept either `name` (preferred) or
      // a bare string for resilience.
      const raw = ctx.event?.data ?? {};
      const requested =
        typeof raw === "object" && raw !== null
          ? String(
              (raw as Record<string, unknown>).name ??
                (raw as Record<string, unknown>).skill ??
                "",
            )
          : String(raw);
      if (!requested) {
        throw new Error(
          "skills.load_skill: required argument `name` missing or empty",
        );
      }
      const descriptor = byName.get(requested);
      if (!descriptor) {
        throw new Error(
          `skills.load_skill: unknown skill '${requested}'. Known: ${Array.from(
            byName.keys(),
          ).join(", ")}`,
        );
      }
      const body = readSkillBody(descriptor.path);
      return {
        data: {
          name: descriptor.name,
          body,
          bytes: Buffer.byteLength(body, "utf8"),
        },
        meta: { skill: descriptor.name, path: descriptor.path },
      };
    },
  });

  return {
    [listSkills.name]: listSkills,
    [loadSkill.name]: loadSkill,
  };
}

/**
 * Build a one-line snippet for inclusion in an agent's system prompt so
 * the model knows the skills exist without us having to teach it about
 * the `list_skills`/`load_skill` tools in every prompt. The runtime
 * doesn't auto-inject this — tenants opt in by interpolating it inside
 * their `definePrompt({system: ...})` body.
 */
export function buildSkillsPromptHint(skills: SkillDescriptor[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map(
    (s) => `  - ${s.name}: ${s.description}`,
  );
  return [
    "Available skills (use the `skills.load_skill` tool to fetch the full body of any of these):",
    ...lines,
  ].join("\n");
}
