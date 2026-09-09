/**
 * `isMainEntry` decides whether the CLI runs or merely gets imported.
 *
 * It used to be `import.meta.url.endsWith(process.argv[1])`, comparing a URL
 * with a filesystem path. Every character a URL percent-encodes broke it: on a
 * checkout under `/Users/me/agentic operator/…` the URL holds `%20` where
 * argv[1] holds a space, the check answered false, and `agentic <anything>`
 * exited 0 having done nothing — a silent success that fools scripts, CI and
 * people equally. A relative argv[1] (`node ./src/cli.ts`) failed the same way.
 *
 * These cases are the reason the function is exported: the bug is a
 * path-comparison bug, and it is testable without spawning a process.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isMainEntry } from "../src/cli.js";

const SELF = path.resolve("/tmp/agentic-cli-fixture/src/cli.ts");
const SELF_URL = pathToFileURL(SELF).href;

describe("isMainEntry", () => {
  it("matches when the entry is this module", () => {
    expect(isMainEntry(SELF_URL, SELF)).toBe(true);
  });

  it("matches when the checkout path contains a space", () => {
    // The regression: pathToFileURL percent-encodes the space, argv[1] does not.
    const spaced = path.resolve("/tmp/agentic operator_new/apps/cli/src/cli.ts");
    const url = pathToFileURL(spaced).href;
    expect(url).toContain("%20");
    expect(url).not.toContain(" ");
    expect(isMainEntry(url, spaced)).toBe(true);
  });

  it("matches other characters a URL escapes but a path does not", () => {
    for (const dir of ["with#hash", "with?question", "汉字目录", "with%percent"]) {
      const entry = path.resolve(`/tmp/${dir}/src/cli.ts`);
      expect(isMainEntry(pathToFileURL(entry).href, entry), dir).toBe(true);
    }
  });

  it("matches a relative argv[1] by resolving it against cwd", () => {
    const entry = path.resolve(process.cwd(), "src", "cli.ts");
    const relative = path.join("src", "cli.ts");
    expect(isMainEntry(pathToFileURL(entry).href, relative)).toBe(true);
  });

  it("does not match a different file", () => {
    const other = path.resolve("/tmp/agentic-cli-fixture/src/other.ts");
    expect(isMainEntry(SELF_URL, other)).toBe(false);
  });

  it("does not match when a longer path merely ends with the entry", () => {
    // `endsWith` said true here; these are different files.
    const suffix = path.resolve("/cli.ts");
    expect(isMainEntry(SELF_URL, suffix)).toBe(false);
  });

  it("returns false without a usable argv[1]", () => {
    expect(isMainEntry(SELF_URL, undefined)).toBe(false);
    expect(isMainEntry(SELF_URL, "")).toBe(false);
  });

  it("returns false when the module is not a file: URL", () => {
    expect(isMainEntry("data:text/javascript,export{}", SELF)).toBe(false);
    expect(isMainEntry("https://example.com/cli.js", SELF)).toBe(false);
  });
});
