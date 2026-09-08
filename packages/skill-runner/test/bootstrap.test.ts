import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertValidSkillBundle, decodeSkillFile } from "@agentic/skills";
import { DEFAULT_SKILL_SCRIPT_LIMITS } from "../src/index";

const bootstrapPath = resolve(import.meta.dirname, "../../../deploy/skill-runner/skill-runner.cjs");
const bootstrap = createRequire(import.meta.url)(bootstrapPath) as {
  safePath(path: string): string;
  decode64(content: string, maximum: number): Buffer;
  bundleDigest(files: Array<{ path: string; bytes: Buffer }>): string;
  artifactFiles(root: string, limits: typeof DEFAULT_SKILL_SCRIPT_LIMITS): Array<{ path: string; content: string }>;
  textWithin(bytes: Buffer, maximum: number): string;
};

describe("fixed Skill runner supervisor", () => {
  it("refuses to run uploaded code as an ordinary host process", () => {
    const result = spawnSync(process.execPath, [bootstrapPath, "run"], { input: '{"scriptPath":"scripts/never-run.js"}\n', encoding: "utf8", timeout: 2000, env: {} });
    expect(result.status).toBe(78);
    expect(result.stderr).toContain("non-root isolated container");
    expect(result.stdout).toBe("");
  });

  it("requires a pinned base and supports a build validation mode without Docker", () => {
    const helper = resolve(import.meta.dirname, "../../../deploy/skill-runner/build.mjs");
    const valid = spawnSync(process.execPath, [helper, "--node-image", `sha256:${"a".repeat(64)}`, "--python-version", "3.13.5-1", "--check"], { encoding: "utf8", timeout: 2000, env: { PATH: "" } });
    expect(valid.status).toBe(0); expect(valid.stdout).toContain("no Docker command");
    const mutable = spawnSync(process.execPath, [helper, "--node-image", "node:latest", "--python-version", "3.13.5-1", "--check"], { encoding: "utf8", timeout: 2000, env: { PATH: "" } });
    expect(mutable.status).not.toBe(0); expect(mutable.stderr).toContain("exact SHA-256");
  });

  it("verifies staged bytes using the same canonical digest as bundle admission", () => {
    const bundle = { files: [
      { path: "SKILL.md", content: "---\nname: sample\ndescription: Example\n---\nRun a check.\n", encoding: "utf8" as const },
      { path: "assets/x.bin", content: "AP8=", encoding: "base64" as const },
    ] };
    expect(bootstrap.bundleDigest(bundle.files.map((file) => ({ path: file.path, bytes: decodeSkillFile(file) })).reverse())).toBe(assertValidSkillBundle(bundle).digest);
  });

  it.each(["../file", "/file", "a\\b", "a/../b", "a//b", "a/COM¹.txt", "a/ name", "x\0y", "e\u0301.txt"])("rejects nonportable path %j inside the image", (path) => {
    expect(() => bootstrap.safePath(path)).toThrow();
  });

  it("preserves binary artifacts and applies total bounds before returning files", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "skill-artifacts-"));
    try {
      mkdirSync(join(root, "reports"));
      writeFileSync(join(root, "reports", "binary.bin"), Buffer.from([0, 255, 128]));
      const files = bootstrap.artifactFiles(root, DEFAULT_SKILL_SCRIPT_LIMITS);
      expect(files).toEqual([{ path: "reports/binary.bin", content: Buffer.from([0, 255, 128]).toString("base64") }]);
      expect(() => bootstrap.artifactFiles(root, { ...DEFAULT_SKILL_SCRIPT_LIMITS, artifactBytes: 2 })).toThrow("Artifact file limit");
      symlinkSync(join(root, "reports"), join(root, "linked"));
      expect(() => bootstrap.artifactFiles(root, DEFAULT_SKILL_SCRIPT_LIMITS)).toThrow("links");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("bounds invalid UTF-8 stdout without expanding replacement bytes beyond the limit", () => {
    for (const size of [0, 1, 2, 3, 4, 5, 10]) expect(Buffer.byteLength(bootstrap.textWithin(Buffer.from([255, 255, 255, 255]), size))).toBeLessThanOrEqual(size);
    expect(() => bootstrap.decode64("YQ", 10)).toThrow();
    expect(() => bootstrap.decode64("YQ==", 0)).toThrow();
  });
});
