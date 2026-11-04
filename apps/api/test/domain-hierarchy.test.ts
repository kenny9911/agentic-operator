import { readFileSync } from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  agents,
  apiTokens,
  auditLog,
  closeDb,
  deployments,
  domainMemberships,
  domains,
  getDb,
  getRawSqlite,
  getTenantInngestDeploymentMarker,
  memberships,
  runMigrations,
  runs,
  tenantRuntimeNamespaces,
  tenants,
  users,
  workflows,
} from "@agentic/db";
import { type Domain } from "@agentic/contracts";
import { registerEnvelope } from "../src/plugins/error";
import type { AuthedContext } from "../src/plugins/auth";
import { domainRoutes } from "../src/routes/v1/domains";
import {
  archiveDomain,
  createDomain,
  domainForRuntimeTenant,
  domainHasActiveWork,
  domainRoleForUser,
  ensureDefaultDomain,
  grantDomainMembership,
  listDomainMembers,
  listDomains,
  resolveDomain,
  restoreDomain,
  revokeDomainMembership,
} from "../src/services/domains";
import {
  createRuntimeProfile,
  listRuntimeProfiles,
  runtimeProfileBindingProjections,
} from "../src/services/runtime-profile-store";
import { resolveRuntimeProfileExecutionContext } from "../src/services/runtime-profile-adapter-resolver";
import {
  clearRuntimeTenantRegistrySnapshots,
  getRuntimeTenantRegistrySnapshot,
  publishRuntimeTenantRegistrySnapshot,
} from "../src/services/agent-factory/tenant-native-tool-provider";

const migrations = path.resolve(
  import.meta.dirname,
  "../../../packages/db/drizzle",
);
const OWNER = "ten-owner";
const OTHER = "ten-other";
const ADMIN = "usr-admin";
const VIEWER = "usr-viewer";
let app: FastifyInstance | undefined;
let identity: AuthedContext;

beforeEach(() => {
  clearRuntimeTenantRegistrySnapshots();
  closeDb();
  process.env.DATABASE_URL = "file::memory:";
  process.env.AGENTIC_SQLITE_TEST_WRITER = "1";
  process.env.AGENTIC_DATABASE_READONLY = "0";
  runMigrations(migrations);
  const db = getDb();
  db.insert(tenants)
    .values([
      { id: OWNER, slug: "owner", name: "Owner" },
      { id: OTHER, slug: "other", name: "Other" },
    ])
    .run();
  db.insert(users)
    .values([
      {
        id: ADMIN,
        email: "admin@domain.test",
        name: "Admin",
        platformRole: "none",
        status: "active",
      },
      {
        id: VIEWER,
        email: "viewer@domain.test",
        name: "Viewer",
        platformRole: "none",
        status: "active",
      },
    ])
    .run();
  db.insert(memberships)
    .values([
      { userId: ADMIN, tenantId: OWNER, role: "admin" },
      { userId: VIEWER, tenantId: OWNER, role: "viewer" },
    ])
    .run();
  identity = {
    tenantId: OWNER,
    tenantSlug: "owner",
    ownerTenantId: OWNER,
    ownerTenantSlug: "owner",
    ownerRole: "admin",
    role: "admin",
    userId: ADMIN,
    name: "Admin",
    email: "admin@domain.test",
    platformRole: "none",
    via: "cookie",
  };
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  closeDb();
});

async function api(syncRuntime = vi.fn(async () => undefined)) {
  app = Fastify();
  await registerEnvelope(app);
  app.addHook("onRequest", async (req) => {
    req.auth = { ...identity };
  });
  await app.register(async (scoped) => domainRoutes(scoped, { syncRuntime }), {
    prefix: "/v1",
  });
  await app.ready();
  return app;
}

