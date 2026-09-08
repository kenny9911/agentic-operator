/**
 * Native Codex materialization for a trusted host's immutable Skill catalog.
 * This is not a resolver, script runner, or process sandbox. Callers own the
 * authorized subset, private process/filesystem boundary, and gateway config.
 */
import {
  chmodSync, closeSync, constants, fstatSync, lstatSync, mkdirSync,
  openSync, readdirSync, realpathSync, rmSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import type { SkillMetadata, UserInput } from "@agentic/codex-protocol";
import {
  assertSafeSkillPath, assertValidSkillBundle, decodeSkillFile,
  readSkillBundleFromDirectory, SkillSession,
  DEFAULT_SKILL_SESSION_LIMITS,
  type SkillBundle, type SkillCatalogEntry,
} from "@agentic/skills";
import type { AppServerClient } from "./app-server-client";

export interface CodexSkillSource {
  readonly entry: SkillCatalogEntry;
  readonly bundle: SkillBundle;
}

export interface MaterializeCodexSkillsOptions {
  /** Existing private, operator-owned home; initialize its config separately. */
  readonly codexHome: string;
  readonly skills: readonly CodexSkillSource[];
}

export type CodexSkillInput = Extract<UserInput, { type: "skill" }>;

export type CodexSkillErrorCode =
  | "UNSAFE_DIRECTORY" | "UNSAFE_FILE" | "UNSAFE_CLIENT"
  | "UNKNOWN_SKILL" | "UNEXPECTED_DISCOVERY" | "DISCOVERY_REQUIRED"
  | "DISCOVERY_MISMATCH" | "INTEGRITY_MISMATCH" | "LIMIT_EXCEEDED"
  | "UNSUPPORTED_INVOCATION_POLICY";

export class CodexSkillError extends Error {
  override readonly name = "CodexSkillError";
  constructor(readonly code: CodexSkillErrorCode, message: string) { super(message); }
}

interface MaterializedSkill {
  readonly entry: SkillCatalogEntry;
  readonly directory: string;
  readonly skillPath: string;
}

type SkillClient = Pick<AppServerClient, "options" | "skillsList" | "skillsConfigWrite">;

function fail(code: CodexSkillErrorCode, message: string): never { throw new CodexSkillError(code, message); }

function privateDirectory(directory: string, requirePrivateMode = true): string {
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) fail("UNSAFE_DIRECTORY", "Codex Skill directories must not be links");
  if (process.platform !== "win32" && ((requirePrivateMode && (info.mode & 0o077) !== 0) || (process.getuid && info.uid !== process.getuid()))) {
    fail("UNSAFE_DIRECTORY", "Codex Skill directories must be private and owned by this process user");
  }
  return realpathSync(directory);
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

// Pinned Codex collapses YAML description whitespace for its metadata catalog.
// Bytes still have to match the original immutable digest on disk.
function nativeDescription(value: string): string { return value.trim().replace(/\s+/gu, " "); }

function regularScopedFile(root: string, file: string): void {
  if (!path.isAbsolute(file) || !inside(root, file) || realpathSync(file) !== file) {
    fail("UNEXPECTED_DISCOVERY", "Codex discovered a skill outside its authorized materialization");
  }
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail("UNSAFE_FILE", "Codex Skill files must not be links");
}

/**
 * An instance can only be created by successful materialization. Supply its
 * environment to AppServerClient with inheritEnv:false, then prepare discovery
 * before starting a thread. Recheck discovery before subsequent model turns.
 */
export interface CodexSkillSet {
  readonly codexHome: string;
  readonly root: string;
  readonly catalog: readonly SkillCatalogEntry[];
  /** Only discovery-related values; callers separately allow-list launch/gateway values. */
  readonly environment: Readonly<Record<"HOME" | "USERPROFILE" | "XDG_CONFIG_HOME", string>>;
  /** Disables private native system skills, rejects all other unexpected roots. */
  prepareDiscovery(client: SkillClient, cwd: string): Promise<readonly SkillCatalogEntry[]>;
  /** Read-only recheck. Failure invalidates explicit inputs until a successful check. */
  verifyDiscovery(client: SkillClient, cwd: string): Promise<readonly SkillCatalogEntry[]>;
  /** Opaque authorized id only. Never accepts a model-provided filesystem path. */
  explicitInput(id: string): CodexSkillInput;
  /** Detect changes, extra files, symlinks and hardlinks before handing bytes to Codex. */
  verifyIntegrity(): void;
}

class MaterializedCodexSkillSet implements CodexSkillSet {
  readonly catalog: readonly SkillCatalogEntry[];
  readonly environment: Readonly<Record<"HOME" | "USERPROFILE" | "XDG_CONFIG_HOME", string>>;
  #byId: ReadonlyMap<string, MaterializedSkill>;
  #byPath: ReadonlyMap<string, MaterializedSkill>;
  #verified = false;

  constructor(readonly codexHome: string, readonly root: string, skills: readonly MaterializedSkill[], userHome: string) {
    this.#byId = new Map(skills.map((skill) => [skill.entry.id, skill]));
    this.#byPath = new Map(skills.map((skill) => [skill.skillPath, skill]));
    this.catalog = Object.freeze(skills.map((skill) => skill.entry));
    this.environment = Object.freeze({ HOME: userHome, USERPROFILE: userHome, XDG_CONFIG_HOME: path.join(userHome, ".config") });
  }

  verifyIntegrity(): void {
    if (privateDirectory(this.codexHome) !== this.codexHome || privateDirectory(this.root) !== this.root) {
      fail("UNSAFE_DIRECTORY", "Codex Skill root changed after materialization");
    }
    for (const entry of readdirSync(this.root)) {
      if (entry === ".system") {
        // Native built-in modes are Codex-owned; the enclosing home/root are
        // private. Still reject any linked or replaced system directory.
        if (privateDirectory(path.join(this.root, entry), false) !== path.join(this.root, entry)) fail("UNSAFE_DIRECTORY", "Native system skill root must not be a link");
      } else if (!this.catalog.some((skill) => skill.name === entry)) {
        fail("INTEGRITY_MISMATCH", "Unexpected entry in the materialized Skill root");
      }
    }
    for (const skill of this.#byId.values()) {
      regularScopedFile(this.root, skill.skillPath);
      const current = assertValidSkillBundle(readSkillBundleFromDirectory(skill.directory));
      if (current.digest !== skill.entry.contentDigest) fail("INTEGRITY_MISMATCH", "Materialized Skill bytes no longer match the selected immutable version");
    }
  }

  async prepareDiscovery(client: SkillClient, cwd: string): Promise<readonly SkillCatalogEntry[]> {
    this.#verified = false;
    const discovered = await this.#list(client, cwd);
    // The pinned binary installs native built-ins into this private directory.
    // Disable those only. Never turn an ambient user/repo/admin skill into an
    // accepted catalog entry, even when the caller could disable it by name.
    for (const skill of discovered) {
      if (!this.#byPath.has(skill.path) && this.#privateSystem(skill) && skill.enabled) {
        const result = await client.skillsConfigWrite({ path: skill.path, enabled: false });
        if (result.effectiveEnabled !== false) fail("UNEXPECTED_DISCOVERY", "Codex refused to disable a native system skill");
      }
    }
    return this.verifyDiscovery(client, cwd);
  }

  async verifyDiscovery(client: SkillClient, cwd: string): Promise<readonly SkillCatalogEntry[]> {
    this.#verified = false;
    const discovered = await this.#list(client, cwd);
    const seen = new Set<string>();
    for (const native of discovered) {
      const skill = this.#byPath.get(native.path);
      if (!skill) {
        if (this.#privateSystem(native) && !native.enabled) continue;
        fail("UNEXPECTED_DISCOVERY", "Codex discovered a skill that is not in the authorized snapshot");
      }
      if (seen.has(skill.entry.id) || !native.enabled || native.scope !== "user"
        || native.name !== skill.entry.name || nativeDescription(native.description) !== nativeDescription(skill.entry.description)) {
        fail("DISCOVERY_MISMATCH", "Codex Skill discovery differs from the authorized snapshot metadata");
      }
      seen.add(skill.entry.id);
    }
    if (seen.size !== this.#byId.size) fail("DISCOVERY_MISMATCH", "Codex did not discover every authorized Skill");
    this.verifyIntegrity();
    this.#verified = true;
    return this.catalog;
  }

  explicitInput(id: string): CodexSkillInput {
    const skill = this.#byId.get(id);
    if (!skill) fail("UNKNOWN_SKILL", "Explicit invocation must identify a Skill in this immutable catalog");
    if (!this.#verified) fail("DISCOVERY_REQUIRED", "Verify Codex Skill discovery before explicit invocation");
    this.verifyIntegrity();
    return { type: "skill", name: skill.entry.name, path: skill.skillPath };
  }

  #privateSystem(skill: SkillMetadata): boolean {
    const systemRoot = path.join(this.root, ".system");
    if (skill.scope !== "system" || !inside(systemRoot, skill.path)) return false;
    regularScopedFile(systemRoot, skill.path);
    return true;
  }

  async #list(client: SkillClient, cwd: string): Promise<readonly SkillMetadata[]> {
    this.verifyIntegrity();
    const { options } = client;
    if (options.inheritEnv !== false || realpathSync(options.codexHome) !== this.codexHome) {
      fail("UNSAFE_CLIENT", "Codex Skill discovery requires this private home and no inherited environment");
    }
    for (const key of ["HOME", "USERPROFILE", "XDG_CONFIG_HOME"] as const) {
      if (options.env?.[key] !== this.environment[key]) fail("UNSAFE_CLIENT", "Codex Skill discovery requires the materialization's private user environment");
    }
    for (const directory of [this.environment.HOME, this.environment.XDG_CONFIG_HOME]) {
      if (privateDirectory(directory) !== directory) fail("UNSAFE_CLIENT", "Codex Skill user environment changed");
    }
    const canonicalCwd = realpathSync(cwd);
    if (!options.cwd || realpathSync(options.cwd) !== canonicalCwd || !lstatSync(canonicalCwd).isDirectory()) {
      fail("UNSAFE_CLIENT", "Verify Skill discovery for the client's explicitly configured working directory");
    }
    const result = await client.skillsList({ cwds: [canonicalCwd], forceReload: true });
    if (!result || !Array.isArray(result.data) || result.data.length !== 1) fail("DISCOVERY_MISMATCH", "Codex returned an invalid Skill discovery response");
    const entry = result.data[0]!;
    if (entry.cwd !== canonicalCwd || !Array.isArray(entry.skills) || !Array.isArray(entry.errors)
      || entry.errors.length > 0 || entry.skills.length > DEFAULT_SKILL_SESSION_LIMITS.maxCatalogEntries + 100) {
      fail("DISCOVERY_MISMATCH", "Codex Skill discovery was incomplete or reported errors");
    }
    for (const skill of entry.skills) {
      if (!skill || typeof skill.path !== "string" || typeof skill.name !== "string" || typeof skill.description !== "string" || typeof skill.enabled !== "boolean") {
        fail("DISCOVERY_MISMATCH", "Codex returned malformed Skill metadata");
      }
      if (!this.#byPath.has(skill.path) && !this.#privateSystem(skill)) fail("UNEXPECTED_DISCOVERY", "Codex discovered a Skill outside the authorized private root");
    }
    return entry.skills;
  }
}

/**
 * Validate the complete supplied catalog before writing anything, then create
 * a fresh root. Never merge into/reuse a prior run's skills or follow links.
 * The caller must prevent concurrent untrusted filesystem writes (for example
 * an isolated process/container with a read-only skill mount during turns).
 */
export function materializeCodexSkills(options: MaterializeCodexSkillsOptions): CodexSkillSet {
  const codexHome = privateDirectory(path.resolve(options.codexHome));
  const sources = structuredClone(options.skills);
  // Reuse canonical catalog identity/collision/budget validation; this does
  // not authorize entries. Authorization was the trusted host's job earlier.
  new SkillSession({ catalog: sources.map((source) => source.entry), readBundle: () => { throw new Error("Materialization does not load mutable sources"); } });
  let bytes = 0;
  const prepared = sources.map(({ entry, bundle }) => {
    const validated = assertValidSkillBundle(bundle);
    if (validated.digest !== entry.contentDigest || validated.metadata.name !== entry.name || validated.metadata.description !== entry.description) {
      fail("INTEGRITY_MISMATCH", "Skill bundle does not match its immutable catalog identity and digest");
    }
    if (entry.invocationPolicy?.model === false || entry.invocationPolicy?.explicit === false || validated.metadata["disable-model-invocation"] === true) {
      fail("UNSUPPORTED_INVOCATION_POLICY", "Restricted invocation requires the host SkillSession adapter; pinned native Codex policy mapping is not verified");
    }
    bytes += validated.totalBytes;
    if (bytes > DEFAULT_SKILL_SESSION_LIMITS.maxBundleCacheBytes) fail("LIMIT_EXCEEDED", "Codex Skill materialization exceeds its total byte budget");
    return { entry: Object.freeze({ ...entry, ...(entry.invocationPolicy ? { invocationPolicy: Object.freeze({ ...entry.invocationPolicy }) } : {}) }), bundle };
  });
  const root = path.join(codexHome, "skills");
  const userHome = path.join(codexHome, "skill-runtime-home");
  mkdirSync(root, { mode: 0o700 }); // EEXIST rejects existing files, roots and links.
  let createdUserHome = false;
  try {
    mkdirSync(userHome, { mode: 0o700 });
    createdUserHome = true;
    mkdirSync(path.join(userHome, ".config"), { mode: 0o700 });
    const materialized = prepared.map(({ entry, bundle }) => {
      const directory = path.join(root, entry.name);
      mkdirSync(directory, { mode: 0o700 });
      for (const file of bundle.files) {
        assertSafeSkillPath(file.path);
        const destination = path.join(directory, ...file.path.split("/"));
        mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
        const fd = openSync(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o400);
        try {
          const stat = fstatSync(fd);
          if (!stat.isFile() || stat.nlink !== 1) fail("UNSAFE_FILE", "Codex Skill resource must be a new regular file");
          writeFileSync(fd, decodeSkillFile(file));
        } finally { closeSync(fd); }
        if (process.platform !== "win32") chmodSync(destination, 0o400);
      }
      return { entry, directory, skillPath: path.join(directory, "SKILL.md") };
    });
    const result = new MaterializedCodexSkillSet(codexHome, root, materialized, userHome);
    result.verifyIntegrity();
    return result;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    if (createdUserHome) rmSync(userHome, { recursive: true, force: true });
    throw error;
  }
}
