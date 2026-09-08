import {
  WorkflowTestSkillEvidenceSchema,
  type WorkflowTestSkillEvidence,
} from "@agentic/contracts";
import type { SkillSessionSnapshot } from "@agentic/skills";

const operations = new Set([
  "skills.list_skills",
  "skills.load_skill",
  "skills.list_resources",
  "skills.read_resource",
]);
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) =>
  typeof value === "string" ? value : undefined;

/** Test Lab keeps exact access receipts, never resource bodies or model reasoning. */
export function workflowSkillEvidence(
  snapshot: SkillSessionSnapshot,
  toolCalls: unknown,
): WorkflowTestSkillEvidence {
  return WorkflowTestSkillEvidenceSchema.parse({
    catalogDigest: snapshot.catalogDigest,
    activations: snapshot.activations,
    accesses: (Array.isArray(toolCalls) ? toolCalls : [])
      .map(record)
      .filter((call) => operations.has(String(call.name)))
      .map((call) => {
        const output = record(call.output);
        const skill = record(output.skill);
        const input = record(call.input);
        const ok = call.isError === false;
        return {
          operation: call.name,
          ok,
          skillId: text(skill.id) ?? text(input.id),
          versionId: text(skill.versionId),
          contentDigest: text(skill.contentDigest),
          path: text(output.path) ?? text(input.path),
          bytes:
            ok && typeof output.bytes === "number" ? output.bytes : undefined,
          error: !ok ? text(output.error)?.slice(0, 2000) : undefined,
        };
      }),
  });
}
