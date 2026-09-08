import { expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const race = vi.hoisted(() => ({ victim: "", target: "", fired: false, stage: "", resourceFd: -1 }));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  function replaceDirectory() {
    if (!race.fired) {
      race.fired = true;
      fs.renameSync(race.victim, race.victim + "-saved");
      fs.symlinkSync(race.target, race.victim);
    }
  }
  return {
    ...fs,
    lstatSync: (...args: Parameters<typeof fs.lstatSync>) => {
      const result = fs.lstatSync(...args);
      if (race.stage === "lstat" && String(args[0]) === race.victim) replaceDirectory();
      return result;
    },
    opendirSync: (...args: Parameters<typeof fs.opendirSync>) => {
      const directory = fs.opendirSync(...args);
      if (race.stage === "opendir" && String(args[0]) === race.victim) replaceDirectory();
      return directory;
    },
    openSync: (...args: Parameters<typeof fs.openSync>) => {
      const fd = fs.openSync(...args);
      if (String(args[0]) === race.victim + "/local.txt") race.resourceFd = fd;
      return fd;
    },
    readSync: (...args: Parameters<typeof fs.readSync>) => {
      const bytes = fs.readSync(...args);
      if (race.stage === "read" && args[0] === race.resourceFd) replaceDirectory();
      return bytes;
    },
  };
});
import { readSkillBundleFromDirectory } from "../src/loader";

it.each(["lstat", "opendir", "read"])("rejects a directory replaced by an external symlink during %s", (stage) => {
  const root = mkdtempSync(join(tmpdir(), "skill-review-"));
  try {
    const skill = join(root, "sample");
    mkdirSync(skill);
    mkdirSync(join(skill, "references"));
    mkdirSync(join(root, "outside"));
    writeFileSync(join(skill, "SKILL.md"), "---\nname: sample\ndescription: Sample\n---\nFollow steps.\n");
    writeFileSync(join(skill, "references", "local.txt"), "authorized bytes");
    writeFileSync(join(root, "outside", "secret.txt"), "external bytes");
    race.victim = join(skill, "references");
    race.target = join(root, "outside");
    race.stage = stage;
    race.fired = false;
    race.resourceFd = -1;
    expect(() => readSkillBundleFromDirectory(skill)).toThrow(/changed|symbolic|pinned/);
    expect(race.fired).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
