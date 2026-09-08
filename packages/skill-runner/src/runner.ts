import { createHash, randomBytes } from "node:crypto";
import { assertSafeSkillPath, assertValidSkillBundle, decodeSkillFile, SkillPathIndex } from "@agentic/skills";
import type { SkillBundle } from "@agentic/contracts";
import type { ScriptContainerConfig, ScriptContainerInspect, SkillScriptDockerTransport } from "./docker";
import {
  DEFAULT_SKILL_SCRIPT_LIMITS,
  type SkillScriptArtifact, type SkillScriptAuthorizationRequest, type SkillScriptEvidence,
  type SkillScriptFailure, type SkillScriptInterpreter, type SkillScriptLimits,
  type SkillScriptRequest, type SkillScriptResult,
} from "./types";

const IMAGE = /^(?:[a-z0-9][a-z0-9._/:-]*@)?sha256:[a-f0-9]{64}$/;
const MAXIMUM: SkillScriptLimits = {
  timeoutMs: 300_000, stagingTimeoutMs: 60_000, memoryBytes: 2 * 1024 ** 3, cpus: 4, pids: 128,
  scratchBytes: 256 * 1024 ** 2, inputBytes: 1024 ** 2, outputBytes: 4 * 1024 ** 2,
  argumentBytes: 64 * 1024, argumentCount: 128,
  artifactBytes: 32 * 1024 ** 2, artifactFileBytes: 10 * 1024 ** 2, artifactCount: 128, artifactDepth: 16,
};

class RunnerFailure extends Error {
  constructor(readonly code: SkillScriptFailure, message: string) { super(message); }
}

export interface SkillScriptRunnerOptions {
  /** Exact reviewed local image ID or repository digest. No automatic pull. */
  readonly image: string;
  readonly approvedImages: readonly string[];
  readonly interpreters: readonly SkillScriptInterpreter[];
  /** Required host capability check, performed before staging and execution.
   * This callback must derive authority from trusted run/session state. */
  readonly authorize: (request: SkillScriptAuthorizationRequest) => boolean | Promise<boolean>;
  readonly transport: SkillScriptDockerTransport;
  readonly limits?: Partial<SkillScriptLimits>;
}

function digest(bytes: string | Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function validId(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value); }

function limits(input: Partial<SkillScriptLimits> = {}): Readonly<SkillScriptLimits> {
  const result = { ...DEFAULT_SKILL_SCRIPT_LIMITS, ...input };
  for (const [key, value] of Object.entries(result)) {
    if (!Object.hasOwn(MAXIMUM, key) || !Number.isFinite(value) || value <= 0 || value > MAXIMUM[key as keyof SkillScriptLimits] || (key !== "cpus" && !Number.isSafeInteger(value))) {
      throw new Error(`Invalid Skill script limit: ${key}`);
    }
  }
  if (result.cpus < 0.1 || result.memoryBytes < 64 * 1024 ** 2 || result.scratchBytes < 1024 ** 2 || result.pids < 8) throw new Error("Skill script resource limits are below the supported minimum");
  return Object.freeze(result);
}

