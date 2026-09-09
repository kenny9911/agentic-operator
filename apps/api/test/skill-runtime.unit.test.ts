import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, getDb, getRawSqlite, managedSkills, runSkillSnapshots, skillVersions } from "@agentic/db";
import { eq } from "drizzle-orm";
import { skillBundleDigest, loadSkillsFromDirectory, type SkillDescriptor } from "@agentic/skills";
import type { SkillBundle } from "@agentic/contracts";
import { ManagedSkillRuntime } from "../src/services/skill-runtime";

let host: ManagedSkillRuntime;
let legacy: SkillDescriptor[];
let temp: string;
const input = { tenantId: "a", tenantSlug: "alpha", executionId: "r1", agentId: "agt-a", agentName: "alpha-agent" };
function bundle(name: string, body = "Original instructions."): SkillBundle { return { files: [{ path: "SKILL.md", encoding: "utf8", content: `---\nname: ${name}\ndescription: Use ${name} to check documents.\n---\n${body}\n` }, { path: "assets/data.bin", encoding: "base64", content: "/wAB" }] }; }
function publish(id: string, owner = "a", name = id, version = `${id}-v1`, body?: string, shared = false) {
  const b = bundle(name, body);
  const db = getDb();
  db.insert(managedSkills).values({ id, tenantId: owner, name, description: `Use ${name} to check documents.`, visibility: shared ? "shared" : "tenant" }).onConflictDoNothing().run();
  db.insert(skillVersions).values({ id: version, skillId: id, tenantId: owner, versionNo: version.endsWith("v2") ? 2 : 1, draftRevision: 1, name, description: `Use ${name} to check documents.`, contentDigest: skillBundleDigest(b), bundleJson: b }).run();
  db.update(managedSkills).set({ latestVersionId: version }).where(eq(managedSkills.id, id)).run();
  return version;
}
function run(id: string, tenant = "a", agent = "agt-a", parent: string | null = null) { getRawSqlite().prepare("INSERT INTO runs(id,tenant_id,agent_id,parent_run_id) VALUES (?,?,?,?)").run(id, tenant, agent, parent); }
async function names(ref = host.capture(input), scope = input) { return (await (await host.restore(ref, scope)).snapshot()).catalog.map((s) => s.name); }
beforeEach(() => {
  closeDb();
  vi.stubEnv("DATABASE_URL", ":memory:"); vi.stubEnv("AGENTIC_SQLITE_TEST_WRITER", "1"); vi.stubEnv("AGENTIC_DATABASE_READONLY", "0");
  for (const key of ["AGENTIC_SQLITE_WRITER_LEASE_TOKEN", "AGENTIC_SQLITE_WRITER_LEASE_PATH", "AGENTIC_SQLITE_WRITER_SUPERVISOR_PID"]) vi.stubEnv(key, "");
  getDb();
  getRawSqlite().exec(`CREATE TABLE tenants (id TEXT PRIMARY KEY,slug TEXT NOT NULL); INSERT INTO tenants VALUES ('a','alpha'),('b','beta'),('sys','__system'); CREATE TABLE runs (id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,agent_id TEXT NOT NULL,parent_run_id TEXT); CREATE TABLE steps(id TEXT PRIMARY KEY,run_id TEXT NOT NULL); CREATE TABLE event_store(id TEXT PRIMARY KEY,tenant_id TEXT,name TEXT,source_run_id TEXT);`);
  for (const migration of ["0080_managed_skills", "0081_run_skill_snapshots", "0083_managed_skill_enabled"]) getRawSqlite().exec(readFileSync(new URL(`../../../packages/db/drizzle/${migration}.sql`, import.meta.url), "utf8"));
  legacy = []; temp = mkdtempSync(join(tmpdir(), "skill-runtime-"));
  host = new ManagedSkillRuntime({ db: getDb(), legacySkills: () => legacy });
  run("r1");
});
afterEach(() => { closeDb(); vi.unstubAllEnvs(); rmSync(temp, { recursive: true, force: true }); });

