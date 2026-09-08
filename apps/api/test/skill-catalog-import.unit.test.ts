import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, getDb, getRawSqlite } from "@agentic/db";
import { decodeSkillFile, assertValidSkillBundle } from "@agentic/skills";
import {
  SkillLibraryStore,
  type SkillLibraryContext,
} from "../src/services/skill-library-store";
import {
  importSkillCatalog,
  prepareCatalogSkill,
  SkillCatalogManifestSchema,
  type SkillCatalogEntry,
} from "../src/services/skill-catalog-import";
import { ManagedSkillRuntime } from "../src/services/skill-runtime";

const ctx: SkillLibraryContext = {
  tenantId: "tnt-system",
  tenantSlug: "__system",
  userId: null,
  email: null,
  name: null,
  role: "admin",
  platformRole: "superadmin",
  via: "dev",
};
const tenant: SkillLibraryContext = {
  ...ctx,
  tenantId: "tnt-a",
  tenantSlug: "alpha",
  platformRole: "none",
};
const entry: SkillCatalogEntry = {
  id: "anthropic/test-skill",
  sourceId: "anthropic",
  upstreamPath: "skills/test-skill",
  path: "upstream/anthropic/skills/test-skill",
  upstreamName: "test-skill",
  name: "anthropic-test-skill",
  sourceUrl: `https://github.com/anthropics/skills/tree/${"a".repeat(40)}/skills/test-skill`,
  revision: "a".repeat(40),
  license: "Apache-2.0",
};
let root: string;
let store: SkillLibraryStore;
const sourceText =
  "---\nname: test-skill\ndescription: Use when testing complete catalog imports.\ncustom-extension:\n  preserved: true\n---\nRead references/details.md before producing results.\n";