export function buildSkillScriptContainerConfig(input: {
  image: string; volume: string; stage: boolean; limits: SkillScriptLimits; executionId: string;
}): ScriptContainerConfig {
  return {
    Image: input.image,
    // The fixed supervisor must never open a debugging endpoint in response
    // to a signal from a child process in the execution container.
    Entrypoint: ["/usr/local/bin/node", "--disable-sigusr1", "/opt/agentic/skill-runner.cjs"],
    Cmd: [input.stage ? "stage" : "run"],
    User: "65532:65532", WorkingDir: input.stage ? "/skill" : "/scratch",
    Env: ["PATH=/usr/local/bin:/usr/bin:/bin", "HOME=/scratch", "TMPDIR=/scratch/tmp", "NODE_OPTIONS="],
    AttachStdin: true, AttachStdout: true, AttachStderr: true, OpenStdin: true, StdinOnce: true, Tty: false,
    Labels: { "io.agentic.role": "skill-script", "io.agentic.execution-id": input.executionId, "io.agentic.stage": input.stage ? "true" : "false" },
    HostConfig: {
      AutoRemove: false, NetworkMode: "none", ReadonlyRootfs: true, Privileged: false,
      CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges"],
      PidsLimit: input.limits.pids, Memory: input.limits.memoryBytes, MemorySwap: input.limits.memoryBytes,
      NanoCpus: Math.floor(input.limits.cpus * 1_000_000_000),
      Binds: [], Mounts: [{ Type: "volume", Source: input.volume, Target: "/skill", ReadOnly: !input.stage }],
      Tmpfs: input.stage ? {} : { "/scratch": `rw,nosuid,nodev,noexec,size=${input.limits.scratchBytes},mode=0700,uid=65532,gid=65532` },
      LogConfig: { Type: "none", Config: {} },
    },
  };
}

/** Inspect the actual daemon configuration, including unexpected mounts. */
export function skillScriptIsolationIssues(actual: ScriptContainerInspect, expected: ScriptContainerConfig, imageId: string): string[] {
  const issues: string[] = [];
  const host = actual.HostConfig;
  const wanted = expected.HostConfig;
  if (actual.Image !== imageId || actual.Config.Image !== expected.Image) issues.push("image identity");
  if (actual.Config.User !== expected.User) issues.push("non-root user");
  if (JSON.stringify(actual.Config.Entrypoint) !== JSON.stringify(expected.Entrypoint) || JSON.stringify(actual.Config.Cmd) !== JSON.stringify(expected.Cmd)) issues.push("fixed entrypoint");
  for (const key of ["NetworkMode", "ReadonlyRootfs", "Privileged", "PidsLimit", "Memory", "MemorySwap", "NanoCpus"] as const) {
    if (host[key] !== wanted[key]) issues.push(key);
  }
  if (!(host.CapDrop ?? []).map((item) => item.toUpperCase()).includes("ALL")) issues.push("capability drop");
  if (!(host.SecurityOpt ?? []).some((item) => item === "no-new-privileges" || item === "no-new-privileges=true")) issues.push("privilege escalation");
  if ((host.Binds ?? []).length) issues.push("host bind mount");
  const mounts = host.Mounts ?? [];
  if (mounts.length !== 1 || mounts[0]?.Type !== "volume" || mounts[0]?.Source !== wanted.Mounts[0]!.Source || mounts[0]?.Target !== "/skill" || Boolean(mounts[0]?.ReadOnly) !== wanted.Mounts[0]!.ReadOnly) issues.push("private bundle mount");
  const tmpfs = host.Tmpfs ?? {};
  if (JSON.stringify(tmpfs) !== JSON.stringify(wanted.Tmpfs)) issues.push("scratch filesystem");
  const actualMounts = actual.Mounts ?? [];
  if (!actualMounts.some((mount) => mount.Type === "volume" && mount.Name === wanted.Mounts[0]!.Source && mount.Destination === "/skill" && mount.RW === !wanted.Mounts[0]!.ReadOnly)) issues.push("actual bundle mount");
  for (const mount of actualMounts) {
    if (mount.Type === "volume" && mount.Name === wanted.Mounts[0]!.Source && mount.Destination === "/skill") continue;
    if (mount.Type === "tmpfs" && mount.Destination === "/scratch" && Object.hasOwn(wanted.Tmpfs, "/scratch")) continue;
    issues.push("unexpected mount");
  }
  if (host.LogConfig?.Type !== "none") issues.push("persistent container logging");
  // Approved base-image version metadata is harmless. No arbitrary image
  // environment (including credentials) may reach the supervisor's /proc.
  const imageMetadata = /^(?:NODE_VERSION|YARN_VERSION|PYTHON_VERSION|PYTHON_SHA256|LANG|GPG_KEY)=/;
  for (const value of actual.Config.Env ?? []) {
    if (!expected.Env.includes(value) && !imageMetadata.test(value)) issues.push("unexpected environment");
  }
  for (const value of expected.Env) if (!(actual.Config.Env ?? []).includes(value)) issues.push("fixed environment");
  return issues;
}

