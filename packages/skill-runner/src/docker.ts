/** Launcher-only Docker Engine transport. No CLI, shell, host bind mounts,
 * model-controlled socket coordinates, or process fallback. */
import * as http from "node:http";
import { PassThrough, type Readable, type Writable } from "node:stream";

export interface ScriptContainerConfig {
  Image: string;
  Entrypoint: string[];
  Cmd: string[];
  User: string;
  WorkingDir: string;
  Env: string[];
  AttachStdin: true;
  AttachStdout: true;
  AttachStderr: true;
  OpenStdin: true;
  StdinOnce: true;
  Tty: false;
  Labels: Record<string, string>;
  HostConfig: {
    AutoRemove: false;
    NetworkMode: "none";
    ReadonlyRootfs: true;
    Privileged: false;
    CapDrop: string[];
    SecurityOpt: string[];
    PidsLimit: number;
    Memory: number;
    MemorySwap: number;
    NanoCpus: number;
    Binds: [];
    Mounts: Array<{ Type: "volume"; Source: string; Target: "/skill"; ReadOnly: boolean }>;
    Tmpfs: Record<string, string>;
    LogConfig: { Type: "none"; Config: Record<string, never> };
  };
}

export interface ScriptContainerInspect {
  Id: string;
  Image: string;
  Config: { Image: string; User: string; Entrypoint?: string[] | null; Cmd?: string[] | null; Env?: string[] | null };
  HostConfig: Omit<ScriptContainerConfig["HostConfig"], "Mounts"> & { Mounts?: Array<{ Type?: string; Source?: string; Target?: string; ReadOnly?: boolean }> };
  Mounts?: Array<{ Type?: string; Name?: string; Destination?: string; RW?: boolean }>;
  State: { Running?: boolean; ExitCode?: number; OOMKilled?: boolean };
}

export interface ScriptDockerAttachment {
  input: Writable;
  stdout: Readable;
  stderr: Readable;
  closed: Promise<void>;
  close(): void;
}

export interface SkillScriptDockerTransport {
  inspectImage(image: string): Promise<{ id: string } | null>;
  createVolume(name: string, labels: Record<string, string>): Promise<void>;
  inspectVolume(name: string): Promise<boolean>;
  removeVolume(name: string): Promise<void>;
  createContainer(name: string, config: ScriptContainerConfig): Promise<void>;
  inspectContainer(name: string): Promise<ScriptContainerInspect | null>;
  attach(name: string, maximumBytes: number): Promise<ScriptDockerAttachment>;
  start(name: string): Promise<void>;
  wait(name: string, timeoutMs: number): Promise<number>;
  removeContainer(name: string): Promise<void>;
}

export class DockerSocketSkillScriptTransport implements SkillScriptDockerTransport {
  readonly #socketPath: string;
  readonly #version: string;
  readonly #requestTimeoutMs: number;

