import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { readSkillBundleFromDirectory } from "../src/loader";
import {
  SKILL_BUNDLE_LIMITS, SkillBundleError, assertSafeSkillPath, assertValidSkillBundle,
  decodeSkillFile, encodeSkillFile, parseSkillDocument, parseSkillFrontmatter,
  skillBundleDigest, validateSkillBundle, type SkillBundle,
} from "../src/bundle";

const source = "---\nname: document-review\ndescription: Review documents when a user requests editorial feedback.\n---\nRead the document, explain findings, and check the final result.\n";
const bundle = (content = source): SkillBundle => ({ files: [{ path: "SKILL.md", content, encoding: "utf8" }] });

describe("portable skill documents", () => {
  it("parses real YAML including quoted colons, folded blocks, nested extensions, and anchors without rewriting source", () => {
    const content = `---
name: document-review
description: >-
  Review documents:
  when a user requests editorial feedback.
license: 'Proprietary: see LICENSE.txt'
compatibility: Requires the configured document tools.
metadata:
  author: "Example Team"
  version: "1.0"
allowed-tools: "documents.read documents.write"
disable-model-invocation: true
user-invocable: false
extension:
  base: &base [one, two]
  same: *base
  enabled: true
---

# Instructions

  Keep this indentation.
`;
    const parsed = parseSkillDocument(content, { directoryName: "document-review" });
    expect(parsed.frontmatter.description).toBe("Review documents: when a user requests editorial feedback.");
    expect(parsed.frontmatter.metadata).toEqual({ author: "Example Team", version: "1.0" });
    expect(parsed.frontmatter.extension).toEqual({ base: ["one", "two"], same: ["one", "two"], enabled: true });
    expect(parsed.frontmatter["disable-model-invocation"]).toBe(true);
    expect(parsed.frontmatter["user-invocable"]).toBe(false);
    expect(parsed.body).toBe("\n# Instructions\n\n  Keep this indentation.\n");
    expect(assertValidSkillBundle(bundle(content)).valid).toBe(true);
    expect(bundle(content).files[0]!.content).toBe(content);
  });

  it("preserves BOM and CRLF while parsing exact delimiter lines", () => {
    const content = `\uFEFF${source.replaceAll("\n", "\r\n")}`;
    expect(parseSkillDocument(content).body).toBe("Read the document, explain findings, and check the final result.\r\n");
    expect(decodeSkillFile(bundle(content).files[0]!)).toEqual(Buffer.from(content));
    expect(() => parseSkillDocument("---not-frontmatter\nname: document-review\n---\nBody")).toThrow(SkillBundleError);
  });

  it.each([
    ["missing metadata", "Read instructions."],
    ["missing description", "---\nname: document-review\n---\nRead instructions."],
    ["numeric description", "---\nname: document-review\ndescription: 42\n---\nRead instructions."],
    ["blank description", "---\nname: document-review\ndescription: '  '\n---\nRead instructions."],
    ["invalid name", source.replace("document-review", "Document--Review")],
    ["empty body", "---\nname: document-review\ndescription: Review documents.\n---\n  \n"],
    ["empty compatibility", source.replace("---\nRead", "compatibility: ''\n---\nRead")],
    ["non-string metadata", source.replace("---\nRead", "metadata:\n  version: 1\n---\nRead")],
    ["non-boolean invocation hint", source.replace("---\nRead", "disable-model-invocation: 'false'\n---\nRead")],
    ["non-boolean user hint", source.replace("---\nRead", "user-invocable: 'false'\n---\nRead")],
    ["broken YAML", "---\nname: [\n---\nRead instructions."],
    ["scalar YAML", "---\ndocument-review\n---\nRead instructions."],
    ["unknown custom tags", source.replace("---\nRead", "x-custom: !execute 'do something'\n---\nRead")],
    ["non-JSON YAML", source.replace("---\nRead", "x-number: .inf\n---\nRead")],
    ["unpaired surrogate", `${source}\ud800`],
    ["binary controls", `${source}\u0000`],
  ])("rejects %s", (_name, content) => {
    expect(validateSkillBundle(bundle(content)).valid).toBe(false);
    expect(() => parseSkillDocument(content)).toThrow(SkillBundleError);
  });

  it("rejects duplicate YAML keys with a source location rather than accepting the last identity", () => {
    const content = source.replace("description:", "name: hidden-replacement\ndescription:");
    const parsed = parseSkillFrontmatter(content);
    expect(parsed.metadata).toBeUndefined();
    expect(parsed.diagnostics[0]).toMatchObject({ code: "invalid_yaml", path: "SKILL.md", line: 3, column: 1 });
    expect(() => parseSkillDocument(content)).toThrow(SkillBundleError);
    expect(() => parseSkillDocument(source.replace("---\nRead", "metadata: {version: '1', version: '2'}\n---\nRead"))).toThrow(SkillBundleError);
  });

  it("bounds cyclic and multiplying YAML aliases", () => {
    const cyclic = source.replace("---\nRead", "x-cycle: &cycle [*cycle]\n---\nRead");
    expect(validateSkillBundle(bundle(cyclic)).diagnostics).toContainEqual(expect.objectContaining({ code: "invalid_yaml" }));
    const aliases = "x-a: &a [word, word, word, word, word]\nx-b: &b [*a, *a, *a, *a, *a]\nx-c: &c [*b, *b, *b, *b, *b]\nx-d: [*c, *c, *c, *c, *c]\n";
    expect(() => parseSkillDocument(source.replace("---\nRead", `${aliases}---\nRead`))).toThrow(SkillBundleError);
  });

  it("checks metadata/body limits and folder identity", () => {
    expect(() => parseSkillDocument(source, { directoryName: "different-name" })).toThrow(/must match/);
    expect(() => parseSkillDocument(source.replace("---\nRead", `x-long: '${"x".repeat(SKILL_BUNDLE_LIMITS.maxFrontmatterBytes)}'\n---\nRead`))).toThrow(/size limit/);
    expect(() => parseSkillDocument(source + "x".repeat(SKILL_BUNDLE_LIMITS.maxSkillMdBytes))).toThrow(/size limit/);
    expect(() => parseSkillDocument(source.replace("Review documents when a user requests editorial feedback.", "x".repeat(1025)))).toThrow(SkillBundleError);
  });

  it("returns authoring warnings without inventing failed runtime/tool checks", () => {
    const content = `${source}\nSee [missing](references/missing.md), [missing again](references/missing.md), [website](https://example.invalid/guide), and [here](#heading).\n${"instruction\n".repeat(500)}`;
    const result = validateSkillBundle(bundle(content));
    expect(result.valid).toBe(true);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["long_instructions", "missing_reference"]);
    expect(result.diagnostics.every((diagnostic) => diagnostic.severity === "warning")).toBe(true);
  });

  it("validates the maintained Skill Creator and referenced output contract as one real bundle", () => {
    const bundle = readSkillBundleFromDirectory(fileURLToPath(new URL("../builtin/skill-creator", import.meta.url)));
    const result = assertValidSkillBundle(bundle);
    expect(result.metadata.name).toBe("skill-creator");
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === "missing_reference")).toEqual([]);
  });
});

