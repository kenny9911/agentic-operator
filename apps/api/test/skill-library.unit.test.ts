import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import {
  closeDb,
  getDb,
  getRawSqlite,
  auditLog,
  managedSkills,
  skillDraftRevisions,
  skillVersions,
} from "@agentic/db";
import { eq } from "drizzle-orm";
import { can, SkillDetailSchema, type SkillBundle } from "@agentic/contracts";
import {
  exportSkillArchive,
  importSkillArchive,
  skillBundleDigest,
} from "@agentic/skills";
import {
  LLMError,
  type ChatRequest,
  type ChatResponse,
} from "@agentic/llm-gateway";
import {
  SkillLibraryStore,
  type SkillLibraryContext,
} from "../src/services/skill-library-store";
import {
  createGeneratedSkill,
  exportManagedSkill,
  previewSkillImport,
  reviseGeneratedSkill,
} from "../src/services/skill-library";
import { skillLibraryRoutes } from "../src/routes/v1/skills";
import { registerEnvelope } from "../src/plugins/error";
import {
  SkillEvaluationService,
  SKILL_EVALUATION_LIMITS,
} from "../src/services/skill-evaluation";

vi.mock("../src/services/llm", () => {
  throw new Error("Isolated tests must inject a gateway");
});

const alice: SkillLibraryContext = {
  tenantId: "tnt-a",
  tenantSlug: "alpha",
  userId: "usr-a",
  email: "a@example.test",
  name: "Alice",
  role: "admin",
  platformRole: "none",
  via: "cookie",
};
const bob: SkillLibraryContext = {
  ...alice,
  tenantId: "tnt-b",
  tenantSlug: "beta",
  userId: "usr-b",
};
const superadmin: SkillLibraryContext = {
  ...alice,
  platformRole: "superadmin",
};
const listQuery = {
  scope: "available" as const,
  archived: false,
  offset: 0,
  limit: 50,
};
function bundle(
  name = "citation-review",
  body = "Review citations and identify unsupported claims.",
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
        content: Buffer.from([0, 255, 1, 128, 13]).toString("base64"),
      },
    ],
  };
}
function generatedResponse(name = "citation-review"): ChatResponse {
  return {
    text: JSON.stringify({
      files: [
        bundle(name, "Verify citations against the supplied sources.").files[0],
      ],
      assumptions: ["The user supplies all source documents."],
      suggestedTests: [
        {
          id: "citation-check",
          prompt: "Review citations in this document.",
          shouldTrigger: true,
          expectedCriteria: ["Flags unsupported claims."],
        },
      ],
      changeSummary: ["Improve verification instructions."],
    }),
    provider: "openrouter",
    model: "openai/gpt-6-astra-pro",
    raw: { model: "openai/gpt-6-astra-pro" },
    tokensIn: 42,
    tokensOut: 21,
    latencyMs: 5,
    finishReason: "stop",
  };
}
function host(
  chat = vi.fn(async (_request: ChatRequest) => generatedResponse()),
) {
  return { capabilities: { tools: [] }, gateway: { chat } };
}
let store: SkillLibraryStore;
beforeEach(async () => {
  // Explicit process-local database. Never opens or migrates the workspace database.
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
    INSERT INTO tenants VALUES ('tnt-a','alpha'),('tnt-b','beta'),('tnt-system','__system');
    CREATE TABLE users (id TEXT PRIMARY KEY);
    INSERT INTO users VALUES ('usr-a'),('usr-b');
    CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), actor_user_id TEXT REFERENCES users(id), action TEXT NOT NULL, target_type TEXT, target_id TEXT, at INTEGER NOT NULL DEFAULT (unixepoch()*1000), meta_json TEXT);`);
  getRawSqlite().exec(
    await readFile(
      fileURLToPath(
        new URL(
          "../../../packages/db/drizzle/0080_managed_skills.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  );
  getRawSqlite().exec(
    await readFile(
      new URL(
        "../../../packages/db/drizzle/0083_managed_skill_enabled.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  store = new SkillLibraryStore(getDb(), null);
});
afterEach(() => {
  closeDb();
  vi.unstubAllEnvs();
});

describe("managed Skill library storage and API", () => {
  it("persists enabled state independently of drafts, publications and management visibility", () => {
    const created = store.create(alice, {
      bundle: bundle(),
      visibility: "tenant",
    });
    expect(created.skill.enabled).toBe(true);
    const published = store.publish(alice, created.skill.id, 1);
    const input = {
      enabled: false,
      expectedEnabled: true,
      expectedRevision: 1,
      expectedLatestVersionId: published.latestVersion!.id,
    };
    const disabled = store.setEnabled(alice, created.skill.id, input);
    expect(disabled.skill).toMatchObject({
      enabled: false,
      archivedAt: null,
      canEdit: true,
    });
    expect(disabled.draft).toEqual(published.draft);
    expect(disabled.latestVersion).toEqual(published.latestVersion);
    expect(disabled.versions).toEqual(published.versions);
    expect(store.list(alice, listQuery).skills[0]?.enabled).toBe(false);
    expect(
      new SkillLibraryStore(getDb(), null).detail(alice, created.skill.id).skill
        .enabled,
    ).toBe(false);
    const enabled = store.setEnabled(alice, created.skill.id, {
      ...input,
      enabled: true,
      expectedEnabled: false,
    });
    expect(enabled.skill.enabled).toBe(true);
    expect(enabled.latestVersion?.id).toBe(published.latestVersion?.id);
    const events = getDb()
      .select()
      .from(auditLog)
      .all()
      .filter((row) => ["skill.enable", "skill.disable"].includes(row.action));
    expect(events.map((row) => row.action)).toEqual([
      "skill.disable",
      "skill.enable",
    ]);
    expect(events[0]?.metaJson).toMatchObject({
      previousEnabled: true,
      enabled: false,
      revision: 1,
      latestVersionId: published.latestVersion!.id,
    });
  });

  it("restricts toggles to the owning tenant's editors and shared-library superadmins", () => {
    const owned = store.create(alice, {
      bundle: bundle(),
      visibility: "tenant",
    });
    const input = {
      enabled: false,
      expectedEnabled: true,
      expectedRevision: 1,
      expectedLatestVersionId: null,
    };
    expect(() => store.setEnabled(bob, owned.skill.id, input)).toThrow(
      /not found/,
    );
    for (const role of ["viewer", "operator"] as const)
      expect(() =>
        store.setEnabled({ ...alice, role }, owned.skill.id, input),
      ).toThrow(/not permitted/);
    const shared = store.create(superadmin, {
      bundle: bundle("shared-review"),
      visibility: "shared",
    });
    const publication = store.publish(superadmin, shared.skill.id, 1);
    const sharedInput = {
      ...input,
      expectedLatestVersionId: publication.latestVersion!.id,
    };
    expect(() => store.setEnabled(alice, shared.skill.id, sharedInput)).toThrow(
      /not permitted/,
    );
    expect(
      store.setEnabled(superadmin, shared.skill.id, sharedInput).skill.enabled,
    ).toBe(false);
    expect(store.detail(alice, shared.skill.id).skill).toMatchObject({
      enabled: false,
      canEdit: false,
    });
    expect(
      getDb()
        .select()
        .from(auditLog)
        .all()
        .find((row) => row.action === "skill.disable")?.tenantId,
    ).toBe("tnt-system");
  });

  it("rejects stale state, draft and publication toggles without duplicate audit events", () => {
    const created = store.create(alice, {
      bundle: bundle(),
      visibility: "tenant",
    });
    const input = {
      enabled: false,
      expectedEnabled: true,
      expectedRevision: 1,
      expectedLatestVersionId: null,
    };
    store.setEnabled(alice, created.skill.id, input);
    expect(() => store.setEnabled(alice, created.skill.id, input)).toThrow(
      /availability or publication changed/,
    );
    store.setEnabled(alice, created.skill.id, {
      ...input,
      expectedEnabled: false,
    });
    expect(
      getDb()
        .select()
        .from(auditLog)
        .all()
        .filter((row) => row.action === "skill.disable"),
    ).toHaveLength(1);
    store.save(alice, created.skill.id, 1, bundle("revised-review"));
    expect(() =>
      store.setEnabled(alice, created.skill.id, {
        ...input,
        enabled: true,
        expectedEnabled: false,
      }),
    ).toThrow(/draft changed/);
    store.publish(alice, created.skill.id, 2);
    expect(() =>
      store.setEnabled(alice, created.skill.id, {
        ...input,
        enabled: true,
        expectedEnabled: false,
        expectedRevision: 2,
      }),
    ).toThrow(/publication changed/);
    expect(store.detail(alice, created.skill.id).skill.enabled).toBe(false);
  });

  it("rolls back the enabled switch if its audit event cannot be persisted", () => {
    const created = store.create(alice, {
      bundle: bundle(),
      visibility: "tenant",
    });
    getRawSqlite().exec(
      "CREATE TRIGGER reject_disable_audit BEFORE INSERT ON audit_log WHEN NEW.action='skill.disable' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;",
    );
    expect(() =>
      store.setEnabled(alice, created.skill.id, {
        enabled: false,
        expectedEnabled: true,
        expectedRevision: 1,
        expectedLatestVersionId: null,
      }),
    ).toThrow(/audit unavailable/);
    expect(store.detail(alice, created.skill.id)).toEqual(created);
  });

  it("serves a strict authenticated toggle contract with state conflict details", async () => {
    const created = store.create(alice, {
      bundle: bundle(),
      visibility: "tenant",
    });
    const app = Fastify();
    await registerEnvelope(app);
    app.addHook("preHandler", async (req) => {
      req.auth =
        req.headers["x-fixture-role"] === "viewer"
          ? { ...alice, role: "viewer" }
          : req.headers["x-fixture-tenant"] === "beta"
            ? bob
            : alice;
    });
    await app.register(skillLibraryRoutes, { prefix: "/v1", store });
    const request = {
      method: "PATCH" as const,
      url: `/v1/skills/${created.skill.id}/enabled`,
      payload: {
        enabled: false,
        expectedEnabled: true,
        expectedRevision: 1,
        expectedLatestVersionId: null,
      },
    };
    try {
      expect(
        (
          await app.inject({
            ...request,
            headers: { "x-fixture-role": "viewer" },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            ...request,
            headers: { "x-fixture-tenant": "beta" },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject({
            ...request,
            payload: { ...request.payload, tenantId: "tnt-b" },
          })
        ).statusCode,
      ).toBe(400);
      const success = await app.inject(request);
      expect(success.statusCode).toBe(200);
      expect(SkillDetailSchema.parse(success.json().data).skill.enabled).toBe(
        false,
      );
      const stale = await app.inject(request);
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error).toMatchObject({
        code: "revision_conflict",
        details: { enabled: false, currentRevision: 1, latestVersionId: null },
      });
    } finally {
      await app.close();
    }
  });

  it("paginates publication history beyond the detail preview without loading version bundles", () => {
    const created = store.create(alice, {
      bundle: bundle(),
      visibility: "tenant",
    });
    for (let i = 0; i < 101; i++) store.publish(alice, created.skill.id, 1);
    const first = store.versionHistory(alice, created.skill.id, {
      offset: 0,
      limit: 100,
    });
    expect(first.versions).toHaveLength(100);
    expect(first.nextOffset).toBe(100);
    const last = store.versionHistory(alice, created.skill.id, {
      offset: 100,
      limit: 100,
    });
    expect(last.versions).toHaveLength(1);
    expect(last.versions[0]?.versionNo).toBe(1);
    expect(last.nextOffset).toBeNull();
    expect(last.versions[0]).not.toHaveProperty("bundle");
  });
  it("enforces dedicated read/write/publish role permissions", () => {
    expect(can("viewer", "none", "skills.read")).toBe(true);
    expect(can("operator", "none", "skills.write")).toBe(false);
    expect(can("admin", "none", "skills.publish")).toBe(true);
    expect(() =>
      store.create(
        { ...alice, role: "viewer" },
        { bundle: bundle(), visibility: "tenant" },
      ),
    ).toThrow(/not permitted/);
  });
  it("isolates tenant skills, drafts, versions and mutation identifiers", () => {
    const first = store.create(alice, {
      bundle: bundle(),
      visibility: "tenant",
    });
    store.publish(alice, first.skill.id, 1);
    expect(store.list(bob, listQuery).skills).toEqual([]);
    for (const read of [
      () => store.detail(bob, first.skill.id),
      () => store.history(bob, first.skill.id, { offset: 0, limit: 10 }),
      () => store.publishedVersion(bob, first.skill.id),
      () => store.save(bob, first.skill.id, 1, bundle()),
    ])
      expect(read).toThrow(/not found/);
    expect(
      store.create(bob, { bundle: bundle(), visibility: "tenant" }).skill.name,
    ).toBe(first.skill.name);
  });
  it("anchors shared ownership to __system and keeps unpublished drafts/provenance private", () => {
    expect(() =>
      store.create(alice, { bundle: bundle(), visibility: "shared" }),
    ).toThrow(/not permitted/);
    const created = store.create(superadmin, {
      bundle: bundle(),
      visibility: "shared",
    });
    expect(created.skill).toMatchObject({
      tenantId: "tnt-system",
      canEdit: true,
    });
    expect(store.list(bob, listQuery).skills).toEqual([]);
    expect(() => store.detail(bob, created.skill.id)).toThrow(/not found/);
    const published = store.publish(superadmin, created.skill.id, 1);
    store.save(
      superadmin,
      created.skill.id,
      1,
      bundle("private-new-name", "PRIVATE_DRAFT_ONLY"),
    );
    const publicDetail = store.detail(bob, created.skill.id);
    expect(publicDetail.draft).toBeNull();
    expect(publicDetail.skill).toMatchObject({
      name: "citation-review",
      draftRevision: null,
      canEdit: false,
    });
    expect(publicDetail.latestVersion?.createdBy).toBeNull();
    expect(JSON.stringify(publicDetail)).not.toContain("PRIVATE_DRAFT_ONLY");
    expect(() => store.draftForRead(bob, created.skill.id)).toThrow(
      /not found/,
    );
    expect(() => store.publish(bob, created.skill.id, 2)).toThrow(
      /not permitted/,
    );
    expect(store.publishedVersion(bob, created.skill.id).id).toBe(
      published.latestVersion?.id,
    );
    // Even a non-superadmin operating inside the system tenant is a public reader.
    const systemReader = { ...bob, tenantId: "tnt-system" };
    expect(store.detail(systemReader, created.skill.id).draft).toBeNull();
  });
  it("saves invalid editable text with diagnostics but refuses unsafe bytes and publication", () => {
    const created = store.create(alice, {
      bundle: bundle(),
      visibility: "tenant",
    });
    const broken = {
      files: [
        {
          path: "SKILL.md",
          encoding: "utf8" as const,
          content: "---\nname: [broken\n---\n",
        },
      ],
    };
    const saved = store.save(alice, created.skill.id, 1, broken);
    expect(saved.draft?.revision).toBe(2);
    expect(
      saved.draft?.diagnostics.some((item) => item.severity === "error"),
    ).toBe(true);
    expect(() => store.publish(alice, created.skill.id, 2)).toThrow();
    expect(() =>
      store.save(alice, created.skill.id, 2, {
        files: [
          ...bundle().files,
          { path: "ASSETS/sample.bin", encoding: "utf8", content: "collision" },
        ],
      }),
    ).toThrow();
    expect(store.detail(alice, created.skill.id).draft?.revision).toBe(2);
    expect(() =>
      store.save(alice, created.skill.id, 2, {
        files: [
          {
            path: "SKILL.md",
            encoding: "utf8",
            content: "x".repeat(256 * 1024 + 1),
          },
        ],
      }),
    ).toThrow();
  });
  it("publishes immutable versions and changes canonical names only on publication", () => {
    const created = store.create(alice, {
      bundle: bundle(),
      visibility: "tenant",
    });
    const first = store.publish(alice, created.skill.id, 1).latestVersion!;
    const edited = store.save(
      alice,
      created.skill.id,
      1,
      bundle("renamed-review"),
    );
    expect(edited.skill.name).toBe("citation-review");
    const next = store.publish(alice, created.skill.id, 2);
    expect(next.skill.name).toBe("renamed-review");
    expect(next.latestVersion?.versionNo).toBe(2);
    expect(store.publishedVersion(alice, created.skill.id, first.id)).toEqual(
      first,
    );
    expect(() =>
      getDb()
        .update(skillVersions)
        .set({ name: "tampered" })
        .where(eq(skillVersions.id, first.id))
        .run(),
    ).toThrow(/immutable/);
    expect(() =>
      getRawSqlite()
        .prepare("DELETE FROM skill_versions WHERE id=?")
        .run(first.id),
    ).toThrow(/cannot be deleted/);
    expect(() =>
      getDb().update(skillDraftRevisions).set({ revision: 55 }).run(),
    ).toThrow(/immutable/);
  });
  it("rejects duplicate imports/renames explicitly and leaves both drafts and publications unchanged", () => {
    const first = store.create(alice, {
      bundle: bundle(),
      visibility: "tenant",
    });
    expect(() =>
      store.create(alice, { bundle: bundle(), visibility: "tenant" }, "import"),
    ).toThrow(/already exists/);
    const second = store.create(alice, {
      bundle: bundle("different-review"),
      visibility: "tenant",
    });
    store.save(alice, second.skill.id, 1, bundle());
    expect(() => store.publish(alice, second.skill.id, 2)).toThrow(
      /already exists/,
    );
    expect(store.detail(alice, second.skill.id).skill.name).toBe(
      "different-review",
    );
    expect(store.detail(alice, first.skill.id).draft?.revision).toBe(1);
  });
  it("uses revision CAS for saves/restores and availability changes", () => {
    const created = store.create(alice, {
      bundle: bundle(),
      visibility: "tenant",
    });
    store.save(alice, created.skill.id, 1, bundle("next-name"));
    expect(() => store.save(alice, created.skill.id, 1, bundle())).toThrow(
      /draft changed/,
    );
    const restored = store.restore(alice, created.skill.id, 2, 1);
    expect(restored.draft?.revision).toBe(3);
    expect(restored.draft?.bundle).toEqual(created.draft?.bundle);
    expect(
      store.history(alice, created.skill.id, { offset: 0, limit: 2 }),
    ).toMatchObject({
      revisions: [
        { revision: 3, source: "restore" },
        { revision: 2, source: "manual" },
      ],
      nextOffset: 2,
    });
    const published = store.publish(alice, created.skill.id, 3);
    expect(() =>
      store.archive(alice, created.skill.id, {
        archived: true,
        expectedRevision: 3,
        expectedLatestVersionId: null,
      }),
    ).toThrow(/publication changed/);
    const archived = store.archive(alice, created.skill.id, {
      archived: true,
      expectedRevision: 3,
      expectedLatestVersionId: published.latestVersion!.id,
    });
    expect(archived.skill.archivedAt).not.toBeNull();
    expect(store.list(alice, listQuery).skills).toEqual([]);
    expect(() => store.save(alice, created.skill.id, 3, bundle())).toThrow(
      /archived/,
    );
    expect(
      store.archive(alice, created.skill.id, {
        archived: false,
        expectedRevision: 3,
        expectedLatestVersionId: published.latestVersion!.id,
      }).skill.archivedAt,
    ).toBeNull();
  });
  it("rolls back the complete mutation when transactional audit persistence fails", () => {
    getRawSqlite().exec(
      "CREATE TRIGGER reject_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;",
    );
    expect(() =>
      store.create(alice, { bundle: bundle(), visibility: "tenant" }),
    ).toThrow(/audit unavailable/);
    expect(getDb().select().from(managedSkills).all()).toHaveLength(0);
    expect(getDb().select().from(skillDraftRevisions).all()).toHaveLength(0);
  });
  it("round-trips binary assets through import preview and published ZIP export without implicit overwrite", async () => {
    const original = bundle();
    const archive = await exportSkillArchive(original);
    const preview = await previewSkillImport({
      format: "zip",
      archiveBase64: archive.toString("base64"),
    });
    expect(preview.valid).toBe(true);
    expect(getDb().select().from(managedSkills).all()).toEqual([]);
    const created = store.create(
      alice,
      { bundle: preview.bundle, visibility: "tenant" },
      "import",
    );
    store.publish(alice, created.skill.id, 1);
    const exported = await exportManagedSkill(store, alice, created.skill.id, {
      format: "zip",
      draft: false,
    });
    expect(skillBundleDigest(await importSkillArchive(exported.bytes))).toBe(
      skillBundleDigest(original),
    );
    const md = await exportManagedSkill(store, alice, created.skill.id, {
      format: "markdown",
      draft: false,
    });
    expect(md.bytes.toString()).toBe(original.files[0]!.content);
    expect(md.filename).toBe("SKILL.md");
    expect(
      getDb()
        .select()
        .from(auditLog)
        .all()
        .map((row) => row.action),
    ).toEqual(["skill.import", "skill.publish"]);
  });
  it("persists validated AI revisions/provenance while preserving binary resources", async () => {
    const created = store.create(alice, {
      bundle: bundle(),
      visibility: "tenant",
    });
    const port = host();
    const result = await reviseGeneratedSkill(
      store,
      alice,
      created.skill.id,
      { expectedRevision: 1, purpose: "Improve citations" },
      port,
    );
    expect(result.detail.draft?.revision).toBe(2);
    expect(
      result.detail.draft?.bundle.files.find(
        (file) => file.path === "assets/sample.bin",
      ),
    ).toEqual(bundle().files[1]);
    expect(result.detail.draft?.provenance).toEqual(
      result.generation.provenance,
    );
    expect(result.detail.draft?.creatorNotes).toMatchObject({
      generatedRevision: 2,
      evaluationStatus: "unexecuted",
      assumptions: ["The user supplies all source documents."],
      suggestedTests: [{ id: "citation-check" }],
    });
    expect(port.gateway.chat.mock.calls[0]?.[0]).toMatchObject({
      tenantId: alice.tenantId,
      routing: { taskType: "agent.author" },
    });
    expect(getDb().select().from(auditLog).all().at(-1)?.action).toBe(
      "skill.draft.generate",
    );
    const manual = store.save(
      alice,
      created.skill.id,
      2,
      bundle("manual-revision"),
    );
    expect(manual.draft?.creatorNotes).toEqual(
      result.detail.draft?.creatorNotes,
    );
    expect(manual.draft?.provenance).toEqual(result.generation.provenance);
    expect(
      store.historicalDraft(alice, created.skill.id, 2).creatorNotes,
    ).toEqual(manual.draft?.creatorNotes);
    const restored = store.restore(alice, created.skill.id, 3, 1);
    expect(restored.draft?.creatorNotes).toBeNull();
    expect(restored.draft?.provenance).toBeNull();
  });
  it("rejects concurrent manual changes after a real generation call without losing either saved revision", async () => {
    const created = store.create(alice, {
      bundle: bundle(),
      visibility: "tenant",
    });
    const port = host(
      vi.fn(async () => {
        store.save(alice, created.skill.id, 1, bundle("human-edited-name"));
        return generatedResponse();
      }),
    );
    await expect(
      reviseGeneratedSkill(
        store,
        alice,
        created.skill.id,
        { expectedRevision: 1, purpose: "Revise" },
        port,
      ),
    ).rejects.toMatchObject({
      code: "revision_conflict",
      details: { currentRevision: 2 },
    });
    expect(store.detail(alice, created.skill.id).draft?.bundle).toEqual(
      bundle("human-edited-name"),
    );
    expect(
      store.history(alice, created.skill.id, { offset: 0, limit: 10 })
        .revisions,
    ).toHaveLength(2);
  });
  it("does not persist a generation on provider failure, cancellation or stale starting revision", async () => {
    const created = store.create(alice, {
      bundle: bundle(),
      visibility: "tenant",
    });
    const failing = host(
      vi.fn(async () => {
        throw new LLMError("provider down", "provider_error", "deepseek");
      }),
    );
    await expect(
      reviseGeneratedSkill(
        store,
        alice,
        created.skill.id,
        { expectedRevision: 1, purpose: "Revise" },
        failing,
      ),
    ).rejects.toThrow("provider down");
    const stale = host();
    await expect(
      reviseGeneratedSkill(
        store,
        alice,
        created.skill.id,
        { expectedRevision: 99, purpose: "Revise" },
        stale,
      ),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    expect(stale.gateway.chat).not.toHaveBeenCalled();
    const controller = new AbortController();
    const cancelled = host(
      vi.fn(async () => {
        controller.abort();
        return generatedResponse("new-generated-skill");
      }),
    );
    await expect(
      createGeneratedSkill(
        store,
        alice,
        { purpose: "Create", visibility: "tenant" },
        { ...cancelled, signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(store.detail(alice, created.skill.id).draft?.revision).toBe(1);
    expect(store.list(alice, listQuery).skills).toHaveLength(1);
  });
  it("serves authenticated contracts, safe downloads and conflict details through the actual routes", async () => {
    const app = Fastify();
    await registerEnvelope(app);
    app.addHook("preHandler", async (req) => {
      req.auth = req.headers["x-fixture-tenant"] === "beta" ? bob : alice;
    });
    await app.register(skillLibraryRoutes, {
      prefix: "/v1",
      store,
      creatorHost: async () => host(),
    });
    try {
      const create = await app.inject({
        method: "POST",
        url: "/v1/skills",
        payload: { bundle: bundle(), visibility: "tenant" },
      });
      expect(create.statusCode).toBe(201);
      const detail = SkillDetailSchema.parse(create.json().data);
      const id = detail.skill.id;
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/v1/skills/${id}`,
            headers: { "x-fixture-tenant": "beta" },
          })
        ).statusCode,
      ).toBe(404);
      const invalidBody = await app.inject({
        method: "PUT",
        url: `/v1/skills/${id}/draft`,
        payload: { expectedRevision: 1, bundle: bundle(), tenantId: "tnt-b" },
      });
      expect(invalidBody.statusCode).toBe(400);
      const publish = await app.inject({
        method: "POST",
        url: `/v1/skills/${id}/publish`,
        payload: { expectedRevision: 1 },
      });
      expect(publish.statusCode).toBe(200);
      const zip = await app.inject({
        method: "GET",
        url: `/v1/skills/${id}/export?format=zip`,
      });
      expect(zip.headers["content-type"]).toContain("application/zip");
      expect(zip.headers["content-disposition"]).toBe(
        'attachment; filename="citation-review.zip"',
      );
      expect(zip.headers["x-content-type-options"]).toBe("nosniff");
      expect(skillBundleDigest(await importSkillArchive(zip.rawPayload))).toBe(
        skillBundleDigest(bundle()),
      );
      await app.inject({
        method: "PUT",
        url: `/v1/skills/${id}/draft`,
        payload: { expectedRevision: 1, bundle: bundle("edited") },
      });
      const conflict = await app.inject({
        method: "POST",
        url: `/v1/skills/${id}/publish`,
        payload: { expectedRevision: 1 },
      });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json().error.details.currentRevision).toBe(2);
    } finally {
      await app.close();
    }
  });
});

