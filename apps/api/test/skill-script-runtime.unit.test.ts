import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, getDb, getRawSqlite, artifacts, managedSkills, skillVersions, skillScriptReservations } from "@agentic/db";
import { eq } from "drizzle-orm";
import { SkillSession, skillBundleDigest } from "@agentic/skills";
import type { SkillBundle, SkillScriptInput } from "@agentic/contracts";
import type { SkillScriptDockerTransport } from "@agentic/skill-runner";
import { ManagedSkillRuntime } from "../src/services/skill-runtime";
import { createSkillScriptExecutionFactory, skillScriptPolicyFromEnvironment, SkillScriptHostPolicySchema } from "../src/services/skill-script-runtime";

const digest = `sha256:${"a".repeat(64)}`;
const policy = { image: digest, approvedImages: [digest], tenantSlugs: ["alpha"], interpreters: ["node" as const] };
const scope = { tenantId: "a", executionId: "r1", agentId: "agt-a", tenantSlug: "alpha", agentName: "agent-a" };
const bundle: SkillBundle = { files: [
  { path: "SKILL.md", encoding: "utf8", content: "---\nname: verify\ndescription: Run the included verification script.\n---\nUse scripts/main.js.\n" },
  { path: "scripts/main.js", encoding: "utf8", content: "require('node:fs').writeFileSync(process.env.OUTPUT_DIR+'/result.bin',Buffer.from([0,255,1])); process.stdout.write('done');" },
] };
const entry = { id: "verify", versionId: "v1", name: "verify", description: "Run the included verification script.", contentDigest: skillBundleDigest(bundle) };
const input: SkillScriptInput = { id: entry.id, scriptPath: "scripts/main.js", interpreter: "node" };
let temp: string;
let runtime: ManagedSkillRuntime;
function run(id: string, parent: string | null = null, tenant = "a") {
  getRawSqlite().prepare("INSERT INTO runs(id,tenant_id,agent_id,parent_run_id,status) VALUES(?,?,'agt-a',?,'running')").run(id, tenant, parent);
  const next = { ...scope, executionId: id, tenantId: tenant, tenantSlug: tenant === "a" ? "alpha" : "beta" };
  runtime.capture(next);
  return next;
}
function absentTransport() {
  return { inspectImage: vi.fn(async () => null) } as unknown as SkillScriptDockerTransport;
}
beforeEach(() => {
  closeDb(); vi.stubEnv("DATABASE_URL", ":memory:"); vi.stubEnv("AGENTIC_SQLITE_TEST_WRITER", "1"); vi.stubEnv("AGENTIC_DATABASE_READONLY", "0");
  for (const key of ["AGENTIC_SQLITE_WRITER_LEASE_TOKEN", "AGENTIC_SQLITE_WRITER_LEASE_PATH", "AGENTIC_SQLITE_WRITER_SUPERVISOR_PID"]) vi.stubEnv(key, "");
  getDb();
  getRawSqlite().exec("CREATE TABLE tenants(id TEXT PRIMARY KEY,slug TEXT); INSERT INTO tenants VALUES('a','alpha'),('b','beta'),('sys','__system'); CREATE TABLE runs(id TEXT PRIMARY KEY,tenant_id TEXT,agent_id TEXT,parent_run_id TEXT,status TEXT); CREATE TABLE steps(id TEXT PRIMARY KEY,run_id TEXT); CREATE TABLE event_store(id TEXT PRIMARY KEY,tenant_id TEXT,name TEXT,source_run_id TEXT); CREATE TABLE artifacts(id TEXT PRIMARY KEY,tenant_id TEXT,run_id TEXT,step_id TEXT,kind TEXT,role TEXT,logical_name TEXT,content_type TEXT,path TEXT,size INTEGER,sha256 TEXT,metadata_json TEXT,schema_id TEXT,redacted INTEGER DEFAULT 0,retention_until INTEGER,created_at INTEGER DEFAULT 0);");
  for (const name of ["0080_managed_skills", "0081_run_skill_snapshots", "0082_skill_script_reservations", "0083_managed_skill_enabled"]) getRawSqlite().exec(readFileSync(new URL(`../../../packages/db/drizzle/${name}.sql`, import.meta.url), "utf8"));
  runtime = new ManagedSkillRuntime({ db: getDb() });
  temp = mkdtempSync(join(tmpdir(), "skill-script-host-")); vi.stubEnv("AGENTIC_ARTIFACTS_DIR", temp);
  run("r1");
});
afterEach(() => { closeDb(); vi.unstubAllEnvs(); rmSync(temp, { recursive: true, force: true }); });