function historicalRun(
  runtimeTenantId: string,
  status: "ok" | "paused" = "ok",
) {
  const db = getDb();
  db.insert(workflows)
    .values({
      id: "wf-existing",
      tenantId: runtimeTenantId,
      slug: "same-name",
      name: "Existing workflow",
    })
    .run();
  db.insert(agents)
    .values({
      id: "agt-existing",
      tenantId: runtimeTenantId,
      workflowId: "wf-existing",
      kebabId: "same-agent",
      name: "sameAgent",
      actor: "Agent",
      createdAt: new Date(1000),
      updatedAt: new Date(1000),
    })
    .run();
  db.insert(runs)
    .values({
      id: "run-existing",
      tenantId: runtimeTenantId,
      agentId: "agt-existing",
      status,
      subject: "same-subject",
      correlationId: "cor-existing",
    })
    .run();
}

describe("Tenant -> Domain schema and services", () => {
  it("cannot claim a fresh owner as a compatibility namespace and preserves explicit legacy mappings", () => {
    const adapter = {
      kind: "tenant_registry_compat" as const,
      adapterRegistrySlug: "other",
      adapterRegistryVersion: "legacy-v1",
      eventNamespace: "other",
      compatibilityTenantSlug: "other",
    };
    const ctx = { tenantId: OWNER, tenantSlug: "owner", actorId: ADMIN };
    expect(resolveDomain(OTHER, "other")).toBeNull();
    expect(() =>
      createRuntimeProfile(ctx, { name: "Claim fresh owner", adapter }),
    ).toThrow(/explicitly provisioned/);
    expect(
      getDb()
        .select()
        .from(tenantRuntimeNamespaces)
        .where(eq(tenantRuntimeNamespaces.tenantId, OTHER))
        .get(),
    ).toBeUndefined();
    expect(listRuntimeProfiles(ctx, { includeArchived: true })).toEqual([]);
    // A reviewed migration can explicitly establish the legacy namespace;
    // profile selection may reuse only that existing exact owner mapping.
    getDb()
      .insert(tenantRuntimeNamespaces)
      .values({
        tenantId: OTHER,
        businessDomainTenantId: OWNER,
        status: "active",
      })
      .run();
    const created = createRuntimeProfile(ctx, {
      name: "Existing compatibility",
      adapter,
    });
    expect(created.version.adapter).toMatchObject(adapter);
    expect(
      getDb()
        .select()
        .from(tenantRuntimeNamespaces)
        .where(eq(tenantRuntimeNamespaces.tenantId, OTHER))
        .get()?.businessDomainTenantId,
    ).toBe(OWNER);
  });

  it("makes a new empty Tenant's default Domain ready without changing legacy or custom registry identities", () => {
    const domain = ensureDefaultDomain(OWNER);
    const ctx = { tenantId: OWNER, tenantSlug: "owner" };
    const profiles = listRuntimeProfiles(ctx, { includeArchived: false });
    expect(profiles).toHaveLength(1);
    const version = profiles[0]!.versions[0]!;
    expect(
      runtimeProfileBindingProjections(getDb(), ctx, [version.id]).get(
        version.id,
      )?.readiness.executable,
    ).toBe(true);
    expect(
      resolveRuntimeProfileExecutionContext({
        businessTenantId: OWNER,
        businessTenantSlug: "owner",
        runtimeProfileVersionId: version.id,
      }).reviewedAdapter.registry.tools,
    ).toEqual({});
    expect(ensureDefaultDomain(OWNER).id).toBe(domain.id);
    expect(listRuntimeProfiles(ctx, { includeArchived: false })).toEqual(
      profiles,
    );

    historicalRun(OTHER);
    ensureDefaultDomain(OTHER);
    expect(
      listRuntimeProfiles(
        { tenantId: OTHER, tenantSlug: "other" },
        { includeArchived: false },
      ),
    ).toEqual([]);
    expect(getRuntimeTenantRegistrySnapshot("other")).toBeUndefined();

    getDb()
      .insert(tenants)
      .values({ id: "ten-custom", slug: "custom", name: "Custom" })
      .run();
    publishRuntimeTenantRegistrySnapshot({
      tenantSlug: "custom",
      selectedVersion: "custom-v1",
      registry: { tools: {}, prompts: {} },
    });
    ensureDefaultDomain("ten-custom");
    expect(
      listRuntimeProfiles(
        { tenantId: "ten-custom", tenantSlug: "custom" },
        { includeArchived: false },
      ),
    ).toEqual([]);
    expect(getRuntimeTenantRegistrySnapshot("custom")?.selectedVersion).toBe(
      "custom-v1",
    );
  });

  it("provisions a ready native global-tool profile without a custom package and fails closed after code replacement", async () => {
    const domain = await createDomain(
      OWNER,
      { slug: "energy", name: "Energy" },
      ADMIN,
    );
    const ctx = {
      tenantId: domain.runtimeTenantId,
      tenantSlug: domain.runtimeTenantSlug,
    };
    const profiles = listRuntimeProfiles(ctx, { includeArchived: false });
    expect(profiles).toHaveLength(1);
    const version = profiles[0]!.versions[0]!;
    expect(version.adapter).toMatchObject({
      kind: "native",
      adapterRegistrySlug: domain.runtimeTenantSlug,
      adapterRegistryVersion: "global-tools-v1",
    });
    expect(
      runtimeProfileBindingProjections(getDb(), ctx, [version.id]).get(
        version.id,
      )?.readiness.executable,
    ).toBe(true);
    expect(
      getRuntimeTenantRegistrySnapshot(domain.runtimeTenantSlug)?.registry
        .tools,
    ).toEqual({});
    const execution = resolveRuntimeProfileExecutionContext({
      businessTenantId: ctx.tenantId,
      businessTenantSlug: ctx.tenantSlug,
      runtimeProfileVersionId: version.id,
    });
    expect(execution.businessTenantId).toBe(domain.runtimeTenantId);
    expect(execution.reviewedAdapter.registry.tools).toEqual({});
    expect(() =>
      createRuntimeProfile(
        { tenantId: OWNER, tenantSlug: "owner", actorId: ADMIN },
        {
          name: "Cannot hijack owned runtime",
          adapter: {
            kind: "tenant_registry_compat",
            adapterRegistrySlug: domain.runtimeTenantSlug,
            adapterRegistryVersion: "global-tools-v1",
            eventNamespace: domain.runtimeTenantSlug,
            compatibilityTenantSlug: domain.runtimeTenantSlug,
          },
        },
      ),
    ).toThrow(/cannot be reassigned/);
    getDb()
      .insert(deployments)
      .values({
        id: "dpl-code",
        tenantId: domain.runtimeTenantId,
        target: "tenant_code",
        versionId: "custom-v1",
        status: "live",
      })
      .run();
    expect(
      getRuntimeTenantRegistrySnapshot(domain.runtimeTenantSlug),
    ).toBeUndefined();
    expect(
      runtimeProfileBindingProjections(getDb(), ctx, [version.id]).get(
        version.id,
      )?.readiness.executable,
    ).toBe(false);
    expect(() =>
      resolveRuntimeProfileExecutionContext({
        businessTenantId: ctx.tenantId,
        businessTenantSlug: ctx.tenantSlug,
        runtimeProfileVersionId: version.id,
      }),
    ).toThrow(/replaced/);
  });

  it("backfills legacy Domains and grants without rewriting runtime history or token identity", () => {
    historicalRun(OWNER);
    getDb()
      .insert(apiTokens)
      .values({
        id: "tok-existing",
        tenantId: OWNER,
        name: "Existing token",
        hash: "existing-digest",
        scopes: ["runs:read"],
      })
      .run();
    getDb()
      .insert(tenants)
      .values({ id: "ten-hidden", slug: "hidden", name: "Internal namespace" })
      .run();
    getDb()
      .insert(tenantRuntimeNamespaces)
      .values({
        tenantId: "ten-hidden",
        businessDomainTenantId: OWNER,
        status: "archived",
      })
      .run();
    getDb()
      .update(tenants)
      .set({ archivedAt: new Date(1234) })
      .where(eq(tenants.id, OTHER))
      .run();
    const beforeRun = getDb()
      .select()
      .from(runs)
      .where(eq(runs.id, "run-existing"))
      .get();
    const beforeToken = getDb()
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.id, "tok-existing"))
      .get();
    // Exercise the actual upgrade SQL over pre-existing business rows.
    getRawSqlite().exec("DROP TABLE domain_memberships; DROP TABLE domains;");
    getRawSqlite().exec(
      readFileSync(
        path.join(migrations, "0085_tenant_domain_hierarchy.sql"),
        "utf8",
      ),
    );
    expect(getDb().select().from(domains).all()).toHaveLength(2);
    const domain = resolveDomain(OWNER, "owner")!;
    expect(domain).toMatchObject({
      id: `dom-legacy-${OWNER}`,
      tenantId: OWNER,
      runtimeTenantId: OWNER,
      isDefault: true,
    });
    expect(domainRoleForUser(domain.id, VIEWER)).toBe("viewer");
    expect(
      resolveDomain(OTHER, "other", { includeArchived: true })?.archivedAt,
    ).toBeNull();
    expect(
      getDb().select().from(runs).where(eq(runs.id, "run-existing")).get(),
    ).toEqual(beforeRun);
    expect(
      getDb()
        .select()
        .from(apiTokens)
        .where(eq(apiTokens.id, "tok-existing"))
        .get(),
    ).toEqual(beforeToken);
    runMigrations(migrations);
    expect(getDb().select().from(domains).all()).toHaveLength(2);
  });

  it("creates exclusive opaque namespaces, allows sibling names and never adds namespace memberships", async () => {
    const a = await createDomain(
      OWNER,
      { slug: "energy", name: "Energy" },
      ADMIN,
    );
    const b = await createDomain(
      OWNER,
      { slug: "hiring", name: "Hiring" },
      ADMIN,
    );
    const elsewhere = await createDomain(
      OTHER,
      { slug: "energy", name: "Other Energy" },
      ADMIN,
    );
    expect(
      new Set([a.runtimeTenantId, b.runtimeTenantId, elsewhere.runtimeTenantId])
        .size,
    ).toBe(3);
    expect(a.runtimeTenantSlug).toMatch(/^dr-[a-f0-9]{24}$/);
    expect(
      getDb()
        .select()
        .from(memberships)
        .where(eq(memberships.tenantId, a.runtimeTenantId))
        .all(),
    ).toEqual([]);
    expect(
      getDb()
        .select()
        .from(tenantRuntimeNamespaces)
        .where(eq(tenantRuntimeNamespaces.tenantId, a.runtimeTenantId))
        .get()?.businessDomainTenantId,
    ).toBe(OWNER);
    expect(domainForRuntimeTenant(a.runtimeTenantId)?.id).toBe(a.id);
    expect(resolveDomain(OTHER, a.id)).toBeNull();
    expect(domainRoleForUser(a.id, ADMIN)).toBe("admin");
    expect(domainRoleForUser(a.id, VIEWER)).toBeNull();
    getDb()
      .insert(workflows)
      .values([
        {
          id: "wf-a",
          tenantId: a.runtimeTenantId,
          slug: "shared-name",
          name: "Same name",
        },
        {
          id: "wf-b",
          tenantId: b.runtimeTenantId,
          slug: "shared-name",
          name: "Same name",
        },
      ])
      .run();
    await expect(
      createDomain(OWNER, { slug: "energy", name: "Duplicate" }, ADMIN),
    ).rejects.toMatchObject({ code: "domain_slug_taken" });
    expect(() =>
      getDb()
        .update(domains)
        .set({ runtimeTenantId: b.runtimeTenantId })
        .where(eq(domains.id, a.id))
        .run(),
    ).toThrow(/immutable/);
    expect(() => ensureDefaultDomain(a.runtimeTenantId)).toThrow(
      /Owning Tenant/,
    );
    getDb()
      .update(tenantRuntimeNamespaces)
      .set({ status: "archived" })
      .where(eq(tenantRuntimeNamespaces.tenantId, a.runtimeTenantId))
      .run();
    expect(() => ensureDefaultDomain(a.runtimeTenantId)).toThrow(
      /Owning Tenant/,
    );
  });

  it("grants only existing owner members and leaves default grants inherited", async () => {
    const domain = await createDomain(
      OWNER,
      { slug: "energy", name: "Energy" },
      ADMIN,
    );
    grantDomainMembership(OWNER, domain.id, VIEWER, "operator", ADMIN);
    expect(domainRoleForUser(domain.id, VIEWER)).toBe("operator");
    expect(() =>
      grantDomainMembership(OTHER, domain.id, VIEWER, "admin", ADMIN),
    ).toThrow(/not found/);
    expect(() =>
      grantDomainMembership(OWNER, domain.id, "usr-unknown", "admin", ADMIN),
    ).toThrow(/active member/);
    expect(revokeDomainMembership(OWNER, domain.id, VIEWER, ADMIN)).toBe(true);
    expect(domainRoleForUser(domain.id, VIEWER)).toBeNull();
    expect(() => revokeDomainMembership(OWNER, "owner", VIEWER, ADMIN)).toThrow(
      /Tenant membership/,
    );
    getDb()
      .update(memberships)
      .set({ role: "viewer" })
      .where(eq(memberships.userId, ADMIN))
      .run();
    expect(
      listDomainMembers(OWNER, "owner").find(
        (member) => member.userId === ADMIN,
      ),
    ).toMatchObject({ tenantRole: "viewer", domainRole: "viewer" });
  });

  it("archives the default namespace without archiving its owner or hiding siblings", async () => {
    const sibling = await createDomain(
      OWNER,
      { slug: "energy", name: "Energy" },
      ADMIN,
    );
    const legacy = ensureDefaultDomain(OWNER);
    const sync = vi.fn(async () => undefined);
    const archived = await archiveDomain(
      OWNER,
      legacy.id,
      legacy.slug,
      ADMIN,
      sync,
    );
    expect(archived.archivedAt).not.toBeNull();
    expect(
      getDb().select().from(tenants).where(eq(tenants.id, OWNER)).get()
        ?.archivedAt,
    ).toBeNull();
    expect(listDomains(OWNER).map((domain) => domain.id)).toEqual([sibling.id]);
    expect(getTenantInngestDeploymentMarker(OWNER)?.versionId).toContain(
      "disabled",
    );
    await restoreDomain(OWNER, legacy.id, ADMIN, sync);
    expect(getTenantInngestDeploymentMarker(OWNER)?.versionId).toContain(
      "enabled",
    );
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("restores exact lifecycle and deployment state when broker sync fails", async () => {
    const domain = await createDomain(
      OWNER,
      { slug: "energy", name: "Energy" },
      ADMIN,
    );
    const before = getDb()
      .select()
      .from(domains)
      .where(eq(domains.id, domain.id))
      .get();
    const marker = getTenantInngestDeploymentMarker(domain.runtimeTenantId);
    const sync = vi
      .fn<(slug: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("Broker unavailable"))
      .mockResolvedValueOnce();
    await expect(
      archiveDomain(OWNER, domain.id, domain.slug, ADMIN, sync),
    ).rejects.toThrow(/Broker unavailable/);
    expect(
      getDb().select().from(domains).where(eq(domains.id, domain.id)).get(),
    ).toEqual(before);
    expect(getTenantInngestDeploymentMarker(domain.runtimeTenantId)).toEqual(
      marker,
    );
    expect(
      getDb()
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.targetId, domain.id),
            eq(auditLog.action, "domain.archive"),
          ),
        )
        .all(),
    ).toEqual([]);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("does not orphan a paused run when archiving its Domain", async () => {
    const domain = await createDomain(
      OWNER,
      { slug: "energy", name: "Energy" },
      ADMIN,
    );
    historicalRun(domain.runtimeTenantId, "paused");
    expect(domainHasActiveWork(domain.runtimeTenantId)).toBe(true);
    const sync = vi.fn(async () => undefined);
    await expect(
      archiveDomain(OWNER, domain.id, domain.slug, ADMIN, sync),
    ).rejects.toMatchObject({ code: "domain_has_active_work" });
    expect(sync).not.toHaveBeenCalled();
    expect(resolveDomain(OWNER, domain.id)?.archivedAt).toBeNull();
  });
});