describe("managed Creator policy availability", () => {
  function creatorBundle(
    name = "agentic-skill-creator",
    imported = true,
  ): SkillBundle {
    const value = bundle(name);
    if (imported)
      value.files[0]!.content = value.files[0]!.content.replace(
        "---\nReview citations and identify unsupported claims.",
        "metadata:\n  agentic-import-format: catalog-v1\n  agentic-catalog-id: agentic/skill-creator\n  agentic-source-id: agentic\n  agentic-upstream-path: packages/skills/builtin/skill-creator\n  agentic-upstream-name: skill-creator\n---\nReview citations and identify unsupported claims.",
      );
    return value;
  }
  function createCreator(name = "agentic-skill-creator", imported = true) {
    const created = store.create(superadmin, {
      bundle: creatorBundle(name, imported),
      visibility: "shared",
    });
    return store.publish(superadmin, created.skill.id, 1);
  }
  function disable(detail: ReturnType<SkillLibraryStore["detail"]>) {
    return store.setEnabled(superadmin, detail.skill.id, {
      enabled: false,
      expectedEnabled: true,
      expectedRevision: detail.draft!.revision,
      expectedLatestVersionId: detail.skill.latestVersionId,
    });
  }

  it("blocks authoring from a disabled canonical Creator even after its display name changes", async () => {
    disable(createCreator("renamed-first-party-creator"));
    const port = host();
    await expect(
      createGeneratedSkill(
        store,
        alice,
        { purpose: "Create a citation skill", visibility: "tenant" },
        port,
      ),
    ).rejects.toMatchObject({ code: "skill_disabled" });
    expect(port.gateway.chat).not.toHaveBeenCalled();
    expect(store.list(alice, { ...listQuery, scope: "owned" }).skills).toEqual(
      [],
    );
  });

  it("allows AI revision of a disabled target when the authoring policy is enabled", async () => {
    createCreator();
    const target = store.create(alice, {
      bundle: bundle(),
      visibility: "tenant",
    });
    store.setEnabled(alice, target.skill.id, {
      enabled: false,
      expectedEnabled: true,
      expectedRevision: 1,
      expectedLatestVersionId: null,
    });
    const port = host();
    const revised = await reviseGeneratedSkill(
      store,
      alice,
      target.skill.id,
      { expectedRevision: 1, purpose: "Improve this disabled draft" },
      port,
    );
    expect(port.gateway.chat).toHaveBeenCalledTimes(1);
    expect(revised.detail.skill).toMatchObject({
      enabled: false,
      draftRevision: 2,
    });
  });

  it("does not let an unrelated same-name custom record control the intrinsic Creator", async () => {
    disable(createCreator("agentic-skill-creator", false));
    const port = host();
    await expect(
      createGeneratedSkill(
        store,
        alice,
        { purpose: "Create a citation skill", visibility: "tenant" },
        port,
      ),
    ).resolves.toMatchObject({ detail: { skill: { enabled: true } } });
    expect(port.gateway.chat).toHaveBeenCalledTimes(1);
  });

  it("does not let a tenant's copied Creator metadata control shared authoring", async () => {
    const copied = store.create(alice, {
      bundle: creatorBundle(),
      visibility: "tenant",
    });
    store.setEnabled(alice, copied.skill.id, {
      enabled: false,
      expectedEnabled: true,
      expectedRevision: 1,
      expectedLatestVersionId: null,
    });
    const port = host();
    await createGeneratedSkill(
      store,
      alice,
      { purpose: "Create a citation skill", visibility: "tenant" },
      port,
    );
    expect(port.gateway.chat).toHaveBeenCalledTimes(1);
  });

  it("stops schema repair if the canonical Creator is disabled after the first model call", async () => {
    const creator = createCreator();
    const port = host(
      vi.fn(async () => {
        disable(creator);
        return { ...generatedResponse(), text: "invalid JSON" };
      }),
    );
    await expect(
      createGeneratedSkill(
        store,
        alice,
        { purpose: "Create a citation skill", visibility: "tenant" },
        port,
      ),
    ).rejects.toMatchObject({ code: "skill_disabled" });
    expect(port.gateway.chat).toHaveBeenCalledTimes(1);
    expect(store.list(alice, { ...listQuery, scope: "owned" }).skills).toEqual(
      [],
    );
  });
});

