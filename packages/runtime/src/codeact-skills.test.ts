/** Actual trusted bootstrap protocol, with a simulated Docker transport.
 * These tests do not establish Docker/OS isolation or call a model provider. */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertValidSkillBundle, SkillSession, type SkillCatalogEntry, type SkillSessionScriptExecution } from "@agentic/skills";
import type { SkillBundle } from "@agentic/contracts";
import { runGeneratedCodeIsolated, type RunGeneratedCodeOptions } from "./codeact";
import type { CodeActDockerTransport, DockerCandidateCreateConfig, DockerCandidateInspect } from "./codeact-container";
import { createCodeActSkillDispatch } from "./codeact-skills";
import { isAgentRuntime } from "@agentic/agent-sdk";
import { getRuntimeGateway, setRuntimeGateway } from "./llm-host";
import { renderRunInputMessage } from "./run-input";

const image = `agentic-codeact-candidate@sha256:${"a".repeat(64)}`;
class BootstrapTransport implements CodeActDockerTransport {
  private config!: DockerCandidateCreateConfig;
  private child!: ChildProcessWithoutNullStreams;
  private input = new PassThrough();
  private exited!: Promise<{ statusCode: number }>;
  private closed!: Promise<void>;
  private removed = false;
  private started = false;
  command?: Record<string, unknown>;
  async create(_name: string, config: DockerCandidateCreateConfig) {
    this.config = config;
    this.child = spawn(process.execPath, [fileURLToPath(new URL("./codeact-candidate-bootstrap.cjs", import.meta.url))], { env: {}, stdio: "pipe" });
    this.exited = new Promise((resolve) => this.child.once("exit", (code) => resolve({ statusCode: code ?? 137 })));
    this.closed = new Promise((resolve) => this.child.once("close", () => resolve()));
    this.input.on("data", (bytes: Buffer) => {
      for (const line of bytes.toString().trim().split("\n")) {
        const message = JSON.parse(line);
        if (message.kind === "execute") this.command = message;
      }
    });
    this.input.pipe(this.child.stdin);
    this.child.stdin.on("error", () => {});
    return { id: "b".repeat(64) };
  }
  async inspect(): Promise<DockerCandidateInspect | null> {
    if (this.removed) return null;
    return {
      Id: "b".repeat(64), Image: `sha256:${"c".repeat(64)}`,
      Config: { Image: this.config.Image, User: this.config.User, Env: [], Entrypoint: this.config.Entrypoint },
      HostConfig: { ...this.config.HostConfig }, Mounts: [], State: { OOMKilled: false, ExitCode: this.started ? 0 : -1 },
    } as DockerCandidateInspect;
  }
  async attach() { return { input: this.input, stdout: this.child.stdout, stderr: this.child.stderr, closed: this.closed }; }
  async start() { this.started = true; }
  wait() { return this.exited; }
  async kill() { this.child.kill("SIGKILL"); }
  async remove() { this.removed = true; }
}

function session(scriptExecution?: SkillSessionScriptExecution) {
  const items = ["alpha", "restricted"].map((name) => {
    const bundle: SkillBundle = { files: [
      { path: "SKILL.md", encoding: "utf8", content: `---\nname: ${name}\ndescription: Use for ${name} work.\n${name === "restricted" ? "disable-model-invocation: true\n" : ""}---\nPRIVATE-${name}-INSTRUCTIONS\n` },
      { path: "scripts/main.js", encoding: "utf8", content: "process.stdout.write('done');" },
      { path: "references/check.md", encoding: "utf8", content: "Inspect π units." },
      { path: "assets/sample.bin", encoding: "base64", content: "AP+A" },
    ] };
    const validated = assertValidSkillBundle(bundle);
    const entry: SkillCatalogEntry = { id: `skill-${name}`, versionId: `version-${name}-1`, name, description: validated.metadata.description, contentDigest: validated.digest, invocationPolicy: { model: name !== "restricted", explicit: true } };
    return { bundle, entry };
  });
  return new SkillSession({ scriptExecution, catalog: items.map((item) => item.entry), readBundle: (entry) => items.find((item) => item.entry.id === entry.id)!.bundle });
}

async function run(body: string, options: RunGeneratedCodeOptions = {}) {
  const transport = new BootstrapTransport();
  const result = await runGeneratedCodeIsolated(`import { defineAgent } from "@agentic/runtime"; export default defineAgent({ async handler(input, ctx) { ${body} } });`, {}, {
    tenantSlug: "af-sbx-skills-sb", candidateImage: image, containerTransport: transport, timeoutMs: 5000, ...options,
  });
  return { result, command: transport.command };
}