describe("durable tenant Skill runtime", () => {
  it("excludes disabled tenant and shared skills from new catalogs and rejects explicit pins", async () => {
    publish("enabled"); publish("disabled"); publish("shared", "sys", "shared", undefined, undefined, true);
    for (const id of ["disabled", "shared"]) getDb().update(managedSkills).set({ enabled: false }).where(eq(managedSkills.id, id)).run();
    expect(await names()).toEqual(["enabled"]);
    run("pinned");
    expect(() => host.capture({ ...input, executionId: "pinned", agentSkills: { mode: "selected", skills: [{ id: "disabled", versionId: "disabled-v1", activate: true }] } })).toThrow(/ceiling/);
    const session = await host.restore(host.capture(input), input);
    expect((await session.list({ origin: "explicit" })).skills.map((s) => s.id)).toEqual(["enabled"]);
    await expect(session.activate("disabled", { origin: "explicit" })).rejects.toThrow();
  });
  it("revokes existing sessions, cached resources, explicit restore and native export on disable", async () => {
    publish("shared", "sys", "shared", undefined, undefined, true);
    const ref = host.capture({ ...input, agentSkills: { mode: "selected", skills: [{ id: "shared", activate: true }] } });
    const session = await host.restore(ref, input);
    await session.readResource("shared", "assets/data.bin");
    expect((await host.materializationSources(ref, input)).sources).toHaveLength(1);
    getDb().update(managedSkills).set({ enabled: false }).where(eq(managedSkills.id, "shared")).run();
    expect((await session.list()).skills).toEqual([]);
    expect((await session.list({ origin: "explicit" })).skills).toEqual([]);
    await expect(session.activate("shared", { origin: "model" })).rejects.toThrow(/access|authorized/i);
    await expect(session.activate("shared", { origin: "explicit" })).rejects.toThrow(/access|authorized/i);
    await expect(session.listResources("shared")).rejects.toThrow(/access|authorized/i);
    await expect(session.readResource("shared", "assets/data.bin")).rejects.toThrow(/access|authorized/i);
    await expect(session.renderActiveInstructions()).rejects.toThrow(/access|authorized/i);
    await expect(host.restore(ref, input)).rejects.toThrow(/access|authorized/i);
    await expect(host.materializationSources(ref, input)).rejects.toThrow(/authorized/);
    run("child", "a", "agt-a", "r1");
    expect(() => host.capture({ ...input, executionId: "child" })).toThrow(/authorized/);
    getDb().update(managedSkills).set({ enabled: true }).where(eq(managedSkills.id, "shared")).run();
    expect((await session.list()).skills.map((s) => s.id)).toEqual(["shared"]);
    expect((await session.readResource("shared", "assets/data.bin")).content).toBe("/wAB");
    expect((await host.materializationSources(ref, input)).sources[0]?.entry.versionId).toBe("shared-v1");
  });
  it("unpublished drafts do not exhaust the published runtime catalog limit", async () => {
    const sqlite = getRawSqlite();
    const insert = sqlite.prepare("INSERT INTO managed_skills(id,tenant_id,name,description,visibility) VALUES (?, 'a', ?, 'Incomplete draft', 'tenant')");
    sqlite.transaction(() => { for (let index = 0; index < 1001; index++) insert.run(`draft-${index}`, `draft-${index}`); })();
    publish("published-only");
    expect(await names()).toEqual(["published-only"]);
  });
  it("publishes tenant/shared catalogs automatically and rejects non-system shared owners", async () => {
    publish("owned"); publish("foreign", "b"); publish("shared", "sys", "shared", undefined, undefined, true); publish("spoofed", "b", "spoofed", undefined, undefined, true);
    expect(await names()).toEqual(["owned", "shared"]);
  });
  it("tenant names shadow shared names; explicit selection remains exact", async () => {
    publish("own", "a", "common"); publish("shared", "sys", "common", undefined, undefined, true);
    const first = await host.restore(host.capture(input), input);
    expect((await first.snapshot()).catalog[0]?.id).toBe("own");
    run("r2"); const scope = { ...input, executionId: "r2" };
    expect((await (await host.restore(host.capture({ ...scope, agentSkills: { mode: "selected", skills: [{ id: "shared" }] } }), scope)).snapshot()).catalog[0]?.id).toBe("shared");
  });
  it("captures only once and keeps exact versions across a mid-run publication and process reconstruction", async () => {
    publish("policy"); const ref = host.capture(input);
    publish("policy", "a", "policy", "policy-v2", "Changed instructions.");
    expect(host.capture({ ...input, agentSkills: { mode: "disabled" } })).toEqual(ref);
    host = new ManagedSkillRuntime({ db: getDb() });
    const session = await host.restore(ref, input); await session.activate("policy", { origin: "model" });
    expect((await session.activeInstructions())[0]?.body).toContain("Original");
    expect(getDb().select().from(runSkillSnapshots).all()).toHaveLength(2);
    run("r2"); const next = { ...input, executionId: "r2" }; const fresh = await host.restore(host.capture(next), next); await fresh.activate("policy", { origin: "model" }); expect((await fresh.activeInstructions())[0]?.body).toContain("Changed");
  });
  it("honors workflow pins, explicit activation, agent narrowing, and dormant selections", async () => {
    publish("policy"); publish("policy", "a", "policy", "policy-v2"); publish("other");
    const ref = host.capture({ ...input, workflowSkills: { mode: "selected", skills: [{ id: "policy", versionId: "policy-v1", activate: true }] }, agentSkills: { mode: "selected", skills: [{ id: "policy" }] } });
    const snapshot = await (await host.restore(ref, input)).snapshot(); expect(snapshot.catalog.map((s) => s.versionId)).toEqual(["policy-v1"]); expect(snapshot.activations[0]?.origin).toBe("explicit");
    run("r2"); expect(() => host.capture({ ...input, executionId: "r2", workflowSkills: { mode: "selected", skills: [{ id: "policy", versionId: "policy-v1" }] }, agentSkills: { mode: "selected", skills: [{ id: "policy", versionId: "policy-v2" }] } })).toThrow(/ceiling/);
    run("r3"); expect(await names(host.capture({ ...input, executionId: "r3", agentSkills: { mode: "disabled", skills: [{ id: "policy" }] } }), { ...input, executionId: "r3" })).toEqual([]);
  });
  it("archive blocks new runs and new pins while old snapshots retain exact bytes", async () => {
    publish("policy"); const ref = host.capture(input); getDb().update(managedSkills).set({ archivedAt: new Date() }).where(eq(managedSkills.id, "policy")).run();
    expect(await names(ref)).toEqual(["policy"]); run("r2"); expect(await names(host.capture({ ...input, executionId: "r2" }), { ...input, executionId: "r2" })).toEqual([]);
    run("r3"); expect(() => host.capture({ ...input, executionId: "r3", agentSkills: { mode: "selected", skills: [{ id: "policy", versionId: "policy-v1" }] } })).toThrow(/ceiling/);
  });
  it("snapshots legacy binary resources once and never reads mutable paths on restore", async () => {
    const directory = join(temp, "legacy-skill"); mkdirSync(join(directory, "assets"), { recursive: true });
    writeFileSync(join(directory, "SKILL.md"), bundle("legacy-skill").files[0]!.content); writeFileSync(join(directory, "assets/data.bin"), Buffer.from([255, 0, 1]));
    legacy = loadSkillsFromDirectory(temp); const ref = host.capture(input); rmSync(directory, { recursive: true });
    const session = await host.restore(ref, input); await session.activate("legacy-skill", { origin: "model" }); const resource = await session.readResource("legacy-skill", "assets/data.bin"); expect(resource.encoding).toBe("base64"); expect(resource.content).toBe("/wAB");
  });
  it("rejects cross-tenant, cross-agent and forged snapshot identifiers", async () => {
    publish("policy"); const ref = host.capture(input);
    await expect(host.restore(ref, { ...input, tenantId: "b" })).rejects.toThrow(/tenant/);
    await expect(host.restore(ref, { ...input, agentId: "another" })).rejects.toThrow(/scope/);
    await expect(host.restore({ ...ref, contentDigest: "0".repeat(64) }, input)).rejects.toThrow(/tenant/);
    expect(() => host.capture({ ...input, executionId: "missing" })).toThrow(/durable run/);
  });
  it("rechecks shared authorization for every access without granting foreign tenant data", async () => {
    publish("shared", "sys", "shared", undefined, undefined, true); const session = await host.restore(host.capture(input), input); await session.activate("shared", { origin: "model" });
    getDb().update(managedSkills).set({ visibility: "tenant" }).where(eq(managedSkills.id, "shared")).run();
    expect((await session.list()).skills).toEqual([]); await expect(session.readResource("shared", "assets/data.bin")).rejects.toThrow();
  });
  it("derives event lineage from broker identity and durable tenant ledger, ignoring forged logical metadata", async () => {
    publish("policy"); publish("other"); host.capture({ ...input, agentSkills: { mode: "selected", skills: [{ id: "policy" }] } });
    getRawSqlite().exec("INSERT INTO event_store VALUES ('delivered','a','next','r1')"); run("child");
    const child = { ...input, executionId: "child", delivery: { eventId: "delivered", eventName: "alpha/next" } }; expect(await names(host.capture(child), child)).toEqual(["policy"]);
    run("spoof"); const spoof = { ...input, executionId: "spoof", __parentSnapshotId: "r1", source_run: "r1", __triggerEventId: "delivered", delivery: { eventId: "new-api-event", eventName: "alpha/next" } }; expect(await names(host.capture(spoof), spoof)).toEqual(["other", "policy"]);
    run("bad-name"); expect(() => host.capture({ ...input, executionId: "bad-name", delivery: { eventId: "delivered", eventName: "alpha/wrong" } })).toThrow(/name mismatch/);
  });
  it("internal invoke receipts bind exact parent catalog, tenant, durable step and recipient", async () => {
    publish("policy"); publish("other"); host.capture({ ...input, agentSkills: { mode: "selected", skills: [{ id: "policy" }] } }); getRawSqlite().exec("INSERT INTO steps VALUES('stp1','r1')");
    const grant = host.issueInvocation({ ...input, stepId: "stp1", recipient: "child-agent" }); expect(host.issueInvocation({ ...input, stepId: "stp1", recipient: "child-agent" })).toBe(grant);
    run("child"); const child = { ...input, executionId: "child", agentName: "child-agent", invocationGrant: grant }; expect(await names(host.capture(child), child)).toEqual(["policy"]);
    run("bad"); expect(() => host.capture({ ...input, executionId: "bad", invocationGrant: grant })).toThrow(/receipt/);
    expect(() => host.issueInvocation({ ...input, stepId: "not-a-step", recipient: "child-agent" })).toThrow(/durable/);
  });
  it("children cannot add skills or retarget versions after parent capture", async () => {
    publish("policy"); publish("other"); host.capture({ ...input, agentSkills: { mode: "selected", skills: [{ id: "policy" }] } }); publish("policy", "a", "policy", "policy-v2");
    run("child", "a", "agt-a", "r1"); const child = { ...input, executionId: "child" }; expect(() => host.capture({ ...child, agentSkills: { mode: "selected", skills: [{ id: "other" }] } })).toThrow(/ceiling/); expect(() => host.capture({ ...child, agentSkills: { mode: "selected", skills: [{ id: "policy", versionId: "policy-v2" }] } })).toThrow(/ceiling/);
    expect((await (await host.restore(host.capture(child), child)).snapshot()).catalog[0]?.versionId).toBe("policy-v1");
  });
  it("retains immutable snapshots and legacy blobs and rolls back failed captures atomically", () => {
    publish("policy"); expect(() => host.capture({ ...input, agentSkills: { mode: "selected", skills: [{ id: "missing" }] } })).toThrow(); expect(getDb().select().from(runSkillSnapshots).all()).toEqual([]);
    host.capture(input); expect(() => getRawSqlite().exec("UPDATE run_skill_snapshots SET catalog_json='[]'")).toThrow(/immutable/); expect(() => getRawSqlite().exec("DELETE FROM run_skill_snapshots")).toThrow(/retained/);
  });
  it("intersects the recipient workflow ceiling with a narrower parent selection", async () => {
    publish("policy"); publish("other");
    const workflowSkills = { mode: "selected" as const, skills: [{ id: "policy" }, { id: "other" }] };
    host.capture({ ...input, workflowSkills, agentSkills: { mode: "selected", skills: [{ id: "policy" }] } });
    run("child", "a", "agt-a", "r1"); const child = { ...input, executionId: "child", workflowSkills };
    expect(await names(host.capture(child), child)).toEqual(["policy"]);
  });
  it("preserves model-disabled publication policy while explicit host activation remains available", async () => {
    const b = bundle("explicit-only"); b.files[0]!.content = b.files[0]!.content.replace("---\nOriginal", "disable-model-invocation: true\n---\nOriginal");
    getDb().insert(managedSkills).values({ id: "explicit", tenantId: "a", name: "explicit-only", description: "Use explicit-only to check documents." }).run();
    getDb().insert(skillVersions).values({ id: "explicit-v1", skillId: "explicit", tenantId: "a", versionNo: 1, draftRevision: 1, name: "explicit-only", description: "Use explicit-only to check documents.", contentDigest: skillBundleDigest(b), bundleJson: b }).run();
    getDb().update(managedSkills).set({ latestVersionId: "explicit-v1" }).where(eq(managedSkills.id, "explicit")).run();
    const session = await host.restore(host.capture(input), input); expect((await session.list()).skills).toEqual([]);
    await expect(session.activate("explicit-only", { origin: "model" })).rejects.toThrow();
    await session.activate("explicit-only", { origin: "explicit" }); expect((await session.activeInstructions())[0]?.origin).toBe("explicit");
    expect((await session.listResources("explicit-only")).resources).toHaveLength(2);
    expect(await session.readResource("explicit-only", "assets/data.bin")).toMatchObject({ encoding: "base64", content: "/wAB" });
  });
  it("prepares native exact bundles without activation and rejects cross-scope materialization", async () => {
    publish("policy"); const ref = host.capture({ ...input, agentSkills: { mode: "selected", skills: [{ id: "policy", activate: true }] } });
    publish("policy", "a", "policy", "policy-v2", "New instructions");
    const result = await host.materializationSources(ref, input);
    expect(result.activationIds).toEqual(["policy"]); expect(result.sources[0]?.entry.versionId).toBe("policy-v1");
    expect(result.sources[0]?.bundle.files[0]?.content).toContain("Original"); expect(Object.isFrozen(result.sources[0]?.bundle.files)).toBe(true);
    await expect(host.materializationSources(ref, { ...input, tenantId: "b" })).rejects.toThrow(/tenant/);
  });
});
