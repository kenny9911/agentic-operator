import { describe, it, expect } from "vitest";
import { buildTar, gzipToBase64 } from "./tar";

describe("buildTar", () => {
  it("writes a 512-byte aligned header followed by content", () => {
    const tar = buildTar([{ path: "agentic.json", body: "{}" }]);
    // header (512) + content body padded to 512 + 2 zero trailing blocks
    expect(tar.length).toBe(512 + 512 + 512 + 512);
  });

  it("places file name at offset 0", () => {
    const tar = buildTar([{ path: "a.txt", body: "" }]);
    const name = new TextDecoder().decode(tar.slice(0, 5));
    expect(name).toBe("a.txt");
  });

  it("encodes size as octal at offset 124", () => {
    const tar = buildTar([{ path: "x", body: "abcdefgh" }]);
    const octal = new TextDecoder().decode(tar.slice(124, 135));
    expect(parseInt(octal, 8)).toBe(8);
  });

  it("contains the ustar magic at offset 257", () => {
    const tar = buildTar([{ path: "x", body: "y" }]);
    const magic = new TextDecoder().decode(tar.slice(257, 262));
    expect(magic).toBe("ustar");
  });

  it("ends with two zero blocks", () => {
    const tar = buildTar([{ path: "x", body: "y" }]);
    const tail = tar.slice(tar.length - 1024);
    expect(Array.from(tail).every((b) => b === 0)).toBe(true);
  });

  it("rejects paths longer than 100 chars", () => {
    expect(() =>
      buildTar([{ path: "a".repeat(101), body: "y" }]),
    ).toThrow(/too long/);
  });
});

describe("gzipToBase64", () => {
  it("returns a non-empty base64 string for arbitrary bytes", async () => {
    const bytes = new TextEncoder().encode("hello world");
    const out = await gzipToBase64(bytes);
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
    // Base64 alphabet only.
    expect(out).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("round-trip-decodes back to the original bytes via gunzip", async () => {
    const original = new TextEncoder().encode("the quick brown fox");
    const b64 = await gzipToBase64(original);
    const compressed = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    // Decompress via DecompressionStream (mirror of the encode path).
    type DecompressionStreamCtor = new (format: "gzip") => unknown;
    const Cls = (globalThis as { DecompressionStream?: DecompressionStreamCtor })
      .DecompressionStream;
    if (!Cls) {
      // If the test runner doesn't have the API, just smoke-test that
      // the output is non-empty (covered above).
      expect(b64.length).toBeGreaterThan(0);
      return;
    }
    const stream = new Blob([compressed as unknown as BlobPart]).stream();
    const decompressed = (
      stream as unknown as {
        pipeThrough: (transformer: unknown) => ReadableStream<Uint8Array>;
      }
    ).pipeThrough(new Cls("gzip"));
    const reader = decompressed.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      merged.set(c, off);
      off += c.length;
    }
    expect(new TextDecoder().decode(merged)).toBe("the quick brown fox");
  });
});

