import { afterEach, describe, expect, it } from "vitest";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeSkillFile, skillBundleDigest } from "./bundle";
import { exportSkillArchive, importSkillArchive } from "./archive";
import {
  loadSkillsFromDirectory,
  parseFrontmatter,
  readSkillBody,
  readSkillBundleFromDirectory,
} from "./loader";

const roots: string[] = [];
function root() {
  const result = mkdtempSync(join(tmpdir(), "agentic-skill-loader-"));
  roots.push(result);
  return result;
}
function createSkill(parent: string, name = "example-skill") {
  const directory = join(parent, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: Read the supplied policy when classifying a request.\nmetadata:\n  team: Support\n---\nConsult [policy](references/policy.md).\n`,
  );
  return directory;
}
afterEach(() =>
  roots
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true })),
);

describe("configured filesystem Skill adapter", () => {
  it("retains all 512 files through directory capture and ZIP round-trip while rejecting file 513", async () => {
    const directory = createSkill(root());
    mkdirSync(join(directory, "references"));
    for (let index = 1; index < 512; index++) {
      writeFileSync(
        join(directory, "references", `product-${index}.md`),
        `Product reference ${index}\n`,
      );
    }
    const captured = readSkillBundleFromDirectory(directory);
    expect(captured.files).toHaveLength(512);
    const roundTrip = await importSkillArchive(
      await exportSkillArchive(captured),
    );
    expect(roundTrip.files).toHaveLength(512);
    expect(skillBundleDigest(roundTrip)).toBe(skillBundleDigest(captured));
    writeFileSync(
      join(directory, "references", "overflow.md"),
      "Over the file-count boundary\n",
    );
    expect(() => readSkillBundleFromDirectory(directory)).toThrow(
      /too many files/,
    );
  });
  it("keeps absent libraries empty and discovers bounded metadata in stable order", () => {
    const directory = root();
    expect(loadSkillsFromDirectory(join(directory, "absent"))).toEqual([]);
    createSkill(directory, "zebra");
    createSkill(directory, "alpha");
    expect(
      loadSkillsFromDirectory(directory).map(({ name, metadata }) => ({
        name,
        team: metadata?.metadata,
      })),
    ).toEqual([
      { name: "alpha", team: { team: "Support" } },
      { name: "zebra", team: { team: "Support" } },
    ]);
  });

  it("uses real YAML while preserving the legacy no-frontmatter return shape", () => {
    expect(parseFrontmatter("Just instructions")).toEqual({
      metadata: undefined,
      body: "Just instructions",
    });
    const parsed = parseFrontmatter(
      "---\nname: task\ndescription: >-\n  Route a request\n  using policy.\nmetadata:\n  owner: 'Ops: team'\n---\n\nDo the task.\n",
    );
    expect(parsed.metadata?.description).toBe("Route a request using policy.");
    expect(parsed.metadata?.metadata).toEqual({ owner: "Ops: team" });
    expect(parsed.body).toBe("Do the task.");
    expect(() =>
      parseFrontmatter("---\nname: one\nname: two\n---\nDo something"),
    ).toThrow();
  });

  it("captures bytes independently from later filesystem edits", () => {
    const directory = createSkill(root());
    mkdirSync(join(directory, "assets"));
    mkdirSync(join(directory, "references"));
    const binary = Buffer.from([0, 255, 254, 128, 10]);
    writeFileSync(join(directory, "assets", "template.bin"), binary);
    writeFileSync(
      join(directory, "references", "policy.md"),
      "Escalate missing information.",
    );
    const bundle = readSkillBundleFromDirectory(directory);
    const digest = skillBundleDigest(bundle);
    writeFileSync(
      join(directory, "references", "policy.md"),
      "Different policy.",
    );
    expect(skillBundleDigest(bundle)).toBe(digest);
    expect(skillBundleDigest(readSkillBundleFromDirectory(directory))).not.toBe(
      digest,
    );
    expect(
      decodeSkillFile(
        bundle.files.find((file) => file.path === "assets/template.bin")!,
      ),
    ).toEqual(binary);
    expect(readSkillBody(join(directory, "SKILL.md"))).toContain(
      "references/policy.md",
    );
  });

  it("rejects linked directories, linked resources and hardlinked files", () => {
    const outside = root();
    const source = createSkill(outside);
    const catalog = root();
    symlinkSync(source, join(catalog, "linked-skill"), "dir");
    expect(() => loadSkillsFromDirectory(catalog)).toThrow(/links/);
    symlinkSync(join(source, "SKILL.md"), join(source, "linked.md"));
    expect(() => readSkillBundleFromDirectory(source)).toThrow(/links/);
    rmSync(join(source, "linked.md"));
    linkSync(join(source, "SKILL.md"), join(outside, "hardlink.md"));
    expect(() => readSkillBundleFromDirectory(source)).toThrow(/links/);
  });

  it("requires portable identity and rejects malformed or oversized entrypoints", () => {
    const directory = createSkill(root());
    writeFileSync(
      join(directory, "SKILL.md"),
      "---\nname: other-name\ndescription: Test the supplied values.\n---\nCheck all values.",
    );
    expect(() => readSkillBundleFromDirectory(directory)).toThrow(/folder/);
    writeFileSync(
      join(directory, "SKILL.md"),
      Buffer.alloc(256 * 1024 + 1, "x"),
    );
    expect(() => loadSkillsFromDirectory(dirname(directory))).toThrow(
      /byte limit/,
    );
  });

  it("admits every checked-in Tenant Skill and the maintained Skill Creator", () => {
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    let count = 0;
    for (const tenant of ["northwind", "insightlab", "robohire"]) {
      for (const descriptor of loadSkillsFromDirectory(
        join(repo, "tenants", tenant, "src", "skills"),
      )) {
        expect(
          readSkillBundleFromDirectory(dirname(descriptor.path)).files.some(
            (file) => file.path === "SKILL.md",
          ),
        ).toBe(true);
        count++;
      }
    }
    expect(count).toBe(9);
    expect(
      readSkillBundleFromDirectory(
        join(repo, "packages/skills/builtin/skill-creator"),
      ).files.length,
    ).toBeGreaterThanOrEqual(1);
  });
});
