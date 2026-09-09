/** A recoverable, owner-scoped filesystem projection of the authoritative DB.
 * Bundles never change in place; one atomic manifest replacement selects them.
 * Configured roots are operator-owned, not a sandbox against hostile same-UID
 * processes. No projected file is read back into the database or run catalog.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { SkillBundleSchema, type SkillBundle } from "@agentic/contracts";
import {
  decodeSkillFile,
  SkillPathIndex,
  SKILL_BUNDLE_LIMITS,
} from "@agentic/skills";
import { resolveDataRootPath } from "../config/data-paths";

export interface SkillLibraryFileOwner {
  visibility: "tenant" | "shared";
  tenantId: string;
  /** Looked up from the owning DB row, never the request's active tenant. */
  tenantSlug: string;
  skillId: string;
}
export interface SkillLibraryFileRevision {
  revision: number;
  bundle: SkillBundle;
  metadata?: Record<string, unknown>;
}
export interface SkillLibraryFileVersion {
  id: string;
  versionNo: number;
  contentDigest: string;
  bundle: SkillBundle;
  metadata?: Record<string, unknown>;
}
export interface SkillLibraryFileSnapshot {
  owner: SkillLibraryFileOwner;
  metadata: Record<string, unknown>;
  draft: SkillLibraryFileRevision;
  revisions: SkillLibraryFileRevision[];
  versions: SkillLibraryFileVersion[];
}
export interface SkillLibraryFileOptions {
  dataRoot?: string;
  tenantsRoot?: string;
}
export interface SkillLibraryFileProjection {
  skillDirectory: string;
  manifestPath: string;
  changed: boolean;
  /** Used if the enclosing DB commit fails. Refuses to replace a later write. */
  rollback: () => void;
}
type Decoded = { digest: string; files: { path: string; bytes: Buffer }[] };
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const DIGEST = /^[a-f0-9]{64}$/;
export class SkillLibraryFileError extends Error {
  constructor(
    message = "Skill files could not be synchronized. The database edit was not committed.",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SkillLibraryFileError";
  }
}
function fail(message: string): never {
  throw new SkillLibraryFileError(`Skill filesystem projection: ${message}`);
}
function segment(value: string): string {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_-]{0,239}$/.test(value))
    fail("Invalid owner or identity path segment");
  return value;
}
function positive(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1)
    fail("Invalid revision or version number");
  return value;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonical(child)]),
    );
  return value;
}
function json(value: unknown): Buffer {
  // Normalize Date/undefined exactly as JSON storage does, then sort keys.
  const encoded = Buffer.from(
    `${JSON.stringify(canonical(JSON.parse(JSON.stringify(value))), null, 2)}\n`,
  );
  if (encoded.length > MAX_MANIFEST_BYTES)
    fail("Metadata exceeds its size limit");
  return encoded;
}
function decoded(input: SkillBundle): Decoded {
  const bundle = SkillBundleSchema.parse(input);
  const index = new SkillPathIndex();
  let total = 0;
  const files = bundle.files
    .map((file) => {
      index.add(file.path);
      const bytes = decodeSkillFile(file);
      total += bytes.length;
      if (total > SKILL_BUNDLE_LIMITS.maxBundleBytes)
        fail("Bundle exceeds its byte limit");
      if (
        file.path === "SKILL.md" &&
        bytes.length > SKILL_BUNDLE_LIMITS.maxSkillMdBytes
      )
        fail("SKILL.md exceeds its byte limit");
      return { path: file.path, bytes };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  // Match the portable bundle digest while allowing an invalid editable draft.
  const hash = createHash("sha256").update("agentic-skill-bundle-v1\0");
  for (const file of files) {
    const name = Buffer.from(file.path);
    const lengths = Buffer.alloc(8);
    lengths.writeUInt32BE(name.length, 0);
    lengths.writeUInt32BE(file.bytes.length, 4);
    hash.update(lengths).update(name).update(file.bytes);
  }
  return { digest: hash.digest("hex"), files };
}
function directory(directory: string): void {
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    fail("Directory is not a regular, unlinked directory");
}
/** Canonicalize only the operator-supplied outer root (macOS /var is an OS
 * alias). Every descendant is checked without following symbolic links. */
function rootDirectory(configured: string): string {
  const absolute = path.resolve(configured);
  if (existsSync(absolute)) {
    directory(absolute);
    return realpathSync(absolute);
  }
  const parent = rootDirectory(path.dirname(absolute));
  const target = path.join(parent, path.basename(absolute));
  mkdirSync(target, { mode: 0o700 });
  directory(target);
  return target;
}
function childDirectory(parent: string, name: string): string {
  directory(parent);
  const target = path.join(parent, name);
  if (!existsSync(target)) mkdirSync(target, { mode: 0o700 });
  directory(target);
  if (realpathSync(target) !== target)
    fail("Directory escaped its canonical root");
  return target;
}
function regularBytes(file: string, maximum = MAX_MANIFEST_BYTES): Buffer {
  const initial = lstatSync(file);
  if (
    !initial.isFile() ||
    initial.isSymbolicLink() ||
    initial.nlink !== 1 ||
    (process.platform !== "win32" && (initial.mode & 0o077) !== 0) ||
    initial.size > maximum
  )
    fail("File is linked, irregular, or oversized");
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (
      before.dev !== initial.dev ||
      before.ino !== initial.ino ||
      before.nlink !== 1
    )
      fail("File changed before it could be verified");
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (
      bytes.length !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    )
      fail("File changed during verification");
    return bytes;
  } finally {
    closeSync(fd);
  }
}
function writeNew(file: string, bytes: Buffer, mode = 0o600): void {
  const fd = openSync(
    file,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    mode,
  );
  try {
    writeFileSync(fd, bytes);
  } finally {
    closeSync(fd);
  }
}
function checkTree(root: string): string[] {
  const files: string[] = [];
  const paths = new SkillPathIndex();
  let visited = 0;
  function walk(parent: string, prefix: string): void {
    directory(parent);
    if (process.platform !== "win32" && (lstatSync(parent).mode & 0o077) !== 0)
      fail("Bundle directory permissions must be owner-only");
    const entries = readdirSync(parent).sort();
    if (prefix && entries.length === 0)
      fail("Unexpected empty bundle directory");
    for (const name of entries) {
      if (++visited > SKILL_BUNDLE_LIMITS.maxFiles * 2)
        fail("Bundle directory exceeds its entry limit");
      const full = path.join(parent, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) fail("Symbolic links are not allowed");
      if (stat.isDirectory()) walk(full, relative);
      else if (stat.isFile() && stat.nlink === 1) {
        paths.add(relative);
        if (files.length >= SKILL_BUNDLE_LIMITS.maxFiles)
          fail("Bundle directory exceeds its file limit");
        files.push(relative);
      } else fail("Linked or irregular resource is not allowed");
    }
  }
  walk(root, "");
  return files.sort();
}
function verifyBundle(root: string, bundle: Decoded): void {
  const actual = checkTree(root);
  if (
    actual.length !== bundle.files.length ||
    actual.some((name, i) => name !== bundle.files[i]!.path)
  )
    fail("Existing immutable bundle has unexpected or missing content");
  for (const file of bundle.files)
    if (
      !regularBytes(
        path.join(root, file.path),
        SKILL_BUNDLE_LIMITS.maxFileBytes,
      ).equals(file.bytes)
    )
      fail("Existing immutable bundle bytes changed");
}
function replaceManifest(root: string, bytes: Buffer): void {
  const temporary = path.join(root, `.current-${randomUUID()}.tmp`);
  try {
    writeNew(temporary, bytes);
    renameSync(temporary, path.join(root, "current.json"));
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function projectFiles(
  input: SkillLibraryFileSnapshot,
  options: SkillLibraryFileOptions = {},
): SkillLibraryFileProjection {
  const owner = { ...input.owner };
  segment(owner.tenantId);
  segment(owner.tenantSlug);
  segment(owner.skillId);
  if (owner.visibility !== "tenant" && owner.visibility !== "shared")
    fail("Invalid visibility");
  const bundles = new Map<string, Decoded>();
  function bundleReference(bundle: SkillBundle) {
    const prepared = decoded(bundle);
    bundles.set(prepared.digest, prepared);
    return {
      contentDigest: prepared.digest,
      path: `bundles/${prepared.digest}`,
    };
  }
  const revision = (value: SkillLibraryFileRevision) => ({
    revision: positive(value.revision),
    ...bundleReference(value.bundle),
    ...(value.metadata ? { metadata: value.metadata } : {}),
  });
  const revisions = input.revisions
    .map(revision)
    .sort((a, b) => a.revision - b.revision);
  const draft = revision(input.draft);
  if (new Set(revisions.map((row) => row.revision)).size !== revisions.length)
    fail("Duplicate draft revision");
  const currentRevision = revisions.find(
    (row) => row.revision === draft.revision,
  );
  if (!currentRevision || currentRevision.contentDigest !== draft.contentDigest)
    fail("Current draft does not match its immutable revision");
  const versions = input.versions
    .map((value) => {
      segment(value.id);
      const ref = bundleReference(value.bundle);
      if (
        !DIGEST.test(value.contentDigest) ||
        ref.contentDigest !== value.contentDigest
      )
        fail("Published bundle digest mismatch");
      return {
        id: value.id,
        versionNo: positive(value.versionNo),
        ...ref,
        ...(value.metadata ? { metadata: value.metadata } : {}),
      };
    })
    .sort((a, b) => a.versionNo - b.versionNo);
  if (
    new Set(versions.map((row) => row.id)).size !== versions.length ||
    new Set(versions.map((row) => row.versionNo)).size !== versions.length
  )
    fail("Duplicate published version");
  const marker = json({ schemaVersion: 1, owner });
  const manifest = json({
    schemaVersion: 1,
    owner,
    metadata: input.metadata,
    draft,
    revisions,
    versions,
  });
  const dataRoot = options.dataRoot ?? resolveDataRootPath();
  const base =
    owner.visibility === "shared"
      ? childDirectory(
          childDirectory(rootDirectory(dataRoot), "shared"),
          "skills",
        )
      : childDirectory(
          childDirectory(
            rootDirectory(
              options.tenantsRoot ??
                (options.dataRoot
                  ? path.join(dataRoot, "tenants")
                  : (process.env.AGENTIC_TENANTS_DIR ??
                    path.join(dataRoot, "tenants"))),
            ),
            owner.tenantSlug,
          ),
          "skills",
        );
  const skillDirectory = path.join(base, owner.skillId);
  if (!existsSync(skillDirectory)) {
    const stage = path.join(base, `.skill-${randomUUID()}.tmp`);
    try {
      mkdirSync(stage, { mode: 0o700 });
      writeNew(path.join(stage, "owner.json"), marker, 0o400);
      mkdirSync(path.join(stage, "bundles"), { mode: 0o700 });
      renameSync(stage, skillDirectory);
    } finally {
      if (existsSync(stage)) rmSync(stage, { recursive: true });
    }
  }
  directory(skillDirectory);
  const ownerPath = path.join(skillDirectory, "owner.json");
  if (!existsSync(ownerPath) || !regularBytes(ownerPath).equals(marker))
    fail("Existing skill directory is unmanaged or belongs to another owner");
  if (
    process.platform !== "win32" &&
    (lstatSync(skillDirectory).mode & 0o077) !== 0
  )
    fail("Managed skill directory permissions must be owner-only");
  for (const name of readdirSync(skillDirectory))
    if (!["owner.json", "current.json", "bundles"].includes(name))
      fail("Existing skill directory contains unmanaged content");
  const bundleDirectory = childDirectory(skillDirectory, "bundles");
  // Do not overlook links or arbitrary content even in unreferenced crash residue.
  for (const name of readdirSync(bundleDirectory)) {
    if (!DIGEST.test(name)) fail("Unmanaged bundle directory");
    const root = path.join(bundleDirectory, name);
    const files = checkTree(root).map((file) => ({
      path: file,
      encoding: "base64" as const,
      content: regularBytes(
        path.join(root, file),
        SKILL_BUNDLE_LIMITS.maxFileBytes,
      ).toString("base64"),
    }));
    if (decoded({ files }).digest !== name)
      fail("Existing immutable bundle bytes changed");
  }
  const manifestPath = path.join(skillDirectory, "current.json");
  const previous = existsSync(manifestPath) ? regularBytes(manifestPath) : null;
  let addedBundle = false;
  for (const bundle of bundles.values()) {
    const destination = path.join(bundleDirectory, bundle.digest);
    if (existsSync(destination)) {
      verifyBundle(destination, bundle);
      continue;
    }
    const stage = path.join(base, `.skill-${randomUUID()}.tmp`);
    try {
      mkdirSync(stage, { mode: 0o700 });
      for (const file of bundle.files) {
        let parent = stage;
        for (const part of file.path.split("/").slice(0, -1))
          parent = childDirectory(parent, part);
        writeNew(path.join(stage, file.path), file.bytes, 0o400);
      }
      verifyBundle(stage, bundle);
      renameSync(stage, destination);
      addedBundle = true;
    } finally {
      if (existsSync(stage)) rmSync(stage, { recursive: true });
    }
  }
  const manifestChanged = !previous?.equals(manifest);
  if (manifestChanged) replaceManifest(skillDirectory, manifest);
  return {
    skillDirectory,
    manifestPath,
    changed: manifestChanged || addedBundle,
    rollback() {
      if (!manifestChanged) return;
      if (
        !existsSync(manifestPath) ||
        !regularBytes(manifestPath).equals(manifest)
      )
        fail("Rollback refused because a later manifest is current");
      if (previous) replaceManifest(skillDirectory, previous);
      else unlinkSync(manifestPath);
    },
  };
}

/** Native filesystem errors can contain absolute private paths. Keep the API
 * error safe while preserving the typed failure for transaction rollback. */
export function projectSkillLibraryFiles(
  input: SkillLibraryFileSnapshot,
  options: SkillLibraryFileOptions = {},
): SkillLibraryFileProjection {
  try {
    const result = projectFiles(input, options);
    return {
      ...result,
      rollback() {
        try {
          result.rollback();
        } catch (error) {
          if (error instanceof SkillLibraryFileError) throw error;
          throw new SkillLibraryFileError(undefined, { cause: error });
        }
      },
    };
  } catch (error) {
    if (error instanceof SkillLibraryFileError) throw error;
    throw new SkillLibraryFileError(undefined, { cause: error });
  }
}