describe("observed Skill comparisons and human grades", () => {
  const prompt = "Review the claims in the supplied document.";
  const expectations = ["Flags unsupported claims."];
  function evaluationHost(
    ...responses: Array<
      Partial<ChatResponse> | Error | (() => Partial<ChatResponse>)
    >
  ) {
    const chat = vi.fn(async (_request: ChatRequest): Promise<ChatResponse> => {
      const next = responses.shift();
      if (!next) throw new Error("Unexpected comparison call");
      if (next instanceof Error) throw next;
      return {
        ...generatedResponse(),
        text: "Observed answer.",
        ...(typeof next === "function" ? next() : next),
      };
    });
    return { gateway: { chat } };
  }
  it("blocks both draft and published comparisons while disabled without making a model call", async () => {
    const created = store.create(alice, {
      bundle: bundle(),
      visibility: "tenant",
    });
    const published = store.publish(alice, created.skill.id, 1);
    store.setEnabled(alice, created.skill.id, {
      enabled: false,
      expectedEnabled: true,
      expectedRevision: 1,
      expectedLatestVersionId: published.latestVersion!.id,
    });
    const service = new SkillEvaluationService(getDb(), store);
    const port = evaluationHost();
    for (const source of [
      { expectedRevision: 1 },
      { versionId: published.latestVersion!.id },
    ])
      await expect(
        service.evaluate(
          alice,
          created.skill.id,
          { prompt, expectations, ...source },
          port,
        ),
      ).rejects.toMatchObject({ code: "skill_disabled" });
    expect(port.gateway.chat).not.toHaveBeenCalled();
    expect(
      getRawSqlite()
        .prepare("SELECT count(*) AS n FROM skill_evaluations")
        .get(),
    ).toEqual({ n: 0 });
    expect(store.publishedVersion(alice, created.skill.id).bundle).toEqual(
      bundle(),
    );
  });

  it("rechecks live enabled state between baseline and guided comparison calls", async () => {
    const created = store.create(alice, {
      bundle: bundle(),
      visibility: "tenant",
    });
    const service = new SkillEvaluationService(getDb(), store);
    const port = evaluationHost(() => {
      store.setEnabled(alice, created.skill.id, {
        enabled: false,
        expectedEnabled: true,
        expectedRevision: 1,
        expectedLatestVersionId: null,
      });
      return { text: "Baseline completed before the switch changed." };
    });
    await expect(
      service.evaluate(
        alice,
        created.skill.id,
        { prompt, expectations, expectedRevision: 1 },
        port,
      ),
    ).rejects.toMatchObject({ code: "skill_disabled" });
    expect(port.gateway.chat).toHaveBeenCalledTimes(1);
    const row = getRawSqlite()
      .prepare("SELECT result_json FROM skill_evaluations")
      .get() as { result_json: string };
    expect(JSON.parse(row.result_json)).toMatchObject({
      status: "failed",
      baseline: { text: "Baseline completed before the switch changed." },
      withSkill: { status: "failed", error: { code: "skill_disabled" } },
    });
  });
  it("records two real attributed observations with an immutable source and no automatic grade", async () => {
    const created = store.create(alice, {
      bundle: bundle(),
      visibility: "tenant",
    });
    const service = new SkillEvaluationService(getDb(), store);
    const port = evaluationHost(
      {
        text: "Baseline observation.",
        raw: { reasoning_content: "DO_NOT_STORE_OPAQUE" },
      },
      {
        text: "Skill-guided observation.",
        reasoningContent: "DO_NOT_STORE_OPAQUE",
      },
    );
    const result = await service.evaluate(
      alice,
      created.skill.id,
      {
        prompt,
        expectations,
        expectedRevision: 1,
        modelRoute: "authoring/deepseek-chat",
      },
      port,
    );
    expect(result).toMatchObject({
      status: "completed",
      source: {
        kind: "draft",
        draftRevision: 1,
        contentDigest: skillBundleDigest(bundle()),
      },
      grade: null,
      baseline: {
        text: "Baseline observation.",
        provider: "openrouter",
        model: "openai/gpt-6-astra-pro",
        tokensIn: 42,
      },
      withSkill: { text: "Skill-guided observation." },
    });
    expect(result.limitations.join(" ")).toContain("No business tools");
    const calls = port.gateway.chat.mock.calls.map(([request]) => request);
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[0]!.messages)).not.toContain(
      "Review citations and identify unsupported claims.",
    );
    expect(JSON.stringify(calls[1]!.messages)).toContain(
      "Review citations and identify unsupported claims.",
    );
    for (const call of calls) {
      expect(call).toMatchObject({
        tenantId: alice.tenantId,
        routing: {
          taskType: "evaluation.run",
          requestedRoute: "authoring/deepseek-chat",
        },
        attribution: {
          actorId: alice.userId,
          billingAccountId: alice.tenantId,
          interactionId: result.id,
        },
      });
      expect(call.tools).toBeUndefined();
    }
    expect(service.get(alice, created.skill.id, result.id)).toEqual(result);
    expect(JSON.stringify(result)).not.toContain("DO_NOT_STORE_OPAQUE");
    const graded = service.grade(alice, created.skill.id, result.id, {
      expectedGradeRevision: 0,
      verdict: "pass",
      comment: "I checked both answers against the supplied sources.",
    });
    expect(graded).toMatchObject({
      status: "completed",
      grade: { revision: 1, verdict: "pass", actorId: alice.userId },
    });
    expect(port.gateway.chat).toHaveBeenCalledTimes(2);
    expect(() =>
      service.grade(alice, created.skill.id, result.id, {
        expectedGradeRevision: 0,
        verdict: "fail",
        comment: "stale",
      }),
    ).toThrow(/review changed/);
  });
  it("retains the captured revision if the editable draft changes during the comparison", async () => {
    const created = store.create(alice, {
      bundle: bundle(),
      visibility: "tenant",
    });
    const service = new SkillEvaluationService(getDb(), store);
    const port = evaluationHost(
      () => {
        store.save(
          alice,
          created.skill.id,
          1,
          bundle("updated-name", "NEW_UNOBSERVED_INSTRUCTIONS"),
        );
        return { text: "Baseline" };
      },
      { text: "With original Skill" },
    );
    const result = await service.evaluate(
      alice,
      created.skill.id,
      { prompt, expectations, expectedRevision: 1 },
      port,
    );
    expect(result.source.draftRevision).toBe(1);
    expect(store.detail(alice, created.skill.id).draft?.revision).toBe(2);
    expect(
      JSON.stringify(port.gateway.chat.mock.calls[1]?.[0].messages),
    ).not.toContain("NEW_UNOBSERVED_INSTRUCTIONS");
    expect(result.source.contentDigest).toBe(
      skillBundleDigest(
        store.historicalDraft(alice, created.skill.id, 1).bundle,
      ),
    );
  });
  it("preserves baseline usage and the real provider failure when the second arm fails", async () => {
    const created = store.create(alice, {
      bundle: bundle(),
      visibility: "tenant",
    });
    const service = new SkillEvaluationService(getDb(), store);
    const failure = new LLMError(
      "actual provider outage",
      "provider_error",
      "deepseek",
    );
    await expect(
      service.evaluate(
        alice,
        created.skill.id,
        { prompt, expectations, expectedRevision: 1 },
        evaluationHost({ text: "Baseline completed" }, failure),
      ),
    ).rejects.toBe(failure);
    const result = service.list(alice, created.skill.id, {
      offset: 0,
      limit: 10,
    }).evaluations[0]!;
    expect(result).toMatchObject({
      status: "failed",
      baseline: { status: "completed", tokensIn: 42 },
      withSkill: {
        status: "failed",
        error: { message: "actual provider outage" },
      },
      grade: null,
    });
    expect(failure).toHaveProperty("evaluationId", result.id);
    expect(() =>
      service.grade(alice, created.skill.id, result.id, {
        expectedGradeRevision: 0,
        verdict: "pass",
        comment: "",
      }),
    ).toThrow(/completed comparison/);
  });
  it.each([
    { provider: "mock" as const },
    { finishReason: "length" as const },
    { text: "" },
    { toolCalls: [{ id: "write-1", name: "sendEmail", input: {} }] },
  ])(
    "fails visibly without synthetic success for unusable provider output %j",
    async (response) => {
      const created = store.create(alice, {
        bundle: bundle(),
        visibility: "tenant",
      });
      const service = new SkillEvaluationService(getDb(), store);
      const port = evaluationHost(response);
      await expect(
        service.evaluate(
          alice,
          created.skill.id,
          { prompt, expectations, expectedRevision: 1 },
          port,
        ),
      ).rejects.toThrow();
      const result = service.list(alice, created.skill.id, {
        offset: 0,
        limit: 10,
      }).evaluations[0]!;
      expect(result.status).toBe("failed");
      expect(result.grade).toBeNull();
      expect(result.withSkill).toBeNull();
      expect(port.gateway.chat).toHaveBeenCalledTimes(1);
    },
  );
  it("cancels between arms after persisting the observed response", async () => {
    const created = store.create(alice, {
      bundle: bundle(),
      visibility: "tenant",
    });
    const service = new SkillEvaluationService(getDb(), store);
    const controller = new AbortController();
    const port = evaluationHost(() => {
      controller.abort();
      return { text: "Observed before cancellation" };
    });
    await expect(
      service.evaluate(
        alice,
        created.skill.id,
        { prompt, expectations, expectedRevision: 1 },
        { ...port, signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(
      service.list(alice, created.skill.id, { offset: 0, limit: 10 })
        .evaluations[0],
    ).toMatchObject({
      status: "cancelled",
      baseline: { status: "completed", text: "Observed before cancellation" },
      withSkill: null,
      grade: null,
    });
    expect(port.gateway.chat).toHaveBeenCalledTimes(1);
  });
  it("keeps evaluations of shared Skills private to the evaluating tenant", async () => {
    const created = store.create(superadmin, {
      bundle: bundle(),
      visibility: "shared",
    });
    const published = store.publish(superadmin, created.skill.id, 1);
    const service = new SkillEvaluationService(getDb(), store);
    const result = await service.evaluate(
      bob,
      created.skill.id,
      {
        prompt: "PRIVATE_BETA_DOCUMENT",
        expectations,
        versionId: published.latestVersion!.id,
      },
      evaluationHost({}, {}),
    );
    expect(
      service.list(alice, created.skill.id, { offset: 0, limit: 10 })
        .evaluations,
    ).toEqual([]);
    expect(() => service.get(superadmin, created.skill.id, result.id)).toThrow(
      /not found/,
    );
    expect(() =>
      service.grade(alice, created.skill.id, result.id, {
        expectedGradeRevision: 0,
        verdict: "pass",
        comment: "",
      }),
    ).toThrow(/not found/);
    expect(service.get(bob, created.skill.id, result.id).prompt).toBe(
      "PRIVATE_BETA_DOCUMENT",
    );
  });
  it("rejects oversized and stale draft contexts before spending provider budget", async () => {
    const created = store.create(alice, {
      bundle: bundle(
        "large-review",
        "a".repeat(SKILL_EVALUATION_LIMITS.maxInstructionsBytes + 1),
      ),
      visibility: "tenant",
    });
    const service = new SkillEvaluationService(getDb(), store);
    const port = evaluationHost({}, {});
    await expect(
      service.evaluate(
        alice,
        created.skill.id,
        { prompt, expectations, expectedRevision: 1 },
        port,
      ),
    ).rejects.toMatchObject({ code: "context_too_large" });
    await expect(
      service.evaluate(
        alice,
        created.skill.id,
        { prompt, expectations, expectedRevision: 999 },
        port,
      ),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    expect(port.gateway.chat).not.toHaveBeenCalled();
    expect(
      service.list(alice, created.skill.id, { offset: 0, limit: 10 })
        .evaluations,
    ).toEqual([]);
  });
  it("rolls back a human grade if its audit cannot be saved", async () => {
    const created = store.create(alice, {
      bundle: bundle(),
      visibility: "tenant",
    });
    const service = new SkillEvaluationService(getDb(), store);
    const result = await service.evaluate(
      alice,
      created.skill.id,
      { prompt, expectations, expectedRevision: 1 },
      evaluationHost({}, {}),
    );
    getRawSqlite().exec(
      "CREATE TRIGGER reject_grade_audit BEFORE INSERT ON audit_log WHEN NEW.action='skill.evaluation.grade' BEGIN SELECT RAISE(ABORT,'grade audit unavailable'); END;",
    );
    expect(() =>
      service.grade(alice, created.skill.id, result.id, {
        expectedGradeRevision: 0,
        verdict: "fail",
        comment: "Wrong source",
      }),
    ).toThrow(/grade audit unavailable/);
    expect(service.get(alice, created.skill.id, result.id).grade).toBeNull();
  });
});
