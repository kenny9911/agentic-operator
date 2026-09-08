/** Bounded in-memory ZIP interchange. No extraction to disk, URL fetching, or execution. */
import { crc32, deflateRaw } from "node:zlib";
import { promisify } from "node:util";
import type { Readable } from "node:stream";
import { fromBufferPromise, getFileNameLowLevel, parseExtraFields, type Entry, type ZipFile as ReadZip } from "yauzl";
import { ZipFile as WriteZip } from "yazl";
import { SkillNameSchema, type SkillBundle, type SkillFile } from "@agentic/contracts";
import {
  SKILL_BUNDLE_LIMITS, SkillBundleError, SkillPathIndex, assertSafeSkillPath,
  assertValidSkillBundle, decodeSkillFile, encodeSkillFile, parseSkillDocument,
} from "./bundle";

const compressBuffer = promisify(deflateRaw);
const MAX_ARCHIVE_ENTRIES = SKILL_BUNDLE_LIMITS.maxFiles * (SKILL_BUNDLE_LIMITS.maxPathDepth + 1) + 1;

function reject(message: string, code = "invalid_archive", path?: string): never {
  throw new SkillBundleError(message, code, path);
}

function splitArchivePath(name: string): { root: string; relative: string; directory: boolean } {
  const directory = name.endsWith("/");
  const path = directory ? name.slice(0, -1) : name;
  const [root, ...components] = path.split("/");
  if (!root || !SkillNameSchema.safeParse(root).success) {
    reject("A portable ZIP must contain one skill directory with a valid skill name.", "archive_root", name);
  }
  const relative = components.join("/");
  if (relative) assertSafeSkillPath(relative);
  else if (!directory) reject("Put SKILL.md and its resources inside one named skill directory in the ZIP.", "archive_root", name);
  return { root, relative, directory };
}

function rejectLinkMetadata(extraFields: Array<{ id: number; data: Buffer }>, path: string): void {
  for (const { id, data } of extraFields) {
    // PKWARE Unix: the optional data after timestamps/uid/gid represents a link or device.
    if (id === 0x000d && data.length > 12) reject("ZIP links and special files are not admitted.", "archive_link", path);
    // ASi Unix stores mode and an optional link target in its extra field.
    if (id === 0x756e) {
      if (data.length < 14) reject("Malformed Unix ZIP metadata.", "invalid_archive", path);
      const kind = data.readUInt16LE(4) & 0o170000;
      if (data.length > 14 || (kind !== 0 && kind !== 0o100000 && kind !== 0o040000)) {
        reject("ZIP links and special files are not admitted.", "archive_link", path);
      }
    }
  }
}

function validateEntry(entry: Entry): { root: string; relative: string; directory: boolean } {
  const parts = splitArchivePath(entry.fileName);
  // Even when a Unicode extra field supplies a different name, its fallback must be safe.
  splitArchivePath(getFileNameLowLevel(entry.generalPurposeBitFlag, entry.fileNameRaw, [], true));
  if ((entry.generalPurposeBitFlag & 0x800) && !Buffer.from(entry.fileNameRaw.toString("utf8"), "utf8").equals(entry.fileNameRaw)) {
    reject("ZIP filenames marked UTF-8 must be valid UTF-8.", "invalid_archive", entry.fileName);
  }
  const kind = (entry.externalFileAttributes >>> 16) & 0o170000;
  if ((kind !== 0 && kind !== 0o100000 && kind !== 0o040000) || (entry.externalFileAttributes & 0x400) !== 0) {
    reject("ZIP links, reparse points, and special files are not admitted.", "archive_link", entry.fileName);
  }
  const directoryAttribute = kind === 0o040000 || (entry.externalFileAttributes & 0x10) !== 0;
  if ((directoryAttribute && !parts.directory) || (kind === 0o100000 && parts.directory)) {
    reject("ZIP file and directory metadata disagree.", "invalid_archive", entry.fileName);
  }
  rejectLinkMetadata(entry.extraFields, entry.fileName);
  if ((entry.generalPurposeBitFlag & 0x41) !== 0) reject("Encrypted ZIP entries are not supported.", "archive_encrypted", entry.fileName);
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) reject("ZIP entries must use stored or deflate compression.", "archive_compression", entry.fileName);
  for (const value of [entry.compressedSize, entry.uncompressedSize, entry.relativeOffsetOfLocalHeader]) {
    if (!Number.isSafeInteger(value) || value < 0) reject("ZIP entry has invalid size or offset metadata.", "invalid_archive", entry.fileName);
  }
  if (parts.directory && (entry.uncompressedSize !== 0 || entry.crc32 !== 0)) {
    reject("ZIP directory entries cannot contain file data.", "invalid_archive", entry.fileName);
  }
  const maxSize = parts.relative === "SKILL.md" ? SKILL_BUNDLE_LIMITS.maxSkillMdBytes : SKILL_BUNDLE_LIMITS.maxFileBytes;
  if (entry.uncompressedSize > maxSize) reject("ZIP entry exceeds the individual file size limit.", "file_size", entry.fileName);
  if (entry.uncompressedSize > Math.max(1, entry.compressedSize) * SKILL_BUNDLE_LIMITS.maxCompressionRatio) {
    reject("ZIP entry exceeds the permitted compression ratio.", "compression_ratio", entry.fileName);
  }
  return parts;
}

