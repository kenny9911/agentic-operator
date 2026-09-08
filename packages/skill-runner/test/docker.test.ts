import * as http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Socket } from "node:net";
import { afterEach, expect, it } from "vitest";
import { DockerSocketSkillScriptTransport } from "../src/index";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function daemon(handler?: http.RequestListener) {
  const root = mkdtempSync(join(tmpdir(), "skill-sock-"));
  const socketPath = join(root, "daemon.sock");
  const sockets = new Set<Socket>();
  const server = http.createServer(handler);
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  cleanups.push(async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve) => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); });
  return { server, transport: new DockerSocketSkillScriptTransport({ socketPath, requestTimeoutMs: 100 }) };
}

it("uses Engine API calls with bounded JSON and absent-resource responses", async () => {
  const paths: string[] = [];
  const { transport } = await daemon((req, res) => {
    paths.push(req.url!);
    if (req.url!.includes("/images/")) res.end(JSON.stringify({ Id: `sha256:${"a".repeat(64)}` }));
    else { res.statusCode = 404; res.end("{}"); }
  });
  expect(await transport.inspectImage(`repo/image@sha256:${"a".repeat(64)}`)).toEqual({ id: `sha256:${"a".repeat(64)}` });
  expect(paths[0]).toContain("repo%2Fimage%40sha256%3A");
  expect(await transport.inspectContainer("missing")).toBeNull();
  expect(await transport.inspectVolume("missing")).toBe(false);
  await transport.removeContainer("missing"); await transport.removeVolume("missing");
});

it("rejects daemon errors, oversized responses and stalled requests", async () => {
  const invalid = await daemon((_req, res) => { res.statusCode = 500; res.end("private diagnostics must not be relayed"); });
  await expect(invalid.transport.inspectImage("image")).rejects.toThrow("HTTP 500");
  const oversized = await daemon((_req, res) => res.end("x".repeat(2 * 1024 * 1024 + 1)));
  await expect(oversized.transport.inspectImage("image")).rejects.toThrow("size limit");
  const stalled = await daemon(() => {});
  await expect(stalled.transport.inspectImage("image")).rejects.toThrow("deadline");
});

it("decodes fragmented Docker streams and transmits only explicit protocol input", async () => {
  const { server, transport } = await daemon();
  let received = "";
  server.on("upgrade", (_req, socket) => {
    socket.write("HTTP/1.1 101 UPGRADED\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n");
    socket.on("data", (bytes) => {
      received += bytes.toString();
      const content = Buffer.from("result\n"); const header = Buffer.alloc(8); header[0] = 1; header.writeUInt32BE(content.length, 4);
      socket.write(header.subarray(0, 4)); socket.write(Buffer.concat([header.subarray(4), content])); socket.end();
    });
  });
  const attachment = await transport.attach("test", 1024);
  let stdout = ""; attachment.stdout.on("data", (chunk) => { stdout += chunk; });
  attachment.input.write('{"approved":"input"}\n');
  await attachment.closed;
  expect(stdout).toBe("result\n"); expect(received).toBe('{"approved":"input"}\n');
  attachment.close();
});

it.each(["oversized", "invalid-stream", "incomplete"])("rejects %s Docker attach frames", async (kind) => {
  const { server, transport } = await daemon();
  server.on("upgrade", (_req, socket) => {
    socket.write("HTTP/1.1 101 UPGRADED\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n");
    const header = Buffer.alloc(8); header[0] = kind === "invalid-stream" ? 9 : 1; header.writeUInt32BE(kind === "oversized" ? 2000 : 4, 4);
    socket.end(header);
  });
  const attachment = await transport.attach("test", 1024);
  await expect(attachment.closed).rejects.toThrow();
  attachment.close();
});
