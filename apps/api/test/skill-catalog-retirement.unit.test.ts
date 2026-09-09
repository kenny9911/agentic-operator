import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, getDb, getRawSqlite } from "@agentic/db";
import type { SkillBundle } from "@agentic/contracts";
import { skillBundleDigest } from "@agentic/skills";
import {
  SkillLibraryStore,
  type SkillLibraryContext,
} from "../src/services/skill-library-store";
import {
  retireSkillCatalog,
  type SkillRetirementStore,
} from "../src/services/skill-catalog-retirement";
import { ManagedSkillRuntime } from "../src/services/skill-runtime";

const ctx: SkillLibraryContext = {
  tenantId: "system",
  tenantSlug: "__system",
  userId: null,
  email: null,
  name: "Retirement test",
  role: "admin",
  platformRole: "superadmin",
  via: "dev",
};
const entry = {
  id: "openai/curated/cli-creator",
  name: "openai-cli-creator",
  sourceId: "openai",
  upstreamPath: "skills/.curated/cli-creator",
  sourceDigest: "a".repeat(64),
  expectedImportedDigest: "0".repeat(64),
};
let library: SkillLibraryStore;
let store: SkillRetirementStore;
function bundle(
  name = entry.name,
  identity: Record<string, string> | null = {},
): SkillBundle {
  const metadata =
    identity === null
      ? {}
      : {
          "agentic-import-format": "catalog-v1",
          "agentic-catalog-id": entry.id,
          "agentic-source-id": entry.sourceId,
          "agentic-upstream-path": entry.upstreamPath,
          "agentic-source-digest": entry.sourceDigest,
          ...identity,
        };
  return {
    files: [
      {
        path: "SKILL.md",
        encoding: "utf8",
        content: `---\nname: ${name}\ndescription: Use this skill to create command-line programs.\n${
          Object.keys(metadata).length
            ? `metadata:\n${Object.entries(metadata)
                .map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`)
                .join("\n")}\n`
            : ""
        }---\nPreserve the supplied requirements.\n`,
      },
    ],
  };
}
entry.expectedImportedDigest = skillBundleDigest(bundle());
function create(
  value = bundle(),
  published = true,
  visibility: "tenant" | "shared" = "shared",
) {
  const created = library.create(ctx, { bundle: value, visibility });
  return published ? library.publish(ctx, created.skill.id, 1) : created;
}
function run(apply = false, port = store) {
  return retireSkillCatalog({ entries: [entry], store: port, apply });
}
function databaseState() {
  return [
    "managed_skills",
    "skill_drafts",
    "skill_draft_revisions",
    "skill_versions",
    "audit_log",
  ].map((table) =>
    getRawSqlite().prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
  );
}
beforeEach(() => {
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
    .exec(`CREATE TABLE tenants(id TEXT PRIMARY KEY,slug TEXT NOT NULL);
    INSERT INTO tenants VALUES ('system','__system'),('tenant','business');
    CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE audit_log(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),actor_user_id TEXT REFERENCES users(id),action TEXT NOT NULL,target_type TEXT,target_id TEXT,at INTEGER NOT NULL DEFAULT (unixepoch()*1000),meta_json TEXT);`);
  for (const migration of ["0080_managed_skills", "0083_managed_skill_enabled"])
    getRawSqlite().exec(
      readFileSync(
        new URL(
          `../../../packages/db/drizzle/${migration}.sql`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
  library = new SkillLibraryStore(getDb(), null);
  store = {
    list: (query) => library.list(ctx, query),
    detail: (id) => library.detail(ctx, id),
    setEnabled: (id, input) => library.setEnabled(ctx, id, input),
    archive: (id, input) => library.archive(ctx, id, input),
  };
});
afterEach(() => {
  closeDb();
  vi.unstubAllEnvs();
});

describe("reviewed catalog retirement", () => {
  it("dry-runs without writes, then disables and archives a matching import with retained history, idempotently", async () => {
    const original = create();
    const before = databaseState();
    const plan = await run();
    expect(plan).toMatchObject({
      apply: false,
      considered: 1,
      retired: 0,
      blocked: 0,
      results: [{ status: "planned", skillId: original.skill.id }],
    });
    expect(databaseState()).toEqual(before);
    expect(await run(true)).toMatchObject({
      retired: 1,
      blocked: 0,
      results: [{ status: "retired" }],
    });
    const retired = library.detail(ctx, original.skill.id);
    expect(retired.skill.enabled).toBe(false);
    expect(retired.skill.archivedAt).not.toBeNull();
    expect(retired.draft).toEqual(original.draft);
    expect(retired.latestVersion).toEqual(original.latestVersion);
    expect(retired.versions).toEqual(original.versions);
    const after = databaseState();
    expect(await run(true)).toMatchObject({
      retired: 0,
      alreadyRetired: 1,
      blocked: 0,
    });
    expect(databaseState()).toEqual(after);
  });

  it.each([
    ["format", "agentic-import-format", "custom-v1"],
    ["catalog id", "agentic-catalog-id", "another/skill"],
    ["source id", "agentic-source-id", "another-vendor"],
    ["upstream path", "agentic-upstream-path", "skills/another"],
    ["source digest", "agentic-source-digest", "b".repeat(64)],
  ])(
    "preserves a same-name record with mismatching %s",
    async (_label, key, value) => {
      create(bundle(entry.name, { [key]: value }));
      const before = databaseState();
      expect(await run(true)).toMatchObject({
        retired: 0,
        blocked: 1,
        results: [{ status: "blocked" }],
      });
      expect(databaseState()).toEqual(before);
    },
  );

  it("preserves a same-name custom skill without import provenance", async () => {
    create(bundle(entry.name, null));
    const before = databaseState();
    expect(await run(true)).toMatchObject({ blocked: 1, retired: 0 });
    expect(databaseState()).toEqual(before);
  });

  it("preserves authored tenant skills and unrelated malformed drafts while retiring the matching shared import", async () => {
    const original = create();
    const custom = create(bundle("business-ontology", null), false);
    library.save(ctx, custom.skill.id, 1, {
      files: [
        {
          path: "SKILL.md",
          encoding: "utf8",
          content: "---\nname: [unterminated\n---\nWork in progress",
        },
      ],
    });
    const tenant = library.create(
      {
        ...ctx,
        tenantId: "tenant",
        tenantSlug: "business",
        platformRole: "none",
      },
      { bundle: bundle(), visibility: "tenant" },
    );
    const beforeCustom = library.detail(ctx, custom.skill.id);
    expect(await run(true)).toMatchObject({
      retired: 1,
      blocked: 0,
      results: [{ skillId: original.skill.id }],
    });
    expect(library.detail(ctx, custom.skill.id)).toEqual(beforeCustom);
    expect(
      library.detail(
        { ...ctx, tenantId: "tenant", tenantSlug: "business" },
        tenant.skill.id,
      ),
    ).toEqual(tenant);
  });

  it("preserves renamed imports and current drafts whose import identity was removed", async () => {
    const renamed = create(bundle("business-cli"));
    const beforeRename = library.detail(ctx, renamed.skill.id);
    expect(await run(true)).toMatchObject({ blocked: 1, retired: 0 });
    expect(library.detail(ctx, renamed.skill.id)).toEqual(beforeRename);
    const original = create();
    library.save(ctx, original.skill.id, 1, bundle(entry.name, null));
    const before = databaseState();
    expect(await run(true)).toMatchObject({ blocked: 2, retired: 0 });
    expect(databaseState()).toEqual(before);
  });

  it("preserves unpublished manual edits even when their provenance remains intact", async () => {
    const original = create();
    const edited = bundle();
    edited.files[0]!.content += "Business-specific draft instructions.\n";
    library.save(ctx, original.skill.id, 1, edited);
    const before = databaseState();
    expect(await run(true)).toMatchObject({
      retired: 0,
      blocked: 1,
      results: [{ reason: expect.stringContaining("unpublished edits") }],
    });
    expect(databaseState()).toEqual(before);
  });

  it("keeps an import disabled when archive fails, then completes on retry", async () => {
    const original = create();
    const archive = vi.fn(() => {
      throw new Error("archive unavailable");
    });
    expect(await run(true, { ...store, archive })).toMatchObject({
      retired: 0,
      blocked: 1,
      results: [{ reason: "archive unavailable" }],
    });
    expect(library.detail(ctx, original.skill.id).skill).toMatchObject({
      enabled: false,
      archivedAt: null,
    });
    expect(archive).toHaveBeenCalledTimes(1);
    expect(await run(true)).toMatchObject({ retired: 1, blocked: 0 });
  });

  it.each(["published adaptation", "unpublished-only adaptation"])(
    "preserves a %s even when import identity metadata is intact",
    async (kind) => {
      const original = create(bundle(), kind === "published adaptation");
      const adapted = bundle();
      adapted.files[0]!.content +=
        "Organization-specific business policy added by the user.\n";
      library.save(ctx, original.skill.id, 1, adapted);
      if (kind === "published adaptation")
        library.publish(ctx, original.skill.id, 2);
      const before = databaseState();
      expect(await run(true)).toMatchObject({
        retired: 0,
        blocked: 1,
        results: [
          {
            reason: expect.stringContaining(
              "differs from the reviewed imported bundle",
            ),
          },
        ],
      });
      expect(databaseState()).toEqual(before);
    },
  );

  it("reports CAS conflicts as blocked without false success or overwriting a concurrent edit", async () => {
    const original = create();
    const archive = vi.fn(store.archive);
    const port: SkillRetirementStore = {
      ...store,
      archive,
      setEnabled: (id, input) => {
        library.save(ctx, id, 1, bundle());
        return store.setEnabled(id, input);
      },
    };
    expect(await run(true, port)).toMatchObject({
      retired: 0,
      blocked: 1,
      results: [{ reason: expect.stringContaining("draft changed") }],
    });
    expect(archive).not.toHaveBeenCalled();
    expect(library.detail(ctx, original.skill.id).skill).toMatchObject({
      enabled: true,
      archivedAt: null,
      draftRevision: 2,
    });
  });

  it("does not report retirement if another actor re-enables the skill before final verification", async () => {
    create();
    const port: SkillRetirementStore = {
      ...store,
      archive: async (id, input) => {
        const archived = await store.archive(id, input);
        return library.setEnabled(ctx, id, {
          enabled: true,
          expectedEnabled: false,
          expectedRevision: archived.draft!.revision,
          expectedLatestVersionId: archived.skill.latestVersionId,
        });
      },
    };
    expect(await run(true, port)).toMatchObject({
      retired: 0,
      blocked: 1,
      results: [{ reason: expect.stringContaining("availability changed") }],
    });
  });

  it("handles absent entries and refuses duplicate curation identities before mutations", async () => {
    expect(await run(true)).toMatchObject({
      retired: 0,
      blocked: 0,
      results: [{ status: "absent" }],
    });
    const list = vi.fn(store.list);
    await expect(
      retireSkillCatalog({
        entries: [entry, entry],
        store: { ...store, list },
        apply: true,
      }),
    ).rejects.toThrow(/unique/);
    expect(list).not.toHaveBeenCalled();
  });

  it("snapshots every management page before archiving can move entries between pages", async () => {
    create();
    const second = {
      ...entry,
      id: "openai/curated/second-tool",
      name: "openai-second-tool",
      upstreamPath: "skills/.curated/second-tool",
    };
    const secondBundle = bundle(second.name, {
      "agentic-catalog-id": second.id,
      "agentic-upstream-path": second.upstreamPath,
    });
    second.expectedImportedDigest = skillBundleDigest(secondBundle);
    create(secondBundle);
    const calls: string[] = [];
    const port: SkillRetirementStore = {
      ...store,
      list: (query) => {
        calls.push(`list:${query.archived}:${query.offset}`);
        return library.list(ctx, { ...query, limit: 1 });
      },
      setEnabled: (id, input) => {
        calls.push("disable");
        return store.setEnabled(id, input);
      },
    };
    expect(
      await retireSkillCatalog({
        entries: [entry, second],
        store: port,
        apply: true,
      }),
    ).toMatchObject({ retired: 2, blocked: 0 });
    expect(calls.slice(0, 3)).toEqual([
      "list:false:0",
      "list:false:1",
      "list:true:0",
    ]);
    expect(calls.slice(3)).toEqual(["disable", "disable"]);
  });

  it("retirement revokes an already captured durable replay without rewriting its retained snapshot", async () => {
    getRawSqlite().exec(
      "CREATE TABLE runs(id TEXT PRIMARY KEY,tenant_id TEXT,agent_id TEXT,parent_run_id TEXT); CREATE TABLE steps(id TEXT PRIMARY KEY,run_id TEXT); CREATE TABLE event_store(id TEXT PRIMARY KEY,tenant_id TEXT,name TEXT,source_run_id TEXT); INSERT INTO runs VALUES('run-replay','tenant','agent',NULL);",
    );
    getRawSqlite().exec(
      readFileSync(
        new URL(
          "../../../packages/db/drizzle/0081_run_skill_snapshots.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const original = create();
    const runtime = new ManagedSkillRuntime({ db: getDb() });
    const scope = {
      tenantId: "tenant",
      tenantSlug: "business",
      executionId: "run-replay",
      agentId: "agent",
      agentName: "agent",
    };
    const ref = runtime.capture(scope);
    const session = await runtime.restore(ref, scope);
    await session.activate({ id: original.skill.id }, { origin: "model" });
    const checkpoint = await session.snapshot();
    expect(await run(true)).toMatchObject({ retired: 1, blocked: 0 });
    expect(runtime.capture(scope)).toEqual(ref);
    const replay = await runtime.restore(ref, scope);
    expect((await replay.list()).skills).toEqual([]);
    await expect(replay.restore(checkpoint)).rejects.toThrow(
      /access|authorized/i,
    );
    await expect(session.advance(checkpoint)).rejects.toThrow(
      /access|authorized/i,
    );
    await expect(session.snapshot()).rejects.toThrow(/access|authorized/i);
    await expect(runtime.materializationSources(ref, scope)).rejects.toThrow(
      /authorized/i,
    );
  });
});
