import { describe, expect, it } from "vitest";
import { SKILL_BUNDLE_LIMITS } from "@agentic/contracts";
import {
  checkEditorFiles,
  encodeBrowserBytes,
  readBrowserSkillFile,
  readBrowserSkillFolder,
  resolveSkillResourceLink,
  skillFileBytes,
  skillFileSize,
} from "./editor-model";

describe("Skill editor resource fidelity and admission", () => {
  it("preserves UTF-8 BOM, non-ASCII text, CRLF, and empty resources byte for byte", async () => {
    for (const text of [
      "\ufeff---\r\nname: résumé\r\n---\r\n",
      "指引 👩🏾‍💻",
      "",
    ]) {
      const bytes = new TextEncoder().encode(text);
      const resource = await readBrowserSkillFile(
        new File([bytes], "guide.md"),
      );
      expect(resource.encoding).toBe("utf8");
      expect(skillFileBytes(resource)).toEqual(bytes);
      expect(skillFileSize(resource)).toBe(bytes.byteLength);
    }
  });
  it("preserves invalid UTF-8 and binary control bytes without replacement characters", async () => {
    for (const bytes of [
      new Uint8Array([0xff, 0xc0, 0x80, 0]),
      new Uint8Array([80, 75, 3, 4, 0, 13, 10]),
    ]) {
      const resource = await readBrowserSkillFile(
        new File([bytes], "template.bin"),
      );
      expect(resource.encoding).toBe("base64");
      expect(skillFileBytes(resource)).toEqual(bytes);
    }
  });
  it("encodes resources larger than a JavaScript argument list without truncation", () => {
    const bytes = Uint8Array.from(
      { length: 400_000 },
      (_, index) => index % 256,
    );
    expect(
      skillFileBytes({
        path: "assets/a.bin",
        content: encodeBrowserBytes(bytes),
        encoding: "base64",
      }),
    ).toEqual(bytes);
  });
  it("rejects case collisions, file/directory aliases, traversal and oversized multibyte entrypoints", () => {
    const file = (path: string, content = "") => ({
      path,
      content,
      encoding: "utf8" as const,
    });
    for (const paths of [
      ["refs/a.md", "REFS/A.md"],
      ["assets", "assets/a.bin"],
      ["../outside"],
      ["scripts\\a.js"],
      ["CON.txt"],
    ])
      expect(() => checkEditorFiles(paths.map((path) => file(path)))).toThrow();
    expect(() =>
      checkEditorFiles([
        file(
          "SKILL.md",
          "界".repeat(Math.ceil(SKILL_BUNDLE_LIMITS.maxSkillMdBytes / 3)),
        ),
      ]),
    ).toThrow("fileLimit");
  });
  it("strips one selected folder root while retaining nested binary resource paths", async () => {
    const entry = new File(
      ["---\nname: test-skill\ndescription: Test\n---\n"],
      "SKILL.md",
    );
    const binary = new File([new Uint8Array([0, 255, 1])], "a.bin");
    Object.defineProperty(entry, "webkitRelativePath", {
      value: "test-skill/SKILL.md",
    });
    Object.defineProperty(binary, "webkitRelativePath", {
      value: "test-skill/assets/a.bin",
    });
    const result = await readBrowserSkillFolder([entry, binary]);
    expect(result.files.map((file) => file.path)).toEqual([
      "SKILL.md",
      "assets/a.bin",
    ]);
    expect(skillFileBytes(result.files[1]!)).toEqual(
      new Uint8Array([0, 255, 1]),
    );
    const unrelated = new File(["x"], "x.md");
    Object.defineProperty(unrelated, "webkitRelativePath", {
      value: "another/x.md",
    });
    await expect(readBrowserSkillFolder([entry, unrelated])).rejects.toThrow(
      "invalidPath",
    );
  });
});

describe("Skill Markdown resource links", () => {
  it("resolves relative resource links with encoded filenames and fragments", () => {
    expect(
      resolveSkillResourceLink("SKILL.md", "references/guide.md#checklist"),
    ).toBe("references/guide.md");
    expect(
      resolveSkillResourceLink(
        "references/guide.md",
        "../assets/report%20template.csv?view=1",
      ),
    ).toBe("assets/report template.csv");
  });
  it("refuses escaping, external, malformed, and reserved paths", () => {
    for (const href of [
      "../../private",
      "https://example.com/guide",
      "javascript:alert(1)",
      "/etc/passwd",
      "//example.com/a",
      "../%2e%2e/secret",
      "bad%ZZ",
      "CON",
      "a\\b",
      "#section",
    ])
      expect(resolveSkillResourceLink("SKILL.md", href)).toBeNull();
  });
});