beforeEach(() => vi.stubEnv("FACTORY_EXEC_GENERATED", "1"));
afterEach(() => vi.unstubAllEnvs());

describe("CodeAct Skills through the actual candidate bootstrap", () => {
  it("passes operator input and recalled context to prepared reasoning without losing active Skills", async () => {
    const runInputMessage = renderRunInputMessage(
      { prompt: "Review this order", context: "Use the audited threshold" },
      [{ runId: "prior-review", input: "Review the prior order", output: "Prior approval was denied" }],
    );
    const reasonPrepared = vi.fn(async () => ({ checked: true }));
    const { result } = await run('await ctx.skills.load({id:"skill-alpha"}); return await ctx.reason("policy", {orderId:"P-17"});', {
      skillSession: session(), runInputMessage, hostRuntime: { reasonPrepared },
    });
    expect(result).toMatchObject({ ok: true, data: { checked: true } });
    const [request] = reasonPrepared.mock.calls[0] as unknown as [{ input: unknown; messages: Array<{ role: string; content: unknown }> }];
    expect(request.input).toEqual({ input: { orderId: "P-17" }, userContext: runInputMessage });
    expect(JSON.stringify(request.messages)).toContain("PRIVATE-alpha-INSTRUCTIONS");
    const userText = JSON.stringify(request.messages.filter((message) => message.role === "user"));
    const privilegedText = JSON.stringify(request.messages.filter((message) => message.role === "system" || message.role === "developer"));
    for (const value of ["Review this order", "audited threshold", "Prior approval was denied"]) {
      expect(userText).toContain(value);
      expect(privilegedText).not.toContain(value);
    }
  });

  it("routes runScript through the separate business allowlist and the current child session", async () => {
    const execute = vi.fn(async () => ({ ok: true, stdout: "done" }));
    const cap: SkillSessionScriptExecution = { policyDigest: "a".repeat(64), limits: { calls: 1, timeoutMs: 1000, inputBytes: 1024, outputBytes: 1024 }, reservation: { timeoutMs: 1000, outputBytes: 1024 }, execute };
    const parent = session(cap); await parent.activate("restricted", { origin: "explicit" });
    const child = await parent.fork({ skillIds: ["skill-alpha"] });
    const tool = vi.fn(async (_name, value, context) => context.skillSession.runScript(value));
    const code = 'await ctx.skills.load({id:"skill-alpha"}); return await ctx.skills.runScript({id:"skill-alpha",scriptPath:"scripts/main.js",interpreter:"node"});';
    const denied = await run(code, { skillSession: child, hostRuntime: { tool } });
    expect(denied.result).toMatchObject({ ok: false, error: expect.stringContaining("generated_tool_not_declared") }); expect(tool).not.toHaveBeenCalled();
    const allowed = await run(code, { skillSession: child, allowedTools: ["skills.run_script"], hostRuntimeKind: "fixture", toolPolicies: { "skills.run_script": { operation: "compute", effectScope: "sandbox_local", sandboxPolicy: "sandbox_local" } }, hostRuntime: { tool } });
    expect(allowed.result).toMatchObject({ ok: true, data: { ok: true, stdout: "done" } });
    expect(tool.mock.calls[0]![2].skillSession).toBe(child);
    const escaped = await run('return await ctx.skills.runScript({id:"skill-restricted",scriptPath:"scripts/main.js",interpreter:"node"});', { skillSession: child, allowedTools: ["skills.run_script"], hostRuntimeKind: "fixture", toolPolicies: { "skills.run_script": { operation: "compute", effectScope: "sandbox_local", sandboxPolicy: "sandbox_local" } }, hostRuntime: { tool } });
    expect(escaped.result).toMatchObject({ ok: false, error: expect.stringContaining("outside") });
    expect(execute).toHaveBeenCalledOnce(); expect((await parent.snapshot()).scriptUsage?.calls).toBe(1);
  });

  it("prepares discovery and active guidance for the default gateway on each reasoning turn", async () => {
    const previous = getRuntimeGateway();
    const chat = vi.fn(async () => ({ text: '{"checked":true}' }));
    setRuntimeGateway({ chat } as never);
    try {
      const { result } = await run('await ctx.reason("policy", {}); await ctx.skills.load({id:"skill-alpha"}); return await ctx.reason("policy", {});', { skillSession: session(), tenantId: "tenant-budget" });
      expect(result).toMatchObject({ ok: true, data: { checked: true } });
      const requests = chat.mock.calls as unknown as Array<[{ messages: unknown[]; tenantId: string }]>;
      expect(requests).toHaveLength(2);
      expect(JSON.stringify(requests[0]![0].messages)).toContain("skill-alpha");
      expect(JSON.stringify(requests[0]![0].messages)).not.toContain("PRIVATE-alpha-INSTRUCTIONS");
      expect(JSON.stringify(requests[1]![0].messages)).toContain("PRIVATE-alpha-INSTRUCTIONS");
      expect(requests[1]![0].tenantId).toBe("tenant-budget");
    } finally {
      setRuntimeGateway(previous as never);
    }
  });

  it("discovers, activates, reads text/binary, and prepares every reasoning call without serializing session authority", async () => {
    const skillSession = session();
    const reasonPrepared = vi.fn(async () => ({ hostMeaning: "preserved" }));
    const { result, command } = await run(`
      const listed = await ctx.skills.list();
      const loaded = await ctx.skills.load({id: listed.skills[0].id});
      const paths = await ctx.skills.listResources({id: loaded.id});
      const text = await ctx.skills.readResource({id: loaded.id}, "references/check.md");
      const binary = await ctx.skills.readResource({id: loaded.id}, "assets/sample.bin");
      const first = await ctx.reason("host policy", {step: 1});
      const second = await ctx.reason("host policy", {step: 2});
      return {listed, loaded, paths, text, binary, first, second, socket: !!ctx.skills};
    `, { skillSession, hostRuntime: { reasonPrepared } });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.data.binary).toMatchObject({ encoding: "base64", content: "AP+A", bytes: 3 });
    expect(result.data.text).toMatchObject({ bytes: Buffer.byteLength("Inspect π units.") });
    expect(result.data.first).toEqual({ hostMeaning: "preserved" });
    expect(reasonPrepared).toHaveBeenCalledTimes(2);
    for (const [request] of reasonPrepared.mock.calls as unknown as Array<[{ messages: unknown[] }]>) {
      expect(JSON.stringify(request.messages)).toContain("PRIVATE-alpha-INSTRUCTIONS");
      expect(JSON.stringify(request.messages)).not.toContain("PRIVATE-restricted-INSTRUCTIONS");
    }
    expect(JSON.stringify(command)).not.toMatch(/PRIVATE-alpha|contentDigest|readBundle|skillSession/);
    expect(result.skillAccesses.find((access) => access.resourcePath === "assets/sample.bin")).toMatchObject({ skillId: "skill-alpha", skillVersionId: "version-alpha-1", bytes: 3 });
    expect(JSON.stringify(result.skillAccesses)).not.toContain("PRIVATE-alpha");
    expect(result.toolDispatches).toEqual([]);
    expect((await skillSession.snapshot()).activations[0]?.origin).toBe("model");
  });

  it("reserved intrinsic calls bypass tenant impersonation while preserving business-tool denial", async () => {
    const tool = vi.fn();
    const bound = await run('return await ctx.tool("skills.load_skill", {id:"skill-alpha"});', { skillSession: session(), hostRuntime: { tool } });
    expect(bound.result.ok).toBe(true);
    expect(tool).not.toHaveBeenCalled();
    const missing = await run('return await ctx.tool("skills.load_skill", {id:"skill-alpha"});', { allowedTools: ["skills.load_skill"], hostRuntime: { tool } });
    expect(missing.result).toMatchObject({ ok: false, error: expect.stringContaining("skills_not_bound") });
    const business = await run('await ctx.skills.load({id:"skill-alpha"}); return await ctx.tool("records.write", {});', { skillSession: session(), hostRuntime: { tool } });
    expect(business.result).toMatchObject({ ok: false, error: expect.stringContaining("generated_tool_not_declared") });
    expect(tool).not.toHaveBeenCalled();
  });

  it.each([
    ['return await ctx.skills.load({id:"skill-restricted"});', /not available|denied|does not permit/i],
    ['return await ctx.skills.load({id:"skill-alpha", origin:"explicit"});', /Unrecognized|origin/],
    ['return await ctx.skills.readResource({id:"skill-alpha"}, "references/check.md");', /activat/i],
    ['await ctx.skills.load({id:"skill-alpha"}); return await ctx.skills.readResource({id:"skill-alpha"}, "../outside");', /path|segment|relative/i],
  ])("fails closed for unauthorized or malformed generated access: %s", async (body, error) => {
    const { result } = await run(body, { skillSession: session() });
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(error) });
  });

  it("requires a prepared-message custom reason contract with Skills and retains legacy semantics without Skills", async () => {
    const reason = vi.fn(async () => ({ legacy: true }));
    const unsupported = await run('return await ctx.reason("policy", input);', { skillSession: session(), hostRuntime: { reason } });
    expect(unsupported.result).toMatchObject({ ok: false, error: expect.stringContaining("skills_reason_adapter_unsupported") });
    expect(reason).not.toHaveBeenCalled();
    const legacy = await run('return await ctx.reason("policy", input);', { hostRuntime: { reason } });
    expect(legacy.result).toMatchObject({ ok: true, data: { legacy: true } });
    const reasonPrepared = vi.fn(async () => ({ prepared: true }));
    const preferred = await run('return await ctx.reason("policy", input);', { hostRuntime: { reason, reasonPrepared } });
    expect(preferred.result).toMatchObject({ ok: true, data: { prepared: true } });
    expect(reason).toHaveBeenCalledTimes(1);
  });

  it("forks exact inherited/narrowed catalogs separately from untrusted spawn arguments", async () => {
    const parent = session();
    const spawn = vi.fn(async () => ({ ok: true }));
    for (const options of ["{}", '{skillIds:["skill-alpha"]}']) {
      const { result } = await run(`return await ctx.spawn("inspect", {}, ${options});`, { skillSession: parent, hostRuntime: { spawn } });
      expect(result.ok).toBe(true);
    }
    const calls = spawn.mock.calls as unknown as Array<[string, unknown, unknown, { skillSession: SkillSession }]>;
    expect(calls[0]![3].skillSession).not.toBe(parent);
    expect((await calls[0]![3].skillSession.snapshot()).catalog).toEqual((await parent.snapshot()).catalog);
    expect((await calls[1]![3].skillSession.snapshot()).catalog.map((entry) => entry.id)).toEqual(["skill-alpha"]);
    const escalated = await run('return await ctx.spawn("inspect", {}, {skillIds:["outside"]});', { skillSession: parent, hostRuntime: { spawn } });
    expect(escalated.result).toMatchObject({ ok: true, data: { ok: false, error: expect.stringContaining("Child Skill catalog denied") } });
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("keeps production spawn disabled even with a host SkillSession and custom spawn", async () => {
    const spawn = vi.fn();
    const code = 'import { defineAgent } from "@agentic/runtime"; export default defineAgent({ async handler(input, ctx) { return await ctx.spawn("inspect", {}); } });';
    const { createHash } = await import("node:crypto");
    const result = await runGeneratedCodeIsolated(code, {}, { tenantSlug: "real-tenant", skillSession: session(), hostRuntime: { spawn }, candidateImage: image, containerTransport: new BootstrapTransport(), production: { allowProduction: true, expectedCodeSha256: createHash("sha256").update(code).digest("hex") } });
    expect(result).toMatchObject({ ok: true, data: { ok: false, error: expect.stringContaining("spawn is not enabled") } });
    expect(spawn).not.toHaveBeenCalled();
  });
});

it("enforces the host resource budget even across repeat RPC reads", async () => {
  const skillSession = session();
  const dispatch = createCodeActSkillDispatch(skillSession, () => {});
  await dispatch.rpc("skills.load", [{ id: "skill-alpha" }]);
  for (let i = 0; i < 64; i++) await dispatch.rpc("skills.readResource", [{ id: "skill-alpha" }, "assets/sample.bin"]);
  await expect(dispatch.rpc("skills.readResource", [{ id: "skill-alpha" }, "assets/sample.bin"])).rejects.toThrow(/limit|budget/i);
});

it("requires the complete Skills namespace in the SDK runtime guard", () => {
  const method = async () => {};
  const base = { agentName: "a", tenantSlug: "t", correlationId: "c", memory: {}, reason: method, tool: method, emit: method, invoke: method, spawn: method, log: method };
  expect(isAgentRuntime(base)).toBe(false);
  expect(isAgentRuntime({ ...base, skills: { list: method, load: method, listResources: method, readResource: method } })).toBe(true);
});
