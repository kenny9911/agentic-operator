import {
  SKILL_BUNDLE_LIMITS,
  SkillFilePathSchema,
  type SkillBundle,
  type SkillFile,
} from "@agentic/contracts";

export class SkillEditorError extends Error {
  constructor(readonly key: "invalidPath" | "pathConflict" | "fileLimit") {
    super(key);
  }
}

export function skillFileBytes(file: SkillFile): Uint8Array {
  if (file.encoding === "utf8") return new TextEncoder().encode(file.content);
  return Uint8Array.from(atob(file.content), (character) =>
    character.charCodeAt(0),
  );
}

export function encodeBrowserBytes(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  }
  return btoa(chunks.join(""));
}

// Editor file objects are immutable; cache sizes so each keystroke only
// encodes the changed file rather than decoding every binary resource again.
const fileSizes = new WeakMap<SkillFile, number>();
export function skillFileSize(file: SkillFile): number {
  const cached = fileSizes.get(file);
  if (cached !== undefined) return cached;
  const size = skillFileBytes(file).byteLength;
  fileSizes.set(file, size);
  return size;
}

/** Cheap client feedback only; the API repeats authoritative admission. */
export function checkEditorFiles(files: readonly SkillFile[]): void {
  if (files.length > SKILL_BUNDLE_LIMITS.maxFiles)
    throw new SkillEditorError("fileLimit");
  const paths = new Set<string>();
  let total = 0;
  for (const file of files) {
    if (!SkillFilePathSchema.safeParse(file.path).success)
      throw new SkillEditorError("invalidPath");
    const path = file.path.toLowerCase();
    if (paths.has(path)) throw new SkillEditorError("pathConflict");
    for (const existing of paths) {
      if (existing.startsWith(`${path}/`) || path.startsWith(`${existing}/`))
        throw new SkillEditorError("pathConflict");
    }
    paths.add(path);
    const bytes = skillFileSize(file);
    total += bytes;
    if (
      bytes >
        (file.path === "SKILL.md"
          ? SKILL_BUNDLE_LIMITS.maxSkillMdBytes
          : SKILL_BUNDLE_LIMITS.maxFileBytes) ||
      total > SKILL_BUNDLE_LIMITS.maxBundleBytes
    )
      throw new SkillEditorError("fileLimit");
  }
}

export async function readBrowserSkillFile(
  file: File,
  path = file.name,
): Promise<SkillFile> {
  if (file.size > SKILL_BUNDLE_LIMITS.maxFileBytes)
    throw new SkillEditorError("fileLimit");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let result: SkillFile;
  try {
    const content = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(content))
      throw new Error("binary");
    result = { path, content, encoding: "utf8" };
  } catch {
    result = { path, content: encodeBrowserBytes(bytes), encoding: "base64" };
  }
  checkEditorFiles([result]);
  return result;
}

export async function readBrowserSkillFolder(
  files: readonly File[],
): Promise<SkillBundle> {
  if (
    files.length > SKILL_BUNDLE_LIMITS.maxFiles ||
    files.reduce((sum, file) => sum + file.size, 0) >
      SKILL_BUNDLE_LIMITS.maxBundleBytes
  )
    throw new SkillEditorError("fileLimit");
  const paths = files.map((file) => file.webkitRelativePath || file.name);
  const entry = paths.find((path) => path.endsWith("/SKILL.md"));
  const prefix = entry?.slice(0, -"SKILL.md".length) ?? "";
  if (prefix && paths.some((path) => !path.startsWith(prefix)))
    throw new SkillEditorError("invalidPath");
  const bundle = {
    files: await Promise.all(
      files.map((file, index) =>
        readBrowserSkillFile(file, paths[index]!.slice(prefix.length)),
      ),
    ),
  };
  checkEditorFiles(bundle.files);
  return bundle;
}

export function downloadSkillFile(file: SkillFile): void {
  const bytes = skillFileBytes(file);
  const url = URL.createObjectURL(
    new Blob([bytes as Uint8Array<ArrayBuffer>], {
      type: "application/octet-stream",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.path.split("/").at(-1) ?? "resource";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function resolveSkillResourceLink(
  currentPath: string,
  href: string,
): string | null {
  if (/^[a-z][a-z0-9+.-]*:|^\//i.test(href)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(href.split(/[?#]/u)[0]!);
  } catch {
    return null;
  }
  if (!decoded) return null;
  const parts = currentPath.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else if (part && part !== ".") parts.push(part);
  }
  const resolved = parts.join("/");
  return SkillFilePathSchema.safeParse(resolved).success ? resolved : null;
}
