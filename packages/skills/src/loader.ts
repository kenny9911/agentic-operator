/** Filesystem compatibility adapter. Configured roots are operator-owned;
 * untrusted uploads enter through bundle/archive admission instead. */
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readSync,
  realpathSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  SKILL_BUNDLE_LIMITS,
  type SkillBundle,
  type SkillFile,
} from "@agentic/contracts";
import {
  assertSafeSkillPath,
  assertValidSkillBundle,
  parseSkillFrontmatter,
} from "./bundle";

export interface SkillDescriptor {
  name: string;
  description: string;
  /** Trusted compatibility coordinate. Never accept this path from a model. */
  path: string;
  metadata?: Record<string, unknown>;
}

interface DirectoryAnchor {
  path: string;
  canonical: string;
  dev: number;
  ino: number;
}

/** Pin each traversed directory to its original identity and canonical parent.
 * These checks reject observed replacements, including intermediate symlinks.
 * They are not an atomic openat-based defense against a hostile same-UID
 * process swapping paths back between checks; configured roots are trusted. */
function captureDirectory(
  path: string,
  parent?: DirectoryAnchor,
): DirectoryAnchor {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(
      "Skill directories must be directories without symbolic links",
    );
  const canonical = realpathSync(path);
  if (parent && canonical !== join(parent.canonical, basename(path))) {
    throw new Error("Skill directory changed or escaped its pinned parent");
  }
  const anchor = { path, canonical, dev: stat.dev, ino: stat.ino };
  verifyDirectories([anchor]);
  return anchor;
}

function verifyDirectories(anchors: readonly DirectoryAnchor[]): void {
  for (const anchor of anchors) {
    const stat = lstatSync(anchor.path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.dev !== anchor.dev ||
      stat.ino !== anchor.ino ||
      realpathSync(anchor.path) !== anchor.canonical
    ) {
      throw new Error("Skill directory changed while it was being snapshotted");
    }
  }
}

function directoryEntries(
  anchors: readonly DirectoryAnchor[],
  maximum: number,
): string[] {
  verifyDirectories(anchors);
  const result: string[] = [];
  const directory = opendirSync(anchors[anchors.length - 1]!.path);
  try {
    for (
      let entry = directory.readSync();
      entry;
      entry = directory.readSync()
    ) {
      if (result.length >= maximum)
        throw new Error("Skill directory contains too many entries");
      result.push(entry.name);
    }
  } finally {
    directory.closeSync();
  }
  verifyDirectories(anchors);
  return result.sort();
}

/** Read regular files without following a final symlink or allocating beyond
 * the admitted size. Reject a file changed while being snapshotted. */
function readStableBytes(
  file: string,
  maximum: number,
  anchors: readonly DirectoryAnchor[],
): Buffer {
  verifyDirectories(anchors);
  const initial = lstatSync(file);
  if (!initial.isFile() || initial.isSymbolicLink() || initial.nlink !== 1) {
    throw new Error("Skill resources must be regular files without links");
  }
  if (initial.size > maximum)
    throw new Error("Skill file exceeds its byte limit");
  const expected = realpathSync(file);
  if (
    expected !== join(anchors[anchors.length - 1]!.canonical, basename(file))
  ) {
    throw new Error("Skill file escaped its pinned directory");
  }
  verifyDirectories(anchors);
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (
      !before.isFile() ||
      before.dev !== initial.dev ||
      before.ino !== initial.ino ||
      before.size > maximum
    ) {
      throw new Error("Skill file changed before it could be read");
    }
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    const after = fstatSync(fd);
    verifyDirectories(anchors);
    if (
      length !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      realpathSync(file) !== expected
    ) {
      throw new Error("Skill file changed while it was being read");
    }
    return bytes.subarray(0, length);
  } finally {
    closeSync(fd);
  }
}

function textBytes(bytes: Buffer): string {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes))
    throw new Error("SKILL.md must contain valid UTF-8 text");
  return text;
}

/** Metadata discovery stays compatible with existing Tenant Registries. A
 * missing configured root is an empty library; malformed files fail visibly.
 * Only bounded SKILL.md files are inspected, not their supporting resources. */