interface ContainerOutput { text: string; status: number; inspected: ScriptContainerInspect }

export class SkillScriptRunner {
  readonly #image: string;
  readonly #approved: readonly string[];
  readonly #interpreters: readonly SkillScriptInterpreter[];
  readonly #authorize: SkillScriptRunnerOptions["authorize"];
  readonly #transport: SkillScriptDockerTransport;
  readonly #limits: Readonly<SkillScriptLimits>;

  constructor(options: SkillScriptRunnerOptions) {
    this.#image = options.image;
    this.#approved = Object.freeze([...options.approvedImages]);
    this.#interpreters = Object.freeze([...options.interpreters]);
    if (typeof options.authorize !== "function") throw new Error("Skill script execution requires a host capability authorizer");
    if (this.#interpreters.some((item) => item !== "node" && item !== "python")) throw new Error("Unsupported Skill script interpreter");
    this.#authorize = options.authorize;
    this.#transport = options.transport;
    this.#limits = limits(options.limits);
  }

  async run(request: SkillScriptRequest): Promise<SkillScriptResult> {
    const startedAt = new Date().toISOString();
    const signal = request.signal;
    let auth: SkillScriptAuthorizationRequest;
    let bundle: SkillBundle;
    let args: string[];
    let stdin: string;
    let scriptDigest: string;
    try {
      if (!record(request.identity) || !record(request.skill) || !Object.values(request.identity).every(validId)
        || ![request.identity.tenantId, request.identity.agentId, request.identity.runId, request.skill.id, request.skill.versionId].every(validId)
        || typeof request.skill.name !== "string" || !/^[a-f0-9]{64}$/.test(request.skill.contentDigest)) throw new Error("An immutable Skill reference and trusted run identity are required");
      assertSafeSkillPath(request.scriptPath);
      if (!request.scriptPath.startsWith("scripts/") || (request.interpreter !== "node" && request.interpreter !== "python")) throw new Error("Choose a bundled scripts/ path and an approved interpreter");
      if (!this.#interpreters.includes(request.interpreter)) throw new RunnerFailure("execution_denied", "This interpreter is not enabled by the host capability");
      bundle = structuredClone(request.bundle);
      const validated = assertValidSkillBundle(bundle);
      if (validated.digest !== request.skill.contentDigest || validated.metadata.name !== request.skill.name) throw new Error("Skill bundle does not match the exact authorized version");
      const file = bundle.files.find((entry) => entry.path === request.scriptPath);
      if (!file) throw new Error("The script is absent from the authorized bundle");
      scriptDigest = digest(decodeSkillFile(file));
      if (request.args !== undefined && !Array.isArray(request.args)) throw new Error("Script arguments must be an array of strings");
      args = [...(request.args ?? [])];
      if (args.length > this.#limits.argumentCount || args.some((arg) => typeof arg !== "string" || arg.includes("\0")) || Buffer.byteLength(args.join("\0")) > this.#limits.argumentBytes) throw new Error("Script arguments exceed their bounds or contain NUL");
      stdin = request.stdin ?? "";
      if (typeof stdin !== "string" || Buffer.byteLength(stdin) > this.#limits.inputBytes) throw new Error("Script standard input exceeds its byte limit");
      auth = Object.freeze({
        identity: Object.freeze({ tenantId: request.identity.tenantId, agentId: request.identity.agentId, runId: request.identity.runId }),
        skill: Object.freeze({ id: request.skill.id, versionId: request.skill.versionId, name: request.skill.name, contentDigest: request.skill.contentDigest }),
        scriptPath: request.scriptPath, interpreter: request.interpreter,
      });
    } catch (error) {
      return this.#failure(error instanceof RunnerFailure ? error.code : "invalid_request", error instanceof Error ? error.message : "Invalid script request");
    }
    if (!IMAGE.test(this.#image) || !this.#approved.includes(this.#image)) return this.#failure("image_not_approved", "An exact, host-approved Skill runner image is required");
    if (signal?.aborted) return this.#failure("cancelled", "Skill script execution was cancelled before start");
    const executionId = randomBytes(16).toString("hex");
    const volume = `agentic-skill-${executionId}`;
    const stagingName = `${volume}-stage`;
    const executionName = `${volume}-run`;
    const policyDigest = digest(JSON.stringify({ image: this.#image, limits: this.#limits, network: "none", bundle: "private-volume-readonly", user: "65532:65532" }));
    let imageId: string | null = null;
    let executorStarted = false;
    let oomKilled: boolean | null = null;
    let exitCode: number | null = null;
    let containerExitCode: number | null = null;
    let touchedResources = false;
    let result: SkillScriptResult;
    const cleanup = { stagingContainerAbsent: false, executionContainerAbsent: false, volumeAbsent: false };
    try {
      await this.#checkAuthorization(auth, signal);
      const image = await this.#transport.inspectImage(this.#image);
      if (!image) throw new RunnerFailure("executor_unavailable", "The approved Skill runner image is not installed on the execution daemon");
      imageId = image.id;
      this.#checkCancelled(signal);
      touchedResources = true; // Cleanup by known names even after an ambiguous create response.
      await this.#transport.createVolume(volume, { "io.agentic.role": "skill-script-bundle", "io.agentic.execution-id": executionId });
      this.#checkCancelled(signal);
      const stage = await this.#container(stagingName, buildSkillScriptContainerConfig({ image: this.#image, volume, stage: true, limits: this.#limits, executionId }), {
        schema: "agentic-skill-stage/v1", contentDigest: auth.skill.contentDigest,
        files: bundle.files.map((file) => ({ path: file.path, content: decodeSkillFile(file).toString("base64") })),
      }, this.#limits.stagingTimeoutMs, 64 * 1024, imageId, signal);
      const stageResult = this.#parseProtocol(stage.text);
      if (stage.status !== 0 || stageResult.schema !== "agentic-skill-stage-result/v1" || stageResult.ok !== true || stageResult.contentDigest !== auth.skill.contentDigest) throw new RunnerFailure("staging_failed", "The immutable Skill bundle could not be staged");
      await this.#transport.removeContainer(stagingName);
      if (await this.#transport.inspectContainer(stagingName)) throw new RunnerFailure("cleanup_failed", "The staging container could not be removed before execution");
      await this.#checkAuthorization(auth, signal);
      const outputLimit = 6 * this.#limits.outputBytes + 4 * Math.ceil(this.#limits.artifactBytes / 3) + 128 * 1024;
      const execution = await this.#container(executionName, buildSkillScriptContainerConfig({ image: this.#image, volume, stage: false, limits: this.#limits, executionId }), {
        schema: "agentic-skill-run/v1", scriptPath: auth.scriptPath, interpreter: auth.interpreter,
        args, stdin: Buffer.from(stdin).toString("base64"), limits: this.#limits,
      }, this.#limits.timeoutMs, outputLimit, imageId, signal, () => { executorStarted = true; });
      oomKilled = execution.inspected.State.OOMKilled === true;
      containerExitCode = execution.status;
      if (execution.status !== 0) throw new RunnerFailure("script_failed", "The isolated runner process exited without a complete result");
      result = this.#scriptResult(this.#parseProtocol(execution.text));
      exitCode = result.exitCode;
    } catch (error) {
      result = this.#failure(error instanceof RunnerFailure ? error.code : "executor_unavailable", error instanceof RunnerFailure ? error.message : "The isolated Skill script executor could not complete the request");
    } finally {
      if (touchedResources) {
        for (const [name, key] of [[stagingName, "stagingContainerAbsent"], [executionName, "executionContainerAbsent"]] as const) {
          try { await this.#transport.removeContainer(name); cleanup[key] = (await this.#transport.inspectContainer(name)) === null; } catch { /* Retain failed cleanup in evidence. */ }
        }
        try { await this.#transport.removeVolume(volume); cleanup.volumeAbsent = !(await this.#transport.inspectVolume(volume)); } catch { /* Never claim verified cleanup on an uncertain response. */ }
      } else {
        cleanup.stagingContainerAbsent = cleanup.executionContainerAbsent = cleanup.volumeAbsent = true;
      }
    }
    const evidence: SkillScriptEvidence = {
      schema: "agentic-skill-script-execution/v1", ...auth, scriptDigest,
      image: this.#image, imageId, isolation: "isolated_container", policyDigest,
      startedAt, completedAt: new Date().toISOString(), executorStarted, exitCode, containerExitCode, oomKilled, cleanup,
    };
    if (!Object.values(cleanup).every(Boolean)) result = { ...result, ok: false, failure: "cleanup_failed", error: "Skill execution resources could not all be verified absent" };
    return { ...result, evidence };
  }

  async #checkAuthorization(auth: SkillScriptAuthorizationRequest, signal?: AbortSignal): Promise<void> {
    this.#checkCancelled(signal);
    let fail!: (error: Error) => void;
    const stopped = new Promise<never>((_resolve, reject) => { fail = reject; });
    const aborted = () => fail(new RunnerFailure("cancelled", "Skill script execution was cancelled"));
    signal?.addEventListener("abort", aborted, { once: true });
    const timer = setTimeout(() => fail(new RunnerFailure("timeout", "Skill capability authorization exceeded its deadline")), this.#limits.stagingTimeoutMs);
    try {
      if ((await Promise.race([this.#authorize(auth), stopped])) !== true) throw new RunnerFailure("execution_denied", "This run has no approved capability to execute the selected Skill script");
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", aborted); }
    this.#checkCancelled(signal);
  }

  #checkCancelled(signal?: AbortSignal): void {
    if (signal?.aborted) throw new RunnerFailure("cancelled", "Skill script execution was cancelled");
  }

  async #container(name: string, config: ScriptContainerConfig, payload: unknown, timeoutMs: number, maximumBytes: number, imageId: string, signal?: AbortSignal, onStarted?: () => void): Promise<ContainerOutput> {
    this.#checkCancelled(signal);
    await this.#transport.createContainer(name, config);
    this.#checkCancelled(signal);
    const inspected = await this.#transport.inspectContainer(name);
    if (!inspected || skillScriptIsolationIssues(inspected, config, imageId).length) throw new RunnerFailure("isolation_mismatch", "The daemon did not enforce the required Skill script isolation policy");
    const attachment = await this.#transport.attach(name, maximumBytes);
    let bytes = 0;
    const stdout: Buffer[] = [];
    let stderrBytes = 0;
    let fail!: (error: Error) => void;
    const stopped = new Promise<never>((_resolve, reject) => { fail = reject; });
    void stopped.catch(() => undefined);
    const collect = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maximumBytes) { fail(new RunnerFailure("protocol_failed", "The isolated runner exceeded its output protocol limit")); return; }
      stdout.push(chunk);
    };
    attachment.stdout.on("data", collect);
    attachment.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 16 * 1024) fail(new RunnerFailure("protocol_failed", "The isolated runner exceeded its diagnostic limit"));
    });
    const aborted = () => fail(new RunnerFailure("cancelled", "Skill script execution was cancelled"));
    signal?.addEventListener("abort", aborted, { once: true });
    const timer = setTimeout(() => fail(new RunnerFailure("timeout", "Skill script execution exceeded its deadline")), timeoutMs);
    try {
      this.#checkCancelled(signal);
      await Promise.race([this.#transport.start(name), stopped]);
      onStarted?.();
      await Promise.race([new Promise<void>((resolve, reject) => {
        attachment.input.write(JSON.stringify(payload) + "\n", (error?: Error | null) => error ? reject(error) : resolve());
      }), stopped]);
      const [status] = await Promise.race([Promise.all([this.#transport.wait(name, timeoutMs + 1000), attachment.closed]), stopped]);
      const finished = await this.#transport.inspectContainer(name);
      if (!finished || skillScriptIsolationIssues(finished, config, imageId).length || finished.State.Running) throw new RunnerFailure("isolation_mismatch", "The daemon did not verify the completed isolated execution");
      return { text: Buffer.concat(stdout).toString("utf8"), status, inspected: finished };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      attachment.close();
    }
  }

  #parseProtocol(text: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!record(parsed)) throw new Error("shape");
      return parsed;
    } catch { throw new RunnerFailure("protocol_failed", "The isolated runner returned an invalid result protocol"); }
  }

  #scriptResult(value: Record<string, unknown>): SkillScriptResult {
    if (value.schema !== "agentic-skill-run-result/v1" || typeof value.stdout !== "string" || typeof value.stderr !== "string" || !Number.isSafeInteger(value.exitCode) || (value.exitCode as number) < -1 || (value.exitCode as number) > 255 || !Array.isArray(value.artifacts)
      || Buffer.byteLength(value.stdout) + Buffer.byteLength(value.stderr) > this.#limits.outputBytes || value.artifacts.length > this.#limits.artifactCount) throw new RunnerFailure("protocol_failed", "The isolated runner returned an invalid or oversized script result");
    const artifacts: SkillScriptArtifact[] = [];
    const paths = new SkillPathIndex();
    let total = 0;
    for (const artifact of value.artifacts) {
      if (!record(artifact) || typeof artifact.path !== "string" || typeof artifact.content !== "string") throw new RunnerFailure("protocol_failed", "The isolated runner returned an invalid artifact");
      try { paths.add(artifact.path); } catch { throw new RunnerFailure("protocol_failed", "The isolated runner returned an unsafe or conflicting artifact path"); }
      if (artifact.path.split("/").length > this.#limits.artifactDepth || artifact.content.length > 4 * Math.ceil(this.#limits.artifactFileBytes / 3)) throw new RunnerFailure("artifact_limit", "Script artifacts exceed their portable path or size limits");
      const content = Buffer.from(artifact.content, "base64");
      total += content.length;
      if (content.toString("base64") !== artifact.content || content.length > this.#limits.artifactFileBytes || total > this.#limits.artifactBytes) throw new RunnerFailure("artifact_limit", "Script artifacts exceed their encoding or size limits");
      artifacts.push({ path: artifact.path, content: artifact.content, encoding: "base64", bytes: content.length, contentDigest: digest(content) });
    }
    const failure = value.failure;
    if (failure !== undefined && (typeof failure !== "string" || !["timeout", "output_limit", "artifact_limit", "script_failed"].includes(failure))) throw new RunnerFailure("protocol_failed", "The isolated runner returned an unknown script outcome");
    const ok = value.exitCode === 0 && failure === undefined;
    return { ok, ...(ok ? {} : { failure: (failure ?? "script_failed") as SkillScriptFailure, error: "The Skill script did not complete successfully" }), stdout: value.stdout, stderr: value.stderr, exitCode: value.exitCode as number, artifacts };
  }

  #failure(failure: SkillScriptFailure, error: string): SkillScriptResult {
    return { ok: false, failure, error: error.slice(0, 1000), stdout: "", stderr: "", exitCode: null, artifacts: [] };
  }
}
