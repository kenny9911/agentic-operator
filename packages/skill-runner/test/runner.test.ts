import { PassThrough, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { assertValidSkillBundle } from "@agentic/skills";
import {
  SkillScriptRunner, DEFAULT_SKILL_SCRIPT_LIMITS,
  type ScriptContainerConfig, type ScriptContainerInspect, type ScriptDockerAttachment,
  type SkillScriptDockerTransport, type SkillScriptRequest, type SkillScriptRunnerOptions,
} from "../src/index";

const image = `sha256:${"a".repeat(64)}`;
const success = { schema: "agentic-skill-run-result/v1", stdout: "completed\n", stderr: "", exitCode: 0, artifacts: [{ path: "report.txt", content: Buffer.from("report bytes").toString("base64") }] };

function request(): SkillScriptRequest {
  const bundle = { files: [
    { path: "SKILL.md", encoding: "utf8" as const, content: "---\nname: report\ndescription: Build a report\n---\nUse scripts/report.js.\n" },
    { path: "scripts/report.js", encoding: "utf8" as const, content: 'console.log("safe test fixture");' },
    { path: "assets/input.bin", encoding: "base64" as const, content: Buffer.from([0, 255, 128]).toString("base64") },
  ] };
  return {
    identity: { tenantId: "tenant-a", agentId: "agent-a", runId: "run-a" },
    skill: { id: "skill-report", versionId: "version-a", name: "report", contentDigest: assertValidSkillBundle(bundle).digest },
    bundle, scriptPath: "scripts/report.js", interpreter: "node", args: ["literal;$(not-a-command)"], stdin: "input text",
  };
}

class FakeDocker implements SkillScriptDockerTransport {
  containers = new Map<string, ScriptContainerConfig>();
  volumes = new Set<string>();
  configs: ScriptContainerConfig[] = [];
  payloads: Record<string, unknown>[] = [];
  starts: string[] = [];
  result: unknown = structuredClone(success);
  stageFails = false;
  hangRun = false;
  refuseVolumeRemoval = false;
  createThenFail = false;
  unavailable = false;
  executionStatus = 0;
  onStart?: (name: string) => void;
  corruptInspect?: (inspect: ScriptContainerInspect) => void;
  waiting = new Map<string, (status: number) => void>();
  async inspectImage() { if (this.unavailable) throw new Error("No daemon"); return { id: image }; }
  async createVolume(name: string) { this.volumes.add(name); }
  async inspectVolume(name: string) { return this.volumes.has(name); }
  async removeVolume(name: string) { if (!this.refuseVolumeRemoval) this.volumes.delete(name); }
  async createContainer(name: string, config: ScriptContainerConfig) {
    this.containers.set(name, structuredClone(config)); this.configs.push(structuredClone(config));
    if (this.createThenFail) throw new Error("Lost create response");
  }
  async inspectContainer(name: string): Promise<ScriptContainerInspect | null> {
    const config = this.containers.get(name);
    if (!config) return null;
    const inspect: ScriptContainerInspect = {
      Id: "b".repeat(64), Image: image, Config: structuredClone(config), HostConfig: structuredClone(config.HostConfig),
      Mounts: [{ Type: "volume", Name: config.HostConfig.Mounts[0]!.Source, Destination: "/skill", RW: !config.HostConfig.Mounts[0]!.ReadOnly }],
      State: { Running: false, ExitCode: config.Cmd[0] === "stage" ? 0 : this.executionStatus, OOMKilled: this.executionStatus === 137 },
    };
    this.corruptInspect?.(inspect);
    return inspect;
  }
  async start(name: string) { this.starts.push(name); this.onStart?.(name); }
  async wait(name: string) {
    if (this.hangRun && name.endsWith("-run")) return new Promise<number>((resolve) => { this.waiting.set(name, resolve); });
    return name.endsWith("-stage") ? 0 : this.executionStatus;
  }
  async removeContainer(name: string) { this.containers.delete(name); this.waiting.get(name)?.(137); this.waiting.delete(name); }
  async attach(name: string): Promise<ScriptDockerAttachment> {
    const stdout = new PassThrough(), stderr = new PassThrough();
    let close!: () => void;
    const closed = new Promise<void>((resolve) => { close = resolve; });
    const input = new Writable({ write: (chunk, _encoding, done) => {
      const payload = JSON.parse(String(chunk)) as Record<string, unknown>;
      this.payloads.push(payload);
      if (!this.hangRun || !name.endsWith("-run")) {
        const result = name.endsWith("-stage") ? { schema: "agentic-skill-stage-result/v1", ok: !this.stageFails, contentDigest: payload.contentDigest } : this.result;
        stdout.end(JSON.stringify(result) + "\n"); stderr.end(); close();
      }
      done();
    } });
    return { input, stdout, stderr, closed, close: () => { stdout.end(); stderr.end(); close(); } };
  }
}

function runner(transport = new FakeDocker(), options: Partial<SkillScriptRunnerOptions> = {}) {
  return { transport, runner: new SkillScriptRunner({ image, approvedImages: [image], interpreters: ["node", "python"], authorize: () => true, transport, ...options }) };
}

describe("bounded Skill script execution", () => {
  it("stages exact bytes, uses literal argv/stdin and verifies cleanup before success", async () => {
    const { runner: executor, transport } = runner();
    const input = request();
    const result = await executor.run(input);
    expect(result).toMatchObject({ ok: true, stdout: "completed\n", exitCode: 0 });
    expect(result.artifacts[0]).toMatchObject({ path: "report.txt", bytes: 12, encoding: "base64" });
    expect(result.artifacts[0]?.contentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(transport.payloads[0]).toMatchObject({ schema: "agentic-skill-stage/v1", contentDigest: input.skill.contentDigest });
    expect(transport.payloads[1]).toMatchObject({ args: input.args, stdin: Buffer.from(input.stdin!).toString("base64"), scriptPath: input.scriptPath });
    expect(transport.containers.size).toBe(0); expect(transport.volumes.size).toBe(0);
    expect(result.evidence).toMatchObject({ identity: input.identity, skill: input.skill, executorStarted: true, containerExitCode: 0, oomKilled: false, cleanup: { stagingContainerAbsent: true, executionContainerAbsent: true, volumeAbsent: true } });
  });

  it("uses a nonroot staging container, read-only execution bundle and bounded scratch", async () => {
    const { runner: executor, transport } = runner();
    await executor.run(request());
    expect(transport.configs).toHaveLength(2);
    for (const config of transport.configs) {
      expect(config).toMatchObject({ User: "65532:65532", HostConfig: { NetworkMode: "none", ReadonlyRootfs: true, Privileged: false, Binds: [], CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges"], LogConfig: { Type: "none" } } });
      expect(config.Env.join(" ")).not.toMatch(/TOKEN|SECRET|API_KEY/);
    }
    expect(transport.configs[0]!.HostConfig.Mounts[0]?.ReadOnly).toBe(false);
    expect(transport.configs[0]!.HostConfig.Tmpfs).toEqual({});
    expect(transport.configs[1]!.HostConfig.Mounts[0]?.ReadOnly).toBe(true);
    expect(transport.configs[1]!.HostConfig.Tmpfs["/scratch"]).toContain(`size=${DEFAULT_SKILL_SCRIPT_LIMITS.scratchBytes}`);
  });

  it.each(["latest", `repo:latest`, `sha256:${"b".repeat(64)}`])("requires exact approved image %s", async (candidate) => {
    const { runner: executor, transport } = runner(undefined, { image: candidate });
    expect((await executor.run(request())).failure).toBe("image_not_approved");
    expect(transport.configs).toEqual([]);
  });

  it("requires host capability and does not infer permission from bundle prose", async () => {
    const { runner: executor, transport } = runner(undefined, { authorize: () => false });
    expect((await executor.run(request())).failure).toBe("execution_denied");
    expect(transport.volumes.size).toBe(0); expect(transport.configs).toHaveLength(0);
  });

  it("checks capability again before execution and cleans staged bytes on revocation", async () => {
    const authorize = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { runner: executor, transport } = runner(undefined, { authorize });
    expect((await executor.run(request())).failure).toBe("execution_denied");
    expect(transport.configs).toHaveLength(1); expect(transport.volumes.size).toBe(0);
  });

  it("isolates mutable input while asynchronous authorization runs", async () => {
    let release!: (value: boolean) => void;
    const gate = new Promise<boolean>((resolve) => { release = resolve; });
    const authorize = vi.fn().mockImplementationOnce(() => gate).mockResolvedValue(true);
    const { runner: executor, transport } = runner(undefined, { authorize });
    const input = request();
    const pending = executor.run(input);
    input.bundle.files[1]!.content = "changed after admission";
    (input.skill as { id: string }).id = "private";
    release(true);
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(result.evidence?.skill.id).toBe("skill-report");
    expect(JSON.stringify(transport.payloads[0])).not.toContain(Buffer.from("changed after admission").toString("base64"));
    expect(Object.isFrozen(authorize.mock.calls[0]![0].skill)).toBe(true);
  });

  it.each(["../secret", "/tmp/script.js", "references/report.js", "scripts/../report.js", "scripts/missing.js"])("rejects non-authorized script path %s before creating resources", async (scriptPath) => {
    const { runner: executor, transport } = runner();
    expect((await executor.run({ ...request(), scriptPath })).failure).toBe("invalid_request");
    expect(transport.configs).toHaveLength(0);
  });

  it("rejects modified versions and interpreter/argument/input violations", async () => {
    const { runner: executor, transport } = runner(undefined, { interpreters: ["node"], limits: { inputBytes: 4, argumentBytes: 20 } });
    const input = request();
    expect((await executor.run({ ...input, skill: { ...input.skill, contentDigest: "0".repeat(64) } })).failure).toBe("invalid_request");
    expect((await executor.run({ ...input, interpreter: "python" })).failure).toBe("execution_denied");
    expect((await executor.run({ ...input, args: ["NUL\0"], stdin: "" })).failure).toBe("invalid_request");
    expect((await executor.run({ ...input, args: [], stdin: "12345" })).failure).toBe("invalid_request");
    expect(transport.configs).toHaveLength(0);
  });

  it("never starts with weaker actual Docker isolation", async () => {
    const { runner: executor, transport } = runner();
    transport.corruptInspect = (inspect) => { inspect.HostConfig.ReadonlyRootfs = false as true; };
    expect((await executor.run(request())).failure).toBe("isolation_mismatch");
    expect(transport.starts).toHaveLength(0); expect(transport.volumes.size).toBe(0);
  });

  it("rejects secret-bearing image environment and unexpected mounts", async () => {
    for (const corrupt of [
      (inspect: ScriptContainerInspect) => { inspect.Config.Env!.push("API_KEY=must-not-leak"); },
      (inspect: ScriptContainerInspect) => { inspect.Mounts!.push({ Type: "bind", Destination: "/host" }); },
    ]) {
      const { runner: executor, transport } = runner();
      transport.corruptInspect = corrupt;
      expect((await executor.run(request())).failure).toBe("isolation_mismatch");
      expect(transport.starts).toHaveLength(0);
    }
  });

  it("does not execute after failed staging", async () => {
    const { runner: executor, transport } = runner(); transport.stageFails = true;
    expect((await executor.run(request())).failure).toBe("staging_failed");
    expect(transport.configs).toHaveLength(1); expect(transport.volumes.size).toBe(0);
  });

  it("cleans known resource names after an ambiguous create failure", async () => {
    const { runner: executor, transport } = runner(); transport.createThenFail = true;
    const result = await executor.run(request());
    expect(result.failure).toBe("executor_unavailable");
    expect(transport.containers.size).toBe(0); expect(transport.volumes.size).toBe(0);
    expect(result.evidence?.cleanup.volumeAbsent).toBe(true);
  });

  it("reports unavailable isolation without a host execution fallback", async () => {
    const { runner: executor, transport } = runner(); transport.unavailable = true;
    expect((await executor.run(request())).failure).toBe("executor_unavailable");
    expect(transport.configs).toHaveLength(0);
  });

  it("propagates cancellation during a running script and verifies cleanup", async () => {
    const controller = new AbortController();
    const { runner: executor, transport } = runner(); transport.hangRun = true;
    transport.onStart = (name) => { if (name.endsWith("-run")) setTimeout(() => controller.abort(), 5); };
    const result = await executor.run({ ...request(), signal: controller.signal });
    expect(result.failure).toBe("cancelled");
    expect(transport.containers.size).toBe(0); expect(transport.volumes.size).toBe(0);
  });

  it("bounds a stuck script and a stuck authorizer", async () => {
    const running = runner(undefined, { limits: { timeoutMs: 10 } }); running.transport.hangRun = true;
    expect((await running.runner.run(request())).failure).toBe("timeout");
    expect(running.transport.containers.size).toBe(0);
    const auth = runner(undefined, { limits: { stagingTimeoutMs: 10 }, authorize: () => new Promise(() => {}) });
    expect((await auth.runner.run(request())).failure).toBe("timeout");
    expect(auth.transport.volumes.size).toBe(0);
  });

  it("makes failed cleanup override an otherwise successful script result", async () => {
    const { runner: executor, transport } = runner(); transport.refuseVolumeRemoval = true;
    const result = await executor.run(request());
    expect(result).toMatchObject({ ok: false, failure: "cleanup_failed", evidence: { cleanup: { volumeAbsent: false } } });
  });

  it("records daemon OOM and container exit separately from an absent script result", async () => {
    const { runner: executor, transport } = runner(); transport.executionStatus = 137;
    const result = await executor.run(request());
    expect(result).toMatchObject({ ok: false, failure: "script_failed", exitCode: null, evidence: { containerExitCode: 137, oomKilled: true } });
  });

  it.each([
    { ...success, artifacts: [{ path: "../escape", content: "YQ==" }] },
    { ...success, artifacts: [{ path: "a", content: "YQ==" }, { path: "a/b", content: "YQ==" }] },
    { ...success, artifacts: [{ path: "a", content: "not canonical" }] },
    { ...success, failure: ["timeout"] },
    { ...success, exitCode: 999999999 },
  ])("bounds and validates untrusted script result %#", async (result) => {
    const setup = runner(); setup.transport.result = result;
    const outcome = await setup.runner.run(request());
    expect(outcome.ok).toBe(false);
    expect(["protocol_failed", "artifact_limit"]).toContain(outcome.failure);
    expect(setup.transport.volumes.size).toBe(0);
  });

  it("enforces stdout and artifact budgets at the host boundary", async () => {
    const setup = runner(undefined, { limits: { outputBytes: 2 } });
    expect((await setup.runner.run(request())).failure).toBe("protocol_failed");
    const artifacts = runner(undefined, { limits: { artifactBytes: 1, artifactFileBytes: 1 } });
    expect((await artifacts.runner.run(request())).failure).toBe("artifact_limit");
  });

  it.each([NaN, Infinity, 0, -1])("rejects invalid resource limits %s", (value) => {
    for (const key of Object.keys(DEFAULT_SKILL_SCRIPT_LIMITS)) expect(() => runner(undefined, { limits: { [key]: value } })).toThrow();
  });
});