describe("bundle transport and digest", () => {
  it("preserves binary files and hashes file bytes independently of input order or transport encoding", () => {
    const asset = encodeSkillFile("assets/template.bin", Buffer.from(Array.from({ length: 256 }, (_, index) => index)));
    expect(asset.encoding).toBe("base64");
    expect(decodeSkillFile(asset)).toEqual(Buffer.from(Array.from({ length: 256 }, (_, index) => index)));
    const first = { files: [...bundle().files, asset] };
    const second: SkillBundle = { files: [asset, { path: "SKILL.md", content: Buffer.from(source).toString("base64"), encoding: "base64" }] };
    expect(skillBundleDigest(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(skillBundleDigest(first)).toBe(skillBundleDigest(second));
    expect(skillBundleDigest(first)).not.toBe(skillBundleDigest({ files: [...bundle(`${source}Changed.`).files, asset] }));
    expect(skillBundleDigest(first)).not.toBe(skillBundleDigest({ files: [...bundle().files, { ...asset, path: "assets/renamed.bin" }] }));
  });

  it.each(["YQ", "YQ=", "YQ===", "Y Q==", "YQ==\n", "YR==", "____", "é==="])("rejects noncanonical base64 %s", (content) => {
    expect(() => decodeSkillFile({ path: "assets/a.bin", content, encoding: "base64" })).toThrow(SkillBundleError);
  });

  it("accepts empty and maximum-size binary resources, and rejects over-limit resources", () => {
    expect(decodeSkillFile({ path: "assets/empty.bin", content: "", encoding: "base64" }).length).toBe(0);
    const bytes = Buffer.alloc(SKILL_BUNDLE_LIMITS.maxFileBytes, 0xfe);
    expect(decodeSkillFile({ path: "assets/max.bin", content: bytes.toString("base64"), encoding: "base64" }).equals(bytes)).toBe(true);
    expect(() => decodeSkillFile({ path: "assets/too-big.bin", content: Buffer.concat([bytes, Buffer.from([1])]).toString("base64"), encoding: "base64" })).toThrow(/size limit/);
  });

  it("rejects binary SKILL.md and file count/expanded size overflow", () => {
    expect(validateSkillBundle({ files: [{ path: "SKILL.md", content: "/w==", encoding: "base64" }] }).valid).toBe(false);
    const many = { files: [...bundle().files, ...Array.from({ length: SKILL_BUNDLE_LIMITS.maxFiles }, (_, index) => ({ path: `assets/${index}`, content: "", encoding: "utf8" as const }))] };
    expect(validateSkillBundle(many).diagnostics[0]!.code).toBe("file_count");
    const large = { files: [...bundle().files, ...Array.from({ length: 4 }, (_, index) => ({ path: `assets/${index}`, content: "x".repeat(SKILL_BUNDLE_LIMITS.maxFileBytes), encoding: "utf8" as const }))] };
    expect(validateSkillBundle(large).diagnostics).toContainEqual(expect.objectContaining({ code: "bundle_size" }));
  });
});

describe("portable paths", () => {
  it.each([
    "", "/absolute", "../escape", "references/../escape", "references/./a", "references//a", "references/", "references\\a", "C:relative", "C:/absolute",
    "a\u0000b", "a\u007fb", "a\u0085b", "trailing.", "trailing ", " leading", "refs/nul.txt", "refs/CON", "refs/COM1.log", "refs/a:b", "refs/a?b", "refs/a|b",
    "assets/cafe\u0301.txt", `${"deep/".repeat(SKILL_BUNDLE_LIMITS.maxPathDepth)}a`, "a".repeat(SKILL_BUNDLE_LIMITS.maxPathLength + 1),
  ])("rejects unsafe path %j", (path) => { expect(() => assertSafeSkillPath(path)).toThrow(SkillBundleError); });

  it("accepts portable Unicode files and ordinary spaces", () => {
    expect(() => assertSafeSkillPath("references/中文 guide.md")).not.toThrow();
    expect(() => assertSafeSkillPath("assets/café.txt")).not.toThrow();
  });

  it.each([
    ["assets/a", "assets/a", "duplicate_path"],
    ["assets/a", "assets/A", "path_collision"],
    ["Assets/a", "assets/b", "path_collision"],
    ["references", "references/guide.md", "path_conflict"],
    ["references/guide.md", "references", "path_conflict"],
  ])("rejects conflicting paths %s and %s", (first, second, code) => {
    const result = validateSkillBundle({ files: [...bundle().files, { path: first, content: "", encoding: "utf8" }, { path: second, content: "", encoding: "utf8" }] });
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code }));
  });
});
