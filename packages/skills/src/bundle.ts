/** Portable Agent Skills packages. This module never performs I/O or executes resources. */
import { createHash } from "node:crypto";
import { LineCounter, parseDocument } from "yaml";
import {
  SKILL_BUNDLE_LIMITS,
  SkillFrontmatterSchema,
  type SkillBundle,
  type SkillDiagnostic,
  type SkillFile,
  type SkillFrontmatter,
} from "@agentic/contracts";

export type { SkillBundle, SkillDiagnostic, SkillFile, SkillFrontmatter } from "@agentic/contracts";
export { SKILL_BUNDLE_LIMITS } from "@agentic/contracts";

export class SkillBundleError extends Error {
  readonly diagnostics: SkillDiagnostic[];

  constructor(diagnostics: SkillDiagnostic[] | string, code = "invalid_bundle", path?: string) {
    const issues: SkillDiagnostic[] = typeof diagnostics === "string"
      ? [{ severity: "error", code, message: diagnostics, ...(path === undefined ? {} : { path }) }]
      : diagnostics;
    super(issues.map((issue) => issue.message).join("; "));
    this.name = "SkillBundleError";
    this.diagnostics = issues;
  }
}

export interface SkillBundleValidation {
  valid: boolean;
  diagnostics: SkillDiagnostic[];
  metadata?: SkillFrontmatter;
  body?: string;
  /** SHA-256, hex encoded. Independent of JSON file order and transport encoding. */
  digest?: string;
  totalBytes: number;
}

export interface ValidSkillBundle extends SkillBundleValidation {
  valid: true;
  metadata: SkillFrontmatter;
  body: string;
  digest: string;
}

export interface ParsedSkillDocument {
  frontmatter: SkillFrontmatter;
  body: string;
  diagnostics: SkillDiagnostic[];
}

function issue(code: string, message: string, path = "SKILL.md"): SkillDiagnostic {
  return { severity: "error", code, message, path };
}

