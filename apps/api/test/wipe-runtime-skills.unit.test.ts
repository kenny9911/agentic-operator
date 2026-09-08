import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { closeDb, getDb, getRawSqlite, wipeRuntime } from "@agentic/db";

const runtimeTables = ["skill_script_reservations", "skill_invocation_grants", "run_skill_snapshots", "skill_legacy_bundles", "runs", "steps"];
function count(table: string) { return (getRawSqlite().prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n; }
function triggers() { return getRawSqlite().prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all(); }
function seedRuntime() {
  getRawSqlite().exec(`
    INSERT INTO runs VALUES('r1','a'); INSERT INTO steps VALUES('st1','r1');
    INSERT INTO run_skill_snapshots(id,tenant_id,execution_id,kind,content_digest,catalog_json,activations_json) VALUES('root','a','r1','root','digest','[]','[]');
    INSERT INTO run_skill_snapshots(id,tenant_id,execution_id,kind,agent_id,root_snapshot_id,content_digest,catalog_json,activations_json) VALUES('snap','a','r1','run','agent','root','digest','[]','[]');
    INSERT INTO skill_legacy_bundles(id,tenant_id,name,description,content_digest,bundle_json) VALUES('legacy','a','legacy','Legacy bytes','digest','{}');
    INSERT INTO skill_invocation_grants(id,tenant_id,parent_run_id,parent_snapshot_id,step_id,recipient) VALUES('grant','a','r1','snap','st1','child');
    INSERT INTO skill_script_reservations(id,tenant_id,run_id,root_snapshot_id,agent_id,skill_id,version_id,content_digest,policy_digest,script_path,interpreter,input_digest,timeout_ms,input_bytes,output_bytes) VALUES('reservation','a','r1','root','agent','skill','v1','digest','policy','scripts/check.js','node','input',30000,100,1114112);
  `);
}
beforeEach(() => {
  closeDb(); vi.stubEnv("DATABASE_URL", ":memory:"); vi.stubEnv("AGENTIC_SQLITE_TEST_WRITER", "1"); vi.stubEnv("AGENTIC_DATABASE_READONLY", "0");
  for (const key of ["AGENTIC_SQLITE_WRITER_LEASE_TOKEN", "AGENTIC_SQLITE_WRITER_LEASE_PATH", "AGENTIC_SQLITE_WRITER_SUPERVISOR_PID"]) vi.stubEnv(key, "");
  getDb(); getRawSqlite().exec("CREATE TABLE tenants(id TEXT PRIMARY KEY); INSERT INTO tenants VALUES('a'); CREATE TABLE runs(id TEXT PRIMARY KEY,tenant_id TEXT REFERENCES tenants(id)); CREATE TABLE steps(id TEXT PRIMARY KEY,run_id TEXT REFERENCES runs(id));");
  for (const name of ["0080_managed_skills", "0081_run_skill_snapshots", "0082_skill_script_reservations"]) getRawSqlite().exec(readFileSync(new URL(`../../../packages/db/drizzle/${name}.sql`, import.meta.url), "utf8"));
  getRawSqlite().exec(`
    INSERT INTO managed_skills(id,tenant_id,name,description) VALUES('skill','a','review','Review records');
    INSERT INTO skill_versions(id,skill_id,tenant_id,version_no,draft_revision,name,description,content_digest,bundle_json) VALUES('v1','skill','a',1,1,'review','Review records','digest','{}');
    UPDATE managed_skills SET latest_version_id='v1';
    INSERT INTO skill_drafts(skill_id,tenant_id,revision,bundle_json,diagnostics_json) VALUES('skill','a',1,'{}','[]');
    INSERT INTO skill_draft_revisions(id,skill_id,tenant_id,revision,source,bundle_json,diagnostics_json) VALUES('draft1','skill','a',1,'create','{}','[]');
    INSERT INTO skill_evaluations(id,skill_id,tenant_id,version_id,status,result_json) VALUES('eval1','skill','a','v1','completed','{}');
  `);
  seedRuntime();
});
afterEach(() => { closeDb(); vi.unstubAllEnvs(); });

describe("explicit administrative runtime wipe with retained Skills", () => {
  it("clears runtime Skill state, preserves the library, and restores identical protections", () => {
    const definitions = triggers();
    const report = wipeRuntime();
    for (const table of runtimeTables) { expect(count(table)).toBe(0); expect(report.find((r) => r.table === table)?.afterRows).toBe(0); }
    for (const table of ["managed_skills", "skill_versions", "skill_drafts", "skill_draft_revisions", "skill_evaluations"]) expect(count(table)).toBe(1);
    expect(getRawSqlite().pragma("foreign_key_check")).toEqual([]);
    expect(triggers()).toEqual(definitions);
    seedRuntime();
    for (const table of runtimeTables.slice(0,4)) expect(() => getRawSqlite().exec(`DELETE FROM ${table}`)).toThrow(/retained/);
    expect(() => getRawSqlite().exec("UPDATE skill_script_reservations SET input_bytes=1")).toThrow(/immutable/);
    expect(() => getRawSqlite().exec("DELETE FROM skill_versions")).toThrow(/cannot be deleted/);
    expect(wipeRuntime().find((r) => r.table === "skill_script_reservations")?.cleared).toBe(1);
    expect(wipeRuntime().every((r) => r.cleared === 0)).toBe(true);
  });
  it("rolls back removed rows and trigger DDL when a later deletion fails", () => {
    getRawSqlite().exec("CREATE TRIGGER reject_run_wipe BEFORE DELETE ON runs BEGIN SELECT RAISE(ABORT,'test rollback'); END");
    const definitions = triggers(); const counts = runtimeTables.map(count);
    expect(() => wipeRuntime()).toThrow(/test rollback/);
    expect(runtimeTables.map(count)).toEqual(counts); expect(triggers()).toEqual(definitions);
    expect(getRawSqlite().pragma("foreign_keys", { simple: true })).toBe(1);
    expect(getRawSqlite().pragma("foreign_key_check")).toEqual([]);
    expect(() => getRawSqlite().exec("DELETE FROM skill_script_reservations")).toThrow(/retained/);
  });
  it("rolls back when an unexpected retained table would become orphaned", () => {
    getRawSqlite().exec("CREATE TABLE retained_reference(id TEXT PRIMARY KEY,run_id TEXT REFERENCES runs(id)); INSERT INTO retained_reference VALUES('keep','r1');");
    const definitions = triggers();
    expect(() => wipeRuntime()).toThrow(/foreign-key violation/);
    expect(count("runs")).toBe(1); expect(count("skill_script_reservations")).toBe(1); expect(triggers()).toEqual(definitions);
    expect(getRawSqlite().pragma("foreign_key_check")).toEqual([]);
  });
});
