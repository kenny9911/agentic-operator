import { describe, expect, it } from "vitest";
import type { SkillBundle } from "@agentic/contracts";
import { applySkillCreatorProposal, loadSkillCreatorPolicy } from "./creator";
import { decodeSkillFile } from "./bundle";

const document =
  "---\nname: supplier-report\ndescription: Summarize supplied supplier exceptions.\nmetadata:\n  owner: operations\n---\nUse reportDate to compute overdue calendar days.\n";
const output = {
  files: [{ path: "SKILL.md", encoding: "utf8", content: document }],
  assumptions: [],
  suggestedTests: [],
  changeSummary: ["Use the supplied report date."],
};

describe("Skill Creator policy and proposals", () => {
  it("loads the maintained policy together with its output contract and digest", () => {
    const policy = loadSkillCreatorPolicy();
    expect(policy.contentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(policy.bundle.files.map((file) => file.path)).toContain(
      "references/output-contract.md",
    );
    expect(policy.instructions).toContain(
      policy.bundle.files.find(
        (file) => file.path === "references/output-contract.md",
      )!.content,
    );
  });

  it("preserves omitted resources and detaches proposal data from its inputs", () => {
    const base: SkillBundle = {
      files: [
        {
          path: "SKILL.md",
          encoding: "utf8",
          content: document.replace("Use reportDate", "Use today"),
        },
        { path: "assets/logo.png", encoding: "base64", content: "AP/+gA==" },
        {
          path: "references/thresholds.md",
          encoding: "utf8",
          content: "Escalate at 7 calendar days overdue.",
        },
      ],
    };
    const result = applySkillCreatorProposal(output, base);
    expect(result.validation.metadata.metadata).toEqual({
      owner: "operations",
    });
    expect(
      decodeSkillFile(
        result.bundle.files.find((file) => file.path === "assets/logo.png")!,
      ),
    ).toEqual(Buffer.from([0, 255, 254, 128]));
    expect(
      result.bundle.files.find(
        (file) => file.path === "references/thresholds.md",
      ),
    ).toEqual(base.files[2]);
    expect(
      result.bundle.files.find((file) => file.path === "SKILL.md")!.content,
    ).toBe(document);
    base.files[1]!.content = "changed";
    expect(
      result.bundle.files.find((file) => file.path === "assets/logo.png")!
        .content,
    ).toBe("AP/+gA==");
  });

  it("rejects duplicate and case-colliding generated changes before a merge loses evidence", () => {
    expect(() =>
      applySkillCreatorProposal({
        ...output,
        files: [...output.files, ...output.files],
      }),
    ).toThrow(/Duplicate/);
    expect(() =>
      applySkillCreatorProposal({
        ...output,
        files: [
          ...output.files,
          { path: "skill.md", encoding: "utf8", content: document },
        ],
      }),
    ).toThrow(/collide/);
  });

  it("can repair invalid instructions without executing or discarding resources", () => {
    const base: SkillBundle = {
      files: [
        { path: "SKILL.md", encoding: "utf8", content: "An unfinished draft" },
        {
          path: "scripts/report.py",
          encoding: "utf8",
          content: "raise Exception('must never execute during revision')",
        },
      ],
    };
    const result = applySkillCreatorProposal(output, base);
    expect(result.validation.valid).toBe(true);
    expect(
      result.bundle.files.find((file) => file.path === "scripts/report.py"),
    ).toEqual(base.files[1]);
    expect(base.files[0]!.content).toBe("An unfinished draft");
  });
});