describe("Domain management HTTP boundary", () => {
  it("creates, updates, reads, archives and restores under the selected owner", async () => {
    const server = await api();
    const created = await server.inject({
      method: "POST",
      url: "/v1/domains",
      payload: { slug: "energy", name: "Energy" },
    });
    expect(created.statusCode).toBe(201);
    const domain = created.json().data.domain as Domain;
    const edited = await server.inject({
      method: "PATCH",
      url: `/v1/domains/${domain.slug}`,
      payload: { name: "Energy purchasing" },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().data.domain.name).toBe("Energy purchasing");
    const invalid = await server.inject({
      method: "PATCH",
      url: `/v1/domains/${domain.slug}`,
      payload: { runtimeTenantId: OWNER },
    });
    expect(invalid.statusCode).toBe(400);
    expect(
      (
        await server.inject({
          method: "DELETE",
          url: `/v1/domains/${domain.slug}`,
          payload: { confirm: domain.slug },
        })
      ).statusCode,
    ).toBe(200);
    const archived = await server.inject("/v1/domains?include_archived=1");
    expect(archived.json().data.items).toHaveLength(2);
    expect(
      (
        await server.inject({
          method: "POST",
          url: `/v1/domains/${domain.slug}/restore`,
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    identity = {
      ...identity,
      tenantId: OTHER,
      tenantSlug: "other",
      ownerTenantId: OTHER,
      ownerTenantSlug: "other",
    };
    expect((await server.inject(`/v1/domains/${domain.id}`)).statusCode).toBe(
      404,
    );
  });

  it("filters sibling Domains and prevents Domain admins from administering owner grants", async () => {
    const domain = await createDomain(
      OWNER,
      { slug: "energy", name: "Energy" },
      ADMIN,
    );
    const sibling = await createDomain(
      OWNER,
      { slug: "hiring", name: "Hiring" },
      ADMIN,
    );
    grantDomainMembership(OWNER, domain.id, VIEWER, "admin", ADMIN);
    const server = await api();
    identity = {
      ...identity,
      userId: VIEWER,
      role: "admin",
      ownerRole: "viewer",
    };
    const list = await server.inject("/v1/domains");
    expect(list.json().data.items.map((item: Domain) => item.id)).toContain(
      domain.id,
    );
    expect(list.json().data.items.map((item: Domain) => item.id)).not.toContain(
      sibling.id,
    );
    expect((await server.inject(`/v1/domains/${sibling.id}`)).statusCode).toBe(
      404,
    );
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/v1/domains",
          payload: { slug: "forbidden", name: "Forbidden" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await server.inject({
          method: "PUT",
          url: `/v1/domains/${domain.id}/members`,
          payload: { userId: VIEWER, role: "admin" },
        })
      ).statusCode,
    ).toBe(403);
    identity = {
      ...identity,
      userId: ADMIN,
      role: "admin",
      ownerRole: "admin",
    };
    const roster = await server.inject(`/v1/domains/${domain.id}/members`);
    expect(roster.statusCode).toBe(200);
    expect(
      roster
        .json()
        .data.items.find(
          (member: { userId: string }) => member.userId === VIEWER,
        ),
    ).toMatchObject({ tenantRole: "viewer", domainRole: "admin" });
  });

  it("keeps legacy bearer credentials confined to the original default namespace", async () => {
    await createDomain(OWNER, { slug: "energy", name: "Energy" }, ADMIN);
    const server = await api();
    identity = {
      ...identity,
      userId: null,
      via: "token",
      scopes: ["tenant:write"],
    };
    const list = await server.inject("/v1/domains");
    expect(
      list.json().data.items.map((item: Domain) => item.runtimeTenantId),
    ).toEqual([OWNER]);
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/v1/domains",
          payload: { slug: "forbidden", name: "Forbidden" },
        })
      ).statusCode,
    ).toBe(403);
  });
});
