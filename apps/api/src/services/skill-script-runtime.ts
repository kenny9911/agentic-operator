import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { artifacts, getDb, runs, runSkillSnapshots, skillScriptReservations, tenants, type DB } from "@agentic/db";
import { createFilesystemArtifactSink, type RunSkillScope } from "@agentic/runtime";
import { DockerSocketSkillScriptTransport, SkillScriptRunner, type SkillScriptDockerTransport, type SkillScriptLimits } from "@agentic/skill-runner";
import type { SkillCatalogEntry, SkillSessionScriptExecution } from "@agentic/skills";

const image = z.string().regex(/^(?:[a-z0-9][a-z0-9._/:-]*@)?sha256:[a-f0-9]{64}$/);
export const SkillScriptHostPolicySchema = z.object({
  image,
  approvedImages: z.array(image).min(1).max(20),
  tenantSlugs: z.array(z.string().min(1).max(240)).min(1).max(1000),
  interpreters: z.array(z.enum(["node", "python"])).min(1).max(2),
}).strict().refine((policy) => policy.approvedImages.includes(policy.image), "The configured image must be independently approved");
export type SkillScriptHostPolicy = z.infer<typeof SkillScriptHostPolicySchema>;

const PER_CALL: Partial<SkillScriptLimits> = Object.freeze({ timeoutMs: 30_000, outputBytes: 64 * 1024, artifactBytes: 1024 * 1024, artifactFileBytes: 1024 * 1024 });
const BUDGETS = Object.freeze({ calls: 4, timeoutMs: 120_000, inputBytes: 1024 * 1024, outputBytes: 8 * 1024 * 1024 });
const RESERVATION = Object.freeze({ timeoutMs: 30_000, outputBytes: 1088 * 1024 });

/** Explicit operator policy; missing configuration disables execution. Nothing
 * in a Skill, manifest tool config or model argument can create this grant. */
export function skillScriptPolicyFromEnvironment(env: NodeJS.ProcessEnv = process.env): SkillScriptHostPolicy | undefined {
  const raw = env.AGENTIC_SKILL_SCRIPT_POLICY?.trim();
  if (!raw) return undefined;
  if (Buffer.byteLength(raw) > 128 * 1024) throw new Error("Skill script host policy exceeds its size limit");
  return SkillScriptHostPolicySchema.parse(JSON.parse(raw));
}

