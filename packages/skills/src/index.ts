/**
 * @agentic/skills — Anthropic-style Skills (progressive disclosure of
 * markdown capability files) for tenant agents.
 *
 * Tenants declare a directory of skills:
 *
 *     tenants/<slug>/skills/
 *       candidate-sourcing/SKILL.md
 *       resume-screening/SKILL.md
 *
 * Each SKILL.md starts with a YAML frontmatter block (`name`,
 * `description`, plus arbitrary metadata) followed by the skill's full
 * instructions. The tenant index loads descriptors at boot:
 *
 *     import { loadSkillsFromDirectory } from "@agentic/skills";
 *     const skills = loadSkillsFromDirectory("./skills");
 *     const registry = { ..., skills };
 *
 * The runtime wires two tools into `tenantRegistry.tools` automatically:
 *   - `skills.list_skills` — metadata-only catalogue (cheap)
 *   - `skills.load_skill`  — full body of a named skill (on demand)
 *
 * Agents reference these in `agent.tool_use[]` like any other tool.
 */

export {
  loadSkillsFromDirectory,
  readSkillBody,
  parseFrontmatter,
  type SkillDescriptor,
} from "./loader";

export {
  buildSkillTools,
  buildSkillsPromptHint,
} from "./tools";