function errorsFrom(error: unknown, code = "invalid_bundle", path?: string): SkillDiagnostic[] {
  return error instanceof SkillBundleError
    ? error.diagnostics
    : [{ severity: "error", code, message: error instanceof Error ? error.message : String(error), ...(path ? { path } : {}) }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Refuse replacement-character conversions so admitted UTF-8 round trips exactly. */
function assertWellFormed(value: string, path?: string): void {
  if (Buffer.from(value, "utf8").toString("utf8") !== value) {
    throw new SkillBundleError("Text contains an unpaired Unicode surrogate.", "invalid_unicode", path);
  }
}

/** POSIX relative file path with portable host-filesystem semantics. Never normalizes traversal. */
export function assertSafeSkillPath(path: string): void {
  if (typeof path !== "string" || path.length === 0) {
    throw new SkillBundleError("A skill file needs a non-empty relative path.", "unsafe_path");
  }
  if (Buffer.byteLength(path, "utf8") > SKILL_BUNDLE_LIMITS.maxPathLength) {
    throw new SkillBundleError(`Skill paths must fit within ${SKILL_BUNDLE_LIMITS.maxPathLength} UTF-8 bytes.`, "path_limit", path);
  }
  assertWellFormed(path, path);
  if (path !== path.normalize("NFC")) {
    throw new SkillBundleError("Skill paths must use Unicode NFC normalization.", "unsafe_path", path);
  }
  if (/[\\\u0000-\u001f\u007f-\u009f:*?"<>|]/u.test(path)) {
    throw new SkillBundleError("Skill paths cannot contain backslashes, control characters, drive prefixes, or non-portable filename characters.", "unsafe_path", path);
  }
  const parts = path.split("/");
  if (parts.length > SKILL_BUNDLE_LIMITS.maxPathDepth) {
    throw new SkillBundleError(`Skill paths cannot exceed ${SKILL_BUNDLE_LIMITS.maxPathDepth} components.`, "path_depth", path);
  }
  for (const part of parts) {
    if (!part || part === "." || part === ".." || part.trim() !== part || /[ .]$/u.test(part)
      || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part)) {
      throw new SkillBundleError("Skill paths must be relative, contain no dot or empty components, and avoid reserved filenames or trailing dots/spaces.", "unsafe_path", path);
    }
  }
}

function portablePathKey(path: string): string {
  // NFD/NFC and case aliases cannot coexist on common Mac/Windows filesystems.
  return path.normalize("NFC").toUpperCase().toLowerCase();
}

/** Shared by JSON and archive admission; explicit duplicate directory entries are rejected too. */
export class SkillPathIndex {
  private readonly entries = new Map<string, { path: string; kind: "file" | "directory"; explicit: boolean }>();

  add(path: string, kind: "file" | "directory" = "file"): void {
    assertSafeSkillPath(path);
    const parts = path.split("/");
    for (let length = 1; length <= parts.length; length++) {
      const prefix = parts.slice(0, length).join("/");
      const key = portablePathKey(prefix);
      const explicit = length === parts.length;
      const prefixKind = explicit ? kind : "directory";
      const prior = this.entries.get(key);
      if (prior) {
        if (prior.path !== prefix) {
          throw new SkillBundleError(`Paths '${prior.path}' and '${prefix}' collide on a portable filesystem.`, "path_collision", path);
        }
        if (prior.kind !== prefixKind) {
          throw new SkillBundleError(`'${prefix}' cannot be both a file and a directory.`, "path_conflict", path);
        }
        if (explicit && prior.explicit) {
          throw new SkillBundleError(`Duplicate archive or bundle path '${path}'.`, "duplicate_path", path);
        }
        if (explicit) prior.explicit = true;
      } else {
        this.entries.set(key, { path: prefix, kind: prefixKind, explicit });
      }
    }
  }
}

/** Strictly decode the transport. Buffer's permissive base64 decoder alone is insufficient. */
export function decodeSkillFile(file: SkillFile): Buffer {
  if (!isRecord(file) || typeof file.path !== "string" || typeof file.content !== "string") {
    throw new SkillBundleError("A skill file must contain a path, content, and explicit encoding.", "invalid_file");
  }
  let bytes: Buffer;
  if (file.encoding === "utf8") {
    if (Buffer.byteLength(file.content, "utf8") > SKILL_BUNDLE_LIMITS.maxFileBytes) {
      throw new SkillBundleError("Skill file exceeds the individual file size limit.", "file_size", file.path);
    }
    assertWellFormed(file.content, file.path);
    bytes = Buffer.from(file.content, "utf8");
  } else if (file.encoding === "base64") {
    if (file.content.length > 4 * Math.ceil(SKILL_BUNDLE_LIMITS.maxFileBytes / 3)) {
      throw new SkillBundleError("Skill file exceeds the individual file size limit.", "file_size", file.path);
    }
    if (file.content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(file.content)) {
      throw new SkillBundleError("Binary skill files require canonical padded base64.", "invalid_base64", file.path);
    }
    bytes = Buffer.from(file.content, "base64");
    if (bytes.toString("base64") !== file.content) {
      throw new SkillBundleError("Binary skill files require canonical padded base64.", "invalid_base64", file.path);
    }
  } else {
    throw new SkillBundleError("Skill file encoding must be utf8 or base64.", "invalid_encoding", file.path);
  }
  if (bytes.length > SKILL_BUNDLE_LIMITS.maxFileBytes) {
    throw new SkillBundleError("Skill file exceeds the individual file size limit.", "file_size", file.path);
  }
  return bytes;
}

/** Classify text without changing its bytes; templates and other binary resources use base64. */
export function encodeSkillFile(path: string, bytes: Uint8Array): SkillFile {
  assertSafeSkillPath(path);
  const buffer = Buffer.from(bytes);
  const content = buffer.toString("utf8");
  if (Buffer.from(content, "utf8").equals(buffer) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(content)) {
    return { path, content, encoding: "utf8" };
  }
  return { path, content: buffer.toString("base64"), encoding: "base64" };
}

function normalizeYaml(value: unknown): Record<string, unknown> {
  let nodes = 0;
  const ancestors = new Set<object>();
  function visit(node: unknown, depth: number): unknown {
    if (++nodes > 4096 || depth > 24) throw new Error("Skill frontmatter is too complex or deeply nested.");
    if (node === null || typeof node === "string" || typeof node === "boolean") return node;
    if (typeof node === "number" && Number.isFinite(node)) return node;
    if (!isRecord(node) && !Array.isArray(node)) throw new Error("Skill frontmatter must use JSON-compatible YAML values.");
    if (ancestors.has(node)) throw new Error("Skill frontmatter cannot contain cyclic aliases.");
    ancestors.add(node);
    const result = Array.isArray(node)
      ? node.map((item) => visit(item, depth + 1))
      : Object.fromEntries(Object.entries(node).map(([key, item]) => [key, visit(item, depth + 1)]));
    ancestors.delete(node);
    return result;
  }
  if (!isRecord(value)) throw new Error("Skill frontmatter must be a YAML mapping.");
  const normalized = visit(value, 0) as Record<string, unknown>;
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > SKILL_BUNDLE_LIMITS.maxFrontmatterBytes * 4) {
    throw new Error("Expanded skill frontmatter exceeds its size limit.");
  }
  return normalized;
}

/**
 * Low-level real YAML parser for existing directory adapters. Missing frontmatter
 * is represented by undefined metadata; strict publication uses parseSkillDocument.
 * The original body and caller-owned source bytes are never rewritten.
 */
export function parseSkillFrontmatter(source: string): {
  metadata: Record<string, unknown> | undefined;
  body: string;
  diagnostics: SkillDiagnostic[];
} {
  const start = /^(?:\uFEFF)?---[ \t]*\r?\n/u.exec(source);
  if (!start) return { metadata: undefined, body: source, diagnostics: [issue("missing_frontmatter", "SKILL.md must start with a YAML frontmatter block.")] };
  const delimiter = /^---[ \t]*\r?$/gmu;
  delimiter.lastIndex = start[0].length;
  const end = delimiter.exec(source);
  if (!end) return { metadata: undefined, body: source, diagnostics: [issue("missing_frontmatter_end", "SKILL.md needs a closing YAML frontmatter delimiter.")] };
  const header = source.slice(start[0].length, end.index);
  const after = end.index + end[0].length;
  const body = source.slice(source[after] === "\n" ? after + 1 : after);
  if (Buffer.byteLength(header, "utf8") > SKILL_BUNDLE_LIMITS.maxFrontmatterBytes) {
    return { metadata: undefined, body, diagnostics: [issue("frontmatter_size", "Skill frontmatter exceeds its size limit.")] };
  }
  try {
    const lineCounter = new LineCounter();
    const document = parseDocument(header, {
      version: "1.2", schema: "core", merge: false, resolveKnownTags: false,
      uniqueKeys: true, stringKeys: true, strict: true, prettyErrors: false, lineCounter,
    });
    const yamlIssues = [...document.errors, ...document.warnings];
    if (yamlIssues.length) {
      return { metadata: undefined, body, diagnostics: yamlIssues.map((error) => {
        const position = lineCounter.linePos(error.pos[0]);
        return { ...issue("invalid_yaml", error.message), line: position.line + 1, column: position.col };
      }) };
    }
    const metadata = normalizeYaml(document.toJS({ maxAliasCount: 20 }));
    return { metadata, body, diagnostics: [] };
  } catch (error) {
    return { metadata: undefined, body, diagnostics: errorsFrom(error, "invalid_yaml", "SKILL.md") };
  }
}

/** Parse and enforce the portable specification. Extensions are preserved, never treated as authority. */
export function parseSkillDocument(source: string, options: { directoryName?: string } = {}): ParsedSkillDocument {
  if (Buffer.byteLength(source, "utf8") > SKILL_BUNDLE_LIMITS.maxSkillMdBytes) {
    throw new SkillBundleError("SKILL.md exceeds its size limit.", "skill_md_size", "SKILL.md");
  }
  assertWellFormed(source, "SKILL.md");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(source)) {
    throw new SkillBundleError("SKILL.md must contain UTF-8 text without binary control characters.", "invalid_skill_text", "SKILL.md");
  }
  const parsed = parseSkillFrontmatter(source);
  const diagnostics = [...parsed.diagnostics];
  const metadata = SkillFrontmatterSchema.safeParse(parsed.metadata);
  if (!metadata.success && !diagnostics.some((entry) => entry.severity === "error")) {
    for (const error of metadata.error.issues) {
      diagnostics.push(issue("invalid_metadata", `${error.path.join(".") || "frontmatter"}: ${error.message}`));
    }
  }
  if (!parsed.body.trim()) diagnostics.push(issue("empty_instructions", "SKILL.md needs non-empty Markdown instructions after the frontmatter."));
  if (metadata.success) {
    // Validate compatible invocation hints, while keeping them independent of execution permissions.
    if (metadata.data["user-invocable"] !== undefined && typeof metadata.data["user-invocable"] !== "boolean") {
      diagnostics.push(issue("invalid_metadata", "user-invocable must be a boolean when supplied."));
    }
    if (options.directoryName !== undefined && metadata.data.name !== options.directoryName) {
      diagnostics.push(issue("name_directory_mismatch", `Declared name '${metadata.data.name}' must match the skill directory '${options.directoryName}'.`));
    }
  }
  if (diagnostics.some((entry) => entry.severity === "error") || !metadata.success) throw new SkillBundleError(diagnostics);
  if (source.split("\n").length >= 500) diagnostics.push({ severity: "warning", code: "long_instructions", message: "Keep SKILL.md below 500 lines; move detailed guidance into referenced files.", path: "SKILL.md" });
  return { frontmatter: metadata.data, body: parsed.body, diagnostics };
}