describe("Skill script production host policy and durable reservations", () => {
  it("does not execute a previously activated managed skill after it is disabled", async () => {
    const db = getDb();
    db.insert(managedSkills).values({ id: entry.id, tenantId: "a", name: entry.name, description: entry.description }).run();
    db.insert(skillVersions).values({ id: entry.versionId, skillId: entry.id, tenantId: "a", versionNo: 1, draftRevision: 1, name: entry.name, description: entry.description, contentDigest: entry.contentDigest, bundleJson: bundle }).run();
    db.update(managedSkills).set({ latestVersionId: entry.versionId }).where(eq(managedSkills.id, entry.id)).run();
    const transport = absentTransport();
    runtime = new ManagedSkillRuntime({ db, scriptExecution: createSkillScriptExecutionFactory({ db, policy, transport }) });
    const next = run("with-skill");
    const session = await runtime.restore(runtime.capture(next), next);
    await session.activate(entry.name, { origin: "model" });
    db.update(managedSkills).set({ enabled: false }).where(eq(managedSkills.id, entry.id)).run();
    await expect(session.runScript(input)).rejects.toThrow(/access|authorized/i);
    expect(transport.inspectImage).not.toHaveBeenCalled();
    expect(db.select().from(skillScriptReservations).all()).toEqual([]);
  });
  it("defaults disabled and admits only configured tenants, images, interpreters, current sources and durable runs", async () => {
    expect(skillScriptPolicyFromEnvironment({})).toBeUndefined();
    expect(createSkillScriptExecutionFactory()(scope, () => true)).toBeUndefined();
    expect(() => SkillScriptHostPolicySchema.parse({ ...policy, approvedImages: [`sha256:${"b".repeat(64)}`] })).toThrow();
    const factory = createSkillScriptExecutionFactory({ policy, transport: absentTransport() });
    expect(factory(run("foreign", null, "b"), () => true)).toBeUndefined();
    expect(() => factory({ ...scope, executionId: "forged" }, () => true)).toThrow(/snapshot/);
    await expect(factory(scope, () => false)!.execute({ skill: entry, bundle, input })).rejects.toThrow(/authorized/);
    await expect(factory(scope, () => true)!.execute({ skill: entry, bundle, input: { ...input, interpreter: "python" } })).rejects.toThrow(/authorized/);
    expect(getDb().select().from(skillScriptReservations).all()).toEqual([]);
  });
  it("reserves before external IO and retains failed attempts across restart and durable descendants", async () => {
    const transport = absentTransport();
    vi.mocked(transport.inspectImage).mockImplementation(async () => { expect(getDb().select().from(skillScriptReservations).all().length).toBeGreaterThan(0); return null; });
    const child = run("child", "r1");
    const grandchild = run("grandchild", "child");
    for (const activeScope of [scope, child, grandchild, scope]) {
      // Reconstruct the entire host factory/session as a process retry would.
      const cap = createSkillScriptExecutionFactory({ policy, transport })(activeScope, () => true)!;
      const result = await cap.execute({ skill: entry, bundle, input });
      expect(result).toMatchObject({ ok: false, failure: "executor_unavailable", artifacts: [], executionArtifact: { id: expect.stringContaining("art-") } });
    }
    await expect(createSkillScriptExecutionFactory({ policy, transport })(grandchild, () => true)!.execute({ skill: entry, bundle, input })).rejects.toThrow(/Durable.*budget/);
    expect(transport.inspectImage).toHaveBeenCalledTimes(4);
    const ledger = getDb().select().from(skillScriptReservations).all();
    expect(new Set(ledger.map((r) => r.rootSnapshotId)).size).toBe(1);
    expect(new Set(ledger.map((r) => r.runId)).size).toBe(3);
    expect(() => getRawSqlite().exec("UPDATE skill_script_reservations SET input_bytes=1")).toThrow(/immutable/);
    expect(() => getRawSqlite().exec("DELETE FROM skill_script_reservations")).toThrow(/retained/);
    // A separate root is independently bounded.
    const another = run("another");
    await expect(createSkillScriptExecutionFactory({ policy, transport })(another, () => true)!.execute({ skill: entry, bundle, input })).resolves.toMatchObject({ ok: false });
  });
  it("atomically prevents parallel descendant attempts from oversubscribing the root budget", async () => {
    const scopes = [scope, ...Array.from({ length: 5 }, (_, i) => run(`child-${i}`, "r1"))];
    const transport = absentTransport();
    const results = await Promise.allSettled(scopes.map((s) => createSkillScriptExecutionFactory({ policy, transport })(s, () => true)!.execute({ skill: entry, bundle, input })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(4);
    expect(getDb().select().from(skillScriptReservations).all()).toHaveLength(4);
  });
  it("rejects cancelled or reassigned runs before creating a reservation", async () => {
    const cap = createSkillScriptExecutionFactory({ policy, transport: absentTransport() })(scope, () => true)!;
    getRawSqlite().exec("UPDATE runs SET status='cancelled' WHERE id='r1'");
    await expect(cap.execute({ skill: entry, bundle, input })).rejects.toThrow(/authorized/);
    expect(getDb().select().from(skillScriptReservations).all()).toHaveLength(0);
  });
});

it.skipIf(!process.env.AGENTIC_TEST_SKILL_SCRIPT_IMAGE)("executes an explicitly approved real Docker image through a SkillSession and persists binary artifacts and evidence", async () => {
  const image = process.env.AGENTIC_TEST_SKILL_SCRIPT_IMAGE!;
  const cap = createSkillScriptExecutionFactory({ policy: { ...policy, image, approvedImages: [image] }, socketPath: process.env.AGENTIC_TEST_DOCKER_SOCKET ?? "/var/run/docker.sock" })(scope, () => true)!;
  const session = new SkillSession({ catalog: [entry], readBundle: () => bundle, scriptExecution: cap });
  await session.activate("verify", { origin: "explicit" });
  const result = await session.runScript(input) as { ok: boolean; artifacts: { id: string }[]; evidence: unknown };
  expect(result).toMatchObject({ ok: true, stdout: "done", evidence: { executorStarted: true, isolation: "isolated_container", cleanup: { stagingContainerAbsent: true, executionContainerAbsent: true, volumeAbsent: true } } });
  expect(result.artifacts).toHaveLength(1);
  const persisted = getDb().select().from(artifacts).all();
  expect(persisted).toHaveLength(2);
  expect(readFileSync(persisted.find((a) => a.id === result.artifacts[0]!.id)!.path)).toEqual(Buffer.from([0,255,1]));
  expect((await session.snapshot()).scriptUsage?.calls).toBe(1);
  expect(getDb().select().from(skillScriptReservations).all()).toHaveLength(1);
});