export function loadSkillsFromDirectory(root: string): SkillDescriptor[] {
  const absolute = resolve(root);
  if (!existsSync(absolute)) return [];
  const rootAnchor = captureDirectory(absolute);
  const descriptors: SkillDescriptor[] = [];
  const names = new Set<string>();
  for (const entry of directoryEntries([rootAnchor], 1000)) {
    const skillDirectory = join(absolute, entry);
    const stat = lstatSync(skillDirectory);
    if (stat.isSymbolicLink())
      throw new Error("Skill directories must not be symbolic links");
    if (!stat.isDirectory()) continue;
    const skillAnchor = captureDirectory(skillDirectory, rootAnchor);
    const file = join(skillDirectory, "SKILL.md");
    if (!existsSync(file)) continue;
    const { metadata } = parseFrontmatter(
      textBytes(
        readStableBytes(file, SKILL_BUNDLE_LIMITS.maxSkillMdBytes, [
          rootAnchor,
          skillAnchor,
        ]),
      ),
    );
    const name =
      typeof metadata?.name === "string" && metadata.name.length > 0
        ? metadata.name
        : entry;
    if (names.has(name))
      throw new Error(`Duplicate skill name '${name}' in configured library`);
    names.add(name);
    descriptors.push({
      name,
      description:
        typeof metadata?.description === "string" &&
        metadata.description.length > 0
          ? metadata.description
          : `Skill '${name}' (no description provided)`,
      path: file,
      metadata,
    });
  }
  verifyDirectories([rootAnchor]);
  return descriptors.sort((left, right) => left.name.localeCompare(right.name));
}

/** Capture complete, validated bytes before retaining an immutable version.
 * Supporting files are read here, not each time a model loads instructions. */
export function readSkillBundleFromDirectory(root: string): SkillBundle {
  const absolute = resolve(root);
  const rootAnchor = captureDirectory(absolute);
  const files: SkillFile[] = [];
  let totalBytes = 0;
  let visited = 0;
  function walk(anchors: readonly DirectoryAnchor[], prefix: string): void {
    const parent = anchors[anchors.length - 1]!;
    for (const entry of directoryEntries(
      anchors,
      SKILL_BUNDLE_LIMITS.maxFiles * 2,
    )) {
      if (++visited > SKILL_BUNDLE_LIMITS.maxFiles * 2)
        throw new Error("Skill directory contains too many entries");
      const relative = prefix ? `${prefix}/${entry}` : entry;
      assertSafeSkillPath(relative);
      const full = join(parent.path, entry);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink())
        throw new Error("Skill resources must not contain symbolic links");
      if (stat.isDirectory()) {
        walk([...anchors, captureDirectory(full, parent)], relative);
        continue;
      }
      if (files.length >= SKILL_BUNDLE_LIMITS.maxFiles)
        throw new Error("Skill bundle contains too many files");
      const maximum = Math.min(
        relative === "SKILL.md"
          ? SKILL_BUNDLE_LIMITS.maxSkillMdBytes
          : SKILL_BUNDLE_LIMITS.maxFileBytes,
        SKILL_BUNDLE_LIMITS.maxBundleBytes - totalBytes,
      );
      const bytes = readStableBytes(full, maximum, anchors);
      totalBytes += bytes.length;
      const text = bytes.toString("utf8");
      const utf8 = Buffer.from(text, "utf8").equals(bytes);
      files.push({
        path: relative,
        content: utf8 ? text : bytes.toString("base64"),
        encoding: utf8 ? "utf8" : "base64",
      });
    }
    verifyDirectories(anchors);
  }
  walk([rootAnchor], "");
  const bundle = { files };
  const validated = assertValidSkillBundle(bundle);
  if (validated.metadata?.name !== basename(absolute))
    throw new Error("Skill folder must match the name declared in SKILL.md");
  return bundle;
}

/** Legacy body helper; callers still own descriptor authorization. */
export function readSkillBody(path: string): string {
  return parseFrontmatter(
    textBytes(
      readStableBytes(path, SKILL_BUNDLE_LIMITS.maxSkillMdBytes, [
        captureDirectory(dirname(path)),
      ]),
    ),
  ).body;
}

/** Preserve the legacy return shape, backed by real bounded YAML parsing. */
export function parseFrontmatter(source: string): {
  metadata: Record<string, unknown> | undefined;
  body: string;
} {
  const parsed = parseSkillFrontmatter(source);
  if (
    parsed.metadata === undefined &&
    parsed.diagnostics.every((issue) => issue.code === "missing_frontmatter")
  ) {
    return { metadata: undefined, body: source };
  }
  const errors = parsed.diagnostics.filter(
    (issue) => issue.severity === "error",
  );
  if (errors.length)
    throw new Error(errors.map((issue) => issue.message).join("; "));
  return { metadata: parsed.metadata, body: parsed.body.trim() };
}