function digestFiles(files: Array<{ path: string; bytes: Buffer }>): string {
  const hash = createHash("sha256").update("agentic-skill-bundle-v1\0");
  for (const { path, bytes } of [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    const name = Buffer.from(path, "utf8");
    const sizes = Buffer.alloc(8);
    sizes.writeUInt32BE(name.length, 0);
    sizes.writeUInt32BE(bytes.length, 4);
    hash.update(sizes).update(name).update(bytes);
  }
  return hash.digest("hex");
}

function referenceWarnings(body: string, paths: Set<string>): SkillDiagnostic[] {
  const diagnostics: SkillDiagnostic[] = [];
  const seen = new Set<string>();
  // Only concrete Markdown destinations; prose and shell commands cannot be reliably parsed as references.
  for (const match of body.matchAll(/!?\[[^\]\n]*\]\(<?([^\s)<>]+)>?(?:\s+["'][^\n]*?["'])?\)/gu)) {
    const target = match[1]!;
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/iu.test(target)) continue;
    let path: string;
    try { path = decodeURIComponent(target.split(/[?#]/u)[0]!).replace(/^\.\//u, ""); }
    catch { path = target; }
    if (path && !paths.has(path) && !seen.has(path)) {
      diagnostics.push({ severity: "warning", code: "missing_reference", message: `Referenced file '${path}' is not in this bundle.`, path: "SKILL.md" });
      seen.add(path);
    }
  }
  return diagnostics;
}

export function validateSkillBundle(bundle: SkillBundle): SkillBundleValidation {
  const diagnostics: SkillDiagnostic[] = [];
  let totalBytes = 0;
  if (!isRecord(bundle) || !Array.isArray(bundle.files) || bundle.files.length === 0) {
    return { valid: false, diagnostics: [issue("missing_files", "A skill bundle must contain SKILL.md.")], totalBytes };
  }
  if (bundle.files.length > SKILL_BUNDLE_LIMITS.maxFiles) {
    return { valid: false, diagnostics: [issue("file_count", `A skill bundle cannot exceed ${SKILL_BUNDLE_LIMITS.maxFiles} files.`)], totalBytes };
  }
  const paths = new SkillPathIndex();
  const files: Array<{ path: string; bytes: Buffer }> = [];
  for (const file of bundle.files) {
    try {
      paths.add(file?.path);
      const bytes = decodeSkillFile(file);
      totalBytes += bytes.length;
      if (totalBytes > SKILL_BUNDLE_LIMITS.maxBundleBytes) {
        diagnostics.push(issue("bundle_size", "Expanded skill bundle exceeds its size limit."));
        break;
      }
      files.push({ path: file.path, bytes });
    } catch (error) { diagnostics.push(...errorsFrom(error)); }
  }
  const skill = files.find((file) => file.path === "SKILL.md");
  let parsed: ParsedSkillDocument | undefined;
  if (!skill) diagnostics.push(issue("missing_skill_md", "The bundle must contain exactly named SKILL.md at its root."));
  else {
    try {
      const text = skill.bytes.toString("utf8");
      if (!Buffer.from(text, "utf8").equals(skill.bytes)) throw new SkillBundleError("SKILL.md must be valid UTF-8.", "invalid_skill_text", "SKILL.md");
      parsed = parseSkillDocument(text);
      diagnostics.push(...parsed.diagnostics, ...referenceWarnings(parsed.body, new Set(files.map((file) => file.path))));
    } catch (error) { diagnostics.push(...errorsFrom(error)); }
  }
  const valid = !diagnostics.some((entry) => entry.severity === "error");
  return {
    valid, diagnostics, totalBytes,
    ...(parsed ? { metadata: parsed.frontmatter, body: parsed.body } : {}),
    ...(valid ? { digest: digestFiles(files) } : {}),
  };
}

export function assertValidSkillBundle(bundle: SkillBundle): ValidSkillBundle {
  const result = validateSkillBundle(bundle);
  if (!result.valid) throw new SkillBundleError(result.diagnostics);
  return result as ValidSkillBundle;
}

export function skillBundleDigest(bundle: SkillBundle): string {
  return assertValidSkillBundle(bundle).digest;
}