async function verifyLocalHeader(zip: ReadZip, entry: Entry): Promise<void> {
  const local = await zip.readLocalFileHeaderPromise(entry, { minimal: false });
  if (!local.fileName.equals(entry.fileNameRaw) || local.compressionMethod !== entry.compressionMethod
    || local.generalPurposeBitFlag !== entry.generalPurposeBitFlag) {
    reject("ZIP local and central file headers disagree.", "invalid_archive", entry.fileName);
  }
  const extra = parseExtraFields(local.extraField);
  const zip64 = extra.filter((field) => field.id === 0x0001);
  if (zip64.length > 1) reject("Duplicate ZIP64 local size metadata.", "invalid_archive", entry.fileName);
  const usesZip64Sizes = local.uncompressedSize === 0xffffffff || local.compressedSize === 0xffffffff;
  if (usesZip64Sizes && (!zip64[0] || zip64[0].data.length < 16)) {
    // APPNOTE 4.5.3 requires both original and compressed sizes in a local ZIP64 extra field.
    reject("ZIP64 local header is missing its complete size metadata.", "invalid_archive", entry.fileName);
  }
  const uncompressedSize = local.uncompressedSize === 0xffffffff
    ? zip64[0]!.data.readBigUInt64LE(0) : BigInt(local.uncompressedSize);
  const compressedSize = local.compressedSize === 0xffffffff
    ? zip64[0]!.data.readBigUInt64LE(8) : BigInt(local.compressedSize);
  const hasDescriptor = (local.generalPurposeBitFlag & 0x08) !== 0;
  // Bit 3 permits unknown values (zero) until the data descriptor. Any supplied
  // nonzero value must still agree. Without bit 3, all three fields are authoritative.
  const agrees = (actual: bigint, expected: number): boolean =>
    (hasDescriptor && actual === 0n) || actual === BigInt(expected);
  if (!agrees(BigInt(local.crc32), entry.crc32) || !agrees(compressedSize, entry.compressedSize)
    || !agrees(uncompressedSize, entry.uncompressedSize)) {
    reject("ZIP local and central checksums or sizes disagree.", "invalid_archive", entry.fileName);
  }
  rejectLinkMetadata(extra, entry.fileName);
  splitArchivePath(getFileNameLowLevel(local.generalPurposeBitFlag, local.fileName, extra, true));
}

/**
 * Import exactly one folder-rooted portable skill. All central entries are
 * checked before any expansion, including duplicates that map-based unzip APIs lose.
 */
