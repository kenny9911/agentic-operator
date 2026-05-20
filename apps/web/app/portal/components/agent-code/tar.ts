/**
 * Minimal in-browser tar+gzip builder for the P3-FE-02 code-agent deploy flow.
 *
 * The `/v1/tenants/:slug/code` endpoint expects a base64 `.tar.gz` of a
 * tenant package. Generating that in the browser without a library means
 * (a) building the tar headers by hand and (b) feeding the result through
 * `CompressionStream("gzip")` (well-supported across modern browsers).
 *
 * Only the USTAR header subset is implemented — enough for `tar -xzf` and
 * the server's stream extractor in `apps/api/src/routes/v1/tenant-code.ts`.
 *
 * Pure helpers (no DOM access) so the unit tests can pin the byte layout.
 */

export interface TarFile {
  /** Path relative to the tar root. No leading slash. */
  path: string;
  /** UTF-8 string contents. */
  body: string;
}

const BLOCK_SIZE = 512;

/**
 * Build an uncompressed tar archive of the given files. Returns the raw
 * binary buffer. Use `gzipBytes()` to compress + base64 it for the wire.
 */
export function buildTar(files: TarFile[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const f of files) {
    blocks.push(buildHeader(f.path, f.body));
    const body = encodeUtf8(f.body);
    blocks.push(body);
    const pad = padToBlock(body.length);
    if (pad.length > 0) blocks.push(pad);
  }
  // Two trailing 512-byte zero blocks signal end-of-archive.
  blocks.push(new Uint8Array(BLOCK_SIZE));
  blocks.push(new Uint8Array(BLOCK_SIZE));
  return concat(blocks);
}

/**
 * Gzip + base64-encode raw bytes. Uses the standard `CompressionStream`
 * API so it works in modern Chromium/Firefox/Safari without a polyfill.
 */
export async function gzipToBase64(bytes: Uint8Array): Promise<string> {
  // `CompressionStream` is a global in modern browsers.
  type CompressionStreamCtor = new (format: "gzip") => unknown;
  const Cls = (globalThis as { CompressionStream?: CompressionStreamCtor })
    .CompressionStream;
  if (!Cls) {
    throw new Error("CompressionStream API unavailable");
  }
  // Stream API path: pipe through gzip.
  const stream = new Blob([bytes as unknown as BlobPart]).stream();
  const compressed = (
    stream as unknown as {
      pipeThrough: (transformer: unknown) => ReadableStream<Uint8Array>;
    }
  ).pipeThrough(new (Cls as new (format: "gzip") => unknown)("gzip"));
  const reader = (
    compressed as unknown as ReadableStream<Uint8Array>
  ).getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const combined = concat(chunks);
  return toBase64(combined);
}

// ─── Header builder ─────────────────────────────────────────────────────────

function buildHeader(path: string, body: string): Uint8Array {
  if (path.length > 100) {
    throw new Error(`tar: file name too long for USTAR (>100 bytes): ${path}`);
  }
  const header = new Uint8Array(BLOCK_SIZE);
  writeString(header, 0, path, 100);
  // file mode 0644, owner 0, group 0
  writeOctal(header, 100, 0o644, 8);
  writeOctal(header, 108, 0, 8);
  writeOctal(header, 116, 0, 8);
  // size (UTF-8 byte count)
  const sizeBytes = encodeUtf8(body).length;
  writeOctal(header, 124, sizeBytes, 12);
  // mtime — fixed (zero) so the archive is reproducible
  writeOctal(header, 136, 0, 12);
  // checksum placeholder — eight spaces, then computed below
  for (let i = 148; i < 156; i++) header[i] = 0x20;
  // typeflag = '0' (regular file)
  header[156] = 0x30;
  // ustar magic + version
  writeString(header, 257, "ustar", 6);
  header[263] = 0x30;
  header[264] = 0x30;
  // checksum
  let sum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) sum += header[i]!;
  writeOctal(header, 148, sum, 8);
  return header;
}

function writeString(buf: Uint8Array, offset: number, s: string, max: number) {
  const enc = encodeUtf8(s);
  for (let i = 0; i < Math.min(enc.length, max); i++) {
    buf[offset + i] = enc[i]!;
  }
}

function writeOctal(buf: Uint8Array, offset: number, value: number, length: number) {
  // Tar octal fields are right-justified, NUL-terminated.
  const s = value.toString(8).padStart(length - 1, "0");
  for (let i = 0; i < length - 1; i++) {
    buf[offset + i] = s.charCodeAt(i);
  }
  buf[offset + length - 1] = 0;
}

function padToBlock(n: number): Uint8Array {
  const rem = n % BLOCK_SIZE;
  if (rem === 0) return new Uint8Array(0);
  return new Uint8Array(BLOCK_SIZE - rem);
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function encodeUtf8(s: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(s);
  }
  // Fallback (vitest environment without TextEncoder).
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0x7f);
  return new Uint8Array(out);
}

function toBase64(bytes: Uint8Array): string {
  // Browsers expose `btoa`; node 16+ exposes `Buffer`. Cover both.
  const g = globalThis as {
    btoa?: (s: string) => string;
    Buffer?: { from(b: Uint8Array): { toString(enc: "base64"): string } };
  };
  if (g.Buffer) {
    return g.Buffer.from(bytes).toString("base64");
  }
  if (g.btoa) {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
    return g.btoa(s);
  }
  throw new Error("base64: no encoder available");
}
