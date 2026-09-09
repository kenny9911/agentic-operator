import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { skillBundleDigest } from "@agentic/skills";
import type { SkillBundle } from "@agentic/contracts";
import {
  projectSkillLibraryFiles,
  SkillLibraryFileError,
  type SkillLibraryFileSnapshot,
} from "../src/services/skill-library-files";

let root: string;
const binary = Buffer.from([0, 255, 1, 128, 13]);
function bundle(body = "Review supplied citations."): SkillBundle {
  return {
    files: [
      {
        path: "SKILL.md",
        encoding: "utf8",
        content: `---\nname: citation-review\ndescription: Use when checking citations.\n---\n${body}\n`,
      },
      {
        path: "assets/sample.bin",
        encoding: "base64",
        content: binary.toString("base64"),
      },
    ],
  };
}
function snapshot(): SkillLibraryFileSnapshot {
  const value = bundle();
  return {
    owner: {
      visibility: "shared",
      tenantId: "tnt-system",
      tenantSlug: "__system",
      skillId: "skl-one",
    },
    metadata: {
      name: "citation-review",
      latestVersionId: "skv-one",
      archivedAt: null,
    },
    draft: { revision: 1, bundle: value },
    revisions: [{ revision: 1, bundle: value }],
    versions: [
      {
        id: "skv-one",
        versionNo: 1,
        contentDigest: skillBundleDigest(value),
        bundle: value,
      },
    ],
  };
}
function project(value = snapshot()) {
  return projectSkillLibraryFiles(value, { dataRoot: root });
}
function manifest(file: string) {
  return JSON.parse(readFileSync(file, "utf8"));
}
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "agentic-skill-files-")));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("managed Skill filesystem projection", () => {
  it("writes one binary-safe bundle for identical draft/revision/publication and scopes shared and tenant directories", () => {
    const shared = project();
    expect(shared.skillDirectory).toBe(join(root, "shared/skills/skl-one"));
    const current = manifest(shared.manifestPath);
    expect(current.draft.path).toBe(current.versions[0].path);
    expect(readdirSync(join(shared.skillDirectory, "bundles"))).toHaveLength(1);
    expect(
      readFileSync(
        join(shared.skillDirectory, current.draft.path, "assets/sample.bin"),
      ),
    ).toEqual(binary);
    expect(project().changed).toBe(false);
    if (process.platform !== "win32") {
      expect(statSync(shared.skillDirectory).mode & 0o077).toBe(0);
      expect(statSync(shared.manifestPath).mode & 0o077).toBe(0);
      expect(
        statSync(join(shared.skillDirectory, current.draft.path, "SKILL.md"))
          .mode & 0o077,
      ).toBe(0);
    }
    const owned = snapshot();
    owned.owner = {
      ...owned.owner,
      visibility: "tenant",
      tenantId: "tnt-alpha",
      tenantSlug: "alpha",
    };
    const tenant = projectSkillLibraryFiles(owned, {
      dataRoot: root,
      tenantsRoot: join(root, "configured-tenants"),
    });
    expect(tenant.skillDirectory).toBe(
      join(root, "configured-tenants/alpha/skills/skl-one"),
    );
    expect(manifest(shared.manifestPath).owner.tenantId).toBe("tnt-system");
  });

  it("retains old published bytes while projecting renamed or invalid editable drafts", () => {
    const initial = project();
    const original = manifest(initial.manifestPath);
    const next = snapshot();
    next.draft = {
      revision: 2,
      bundle: {
        files: [
          {
            path: "SKILL.md",
            encoding: "utf8",
            content: "---\nname: [unfinished\n",
          },
        ],
      },
    };
    next.revisions.push(next.draft);
    next.metadata.name = "renamed-after-publication";
    project(next);
    const changed = manifest(initial.manifestPath);
    expect(changed.draft.revision).toBe(2);
    expect(changed.versions).toEqual(original.versions);
    expect(readdirSync(join(initial.skillDirectory, "bundles"))).toHaveLength(
      2,
    );
    expect(
      readFileSync(
        join(initial.skillDirectory, changed.draft.path, "SKILL.md"),
        "utf8",
      ),
    ).toContain("[unfinished");
    expect(
      readFileSync(
        join(
          initial.skillDirectory,
          original.versions[0].path,
          "assets/sample.bin",
        ),
      ),
    ).toEqual(binary);
  });

  it("repairs a missing bundle from DB bytes without rewriting an unchanged manifest", () => {
    const result = project();
    const before = readFileSync(result.manifestPath);
    const current = manifest(result.manifestPath);
    rmSync(join(result.skillDirectory, current.draft.path), {
      recursive: true,
    });
    expect(project().changed).toBe(true);
    expect(readFileSync(result.manifestPath)).toEqual(before);
    expect(
      readFileSync(
        join(result.skillDirectory, current.draft.path, "assets/sample.bin"),
      ),
    ).toEqual(binary);
  });

  it("rolls back a failed database commit and refuses to roll over a later manifest", () => {
    const first = project();
    const initial = readFileSync(first.manifestPath);
    const archived = snapshot();
    archived.metadata.archivedAt = 123;
    const second = project(archived);
    second.rollback();
    expect(readFileSync(first.manifestPath)).toEqual(initial);
    const third = project(archived);
    const renamed = snapshot();
    renamed.metadata.name = "new-name";
    project(renamed);
    expect(() => third.rollback()).toThrow("later manifest");
    expect(manifest(first.manifestPath).metadata.name).toBe("new-name");
  });

  it("reconciles a first-write rollback's managed residue", () => {
    const first = project();
    first.rollback();
    expect(existsSync(first.manifestPath)).toBe(false);
    expect(project().changed).toBe(true);
    expect(readdirSync(join(first.skillDirectory, "bundles"))).toHaveLength(1);
  });

  it("preserves the prior manifest when input or existing immutable bytes are invalid", () => {
    const first = project();
    const before = readFileSync(first.manifestPath);
    const unsafe = snapshot();
    unsafe.owner.tenantSlug = "../beta";
    expect(() => project(unsafe)).toThrow(SkillLibraryFileError);
    const wrongDigest = snapshot();
    wrongDigest.versions[0]!.contentDigest = "0".repeat(64);
    expect(() => project(wrongDigest)).toThrow("digest mismatch");
    const current = manifest(first.manifestPath);
    const file = join(first.skillDirectory, current.draft.path, "SKILL.md");
    chmodSync(file, 0o600);
    writeFileSync(file, "tampered");
    expect(() => project()).toThrow("bytes changed");
    expect(readFileSync(first.manifestPath)).toEqual(before);
  });

  it("rejects foreign directories, unknown files, symlinks, and hardlinks without changing the current manifest", () => {
    const first = project();
    const before = readFileSync(first.manifestPath);
    writeFileSync(join(first.skillDirectory, "manual.txt"), "keep this");
    expect(() => project()).toThrow("unmanaged content");
    rmSync(join(first.skillDirectory, "manual.txt"));
    const foreign = snapshot();
    foreign.owner.tenantId = "tnt-other";
    expect(() => project(foreign)).toThrow("another owner");
    const current = manifest(first.manifestPath);
    const file = join(
      first.skillDirectory,
      current.draft.path,
      "assets/sample.bin",
    );
    const outside = join(root, "outside.bin");
    writeFileSync(outside, binary);
    rmSync(file);
    symlinkSync(outside, file);
    expect(() => project()).toThrow("Symbolic links");
    rmSync(file);
    linkSync(outside, file);
    expect(() => project()).toThrow("Linked or irregular");
    expect(readFileSync(first.manifestPath)).toEqual(before);
    expect(readFileSync(outside)).toEqual(binary);
  });

  it("rejects unmanaged roots and storage failures without exposing absolute filesystem paths", () => {
    mkdirSync(join(root, "shared/skills/skl-one"), { recursive: true });
    writeFileSync(
      join(root, "shared/skills/skl-one", "private.txt"),
      "operator content",
    );
    expect(() => project()).toThrow("unmanaged");
    expect(
      readFileSync(join(root, "shared/skills/skl-one", "private.txt"), "utf8"),
    ).toBe("operator content");
    const blocked = join(root, "blocked");
    writeFileSync(blocked, "not a directory");
    try {
      projectSkillLibraryFiles(snapshot(), { dataRoot: blocked });
      expect.fail("must reject");
    } catch (error) {
      expect(error).toBeInstanceOf(SkillLibraryFileError);
      expect((error as Error).message).not.toContain(root);
    }
  });
});
