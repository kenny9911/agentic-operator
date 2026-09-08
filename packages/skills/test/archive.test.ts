import { describe, expect, it } from "vitest";
import { crc32, deflateRawSync } from "node:zlib";
import { fromBufferPromise } from "yauzl";
import { ZipFile } from "yazl";
import { Readable } from "node:stream";
import { exportSkillArchive, importSkillArchive, importSkillMarkdown } from "../src/archive";
import { SKILL_BUNDLE_LIMITS, SkillBundleError, decodeSkillFile, encodeSkillFile, skillBundleDigest, type SkillBundle } from "../src/bundle";

const source = "---\nname: document-review\ndescription: Review documents when users request editorial feedback.\nmetadata: {author: 'Example Team'}\n---\nRead, review, then verify the final document.\n";
const skill = { path: "document-review/SKILL.md", content: Buffer.from(source) };

interface RawEntry {
  path: string;
  content?: Buffer;
  localPath?: string;
  compression?: number;
  compressedData?: Buffer;
  declaredSize?: number;
  flags?: number;
  mode?: number;
  checksum?: number;
  extra?: Buffer;
  localExtra?: Buffer;
  descriptor?: Buffer;
}

/** Write intentionally malformed ZIP fixtures without a library sanitizing their names or metadata. */
function rawZip(entries: RawEntry[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path);
    const localName = Buffer.from(entry.localPath ?? entry.path);
    const content = entry.content ?? Buffer.alloc(0);
    const compression = entry.compression ?? 0;
    const compressed = entry.compressedData ?? (compression === 8 ? deflateRawSync(content) : content);
    const extra = entry.extra ?? Buffer.alloc(0);
    const localExtra = entry.localExtra ?? extra;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(entry.flags ?? 0x800, 6);
    header.writeUInt16LE(compression, 8);
    header.writeUInt32LE(entry.checksum ?? crc32(content), 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(entry.declaredSize ?? content.length, 22);
    header.writeUInt16LE(localName.length, 26);
    header.writeUInt16LE(localExtra.length, 28);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(0x0314, 4);
    header.copy(record, 6, 4, 26);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt16LE(extra.length, 30);
    record.writeUInt32LE(((entry.mode ?? (entry.path.endsWith("/") ? 0o040755 : 0o100644)) << 16) >>> 0, 38);
    record.writeUInt32LE(offset, 42);
    const local = Buffer.concat([header, localName, localExtra, compressed, entry.descriptor ?? Buffer.alloc(0)]);
    locals.push(local);
    central.push(Buffer.concat([record, name, extra]));
    offset += local.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function extraField(id: number, data: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16LE(id, 0);
  header.writeUInt16LE(data.length, 2);
  return Buffer.concat([header, data]);
}

/** A real streaming writer emits descriptors; forced ZIP64 also exercises its 64-bit directory records. */
async function streamingZip(forceZip64Format: boolean): Promise<Buffer> {
  const zip = new ZipFile();
  zip.addReadStream(Readable.from([skill.content]), skill.path, { forceZip64Format });
  zip.end({ forceZip64Format });
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream as Readable) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Small files may still use local ZIP64 size fields (for example Python's force_zip64 writer). */
function localZip64(sizeData?: Buffer, withDescriptor = false): Buffer {
  const sizes = sizeData ?? Buffer.alloc(16);
  if (!sizeData && !withDescriptor) {
    sizes.writeBigUInt64LE(BigInt(skill.content.length), 0);
    sizes.writeBigUInt64LE(BigInt(skill.content.length), 8);
  }
  const descriptor = Buffer.alloc(withDescriptor ? 24 : 0);
  if (withDescriptor) {
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc32(skill.content), 4);
    descriptor.writeBigUInt64LE(BigInt(skill.content.length), 8);
    descriptor.writeBigUInt64LE(BigInt(skill.content.length), 16);
  }
  const archive = rawZip([{ ...skill, flags: withDescriptor ? 0x808 : 0x800, descriptor, localExtra: extraField(0x0001, sizes) }]);
  if (withDescriptor) archive.writeUInt32LE(0, 14);
  archive.writeUInt16LE(45, 4);
  archive.writeUInt32LE(0xffffffff, 18);
  archive.writeUInt32LE(0xffffffff, 22);
  const centralOffset = archive.readUInt32LE(archive.length - 6);
  archive.writeUInt16LE(45, centralOffset + 6);
  return archive;
}

async function expectCode(zip: Buffer, code: string): Promise<void> {
  await expect(importSkillArchive(zip)).rejects.toMatchObject({ diagnostics: expect.arrayContaining([expect.objectContaining({ code })]) });
}

describe("skill ZIP interchange", () => {
  it("round trips every text/binary byte, metadata extension, BOM and line ending through a real ZIP", async () => {
    const markdown = `\uFEFF${source.replaceAll("\n", "\r\n")}`;
    const bundle: SkillBundle = { files: [
      { path: "SKILL.md", content: markdown, encoding: "utf8" },
      { path: "scripts/check.py", content: "raise Exception('do not execute on import')\n", encoding: "utf8" },
      { path: "agents/openai.yaml", content: "interface:\n  display_name: Document Review\n", encoding: "utf8" },
      { path: "SKILL.json", content: '{"extension":true}\n', encoding: "utf8" },
      { path: "references/中文 guide.md", content: "参考\r\n", encoding: "utf8" },
      encodeSkillFile("assets/template.bin", Buffer.from(Array.from({ length: 2048 }, (_, index) => index % 256))),
    ] };
    const exported = await exportSkillArchive(bundle);
    const reader = await fromBufferPromise(exported);
    const names: string[] = [];
    for await (const entry of reader.eachEntry()) names.push(entry.fileName);
    expect(names.every((name) => name.startsWith("document-review/"))).toBe(true);
    expect(names).toHaveLength(bundle.files.length);
    const imported = await importSkillArchive(exported);
    expect(skillBundleDigest(imported)).toBe(skillBundleDigest(bundle));
    for (const file of bundle.files) expect(decodeSkillFile(imported.files.find((candidate) => candidate.path === file.path)!)).toEqual(decodeSkillFile(file));
  });

  it("imports standard stored and deflated entries with optional directory records", async () => {
    const imported = await importSkillArchive(rawZip([
      { path: "document-review/" }, skill,
      { path: "document-review/references/" },
      { path: "document-review/references/guide.md", content: Buffer.from("Read this reference."), compression: 8 },
    ]));
    expect(imported.files.map((file) => file.path)).toEqual(["SKILL.md", "references/guide.md"]);
  });

  it("imports standalone Markdown bytes and rejects malformed or non-UTF8 Markdown", () => {
    const markdown = `\uFEFF${source.replaceAll("\n", "\r\n")}`;
    expect(decodeSkillFile(importSkillMarkdown(Buffer.from(markdown)).files[0]!)).toEqual(Buffer.from(markdown));
    expect(() => importSkillMarkdown(Buffer.from([0xff]))).toThrow(/UTF-8/);
    expect(() => importSkillMarkdown("No metadata")).toThrow(SkillBundleError);
  });

  it.each([
    ["rootless ZIP", [{ ...skill, path: "SKILL.md" }], "archive_root"],
    ["multiple roots", [skill, { path: "different-root/resource.txt" }], "archive_root"],
    ["name mismatch", [{ ...skill, path: "different-root/SKILL.md" }], "name_directory_mismatch"],
    ["missing SKILL.md", [{ path: "document-review/README.md" }], "missing_skill_md"],
    ["duplicate files", [skill, skill], "duplicate_path"],
    ["duplicate directories", [skill, { path: "document-review/assets/" }, { path: "document-review/assets/" }], "duplicate_path"],
    ["duplicate root directory", [skill, { path: "document-review/" }, { path: "document-review/" }], "duplicate_path"],
    ["case collision", [skill, { path: "document-review/A.md" }, { path: "document-review/a.md" }], "path_collision"],
    ["directory case collision", [skill, { path: "document-review/Refs/a" }, { path: "document-review/refs/b" }], "path_collision"],
    ["file as parent", [skill, { path: "document-review/refs" }, { path: "document-review/refs/a" }], "path_conflict"],
    ["parent as file", [skill, { path: "document-review/refs/a" }, { path: "document-review/refs" }], "path_conflict"],
  ] satisfies Array<[string, RawEntry[], string]>)("rejects %s", async (_name, entries, code) => { await expectCode(rawZip(entries), code); });

  it.each(["/absolute", "../escape", "document-review/../escape", "document-review\\escape", "document-review/a\u0000b", "document-review/a\u0085b", "document-review/C:escape", "document-review/a//b", "document-review/nul.txt"])("rejects unsafe archive path %j", async (path) => {
    await expect(importSkillArchive(rawZip([skill, { path }]))).rejects.toBeInstanceOf(SkillBundleError);
  });

  it.each([0o120777, 0o020666, 0o010644, 0o060644])("rejects links/special Unix mode %o", async (mode) => {
    await expectCode(rawZip([skill, { path: "document-review/assets/link", mode, content: Buffer.from("../../outside") }]), "archive_link");
  });

  it("rejects link metadata including links recorded only in local extra fields", async () => {
    const pkwareLink = extraField(0x000d, Buffer.concat([Buffer.alloc(12), Buffer.from("target")]));
    await expectCode(rawZip([skill, { path: "document-review/link", extra: pkwareLink }]), "archive_link");
    await expectCode(rawZip([skill, { path: "document-review/link", localExtra: pkwareLink }]), "archive_link");
    const asi = Buffer.alloc(14);
    asi.writeUInt16LE(0o120777, 4);
    await expectCode(rawZip([skill, { path: "document-review/link", extra: extraField(0x756e, asi) }]), "archive_link");
  });

  it("rejects empty/malformed ZIPs, encrypted files, unsupported methods and conflicting local names", async () => {
    await expect(importSkillArchive(Buffer.from("not a zip"))).rejects.toBeInstanceOf(SkillBundleError);
    await expectCode(rawZip([]), "missing_skill_md");
    await expectCode(rawZip([{ ...skill, flags: 0x801, compression: 8 }]), "archive_encrypted");
    await expectCode(rawZip([{ ...skill, compression: 9 }]), "archive_compression");
    await expectCode(rawZip([{ ...skill, localPath: "document-review/../../escape" }]), "invalid_archive");
    await expectCode(rawZip([skill, { path: "document-review/directory/", content: Buffer.from("hidden data") }]), "invalid_archive");
  });

  it("verifies CRC-32 and actual decompressed size rather than trusting ZIP metadata", async () => {
    await expectCode(rawZip([{ ...skill, checksum: 123 }]), "archive_integrity");
    await expect(importSkillArchive(rawZip([{ ...skill, compression: 8, declaredSize: 10 }]))).rejects.toBeInstanceOf(SkillBundleError);
  });

  it.each([14, 18, 22])("rejects mismatching authoritative local header field at offset %i, including zero", async (offset) => {
    const archive = rawZip([skill]);
    for (const value of [0, 1]) {
      const mutated = Buffer.from(archive);
      mutated.writeUInt32LE(value, offset);
      await expectCode(mutated, "invalid_archive");
    }
  });

  it.each([false, true])("imports a real streaming descriptor ZIP with zero local values (ZIP64=%s)", async (forceZip64Format) => {
    const archive = await streamingZip(forceZip64Format);
    expect(archive.readUInt16LE(6) & 0x08).toBe(0x08);
    expect([14, 18, 22].map((offset) => archive.readUInt32LE(offset))).toEqual([0, 0, 0]);
    expect(decodeSkillFile((await importSkillArchive(archive)).files[0]!)).toEqual(skill.content);
    for (const offset of [14, 18, 22]) {
      const mutated = Buffer.from(archive);
      mutated.writeUInt32LE(1, offset);
      await expectCode(mutated, "invalid_archive");
    }
  });

  it("reads authoritative local ZIP64 sizes and rejects mismatched, truncated, missing, and overflowing sizes", async () => {
    const archive = localZip64();
    expect(decodeSkillFile((await importSkillArchive(archive)).files[0]!)).toEqual(skill.content);
    const sizeOffset = 30 + Buffer.byteLength(skill.path) + 4;
    for (const offset of [sizeOffset, sizeOffset + 8]) {
      for (const value of [0n, 1n, 0xffffffffffffffffn]) {
        const mutated = Buffer.from(archive);
        mutated.writeBigUInt64LE(value, offset);
        await expectCode(mutated, "invalid_archive");
      }
    }
    await expectCode(localZip64(Buffer.alloc(8)), "invalid_archive");
    const missing = rawZip([skill]);
    missing.writeUInt32LE(0xffffffff, 18);
    missing.writeUInt32LE(0xffffffff, 22);
    await expectCode(missing, "invalid_archive");
  });

  it("permits ZIP64 local size placeholders resolved later by a 64-bit data descriptor", async () => {
    const archive = localZip64(undefined, true);
    expect(decodeSkillFile((await importSkillArchive(archive)).files[0]!)).toEqual(skill.content);
  });

  it("rejects compressed archive, file count and declared expanded limits before expanding data", async () => {
    await expectCode(Buffer.alloc(SKILL_BUNDLE_LIMITS.maxArchiveBytes + 1), "archive_size");
    const files = Array.from({ length: SKILL_BUNDLE_LIMITS.maxFiles }, (_, index) => ({ path: `document-review/assets/${index}` }));
    await expectCode(rawZip([skill, ...files]), "file_count");
    await expectCode(rawZip([skill, { path: "document-review/assets/big", compression: 8, declaredSize: SKILL_BUNDLE_LIMITS.maxFileBytes + 1 }]), "file_size");
    await expectCode(rawZip([{ ...skill, compression: 8, declaredSize: SKILL_BUNDLE_LIMITS.maxSkillMdBytes + 1 }]), "file_size");
    const misleading = Array.from({ length: 4 }, (_, index) => ({ path: `document-review/assets/${index}`, compression: 8, compressedData: Buffer.alloc(30_000), declaredSize: SKILL_BUNDLE_LIMITS.maxFileBytes }));
    await expectCode(rawZip([skill, ...misleading]), "bundle_size");
  });

  it("rejects extreme compression on import while exporting equivalent legitimate data importably", async () => {
    const content = Buffer.alloc(100_000, 65);
    await expectCode(rawZip([skill, { path: "document-review/assets/repetitive.txt", content, compression: 8 }]), "compression_ratio");
    const bundle = { files: [...importSkillMarkdown(source).files, encodeSkillFile("assets/repetitive.txt", content)] };
    const archive = await exportSkillArchive(bundle);
    expect(skillBundleDigest(await importSkillArchive(archive))).toBe(skillBundleDigest(bundle));
  });
});
