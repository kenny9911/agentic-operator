import { describe, expect, it } from "vitest";
import type { SkillSessionSnapshot } from "@agentic/skills";
import { workflowSkillEvidence } from "../src/services/workflow-skill-evidence";

describe("Workflow Test Lab Skill evidence", () => {
  const snapshot = {
    catalogDigest: "captured-catalog",
    activations: [
      {
        id: "skill",
        versionId: "v1",
        contentDigest: "digest",
        origin: "explicit",
      },
    ],
  } as SkillSessionSnapshot;
  it("retains successful immutable reference receipts without bodies or unrelated business data", () => {
    const evidence = workflowSkillEvidence(snapshot, [
      {
        name: "skills.read_resource",
        isError: false,
        input: { id: "skill", path: "references/a.md" },
        output: {
          skill: { id: "skill", versionId: "v1", contentDigest: "digest" },
          path: "references/a.md",
          bytes: 6,
          content: "SECRET",
        },
      },
      { name: "business.read", isError: false, output: { secret: "BUSINESS" } },
    ]);
    expect(evidence.accesses).toEqual([
      {
        operation: "skills.read_resource",
        ok: true,
        skillId: "skill",
        versionId: "v1",
        contentDigest: "digest",
        path: "references/a.md",
        bytes: 6,
      },
    ]);
    expect(evidence.activations[0]?.origin).toBe("explicit");
    expect(JSON.stringify(evidence)).not.toMatch(/SECRET|BUSINESS/);
  });
  it("records failed read attempts without implying verified version or returned bytes", () => {
    const evidence = workflowSkillEvidence(snapshot, [
      {
        name: "skills.read_resource",
        isError: true,
        input: { id: "unknown", path: "missing.md" },
        output: { error: "Not available" },
      },
    ]);
    expect(evidence.accesses[0]).toMatchObject({
      ok: false,
      skillId: "unknown",
      error: "Not available",
    });
    expect(JSON.parse(JSON.stringify(evidence)).accesses[0]).not.toHaveProperty(
      "versionId",
    );
    expect(JSON.parse(JSON.stringify(evidence)).accesses[0]).not.toHaveProperty(
      "bytes",
    );
  });
});
