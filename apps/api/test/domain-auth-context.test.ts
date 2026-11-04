import { createHash, randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  apiTokens,
  domainMemberships,
  domains,
  getDb,
  memberships,
  tenantRuntimeNamespaces,
  tenants,
  users,
  workflows,
} from "@agentic/db";
import type { Domain } from "@agentic/contracts";
import { registerAuth, requireAuth, signSessionJwt } from "../src/plugins/auth";
import { requirePermission } from "../src/plugins/rbac";
import { registerEnvelope } from "../src/plugins/error";
import { createDomain, ensureDefaultDomain } from "../src/services/domains";
import { authRoutes } from "../src/routes/v1/auth";

describe("Tenant and Domain request authorization", () => {
  const suffix = randomUUID().slice(0, 8);
  const owner = {
    id: `ten-auth-owner-${suffix}`,
    slug: `owner-${suffix}`,
    name: "Owner",
  };
  const foreign = {
    id: `ten-auth-other-${suffix}`,
    slug: `other-${suffix}`,
    name: "Other",
  };
  const userId = `usr-domain-${suffix}`;
  const token = `domain-test-${randomUUID()}`;
  const childToken = `child-domain-test-${randomUUID()}`;
  const legacyToken = `legacy-namespace-test-${randomUUID()}`;
  const legacy = {
    id: `ten-legacy-runtime-${suffix}`,
    slug: `legacy-runtime-${suffix}`,
    name: "Legacy compatibility runtime",
  };
  let app: FastifyInstance;
  let cookie: string;
  let first: Domain;
  let second: Domain;
  let foreignDomain: Domain;
  let defaultDomain: Domain;

  beforeAll(async () => {
    vi.stubEnv("AUTH_MODE", "");
    const db = getDb();
    db.insert(tenants).values([owner, foreign, legacy]).run();
    db.insert(tenantRuntimeNamespaces)
      .values({ tenantId: legacy.id, businessDomainTenantId: owner.id })
      .run();
    db.insert(users)
      .values({
        id: userId,
        email: `${suffix}@domain.test`,
        name: "Domain operator",
        status: "active",
        platformRole: "none",
      })
      .run();
    db.insert(memberships)
      .values({ tenantId: owner.id, userId, role: "viewer" })
      .run();
    db.insert(memberships)
      .values({ tenantId: legacy.id, userId, role: "operator" })
      .run();
    defaultDomain = ensureDefaultDomain(owner.id);
    first = await createDomain(owner.id, {
      slug: "purchasing",
      name: "Purchasing",
    });
    second = await createDomain(owner.id, { slug: "sales", name: "Sales" });
    foreignDomain = await createDomain(foreign.id, {
      slug: "purchasing",
      name: "Foreign purchasing",
    });
    db.insert(domainMemberships)
      .values({ domainId: first.id, userId, role: "operator" })
      .run();
    for (const [index, domain] of [first, second, foreignDomain].entries()) {
      db.insert(workflows)
        .values({
          id: `wf-domain-${index}-${suffix}`,
          tenantId: domain.runtimeTenantId,
          slug: "same-name",
          name: `${domain.name} workflow`,
        })
        .run();
    }
    db.insert(apiTokens)
      .values({
        id: `tok-domain-${suffix}`,
        tenantId: owner.id,
        name: "Legacy token",
        hash: createHash("sha256").update(token).digest("hex"),
        scopes: ["tenant:write"],
      })
      .run();
    db.insert(apiTokens)
      .values([
        {
          id: `tok-child-${suffix}`,
          tenantId: first.runtimeTenantId,
          name: "Child Domain token",
          hash: createHash("sha256").update(childToken).digest("hex"),
          scopes: ["tenant:write"],
        },
        {
          id: `tok-legacy-${suffix}`,
          tenantId: legacy.id,
          name: "Unmapped namespace token",
          hash: createHash("sha256").update(legacyToken).digest("hex"),
          scopes: ["tenant:write"],
        },
      ])
      .run();
    db.insert(workflows)
      .values({
        id: `wf-legacy-${suffix}`,
        tenantId: legacy.id,
        slug: "same-name",
        name: "Legacy compatibility workflow",
      })
      .run();
    cookie = `agentic_session=${await signSessionJwt({ sub: userId, name: "Domain operator", initials: "DO", tenant: owner.slug })}`;
    app = Fastify();
    await registerEnvelope(app);
    await registerAuth(app);
    await app.register(authRoutes, { prefix: "/v1" });
    app.get("/v1/workflows", (req) => {
      const ctx = requirePermission(req, "workflows.read");
      return getDb()
        .select({ name: workflows.name })
        .from(workflows)
        .where(eq(workflows.tenantId, ctx.tenantId))
        .all();
    });
    app.post("/v1/agents/invoke", (req) => {
      const ctx = requirePermission(req, "agents.invoke");
      return {
        tenantId: ctx.tenantId,
        domainId: ctx.domainId,
        ownerTenantId: ctx.ownerTenantId,
      };
    });
    app.get("/v1/members", (req) => ({
      tenantId: requirePermission(req, "members.read").tenantId,
    }));
    app.get("/v1/tenants/:slug/inngest-app", (req) => ({
      slug: (req.params as { slug: string }).slug,
      runtime: requireAuth(req).tenantSlug,
    }));
    for (const suffix of [
      "manifest-import",
      "manifest-import/fetch-url",
      "manifest-import/fetch-repo",
      "code",
    ]) {
      app.post(`/v1/tenants/:slug/${suffix}`, (req) => {
        const auth = requireAuth(req);
        return {
          slug: (req.params as { slug: string }).slug,
          tenantId: auth.tenantId,
          domainId: auth.domainId,
        };
      });
    }
    for (const suffix of ["manifest-import", "code"]) {
      app.delete(`/v1/tenants/:slug/${suffix}/:id`, (req) => ({
        slug: (req.params as { slug: string }).slug,
        tenantId: requireAuth(req).tenantId,
      }));
    }
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });

  function headers(domain: Domain | string) {
    return {
      cookie,
      "x-agentic-tenant": owner.slug,
      "x-agentic-domain": typeof domain === "string" ? domain : domain.slug,
    };
  }

  it("reads only the granted child Domain even with a same-named workflow elsewhere", async () => {
    const response = await app.inject({
      url: "/v1/workflows",
      headers: headers(first),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([{ name: "Purchasing workflow" }]);
  });

  it("uses the Domain role without promoting the user's parent-Tenant role", async () => {
    const invoke = await app.inject({
      method: "POST",
      url: "/v1/agents/invoke",
      headers: headers(first),
    });
    expect(invoke.statusCode).toBe(200);
    expect(invoke.json()).toEqual({
      tenantId: first.runtimeTenantId,
      domainId: first.id,
      ownerTenantId: owner.id,
    });
    expect(
      (await app.inject({ url: "/v1/members", headers: headers(first) }))
        .statusCode,
    ).toBe(403);
    const me = await app.inject({ url: "/v1/me", headers: headers(first) });
    expect(me.json().data.activeTenant).toMatchObject({
      slug: owner.slug,
      role: "viewer",
    });
    expect(me.json().data.capabilities).toContain("agents.invoke");
    expect(me.json().data.capabilities).not.toContain("members.write");
  });

  it("rejects unauthorized sibling, foreign and missing Domain identities", async () => {
    for (const domain of [second.id, foreignDomain.id, "missing-domain"]) {
      const response = await app.inject({
        url: "/v1/workflows",
        headers: headers(domain),
      });
      expect([403, 404]).toContain(response.statusCode);
    }
    const wrongOwner = await app.inject({
      url: "/v1/workflows",
      headers: { ...headers(first), "x-agentic-tenant": "nonexistent-owner" },
    });
    expect(wrongOwner.statusCode).toBe(403);
    expect(
      (
        await app.inject({
          url: "/v1/members",
          headers: {
            ...headers(first),
            "x-agentic-tenant": "nonexistent-owner",
          },
        })
      ).statusCode,
    ).toBe(403);
  });

  it("keeps legacy bearer credentials confined to their original default Domain", async () => {
    const common = {
      authorization: `Bearer ${token}`,
      "x-agentic-tenant": owner.slug,
    };
    expect(
      (
        await app.inject({
          url: "/v1/workflows",
          headers: { ...common, "x-agentic-domain": defaultDomain.slug },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          url: "/v1/workflows",
          headers: { ...common, "x-agentic-domain": first.slug },
        })
      ).statusCode,
    ).toBe(403);
  });

  it("does not authorize sessions through a guessed internal runtime namespace", async () => {
    const response = await app.inject({
      url: "/v1/workflows",
      headers: { cookie, "x-agentic-tenant": first.runtimeTenantSlug },
    });
    expect(response.statusCode).toBe(403);
  });

  it("maps domain runtime controls to the authorized namespace, not the default", async () => {
    const response = await app.inject({
      url: `/v1/tenants/${owner.slug}/inngest-app`,
      headers: headers(first),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      slug: first.runtimeTenantSlug,
      runtime: first.runtimeTenantSlug,
    });
    expect(
      (
        await app.inject({
          url: `/v1/tenants/${foreign.slug}/inngest-app`,
          headers: headers(first),
        })
      ).statusCode,
    ).toBe(403);
  });

  it("scopes every manifest import and code deployment operation to its selected Domain", async () => {
    for (const suffix of [
      "manifest-import",
      "manifest-import/fetch-url",
      "manifest-import/fetch-repo",
      "code",
    ]) {
      const response = await app.inject({
        method: "POST",
        url: `/v1/tenants/${owner.slug}/${suffix}`,
        headers: headers(first),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        slug: first.runtimeTenantSlug,
        tenantId: first.runtimeTenantId,
        domainId: first.id,
      });
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/v1/tenants/${foreign.slug}/${suffix}`,
            headers: headers(first),
          })
        ).statusCode,
      ).toBe(403);
    }
    for (const suffix of ["manifest-import", "code"]) {
      const response = await app.inject({
        method: "DELETE",
        url: `/v1/tenants/${owner.slug}/${suffix}/deployment-id`,
        headers: headers(first),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        slug: first.runtimeTenantSlug,
        tenantId: first.runtimeTenantId,
      });
    }
  });

  it("permits a namespace token only in its exact bound Domain, including runtime control aliases", async () => {
    const common = { authorization: `Bearer ${childToken}` };
    expect(
      (await app.inject({ url: "/v1/workflows", headers: common })).json(),
    ).toEqual([{ name: "Purchasing workflow" }]);
    expect(
      (await app.inject({ url: "/v1/me", headers: common })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: "/v1/members", headers: common })).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          url: "/v1/workflows",
          headers: { ...common, "x-agentic-domain": second.id },
        })
      ).statusCode,
    ).toBe(403);
    const control = await app.inject({
      url: `/v1/tenants/${owner.slug}/inngest-app`,
      headers: common,
    });
    expect(control.statusCode).toBe(200);
    expect(control.json()).toEqual({
      slug: first.runtimeTenantSlug,
      runtime: first.runtimeTenantSlug,
    });
  });

  it("preserves unmapped legacy namespace access without creating a Domain or granting parent authority", async () => {
    for (const common of [
      { authorization: `Bearer ${legacyToken}` },
      { cookie, "x-agentic-tenant": legacy.slug },
    ]) {
      const response = await app.inject({
        url: "/v1/workflows",
        headers: common,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([
        { name: "Legacy compatibility workflow" },
      ]);
      expect(
        (await app.inject({ url: "/v1/me", headers: common })).statusCode,
      ).toBe(200);
      expect(
        (await app.inject({ url: "/v1/members", headers: common })).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            url: "/v1/workflows",
            headers: { ...common, "x-agentic-domain": first.id },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            url: `/v1/tenants/${owner.slug}/inngest-app`,
            headers: common,
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            url: `/v1/tenants/${legacy.slug}/inngest-app`,
            headers: common,
          })
        ).statusCode,
      ).toBe(200);
    }
    expect(
      getDb()
        .select()
        .from(domains)
        .where(eq(domains.runtimeTenantId, legacy.id))
        .all(),
    ).toHaveLength(0);
    getDb()
      .delete(memberships)
      .where(
        and(
          eq(memberships.tenantId, legacy.id),
          eq(memberships.userId, userId),
        ),
      )
      .run();
    expect(
      (
        await app.inject({
          url: "/v1/workflows",
          headers: { cookie, "x-agentic-tenant": legacy.slug },
        })
      ).statusCode,
    ).toBe(403);
    getDb()
      .insert(memberships)
      .values({ tenantId: legacy.id, userId, role: "operator" })
      .run();
  });

  it("rejects archived compatibility namespaces and namespaces under archived owners", async () => {
    const db = getDb();
    const common = { authorization: `Bearer ${legacyToken}` };
    db.update(tenantRuntimeNamespaces)
      .set({ status: "archived", archivedAt: new Date() })
      .where(eq(tenantRuntimeNamespaces.tenantId, legacy.id))
      .run();
    expect(
      (await app.inject({ url: "/v1/workflows", headers: common })).statusCode,
    ).toBe(404);
    db.update(tenantRuntimeNamespaces)
      .set({ status: "active", archivedAt: null })
      .where(eq(tenantRuntimeNamespaces.tenantId, legacy.id))
      .run();
    db.update(tenants)
      .set({ archivedAt: new Date() })
      .where(eq(tenants.id, owner.id))
      .run();
    try {
      expect(
        (await app.inject({ url: "/v1/workflows", headers: common }))
          .statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject({
            url: "/v1/workflows",
            headers: { authorization: `Bearer ${childToken}` },
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      db.update(tenants)
        .set({ archivedAt: null })
        .where(eq(tenants.id, owner.id))
        .run();
    }
  });

  it("revokes Domain access immediately when its grant or owner membership disappears", async () => {
    const db = getDb();
    db.delete(domainMemberships)
      .where(
        and(
          eq(domainMemberships.domainId, first.id),
          eq(domainMemberships.userId, userId),
        ),
      )
      .run();
    expect(
      (await app.inject({ url: "/v1/workflows", headers: headers(first) }))
        .statusCode,
    ).toBe(403);
    db.insert(domainMemberships)
      .values({ domainId: first.id, userId, role: "admin" })
      .run();
    db.delete(memberships)
      .where(
        and(eq(memberships.tenantId, owner.id), eq(memberships.userId, userId)),
      )
      .run();
    expect(
      (await app.inject({ url: "/v1/workflows", headers: headers(first) }))
        .statusCode,
    ).toBe(403);
    db.insert(memberships)
      .values({ tenantId: owner.id, userId, role: "viewer" })
      .run();
  });

  it("checks the selected Domain marker lifecycle and owner, including requests through the parent", async () => {
    const db = getDb();
    db.update(tenantRuntimeNamespaces)
      .set({ status: "archived", archivedAt: new Date() })
      .where(eq(tenantRuntimeNamespaces.tenantId, first.runtimeTenantId))
      .run();
    expect(
      (await app.inject({ url: "/v1/workflows", headers: headers(first) }))
        .statusCode,
    ).toBe(404);
    db.update(tenantRuntimeNamespaces)
      .set({
        status: "active",
        archivedAt: null,
        businessDomainTenantId: foreign.id,
      })
      .where(eq(tenantRuntimeNamespaces.tenantId, first.runtimeTenantId))
      .run();
    try {
      expect(
        (await app.inject({ url: "/v1/workflows", headers: headers(first) }))
          .statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            url: "/v1/workflows",
            headers: { authorization: `Bearer ${childToken}` },
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      db.update(tenantRuntimeNamespaces)
        .set({ businessDomainTenantId: owner.id })
        .where(eq(tenantRuntimeNamespaces.tenantId, first.runtimeTenantId))
        .run();
    }
  });

  it("rejects an archived Domain and retains the sibling's independent state", async () => {
    getDb()
      .update(domains)
      .set({ archivedAt: new Date() })
      .where(eq(domains.id, first.id))
      .run();
    expect(
      (await app.inject({ url: "/v1/workflows", headers: headers(first) }))
        .statusCode,
    ).toBe(404);
    expect(
      getDb()
        .select()
        .from(workflows)
        .where(eq(workflows.tenantId, second.runtimeTenantId))
        .all(),
    ).toHaveLength(1);
  });
});
