import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import Fastify from "fastify";
import { closeDb, getDb, getRawSqlite } from "@agentic/db";
import type { SkillBundle } from "@agentic/contracts";
import { skillBundleDigest } from "@agentic/skills";
import {
  SkillLibraryStore,
  type SkillLibraryContext,
} from "../src/services/skill-library-store";
import { ManagedSkillRuntime } from "../src/services/skill-runtime";
import { skillLibraryRoutes } from "../src/routes/v1/skills";
import { registerEnvelope } from "../src/plugins/error";

vi.mock("../src/services/llm", () => {
  throw new Error("Storage tests must never load a configured model gateway");
});

const raas: SkillLibraryContext = {
  tenantId: "tnt-raas",
  tenantSlug: "raas",
  userId: "usr-admin",
  email: "admin@example.test",
  name: "Storage test admin",
  role: "admin",
  platformRole: "none",
  via: "cookie",
};
const beta: SkillLibraryContext = {
  ...raas,
  tenantId: "tnt-beta",
  tenantSlug: "beta",
};
const superadmin: SkillLibraryContext = {
  ...raas,
  platformRole: "superadmin",
};
const originalBytes = Buffer.from([0, 255, 1, 128, 13]);
function bundle(
  name = "citation-review",
  body = "Original instructions: verify citations against the supplied sources.",
  bytes = originalBytes,
): SkillBundle {
  return {
    files: [
      {
        path: "SKILL.md",
        encoding: "utf8",
        content: `---\nname: ${name}\ndescription: Review citations when checking document accuracy.\n---\n${body}\n`,
      },
      {
        path: "assets/sample.bin",
        encoding: "base64",
        content: bytes.toString("base64"),
      },
    ],
  };
}

type BundlePointer = { contentDigest: string; path: string };
type Manifest = {
  schemaVersion: number;
  owner: {
    visibility: "tenant" | "shared";
    tenantId: string;
    tenantSlug: string;
    skillId: string;
  };
  metadata: {
    name: string;
    latestVersionId: string | null;
    archivedAt: string | null;
  };
  draft: BundlePointer & { revision: number };
  revisions: (BundlePointer & { revision: number })[];
  versions: (BundlePointer & { id: string; versionNo: number })[];
};
function current(directory: string): Manifest {
  return JSON.parse(readFileSync(join(directory, "current.json"), "utf8"));
}
function assertBundle(
  directory: string,
  pointer: BundlePointer,
  expected: SkillBundle,
) {
  expect(pointer.contentDigest).toBe(skillBundleDigest(expected));
  expect(pointer.path).toBe(`bundles/${pointer.contentDigest}`);
  for (const file of expected.files) {
    expect(readFileSync(join(directory, pointer.path, file.path))).toEqual(
      Buffer.from(file.content, file.encoding === "base64" ? "base64" : "utf8"),
    );
  }
}
function tree(directory: string): Record<string, string> {
  const files: Record<string, string> = {};
  function visit(path: string) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else
        files[relative(directory, child)] =
          readFileSync(child).toString("base64");
    }
  }
  visit(directory);
  return files;
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