function source(body = sourceText) {
  const directory = join(root, entry.path);
  mkdirSync(join(directory, "assets"), { recursive: true });
  mkdirSync(join(directory, "references"), { recursive: true });
  writeFileSync(join(directory, "SKILL.md"), body);
  writeFileSync(
    join(directory, "LICENSE.txt"),
    "Apache-2.0 fixture license bytes\n",
  );
  writeFileSync(
    join(directory, "assets", "sample.bin"),
    Buffer.from([0, 255, 1, 128]),
  );
  writeFileSync(
    join(directory, "references", "details.md"),
    "Reference resource\n",
  );
}
function run(apply = true, skills = [entry]) {
  return importSkillCatalog({
    root,
    catalog: { schemaVersion: 1, skills },
    store,
    ctx,
    apply,
  });
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agentic-catalog-import-"));
  source();
  closeDb();
  vi.stubEnv("DATABASE_URL", ":memory:");
  vi.stubEnv("AGENTIC_SQLITE_TEST_WRITER", "1");
  vi.stubEnv("AGENTIC_DATABASE_READONLY", "0");
  for (const key of [
    "AGENTIC_SQLITE_WRITER_LEASE_TOKEN",
    "AGENTIC_SQLITE_WRITER_LEASE_PATH",
    "AGENTIC_SQLITE_WRITER_SUPERVISOR_PID",
  ])
    vi.stubEnv(key, "");
  getDb();
  getRawSqlite()
    .exec(`CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT NOT NULL);
    INSERT INTO tenants VALUES ('tnt-a','alpha'),('tnt-system','__system');
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), actor_user_id TEXT REFERENCES users(id), action TEXT NOT NULL, target_type TEXT, target_id TEXT, at INTEGER NOT NULL DEFAULT (unixepoch()*1000), meta_json TEXT);`);
  getRawSqlite().exec(
    readFileSync(
      fileURLToPath(
        new URL(
          "../../../packages/db/drizzle/0080_managed_skills.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  );
  store = new SkillLibraryStore(getDb());
});
afterEach(() => {
  closeDb();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("pinned catalog import", () => {
  it("binds an imported shared publication to a tenant workflow and agent, then restores exact instructions and binary assets after an upstream update", async () => {
    getRawSqlite()
      .exec(`CREATE TABLE runs (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, agent_id TEXT NOT NULL, parent_run_id TEXT);
      CREATE TABLE steps (id TEXT PRIMARY KEY, run_id TEXT NOT NULL);
      CREATE TABLE event_store (id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT, source_run_id TEXT);
      INSERT INTO runs VALUES ('run-imported', 'tnt-a', 'agt-a', NULL);`);
    getRawSqlite().exec(
      readFileSync(
        new URL(
          "../../../packages/db/drizzle/0081_run_skill_snapshots.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const imported = (await run()).results[0]!;
    const scope = {
      tenantId: tenant.tenantId,
      tenantSlug: tenant.tenantSlug,
      executionId: "run-imported",
      agentId: "agt-a",
      agentName: "alpha-agent",
    };
    const host = new ManagedSkillRuntime({ db: getDb() });
    const ref = host.capture({
      ...scope,
      workflowSkills: {
        mode: "selected",
        skills: [{ id: imported.skillId!, versionId: imported.versionId! }],
      },
      agentSkills: {
        mode: "selected",
        skills: [{ id: imported.skillId!, activate: true }],
      },
    });
    writeFileSync(
      join(root, entry.path, "SKILL.md"),
      sourceText.replace(
        "Read references/details.md before producing results.",
        "New upstream procedure.",
      ),
    );
    expect((await run()).results[0]!.versionId).not.toBe(imported.versionId);
    rmSync(join(root, entry.path), { recursive: true });
    // Restoration is entirely from immutable managed bytes, even after a
    // publisher update and deletion of the originally downloaded directory.
    const session = await new ManagedSkillRuntime({ db: getDb() }).restore(
      ref,
      scope,
    );
    expect(
      (await session.snapshot()).catalog.map((item) => item.versionId),
    ).toEqual([imported.versionId]);
    expect((await session.activeInstructions())[0]).toMatchObject({
      name: entry.name,
      origin: "explicit",
      body: "Read references/details.md before producing results.\n",
    });
    const resource = await session.readResource(
      { id: imported.skillId! },
      "assets/sample.bin",
    );
    expect(resource.encoding).toBe("base64");
    expect(Buffer.from(resource.content, "base64")).toEqual(
      Buffer.from([0, 255, 1, 128]),
    );
    expect(
      (await session.readResource(entry.name, "references/details.md")).content,
    ).toBe("Reference resource\n");
  });
  it("previews without writes, publishes complete bundles for every tenant, and retries without duplicate versions", async () => {
    expect((await run(false)).results[0]?.status).toBe("would-import");
    expect(
      getRawSqlite().prepare("SELECT count(*) AS n FROM managed_skills").get(),
    ).toEqual({ n: 0 });
    const first = await run();
    expect(first.blocked).toBe(0);
    expect(first.results[0]?.status).toBe("imported");
    const id = first.results[0]!.skillId!;
    const available = store.detail(tenant, id);
    expect(available.draft).toBeNull();
    expect(available.skill.canEdit).toBe(false);
    expect(available.latestVersion!.name).toBe(entry.name);
    const files = available.latestVersion!.bundle.files;
    expect(
      decodeSkillFile(files.find((file) => file.path === "assets/sample.bin")!),
    ).toEqual(Buffer.from([0, 255, 1, 128]));
    expect(files.find((file) => file.path === "LICENSE.txt")!.content).toBe(
      "Apache-2.0 fixture license bytes\n",
    );
    const metadata = assertValidSkillBundle(
      available.latestVersion!.bundle,
    ).metadata;
    expect(metadata["custom-extension"]).toEqual({ preserved: true });
    expect(metadata.metadata?.["agentic-source-revision"]).toBe(entry.revision);
    expect(readFileSync(join(root, entry.path, "SKILL.md"), "utf8")).toBe(
      sourceText,
    );
    expect((await run()).results[0]?.status).toBe("unchanged");
    expect(store.detail(ctx, id).versions).toHaveLength(1);
    expect(
      getRawSqlite().prepare("SELECT count(*) AS n FROM audit_log").get(),
    ).toEqual({ n: 2 });
  });

  it("updates published imports but preserves manual unpublished draft edits", async () => {
    const id = (await run()).results[0]!.skillId!;
    writeFileSync(
      join(root, entry.path, "references/details.md"),
      "Updated upstream resource\n",
    );
    expect((await run(false)).results[0]?.status).toBe("would-update");
    expect((await run()).results[0]?.status).toBe("updated");
    const current = store.detail(ctx, id);
    expect(current.versions).toHaveLength(2);
    const edited = structuredClone(current.draft!.bundle);
    edited.files.find(
      (file) => file.path === "references/details.md",
    )!.content = "My unpublished notes\n";
    store.save(ctx, id, current.draft!.revision, edited);
    const blocked = await run();
    expect(blocked.blocked).toBe(1);
    expect(blocked.results[0]!.message).toMatch(/unpublished edits/);
    expect(store.detail(ctx, id).draft!.bundle).toEqual(edited);
    expect(store.detail(ctx, id).versions).toHaveLength(2);
  });

  it("does not overwrite unrelated same-name skills, archived imports, or forged provenance", async () => {
    const bundle = prepareCatalogSkill(root, entry).bundle;
    const forged = structuredClone(bundle);
    forged.files.find((file) => file.path === "SKILL.md")!.content =
      sourceText.replace("name: test-skill", `name: ${entry.name}`);
    const created = store.create(ctx, { bundle: forged, visibility: "shared" });
    store.publish(ctx, created.skill.id, 1);
    expect((await run()).results[0]?.message).toMatch(/another source/);
    expect(store.detail(ctx, created.skill.id).versions).toHaveLength(1);
  });

  it("resumes an interrupted create before publication without duplicating the import", async () => {
    const created = store.create(
      ctx,
      { bundle: prepareCatalogSkill(root, entry).bundle, visibility: "shared" },
      "import",
    );
    const result = (await run()).results[0]!;
    expect(result.status).toBe("updated");
    expect(result.skillId).toBe(created.skill.id);
    expect(store.detail(tenant, created.skill.id).latestVersion).not.toBeNull();
  });

  it("blocks tampering, unsafe paths, oversized bundles and symlinked sources visibly", async () => {
    expect(
      (await run(true, [{ ...entry, sourceDigest: "0".repeat(64) }])).results[0]
        ?.message,
    ).toMatch(/digest/);
    expect(() =>
      prepareCatalogSkill(root, { ...entry, path: "../outside" }),
    ).toThrow();
    writeFileSync(
      join(root, entry.path, "assets", "large.bin"),
      Buffer.alloc(5 * 1024 * 1024 + 1),
    );
    expect((await run()).results[0]?.status).toBe("blocked");
    rmSync(join(root, entry.path, "assets", "large.bin"));
    symlinkSync(join(root, entry.path), join(root, "linked"));
    expect(() =>
      prepareCatalogSkill(root, { ...entry, path: "linked" }),
    ).toThrow(/symbolic links/);
    expect(
      getRawSqlite().prepare("SELECT count(*) AS n FROM managed_skills").get(),
    ).toEqual({ n: 0 });
  });

  it("adds a source-root license without replacing any original resource", () => {
    writeFileSync(
      join(root, "OPENAI-LICENSE.txt"),
      "Retained upstream license\n",
    );
    const prepared = prepareCatalogSkill(root, {
      ...entry,
      licenseFiles: [
        { path: "OPENAI-LICENSE.txt", bundlePath: "UPSTREAM-LICENSE.txt" },
      ],
    });
    expect(
      prepared.bundle.files.find(
        (file) => file.path === "UPSTREAM-LICENSE.txt",
      )!.content,
    ).toBe("Retained upstream license\n");
    expect(() =>
      prepareCatalogSkill(root, {
        ...entry,
        licenseFiles: [
          { path: "OPENAI-LICENSE.txt", bundlePath: "LICENSE.txt" },
        ],
      }),
    ).toThrow(/collides/);
  });

  it("rejects duplicate identities and non-admin shared import before any writes", async () => {
    expect(() =>
      SkillCatalogManifestSchema.parse({
        schemaVersion: 1,
        skills: [entry, entry],
      }),
    ).toThrow(/Duplicate/);
    await expect(
      importSkillCatalog({
        root,
        catalog: { schemaVersion: 1, skills: [entry] },
        store,
        ctx: tenant,
        apply: true,
      }),
    ).rejects.toThrow(/superadmin/);
  });
});
