import { describe, expect, it } from "vitest";
import {
  SkillBundleSchema,
  SkillCreatorOutputSchema,
  SkillFilePathSchema,
  SkillFrontmatterSchema,
  SKILL_BUNDLE_LIMITS,
} from "./skills";

describe("portable Skill transport", () => {
  it("admits a complete 512-file reference bundle and rejects the next file", () => {
    const files = Array.from({ length: 512 }, (_, index) => ({
      path: index === 0 ? "SKILL.md" : `references/product-${index}.md`,
      content:
        index === 0
          ? "---\nname: complete-reference\ndescription: Consult this complete provider reference.\n---\nRead the relevant reference."
          : `Reference ${index}`,
      encoding: "utf8" as const,
    }));
    expect(SKILL_BUNDLE_LIMITS.maxFiles).toBe(512);
    expect(SkillBundleSchema.parse({ files }).files).toHaveLength(512);
    expect(
      SkillBundleSchema.safeParse({
        files: [
          ...files,
          {
            path: "references/overflow.md",
            content: "overflow",
            encoding: "utf8",
          },
        ],
      }).success,
    ).toBe(false);
    expect(SKILL_BUNDLE_LIMITS.maxFileBytes).toBe(5 * 1024 * 1024);
    expect(SKILL_BUNDLE_LIMITS.maxBundleBytes).toBe(20 * 1024 * 1024);
  });
  it("preserves nested optional metadata and binary file transport", () => {
    const input = {
      name: "report-template",
      description: "Prepare the tenant's monthly report.",
      metadata: { owner: "Finance" },
      "harness-extension": { invocation: "explicit" },
    };
    expect(SkillFrontmatterSchema.parse(input)).toEqual(input);
    const bundle = {
      files: [
        {
          path: "assets/logo.png",
          content: "iVBORw0KGgo=",
          encoding: "base64",
        },
      ],
    };
    expect(SkillBundleSchema.parse(bundle)).toEqual(bundle);
  });

  it.each([
    "../secret",
    "/etc/passwd",
    "references/../secret",
    "C:/secret",
    "references\\secret",
    "references//secret",
    "references/./secret",
    "references/secret\0",
    "references/space ",
    "references/e\u0301.txt",
  ])("rejects nonportable path %j", (path) => {
    expect(SkillFilePathSchema.safeParse(path).success).toBe(false);
  });

  it("keeps valid resource paths and rejects malformed identity fields", () => {
    expect(SkillFilePathSchema.parse("references/招聘规则.md")).toBe(
      "references/招聘规则.md",
    );
    expect(
      SkillFrontmatterSchema.safeParse({
        name: "My Skill",
        description: "Use me",
      }).success,
    ).toBe(false);
    expect(
      SkillFrontmatterSchema.safeParse({ name: "my-skill", description: "  " })
        .success,
    ).toBe(false);
    expect(
      SkillFrontmatterSchema.safeParse({
        name: "my-skill",
        description: "Use me",
        metadata: { priority: 1 },
      }).success,
    ).toBe(false);
  });
});

describe("Skill Creator output", () => {
  const proposal = {
    files: [
      {
        path: "SKILL.md",
        encoding: "utf8",
        content:
          "---\nname: support-triage\ndescription: Classify incoming support requests.\n---\nApply the tenant queue rules.",
      },
    ],
    assumptions: [],
    suggestedTests: [
      {
        id: "classify",
        prompt: "Which queue should handle this billing ticket?",
        shouldTrigger: true,
        expectedCriteria: [
          "Select the billing queue using the supplied rules.",
        ],
      },
    ],
    changeSummary: ["Added a support triage procedure."],
  };

  it("accepts an editable text proposal with proposed criteria, preserving omissions", () => {
    expect(SkillCreatorOutputSchema.parse(proposal)).toEqual(proposal);
  });

  it("rejects fabricated execution evidence and generated binary data", () => {
    expect(
      SkillCreatorOutputSchema.safeParse({
        ...proposal,
        testResults: [{ passed: true }],
      }).success,
    ).toBe(false);
    expect(
      SkillCreatorOutputSchema.safeParse({
        ...proposal,
        files: [
          ...proposal.files,
          { path: "assets/logo.png", encoding: "base64", content: "aGVsbG8=" },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires the entrypoint and distinct test identities", () => {
    expect(
      SkillCreatorOutputSchema.safeParse({
        ...proposal,
        files: [{ ...proposal.files[0], path: "references/rules.md" }],
      }).success,
    ).toBe(false);
    expect(
      SkillCreatorOutputSchema.safeParse({
        ...proposal,
        suggestedTests: [
          proposal.suggestedTests[0],
          proposal.suggestedTests[0],
        ],
      }).success,
    ).toBe(false);
  });
});
