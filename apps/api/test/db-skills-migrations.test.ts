import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@agentic/db/schema";
import type { getRawSqlite } from "@agentic/db";
import { afterEach, expect, it } from "vitest";
import {
  SkillLibraryStore,
  type SkillLibraryContext,
} from "../src/services/skill-library-store";
import { ManagedSkillRuntime } from "../src/services/skill-runtime";

const repo = path.resolve(import.meta.dirname, "../../..");
const migrations = path.join(repo, "packages/db/drizzle");
const requireFromDb = createRequire(
  path.join(repo, "packages/db/package.json"),
);
const Database = requireFromDb("better-sqlite3") as new (
  file: string,
) => ReturnType<typeof getRawSqlite>;
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function productionMigrate(file: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: `file:${file}`,
    NODE_ENV: "production",
    AGENTIC_SQLITE_TEST_WRITER: "0",
    AGENTIC_DATABASE_READONLY: "0",
  };
  for (const key of Object.keys(env))
    if (key.startsWith("AGENTIC_SQLITE_WRITER_") || key.startsWith("VITEST"))
      delete env[key];
  // This is the real production lease supervisor and migration entrypoint,
  // targeting only this test's explicitly named temporary SQLite file.
  const result = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/sqlite-writer-supervisor.ts",
      "--migrate-only",
    ],
    {
      cwd: path.join(repo, "apps/api"),
      env,
      timeout: 20000,
      maxBuffer: 1024 * 1024,
    },
  );
  expect(result.stdout).toContain("[db:migrate] done");
}
async function through(root: string, last: number) {
  const folder = path.join(root, `through-${last}`),
    meta = path.join(folder, "meta");
  await mkdir(meta, { recursive: true });
  const journal = JSON.parse(
    await readFile(path.join(migrations, "meta/_journal.json"), "utf8"),
  ) as { entries: Array<{ idx: number; tag: string }> };
  const entries = journal.entries.filter((entry) => entry.idx <= last);
  await writeFile(
    path.join(meta, "_journal.json"),
    JSON.stringify({ ...journal, entries }),
  );
  await Promise.all(
    entries.map((entry) =>
      copyFile(
        path.join(migrations, `${entry.tag}.sql`),
        path.join(folder, `${entry.tag}.sql`),
      ),
    ),
  );
  return folder;
}
function open(file: string) {
  const raw = new Database(file);
  raw.pragma("foreign_keys = ON");
  return raw;
}
function seedBusinessRows(raw: ReturnType<typeof getRawSqlite>) {
  raw.exec(`INSERT INTO tenants(id,slug,name) VALUES('ten-migration','migration-fixture','Migration fixture');
    INSERT INTO workflows(id,tenant_id,slug,name) VALUES('wf-migration','ten-migration','existing-workflow','Existing workflow');
    INSERT INTO agents(id,tenant_id,workflow_id,kebab_id,name,actor) VALUES('agt-migration','ten-migration','wf-migration','existing-agent','Existing agent','Agent');
    INSERT INTO runs(id,tenant_id,agent_id,status,subject,correlation_id) VALUES('run-migration','ten-migration','agt-migration','ok','preserve-this-business-subject','cor-migration');`);
}
async function exerciseSkills(raw: ReturnType<typeof getRawSqlite>) {
  const db = drizzle(raw, { schema });
  const ctx: SkillLibraryContext = {
    tenantId: "ten-migration",
    tenantSlug: "migration-fixture",
    userId: null,
    email: null,
    name: "Migration",
    role: "admin",
    platformRole: "none",
    via: "token",
  };
  const store = new SkillLibraryStore(db, null);
  const bundle = {
    files: [
      {
        path: "SKILL.md",
        encoding: "utf8" as const,
        content:
          "---\nname: migrated-skill\ndescription: Verify migrated skill storage.\n---\nPreserve references.\n",
      },
      {
        path: "assets/binary.bin",
        encoding: "base64" as const,
        content: "AP+A",
      },
    ],
  };
  const created = store.create(ctx, { bundle, visibility: "tenant" });
  const published = store.publish(ctx, created.skill.id, 1);
  expect(published.latestVersion?.bundle).toEqual(bundle);
  const scope = {
    tenantId: ctx.tenantId,
    tenantSlug: ctx.tenantSlug,
    executionId: "run-migration",
    agentId: "agt-migration",
    agentName: "existing-agent",
  };
  const host = new ManagedSkillRuntime({ db });
  const ref = host.capture({
    ...scope,
    agentSkills: {
      mode: "selected",
      skills: [{ id: created.skill.id, activate: true }],
    },
  });
  const session = await host.restore(ref, scope);
  expect(
    await session.readResource({ id: created.skill.id }, "assets/binary.bin"),
  ).toMatchObject({ encoding: "base64", content: "AP+A", bytes: 3 });
  const root = raw
    .prepare(
      "SELECT root_snapshot_id AS id FROM run_skill_snapshots WHERE id=?",
    )
    .get(ref.id) as { id: string };
  raw
    .prepare(
      `INSERT INTO skill_script_reservations(id,tenant_id,run_id,root_snapshot_id,agent_id,skill_id,version_id,content_digest,policy_digest,script_path,interpreter,input_digest,timeout_ms,input_bytes,output_bytes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      "ssr-migration",
      ctx.tenantId,
      scope.executionId,
      root.id,
      scope.agentId,
      created.skill.id,
      published.latestVersion!.id,
      published.latestVersion!.contentDigest,
      "a".repeat(64),
      "scripts/check.js",
      "node",
      "b".repeat(64),
      1000,
      20,
      100,
    );
  expect(() =>
    raw
      .prepare("UPDATE skill_versions SET content_digest='changed' WHERE id=?")
      .run(published.latestVersion!.id),
  ).toThrow(/immutable/);
  expect(() =>
    raw.prepare("DELETE FROM run_skill_snapshots WHERE id=?").run(ref.id),
  ).toThrow(/retained/);
  expect(() =>
    raw
      .prepare("DELETE FROM skill_script_reservations WHERE id='ssr-migration'")
      .run(),
  ).toThrow(/retained/);
  expect(
    raw.prepare("SELECT subject FROM runs WHERE id='run-migration'").get(),
  ).toEqual({ subject: "preserve-this-business-subject" });
  expect(raw.pragma("foreign_key_check")).toEqual([]);
  expect(raw.pragma("integrity_check", { simple: true })).toBe("ok");
  return published.latestVersion!.contentDigest;
}

it("runs all migrations through the production supervisor on an empty database, supports the Skill lifecycle, and is idempotent", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skills-fresh-production-"));
  roots.push(root);
  const file = path.join(root, "fresh.db");
  await productionMigrate(file);
  let raw = open(file),
    digest: string;
  try {
    seedBusinessRows(raw);
    digest = await exerciseSkills(raw);
  } finally {
    raw.close();
  }
  await productionMigrate(file);
  raw = open(file);
  try {
    expect(
      raw.prepare("SELECT count(*) AS n FROM skill_versions").get(),
    ).toEqual({ n: 1 });
    expect(
      raw.prepare("SELECT content_digest AS digest FROM skill_versions").get(),
    ).toEqual({ digest });
    expect(
      raw.prepare("SELECT count(*) AS n FROM skill_script_reservations").get(),
    ).toEqual({ n: 1 });
    expect(raw.pragma("foreign_key_check")).toEqual([]);
  } finally {
    raw.close();
  }
});

it("upgrades a pre-Skills production schema through 0080–0083 while preserving existing business rows", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skills-upgrade-production-"));
  roots.push(root);
  const file = path.join(root, "upgrade.db"),
    legacy = await through(root, 79);
  let raw = open(file);
  try {
    migrate(drizzle(raw), { migrationsFolder: legacy });
    seedBusinessRows(raw);
  } finally {
    raw.close();
  }
  await productionMigrate(file);
  raw = open(file);
  try {
    await exerciseSkills(raw);
  } finally {
    raw.close();
  }
});

it("upgrades existing managed Skills as enabled and preserves a disabled state across migration reruns", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skills-enabled-upgrade-"));
  roots.push(root);
  const file = path.join(root, "enabled-upgrade.db");
  const legacy = await through(root, 82);
  let raw = open(file);
  try {
    migrate(drizzle(raw), { migrationsFolder: legacy });
    seedBusinessRows(raw);
    raw.exec(
      "INSERT INTO managed_skills(id,tenant_id,name,description) VALUES('skl-legacy','ten-migration','legacy-skill','Retain existing managed skill');",
    );
  } finally {
    raw.close();
  }
  await productionMigrate(file);
  raw = open(file);
  try {
    expect(
      raw
        .prepare(
          "SELECT enabled,name FROM managed_skills WHERE id='skl-legacy'",
        )
        .get(),
    ).toEqual({ enabled: 1, name: "legacy-skill" });
    expect(() =>
      raw
        .prepare("UPDATE managed_skills SET enabled=2 WHERE id='skl-legacy'")
        .run(),
    ).toThrow(/CHECK/);
    expect(() =>
      raw
        .prepare("UPDATE managed_skills SET enabled=NULL WHERE id='skl-legacy'")
        .run(),
    ).toThrow(/NOT NULL/);
    raw
      .prepare("UPDATE managed_skills SET enabled=0 WHERE id='skl-legacy'")
      .run();
  } finally {
    raw.close();
  }
  await productionMigrate(file);
  raw = open(file);
  try {
    expect(
      raw
        .prepare("SELECT enabled FROM managed_skills WHERE id='skl-legacy'")
        .get(),
    ).toEqual({ enabled: 0 });
    expect(
      raw.prepare("SELECT subject FROM runs WHERE id='run-migration'").get(),
    ).toEqual({ subject: "preserve-this-business-subject" });
    expect(raw.pragma("foreign_key_check")).toEqual([]);
  } finally {
    raw.close();
  }
});