  constructor(options: { socketPath: string; apiVersion?: string; requestTimeoutMs?: number }) {
    if (!options.socketPath.startsWith("/") || options.socketPath.includes("\0")) throw new Error("Configure an absolute Docker Engine socket path");
    this.#socketPath = options.socketPath;
    this.#version = options.apiVersion ?? "v1.45";
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    if (!/^v1\.\d+$/.test(this.#version) || !Number.isSafeInteger(this.#requestTimeoutMs) || this.#requestTimeoutMs < 100 || this.#requestTimeoutMs > 30_000) {
      throw new Error("Invalid Docker Engine transport configuration");
    }
  }

  #request(method: string, path: string, accepted: readonly number[], body?: unknown, timeoutMs = this.#requestTimeoutMs): Promise<{ status: number; body: string }> {
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const request = http.request({
        socketPath: this.#socketPath, method, path: `/${this.#version}${path}`,
        headers: encoded === undefined ? { accept: "application/json" } : {
          accept: "application/json", "content-type": "application/json", "content-length": Buffer.byteLength(encoded),
        },
      });
      const timer = setTimeout(() => request.destroy(new Error("Docker Engine request deadline exceeded")), timeoutMs);
      const finish = (error?: Error) => { clearTimeout(timer); if (error) reject(error); };
      request.once("error", finish);
      request.once("response", (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024) {
            const error = new Error("Docker Engine response exceeds its size limit");
            finish(error);
            response.destroy(error);
            return;
          }
          chunks.push(chunk);
        });
        response.once("error", finish);
        response.once("aborted", () => finish(new Error("Docker Engine response was interrupted")));
        response.once("end", () => {
          finish();
          const status = response.statusCode ?? 0;
          if (!accepted.includes(status)) { reject(new Error(`Docker Engine ${method} failed (HTTP ${status})`)); return; }
          resolve({ status, body: Buffer.concat(chunks).toString("utf8") });
        });
      });
      request.end(encoded);
    });
  }

  async inspectImage(image: string): Promise<{ id: string } | null> {
    const result = await this.#request("GET", `/images/${encodeURIComponent(image)}/json`, [200, 404]);
    if (result.status === 404) return null;
    const parsed = JSON.parse(result.body) as { Id?: unknown };
    if (typeof parsed.Id !== "string" || !/^sha256:[a-f0-9]{64}$/.test(parsed.Id)) throw new Error("Docker image has no immutable identity");
    return { id: parsed.Id };
  }

  async createVolume(name: string, labels: Record<string, string>): Promise<void> {
    const result = await this.#request("POST", "/volumes/create", [201], { Name: name, Driver: "local", Labels: labels, DriverOpts: {} });
    const parsed = JSON.parse(result.body) as { Name?: unknown };
    if (parsed.Name !== name) throw new Error("Docker returned an unexpected volume identity");
  }

  async inspectVolume(name: string): Promise<boolean> {
    return (await this.#request("GET", `/volumes/${encodeURIComponent(name)}`, [200, 404])).status === 200;
  }

  async removeVolume(name: string): Promise<void> {
    await this.#request("DELETE", `/volumes/${encodeURIComponent(name)}?force=1`, [204, 404]);
  }

  async createContainer(name: string, config: ScriptContainerConfig): Promise<void> {
    const result = await this.#request("POST", `/containers/create?name=${encodeURIComponent(name)}`, [201], config);
    if (!/^[a-f0-9]{12,64}$/.test(String((JSON.parse(result.body) as { Id?: unknown }).Id))) throw new Error("Docker returned an invalid container identity");
  }

  async inspectContainer(name: string): Promise<ScriptContainerInspect | null> {
    const result = await this.#request("GET", `/containers/${encodeURIComponent(name)}/json`, [200, 404]);
    return result.status === 404 ? null : JSON.parse(result.body) as ScriptContainerInspect;
  }

  async start(name: string): Promise<void> {
    await this.#request("POST", `/containers/${encodeURIComponent(name)}/start`, [204]);
  }

  async wait(name: string, timeoutMs: number): Promise<number> {
    const result = await this.#request("POST", `/containers/${encodeURIComponent(name)}/wait?condition=not-running`, [200], undefined, timeoutMs);
    const parsed = JSON.parse(result.body) as { StatusCode?: unknown; Error?: { Message?: unknown } | null };
    if (!Number.isSafeInteger(parsed.StatusCode) || parsed.Error?.Message) throw new Error("Docker wait did not return a valid exit status");
    return parsed.StatusCode as number;
  }

  async removeContainer(name: string): Promise<void> {
    await this.#request("DELETE", `/containers/${encodeURIComponent(name)}?force=1&v=1`, [204, 404]);
  }

  attach(name: string, maximumBytes: number): Promise<ScriptDockerAttachment> {
    return new Promise((resolve, reject) => {
      const request = http.request({
        socketPath: this.#socketPath, method: "POST",
        path: `/${this.#version}/containers/${encodeURIComponent(name)}/attach?stream=1&stdin=1&stdout=1&stderr=1`,
        headers: { connection: "Upgrade", upgrade: "tcp" },
      });
      const timer = setTimeout(() => request.destroy(new Error("Docker attach deadline exceeded")), this.#requestTimeoutMs);
      request.once("error", (error) => { clearTimeout(timer); reject(error); });
      request.once("response", (response) => {
        clearTimeout(timer);
        response.resume();
        reject(new Error(`Docker attach failed (HTTP ${response.statusCode ?? 0})`));
      });
      request.once("upgrade", (_response, socket, head) => {
        clearTimeout(timer);
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        let pending = Buffer.alloc(0);
        let total = 0;
        let settled = false;
        let resolveClosed!: () => void;
        let rejectClosed!: (error: Error) => void;
        const closed = new Promise<void>((done, fail) => { resolveClosed = done; rejectClosed = fail; });
        // A synchronous initial frame may fail before the caller installs its handler.
        void closed.catch(() => undefined);
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          stdout.end(); stderr.end();
          if (error) rejectClosed(error); else if (pending.length) rejectClosed(new Error("Docker attach ended inside a frame")); else resolveClosed();
        };
        const consume = (chunk: Buffer) => {
          if (settled) return;
          total += chunk.length;
          if (total > maximumBytes + 1024 * 1024) { socket.destroy(new Error("Docker attach output exceeds its limit")); return; }
          pending = Buffer.concat([pending, chunk]);
          while (pending.length >= 8) {
            const size = pending.readUInt32BE(4);
            const stream = pending[0];
            if ((stream !== 1 && stream !== 2) || size > maximumBytes || pending[1] !== 0 || pending[2] !== 0 || pending[3] !== 0) {
              socket.destroy(new Error("Invalid Docker attach frame")); return;
            }
            if (pending.length < 8 + size) return;
            const content = pending.subarray(8, 8 + size);
            pending = pending.subarray(8 + size);
            (stream === 1 ? stdout : stderr).write(content);
          }
        };
        socket.on("data", consume);
        socket.once("error", finish);
        socket.once("end", () => finish());
        socket.once("close", () => finish());
        resolve({ input: socket, stdout, stderr, closed, close: () => socket.destroy() });
        if (head.length) consume(head);
      });
      request.end();
    });
  }
}
