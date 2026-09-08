import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@agentic/agent-kit";
import type { SkillBundle } from "@agentic/contracts";
import { assertValidSkillBundle } from "./bundle";
import { loadSkillsFromDirectory } from "./loader";
import { SkillSession } from "./session";
import { buildSessionSkillTools, buildSkillTools } from "./tools";

const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true })),
);
const ctx = (data: unknown) => ({ event: { data } }) as unknown as ToolContext;
function source(disableModel = false): SkillBundle {
  return {
    files: [
      {
        path: "SKILL.md",
        encoding: "utf8",
        content: `---\nname: triage\ndescription: Classify requests using supplied policy.\n${disableModel ? "disable-model-invocation: true\n" : ""}---\nRead [policy](references/policy.md) before classification.`,
      },
      {
        path: "references/policy.md",
        encoding: "utf8",
        content: "Missing information requires clarification.",
      },
    ],
  };
}
function session(disableModel = false) {
  const bundle = source(disableModel);
  const validated = assertValidSkillBundle(bundle);
  return new SkillSession({
    catalog: [
      {
        id: "skill-triage",
        versionId: "version-1",
        contentDigest: validated.digest,
        name: validated.metadata.name,
        description: validated.metadata.description,
        invocationPolicy: { model: !disableModel },
      },
    ],
    readBundle: () => bundle,
  });
}

describe("legacy Skill tools", () => {
  it("keeps a fixed source snapshot and does not leak host paths or input mutations", async () => {
    const root = mkdtempSync(join(tmpdir(), "agentic-skill-tools-"));
    roots.push(root);
    const directory = join(root, "triage");
    mkdirSync(directory);
    const document = join(directory, "SKILL.md");
    writeFileSync(document, source().files[0]!.content);
    const descriptors = loadSkillsFromDirectory(root);
    const tools = buildSkillTools(descriptors);
    descriptors[0]!.name = "different";
    rmSync(directory, { recursive: true });
    const result = await tools["skills.load_skill"]!.handler(
      ctx({ name: "triage" }),
    );
    expect(result.data).toMatchObject({
      name: "triage",
      body: expect.stringContaining("references/policy.md"),
    });
    expect(result.meta).not.toHaveProperty("path");
    expect(tools["skills.load_skill"]!.inputSchema).toMatchObject({
      type: "object",
      required: ["name"],
    });
    await expect(
      tools["skills.load_skill"]!.handler(ctx({ name: "other" })),
    ).rejects.toThrow();
  });
});

describe("execution-scoped Skill tools", () => {
  it("advertises a single required model selector while retaining named SDK access", async () => {
    const tools = buildSessionSkillTools(session());
    for (const name of [
      "skills.load_skill",
      "skills.list_resources",
      "skills.read_resource",
    ]) {
      const schema = tools[name]!.inputSchema as {
        required: string[];
        properties: Record<string, unknown>;
        additionalProperties: boolean;
      };
      expect(schema.required).toContain("id");
      expect(schema.properties).not.toHaveProperty("name");
      expect(schema.additionalProperties).toBe(false);
    }
    await tools["skills.load_skill"]!.handler(ctx({ name: "triage" }));
    expect(
      (
        await tools["skills.read_resource"]!.handler(
          ctx({ id: "skill-triage", path: "references/policy.md" }),
        )
      ).data,
    ).toMatchObject({ bytes: 43 });
  });
  it("progressively discloses instructions and resources in one isolated session", async () => {
    const activeSession = session();
    const tools = buildSessionSkillTools(activeSession);
    const listed = await tools["skills.list_skills"]!.handler(ctx({}));
    expect(JSON.stringify(listed.data)).not.toContain(
      "Missing information requires clarification",
    );
    await expect(
      tools["skills.read_resource"]!.handler(
        ctx({ name: "triage", path: "references/policy.md" }),
      ),
    ).rejects.toThrow(/Activate/);
    await tools["skills.load_skill"]!.handler(ctx({ name: "triage" }));
    expect(await activeSession.renderActiveInstructions()).toContain(
      "Read [policy]",
    );
    const result = await tools["skills.read_resource"]!.handler(
      ctx({ id: "skill-triage", path: "references/policy.md" }),
    );
    expect(result.data).toMatchObject({
      path: "references/policy.md",
      encoding: "utf8",
      content: "Missing information requires clarification.",
    });
    expect(result.meta).toMatchObject({ skillVersionId: "version-1" });
    expect(await session().activeInstructions()).toEqual([]);
  });

  it("never accepts a model-selected origin, alternate catalog or ambiguous selector", async () => {
    const tools = buildSessionSkillTools(session(true));
    await expect(
      tools["skills.load_skill"]!.handler(
        ctx({ name: "triage", origin: "explicit" }),
      ),
    ).rejects.toThrow();
    await expect(
      tools["skills.load_skill"]!.handler(ctx({ name: "triage" })),
    ).rejects.toThrow();
    await expect(
      tools["skills.load_skill"]!.handler(
        ctx({ name: "triage", id: "skill-triage" }),
      ),
    ).rejects.toThrow();
    await expect(
      tools["skills.list_skills"]!.handler(
        ctx({ catalog: [{ name: "private" }] }),
      ),
    ).rejects.toThrow();
    expect((await tools["skills.list_skills"]!.handler(ctx({}))).data).toEqual({
      skills: [],
    });
  });
});