export async function importSkillArchive(bytes: Uint8Array): Promise<SkillBundle> {
  if (bytes.byteLength > SKILL_BUNDLE_LIMITS.maxArchiveBytes) reject("Skill ZIP exceeds the archive size limit.", "archive_size");
  let zip: ReadZip | undefined;
  try {
    // Copy only after the compressed-size gate; callers cannot mutate a running import.
    zip = await fromBufferPromise(Buffer.from(bytes), { lazyEntries: true, autoClose: false, decodeStrings: true, strictFileNames: true, validateEntrySizes: true });
    if (zip.entryCount > MAX_ARCHIVE_ENTRIES) reject("Skill ZIP has too many file and directory entries.", "file_count");
    const index = new SkillPathIndex();
    const entries: Array<{ entry: Entry; path: string; directory: boolean }> = [];
    let root: string | undefined;
    let rootSeen = false;
    let expandedBytes = 0;
    let fileCount = 0;
    for await (const entry of zip.eachEntry()) {
      const parts = validateEntry(entry);
      if (root !== undefined && root !== parts.root) reject("A skill ZIP must contain exactly one root directory.", "archive_root", entry.fileName);
      root = parts.root;
      if (!parts.relative) {
        if (rootSeen) reject("Duplicate root directory entry in ZIP.", "duplicate_path", entry.fileName);
        rootSeen = true;
      } else {
        index.add(parts.relative, parts.directory ? "directory" : "file");
      }
      if (!parts.directory && ++fileCount > SKILL_BUNDLE_LIMITS.maxFiles) reject("Skill ZIP has too many files.", "file_count");
      expandedBytes += entry.uncompressedSize;
      if (expandedBytes > SKILL_BUNDLE_LIMITS.maxBundleBytes) reject("Expanded skill ZIP exceeds the bundle size limit.", "bundle_size");
      entries.push({ entry, path: parts.relative, directory: parts.directory });
    }
    if (root === undefined) reject("Skill ZIP is empty.", "missing_skill_md");
    // Check redundant link metadata as well, before admitting any file data.
    for (const { entry } of entries) await verifyLocalHeader(zip, entry);
    const files: SkillFile[] = [];
    let actualTotal = 0;
    for (const { entry, path, directory } of entries) {
      if (directory) continue;
      const chunks: Buffer[] = [];
      let actualSize = 0;
      let checksum = 0;
      const stream = await zip.openReadStreamPromise(entry);
      try {
        for await (const raw of stream) {
          const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
          actualSize += chunk.length;
          actualTotal += chunk.length;
          if (actualSize > entry.uncompressedSize || actualSize > SKILL_BUNDLE_LIMITS.maxFileBytes
            || actualTotal > SKILL_BUNDLE_LIMITS.maxBundleBytes) {
            reject("Expanded ZIP data exceeds its declared or permitted size.", "bundle_size", entry.fileName);
          }
          checksum = crc32(chunk, checksum);
          chunks.push(chunk);
        }
      } finally { stream.destroy(); }
      if (actualSize !== entry.uncompressedSize || checksum !== entry.crc32) reject("ZIP data failed its size or CRC-32 integrity check.", "archive_integrity", entry.fileName);
      files.push(encodeSkillFile(path, Buffer.concat(chunks, actualSize)));
    }
    const bundle = { files };
    const validated = assertValidSkillBundle(bundle);
    if (validated.metadata.name !== root) reject(`Declared name '${validated.metadata.name}' must match the skill directory '${root}'.`, "name_directory_mismatch", "SKILL.md");
    return bundle;
  } catch (error) {
    if (error instanceof SkillBundleError) throw error;
    throw new SkillBundleError(`Invalid skill ZIP: ${error instanceof Error ? error.message : String(error)}`, "invalid_archive");
  } finally { zip?.close(); }
}

/** Standalone SKILL.md import preserves UTF-8 BOM/newlines/source formatting exactly. */
export function importSkillMarkdown(source: string | Uint8Array): SkillBundle {
  const size = typeof source === "string" ? Buffer.byteLength(source, "utf8") : source.byteLength;
  if (size > SKILL_BUNDLE_LIMITS.maxSkillMdBytes) reject("SKILL.md exceeds its size limit.", "skill_md_size", "SKILL.md");
  const content = typeof source === "string" ? source : Buffer.from(source).toString("utf8");
  if (typeof source !== "string" && !Buffer.from(content, "utf8").equals(Buffer.from(source))) reject("SKILL.md must be valid UTF-8.", "invalid_skill_text", "SKILL.md");
  parseSkillDocument(content);
  return { files: [{ path: "SKILL.md", content, encoding: "utf8" }] };
}

/** Emit a portable ZIP with one metadata-matching root, containing every admitted byte. */
export async function exportSkillArchive(bundle: SkillBundle): Promise<Buffer> {
  const validated = assertValidSkillBundle(bundle);
  // Capture inputs before awaiting compression, so later editor mutations cannot change the export.
  const files = bundle.files.map((file) => ({ path: file.path, bytes: decodeSkillFile(file) }))
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const zip = new WriteZip();
  const outputStream = zip.outputStream as Readable;
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  const output = new Promise<Buffer>((resolve, rejectOutput) => {
    zip.on("error", rejectOutput);
    outputStream.on("error", rejectOutput);
    outputStream.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > SKILL_BUNDLE_LIMITS.maxArchiveBytes) {
        const error = new SkillBundleError("Exported skill ZIP exceeds the archive size limit.", "archive_size");
        outputStream.destroy(error);
        rejectOutput(error);
      } else chunks.push(chunk);
    });
    outputStream.on("end", () => resolve(Buffer.concat(chunks, totalBytes)));
  });
  // Register the rejection handler immediately; compression awaits must not expose an unhandled rejection.
  void output.catch(() => {});
  try {
    for (const file of files) {
      const compressed = await compressBuffer(file.bytes, { level: 6 });
      // Highly repetitive legitimate assets must remain importable under the same bomb limits.
      const compress = compressed.length < file.bytes.length
        && file.bytes.length <= Math.max(1, compressed.length) * SKILL_BUNDLE_LIMITS.maxCompressionRatio;
      zip.addBuffer(file.bytes, `${validated.metadata.name}/${file.path}`, {
        compress, compressionLevel: compress ? 6 : 0, mtime: new Date("2000-01-01T00:00:00Z"), mode: 0o100644,
      });
    }
    zip.end();
    return await output;
  } catch (error) {
    outputStream.destroy();
    throw error;
  }
}