export function createSkillScriptExecutionFactory(options: {
  policy?: SkillScriptHostPolicy;
  db?: DB;
  transport?: SkillScriptDockerTransport;
  socketPath?: string;
} = {}) {
  const policy = options.policy ? SkillScriptHostPolicySchema.parse(options.policy) : undefined;
  const db = options.db ?? getDb();
  const transport = policy ? options.transport ?? new DockerSocketSkillScriptTransport({ socketPath: options.socketPath ?? "/var/run/docker.sock" }) : undefined;
  return (scope: RunSkillScope, authorizeSource: (entry: SkillCatalogEntry) => boolean): SkillSessionScriptExecution | undefined => {
    if (!policy || !transport) return undefined;
    const tenant = db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, scope.tenantId)).get();
    if (!tenant || !policy.tenantSlugs.includes(tenant.slug)) return undefined;
    // Immutable, tenant-scoped host lineage; caller/model inputs never select
    // the budget root. Every durable descendant spends the same ceiling.
    const snapshot = db.select().from(runSkillSnapshots).where(and(eq(runSkillSnapshots.tenantId, scope.tenantId), eq(runSkillSnapshots.executionId, scope.executionId), eq(runSkillSnapshots.agentId, scope.agentId), eq(runSkillSnapshots.kind, "run"))).get();
    if (!snapshot?.rootSnapshotId) throw new Error("Skill script execution requires a durable run snapshot");
    const root = db.select({ id: runSkillSnapshots.id }).from(runSkillSnapshots).where(and(eq(runSkillSnapshots.id, snapshot.rootSnapshotId), eq(runSkillSnapshots.tenantId, scope.tenantId), eq(runSkillSnapshots.kind, "root"))).get();
    if (!root) throw new Error("Skill script budget lineage is unavailable");
    const authorizedRun = () => {
      const row = db.select({ status: runs.status }).from(runs).where(and(eq(runs.id, scope.executionId), eq(runs.tenantId, scope.tenantId), eq(runs.agentId, scope.agentId))).get();
      return row?.status === "running";
    };
    const policyDigest = createHash("sha256").update(JSON.stringify({ policy, budgets: BUDGETS, reservation: RESERVATION, perCall: PER_CALL })).digest("hex");
    return {
      policyDigest,
      limits: BUDGETS,
      reservation: RESERVATION,
      async execute(request) {
        if (!authorizedRun() || !authorizeSource(request.skill) || !policy.interpreters.includes(request.input.interpreter)) throw new Error("Skill script execution is not authorized");
        const executionId = `script-${randomUUID()}`;
        const inputJson = JSON.stringify(request.input);
        const inputBytes = Buffer.byteLength(inputJson, "utf8");
        db.transaction(() => {
          const previous = db.select({ calls: sql<number>`count(*)`, timeoutMs: sql<number>`coalesce(sum(${skillScriptReservations.timeoutMs}),0)`, inputBytes: sql<number>`coalesce(sum(${skillScriptReservations.inputBytes}),0)`, outputBytes: sql<number>`coalesce(sum(${skillScriptReservations.outputBytes}),0)` }).from(skillScriptReservations).where(and(eq(skillScriptReservations.tenantId, scope.tenantId), eq(skillScriptReservations.rootSnapshotId, root.id))).get()!;
          if (previous.calls + 1 > BUDGETS.calls || previous.timeoutMs + RESERVATION.timeoutMs > BUDGETS.timeoutMs || previous.inputBytes + inputBytes > BUDGETS.inputBytes || previous.outputBytes + RESERVATION.outputBytes > BUDGETS.outputBytes) throw new Error("Durable Skill script run budget exhausted");
          db.insert(skillScriptReservations).values({ id: executionId, tenantId: scope.tenantId, runId: scope.executionId, rootSnapshotId: root.id, agentId: scope.agentId, skillId: request.skill.id, versionId: request.skill.versionId, contentDigest: request.skill.contentDigest, policyDigest, scriptPath: request.input.scriptPath, interpreter: request.input.interpreter, inputDigest: createHash("sha256").update(inputJson).digest("hex"), inputBytes, timeoutMs: RESERVATION.timeoutMs, outputBytes: RESERVATION.outputBytes }).run();
        });
        const controller = new AbortController();
        const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
        const timer = setInterval(() => { if (!authorizedRun()) controller.abort(); }, 250);
        timer.unref();
        const runner = new SkillScriptRunner({
          image: policy.image, approvedImages: policy.approvedImages, interpreters: policy.interpreters, transport, limits: PER_CALL,
          authorize: (authorization) => authorizedRun() && authorizeSource(request.skill) && authorization.identity.tenantId === scope.tenantId && authorization.identity.agentId === scope.agentId && authorization.identity.runId === scope.executionId && authorization.skill.id === request.skill.id && authorization.skill.versionId === request.skill.versionId && authorization.skill.contentDigest === request.skill.contentDigest && authorization.scriptPath === request.input.scriptPath && authorization.interpreter === request.input.interpreter,
        });
        try {
          const result = await runner.run({ identity: { tenantId: scope.tenantId, agentId: scope.agentId, runId: scope.executionId }, skill: request.skill, bundle: request.bundle, scriptPath: request.input.scriptPath, interpreter: request.input.interpreter, args: request.input.args, stdin: request.input.stdin, signal });
          const sink = createFilesystemArtifactSink(scope.executionId);
          const persist = async (logicalName: string, payload: unknown, contentType: string, metadata: Record<string, unknown>) => {
            const receipt = await sink.persist({ role: "trace", logicalName, payload, contentType, metadata });
            const id = `art-${randomUUID()}`;
            db.insert(artifacts).values({ id, tenantId: scope.tenantId, runId: scope.executionId, kind: "skill_script", role: "trace", logicalName, contentType, path: receipt.path!, size: receipt.size, sha256: receipt.sha256, metadataJson: metadata }).run();
            return { id, logicalName, bytes: receipt.size, contentDigest: receipt.sha256 };
          };
          const outputArtifacts = [];
          for (const [index, artifact] of result.artifacts.entries()) {
            const metadata = { source: "skill_script", executionId, skillId: request.skill.id, versionId: request.skill.versionId, originalPath: artifact.path };
            outputArtifacts.push(await persist(`${executionId}-${index}-${basename(artifact.path)}`, Buffer.from(artifact.content, "base64"), "application/octet-stream", metadata));
          }
          const { artifacts: _bodies, ...bounded } = result;
          const evidence = await persist(`${executionId}-execution.json`, { ...bounded, artifacts: outputArtifacts }, "application/json", { source: "skill_script", executionId, skillId: request.skill.id, versionId: request.skill.versionId });
          return { ...bounded, artifacts: outputArtifacts, executionArtifact: evidence };
        } finally {
          clearInterval(timer);
        }
      },
    };
  };
}