let temp: string;
let dataRoot: string;
let tenantsRoot: string;
let store: SkillLibraryStore;
beforeEach(() => {
  // Never open the workspace database or resolve a workspace storage root.
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
  getRawSqlite().exec(`
    CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT NOT NULL);
    INSERT INTO tenants VALUES ('tnt-raas','raas'),('tnt-beta','beta'),('tnt-system','__system');
    CREATE TABLE users (id TEXT PRIMARY KEY);
    INSERT INTO users VALUES ('usr-admin');
    CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), actor_user_id TEXT REFERENCES users(id), action TEXT NOT NULL, target_type TEXT, target_id TEXT, at INTEGER NOT NULL DEFAULT (unixepoch()*1000), meta_json TEXT);
    CREATE TABLE runs (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, agent_id TEXT NOT NULL, parent_run_id TEXT);
    CREATE TABLE steps (id TEXT PRIMARY KEY, run_id TEXT NOT NULL);
    CREATE TABLE event_store (id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT, source_run_id TEXT);
  `);
  for (const migration of ["0080_managed_skills", "0081_run_skill_snapshots"]) {
    getRawSqlite().exec(
      readFileSync(
        new URL(
          `../../../packages/db/drizzle/${migration}.sql`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
  }
  temp = mkdtempSync(join(tmpdir(), "skill-library-storage-"));
  dataRoot = join(temp, "data");
  tenantsRoot = join(temp, "tenants");
  store = new SkillLibraryStore(getDb(), { dataRoot, tenantsRoot });
});
afterEach(() => {
  closeDb();
  vi.unstubAllEnvs();
  if (temp) rmSync(temp, { recursive: true, force: true });
});

describe("managed Skill database and directory integration", () => {
  it("uses the database tenant slug and keeps same-named tenant skills in separate folders", () => {
    const first = store.create(
      { ...raas, tenantSlug: "wrong-request-slug" },
      {
        bundle: bundle(),
        visibility: "tenant",
      },
    );
    const second = store.create(beta, {
      bundle: bundle(),
      visibility: "tenant",
    });
    const directory = join(tenantsRoot, "raas", "skills", first.skill.id);
    expect(current(directory).owner).toEqual({
      visibility: "tenant",
      tenantId: "tnt-raas",
      tenantSlug: "raas",
      skillId: first.skill.id,
    });
    assertBundle(directory, current(directory).draft, bundle());
    const betaDirectory = join(tenantsRoot, "beta", "skills", second.skill.id);
    assertBundle(betaDirectory, current(betaDirectory).draft, bundle());
    expect(existsSync(join(tenantsRoot, "wrong-request-slug"))).toBe(false);
    expect(
      existsSync(join(tenantsRoot, "raas", "skills", second.skill.id)),
    ).toBe(false);
    expect(existsSync(join(dataRoot, "shared"))).toBe(false);
  });

  it("keeps shared skills under shared storage when created and edited from RAAS", () => {
    const created = store.create(superadmin, {
      bundle: bundle(),
      visibility: "shared",
    });
    const directory = join(dataRoot, "shared", "skills", created.skill.id);
    expect(current(directory).owner).toEqual({
      visibility: "shared",
      tenantId: "tnt-system",
      tenantSlug: "__system",
      skillId: created.skill.id,
    });
    const next = bundle(
      "shared-source-review",
      "Check source evidence before reporting.",
    );
    store.save(superadmin, created.skill.id, 1, next);
    const published = store.publish(superadmin, created.skill.id, 2);
    expect(current(directory).metadata.latestVersionId).toBe(
      published.latestVersion?.id,
    );
    assertBundle(directory, current(directory).draft, next);
    expect(store.publishedVersion(beta, created.skill.id).bundle).toEqual(next);
    expect(
      existsSync(join(tenantsRoot, "raas", "skills", created.skill.id)),
    ).toBe(false);
    expect(
      existsSync(join(tenantsRoot, "__system", "skills", created.skill.id)),
    ).toBe(false);
  });

  it("projects the full lifecycle and preserves an old runtime pin after rename, restore and archive", async () => {
    const original = bundle();
    const created = store.create(raas, {
      bundle: original,
      visibility: "tenant",
    });
    const id = created.skill.id;
    const directory = join(tenantsRoot, "raas", "skills", id);
    const first = store.publish(raas, id, 1).latestVersion!;
    const firstPointer = current(directory).versions[0]!;
    const originalDisk = tree(join(directory, firstPointer.path));
    const scope = {
      tenantId: raas.tenantId,
      tenantSlug: raas.tenantSlug,
      executionId: "storage-before-edit",
      agentId: "agt-storage",
      agentName: "storage-agent",
      kind: "test" as const,
    };
    const runtime = new ManagedSkillRuntime({ db: getDb() });
    const pin = runtime.capture(scope);

    const revised = bundle(
      "source-review",
      "Revised instructions: identify absent source evidence.",
      Buffer.from([42, 0, 254]),
    );
    store.save(raas, id, 1, revised);
    expect(current(directory).draft.revision).toBe(2);
    expect(current(directory).metadata.name).toBe("citation-review");
    assertBundle(directory, current(directory).draft, revised);
    const second = store.publish(raas, id, 2).latestVersion!;
    store.restore(raas, id, 2, 1);
    let manifest = current(directory);
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      metadata: {
        name: "source-review",
        latestVersionId: second.id,
        archivedAt: null,
      },
      draft: { revision: 3, contentDigest: first.contentDigest },
    });
    expect(manifest.revisions.map((revision) => revision.revision)).toEqual([
      1, 2, 3,
    ]);
    expect(manifest.versions.map((version) => version.id)).toEqual([
      first.id,
      second.id,
    ]);
    assertBundle(directory, manifest.draft, original);
    assertBundle(directory, manifest.versions[0]!, original);
    assertBundle(directory, manifest.versions[1]!, revised);

    store.archive(raas, id, {
      archived: true,
      expectedRevision: 3,
      expectedLatestVersionId: second.id,
    });
    manifest = current(directory);
    expect(manifest.metadata.archivedAt).toBeTypeOf("string");
    expect(tree(join(directory, firstPointer.path))).toEqual(originalDisk);
    const reconstructed = new ManagedSkillRuntime({ db: getDb() });
    const pinned = await reconstructed.restore(pin, scope);
    await pinned.activate("citation-review", { origin: "model" });
    expect((await pinned.activeInstructions())[0]?.body).toContain(
      "Original instructions",
    );
    expect((await pinned.snapshot()).catalog[0]?.versionId).toBe(first.id);
    expect(
      await pinned.readResource("citation-review", "assets/sample.bin"),
    ).toMatchObject({
      encoding: "base64",
      content: originalBytes.toString("base64"),
    });
    const archivedScope = { ...scope, executionId: "storage-after-archive" };
    const archivedSession = await reconstructed.restore(
      reconstructed.capture(archivedScope),
      archivedScope,
    );
    expect((await archivedSession.snapshot()).catalog).toEqual([]);

    store.archive(raas, id, {
      archived: false,
      expectedRevision: 3,
      expectedLatestVersionId: second.id,
    });
    expect(current(directory).metadata.archivedAt).toBeNull();
    const freshScope = { ...scope, executionId: "storage-after-unarchive" };
    const fresh = await reconstructed.restore(
      reconstructed.capture(freshScope),
      freshScope,
    );
    expect((await fresh.snapshot()).catalog[0]?.versionId).toBe(second.id);
    await fresh.activate("source-review", { origin: "model" });
    expect((await fresh.activeInstructions())[0]?.body).toContain(
      "Revised instructions",
    );
    expect(store.publishedVersion(raas, id, first.id).bundle).toEqual(original);
  });

  it("rejects stale edits before changing either the database or directory", () => {
    const created = store.create(raas, {
      bundle: bundle(),
      visibility: "tenant",
    });
    store.save(raas, created.skill.id, 1, bundle("source-review"));
    const directory = join(tenantsRoot, "raas", "skills", created.skill.id);
    const beforeFiles = tree(directory);
    const beforeDb = databaseState();
    const beforeManifestStat = statSync(join(directory, "current.json"), {
      bigint: true,
    });
    expect(() =>
      store.save(raas, created.skill.id, 1, bundle("stale-review")),
    ).toThrow(/draft changed/i);
    expect(databaseState()).toEqual(beforeDb);
    expect(tree(directory)).toEqual(beforeFiles);
    const afterManifestStat = statSync(join(directory, "current.json"), {
      bigint: true,
    });
    expect(afterManifestStat.ino).toBe(beforeManifestStat.ino);
    expect(afterManifestStat.mtimeNs).toBe(beforeManifestStat.mtimeNs);
  });

  it("rolls back a new skill, draft, history and audit when its storage parent is a file", () => {
    mkdirSync(join(tenantsRoot, "raas"), { recursive: true });
    const blocked = join(tenantsRoot, "raas", "skills");
    writeFileSync(blocked, "retain this existing file");
    const before = databaseState();
    expect(() =>
      store.create(raas, { bundle: bundle(), visibility: "tenant" }),
    ).toThrow();
    expect(databaseState()).toEqual(before);
    expect(readFileSync(blocked, "utf8")).toBe("retain this existing file");
  });

  it.each(["save", "publish", "archive"] as const)(
    "rolls back %s when disk projection fails",
    (operation) => {
      const created = store.create(raas, {
        bundle: bundle(),
        visibility: "tenant",
      });
      const id = created.skill.id;
      const published = store.publish(raas, id, 1);
      const parent = join(tenantsRoot, "raas", "skills");
      const retained = join(tenantsRoot, "raas", "skills-retained");
      const beforeFiles = tree(parent);
      const beforeDb = databaseState();
      // A real local I/O failure, without replacing the store or filesystem functions.
      renameSync(parent, retained);
      writeFileSync(parent, "blocked storage directory");
      const mutation = () => {
        if (operation === "save")
          return store.save(raas, id, 1, bundle("changed-review"));
        if (operation === "publish") return store.publish(raas, id, 1);
        return store.archive(raas, id, {
          archived: true,
          expectedRevision: 1,
          expectedLatestVersionId: published.latestVersion!.id,
        });
      };
      expect(mutation).toThrow();
      expect(databaseState()).toEqual(beforeDb);
      expect(tree(retained)).toEqual(beforeFiles);
      expect(readFileSync(parent, "utf8")).toBe("blocked storage directory");
    },
  );

  it("restores the prior disk manifest when SQL commit fails after files were projected", () => {
    const created = store.create(raas, {
      bundle: bundle(),
      visibility: "tenant",
    });
    const directory = join(tenantsRoot, "raas", "skills", created.skill.id);
    const beforeManifest = readFileSync(join(directory, "current.json"));
    const beforeDb = databaseState();
    const revised = bundle("failed-commit-review");
    // Defer the audit actor constraint until COMMIT so the real projector runs first.
    getRawSqlite().pragma("defer_foreign_keys = ON");
    expect(() =>
      store.save(
        { ...raas, userId: "usr-missing" },
        created.skill.id,
        1,
        revised,
      ),
    ).toThrow(/FOREIGN KEY/i);
    expect(databaseState()).toEqual(beforeDb);
    expect(readFileSync(join(directory, "current.json"))).toEqual(
      beforeManifest,
    );
    assertBundle(directory, current(directory).draft, bundle());
    // Unselected immutable content may remain for later reuse, proving projection happened.
    expect(
      existsSync(
        join(directory, "bundles", skillBundleDigest(revised), "SKILL.md"),
      ),
    ).toBe(true);
  });

  it("reconciles existing database-only records across owners and repairs missing files without new revisions", () => {
    const legacy = new SkillLibraryStore(getDb(), null);
    const own = legacy.create(raas, { bundle: bundle(), visibility: "tenant" });
    const shared = legacy.create(superadmin, {
      bundle: bundle(),
      visibility: "shared",
    });
    const foreign = legacy.create(beta, {
      bundle: bundle(),
      visibility: "tenant",
    });
    const first = legacy.publish(raas, own.skill.id, 1).latestVersion!;
    legacy.save(raas, own.skill.id, 1, bundle("changed-review"));
    legacy.archive(raas, own.skill.id, {
      archived: true,
      expectedRevision: 2,
      expectedLatestVersionId: first.id,
    });
    legacy.publish(superadmin, shared.skill.id, 1);
    expect(existsSync(dataRoot)).toBe(false);
    expect(existsSync(tenantsRoot)).toBe(false);
    const beforeDb = databaseState();

    // Reconstruct the service as at startup, with only the configured data root.
    const restarted = new SkillLibraryStore(getDb(), { dataRoot });
    expect(restarted.reconcileFiles()).toEqual({ skills: 3, changed: 3 });
    const ownDirectory = join(
      dataRoot,
      "tenants",
      "raas",
      "skills",
      own.skill.id,
    );
    const sharedDirectory = join(dataRoot, "shared", "skills", shared.skill.id);
    const foreignDirectory = join(
      dataRoot,
      "tenants",
      "beta",
      "skills",
      foreign.skill.id,
    );
    expect(current(ownDirectory)).toMatchObject({
      owner: { tenantSlug: "raas", tenantId: "tnt-raas" },
      draft: { revision: 2 },
      metadata: { latestVersionId: first.id, archivedAt: expect.any(String) },
    });
    expect(current(ownDirectory).revisions).toHaveLength(2);
    assertBundle(ownDirectory, current(ownDirectory).versions[0]!, bundle());
    expect(current(sharedDirectory).owner.visibility).toBe("shared");
    expect(current(foreignDirectory).owner.tenantId).toBe("tnt-beta");
    expect(existsSync(join(dataRoot, "tenants", "__system"))).toBe(false);
    expect(databaseState()).toEqual(beforeDb);
    const rebuilt = tree(dataRoot);
    expect(restarted.reconcileFiles()).toEqual({ skills: 3, changed: 0 });
    expect(tree(dataRoot)).toEqual(rebuilt);

    rmSync(join(ownDirectory, current(ownDirectory).versions[0]!.path), {
      recursive: true,
    });
    expect(restarted.reconcileFiles()).toEqual({ skills: 3, changed: 1 });
    expect(tree(dataRoot)).toEqual(rebuilt);

    rmSync(ownDirectory, { recursive: true });
    expect(
      new SkillLibraryStore(getDb(), { dataRoot }).reconcileFiles(),
    ).toEqual({ skills: 3, changed: 1 });
    expect(tree(dataRoot)).toEqual(rebuilt);
    expect(databaseState()).toEqual(beforeDb);
  });

  it("only lets a platform superadmin reconcile all owners through the HTTP endpoint", async () => {
    const legacy = new SkillLibraryStore(getDb(), null);
    const own = legacy.create(raas, { bundle: bundle(), visibility: "tenant" });
    const shared = legacy.create(superadmin, {
      bundle: bundle(),
      visibility: "shared",
    });
    const foreign = legacy.create(beta, {
      bundle: bundle(),
      visibility: "tenant",
    });
    const beforeDb = databaseState();
    const app = Fastify();
    await registerEnvelope(app);
    app.addHook("preHandler", async (req) => {
      req.auth =
        req.headers["x-fixture-role"] === "superadmin" ? superadmin : raas;
    });
    await app.register(skillLibraryRoutes, { prefix: "/v1", store });
    try {
      const forbidden = await app.inject({
        method: "POST",
        url: "/v1/skills/storage/reconcile",
      });
      expect(forbidden.statusCode).toBe(403);
      expect(forbidden.json().error.code).toBe("forbidden");
      expect(existsSync(dataRoot)).toBe(false);
      expect(existsSync(tenantsRoot)).toBe(false);

      const response = await app.inject({
        method: "POST",
        url: "/v1/skills/storage/reconcile",
        headers: { "x-fixture-role": "superadmin" },
      });
      expect(response.statusCode).toBe(200);
      // The administrative response contains counts, never foreign draft data or paths.
      expect(response.json().data).toEqual({ skills: 3, changed: 3 });
      expect(
        current(join(tenantsRoot, "raas", "skills", own.skill.id)).owner
          .tenantId,
      ).toBe(raas.tenantId);
      expect(
        current(join(tenantsRoot, "beta", "skills", foreign.skill.id)).owner
          .tenantId,
      ).toBe(beta.tenantId);
      expect(
        current(join(dataRoot, "shared", "skills", shared.skill.id)).owner
          .visibility,
      ).toBe("shared");
      expect(databaseState()).toEqual(beforeDb);
    } finally {
      await app.close();
    }
  });
});
