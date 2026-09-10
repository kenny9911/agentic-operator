import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  ArchiveDomainBodySchema,
  CreateDomainBodySchema,
  DomainListResponseSchema,
  DomainMemberListResponseSchema,
  DomainMembershipSchema,
  DomainMutationResponseSchema,
  PutDomainMembershipBodySchema,
  UpdateDomainBodySchema,
  type Domain,
} from "@agentic/contracts";
import { requireAuth, type AuthedContext } from "../../plugins/auth";
import { writeAudit } from "../../plugins/rbac";
import {
  archiveDomain,
  createDomain,
  DomainError,
  domainRoleForUser,
  grantDomainMembership,
  listDomainMembers,
  listDomains,
  resolveDomain,
  restoreDomain,
  revokeDomainMembership,
  updateDomain,
  type DomainRuntimeSync,
} from "../../services/domains";

function ownerContext(req: FastifyRequest): AuthedContext {
  const auth = requireAuth(req);
  const ctx = {
    ...auth,
    tenantId: auth.ownerTenantId ?? auth.tenantId,
    tenantSlug: auth.ownerTenantSlug ?? auth.tenantSlug,
    role: auth.ownerRole !== undefined ? auth.ownerRole : auth.role,
  };
  if (!ctx.tenantId || (!ctx.role && ctx.platformRole !== "superadmin")) {
    throw new DomainError("forbidden", "Tenant membership is required", 403);
  }
  return ctx;
}

/** Only the owner administrator can change Domain ownership or access. */
function administrator(req: FastifyRequest): AuthedContext {
  const ctx = ownerContext(req);
  if (
    ctx.via !== "token" &&
    (ctx.platformRole === "superadmin" || ctx.role === "admin")
  )
    return ctx;
  writeAudit(ctx, {
    action: "domain.manage",
    decision: "deny",
    meta: { method: req.method, url: req.url },
  });
  throw new DomainError(
    "forbidden",
    "An owning Tenant administrator is required",
    403,
  );
}

function visible(ctx: AuthedContext, domain: Domain): boolean {
  // Legacy tokens retain exactly their original namespace, even with admin scopes.
  if (ctx.via === "token") return domain.runtimeTenantId === ctx.tenantId;
  if (ctx.platformRole === "superadmin" || ctx.role === "admin") return true;
  return Boolean(ctx.userId && domainRoleForUser(domain.id, ctx.userId));
}

async function synchronizeRuntime(slug: string): Promise<void> {
  const [{ reregisterInngest }, { syncTenantApp }] = await Promise.all([
    import("../../services/inngest-registry"),
    import("../../services/inngest-sync"),
  ]);
  await reregisterInngest({ tenantSlug: slug, scope: "tenant" });
  const sync = await syncTenantApp(slug);
  if (!sync.ok)
    throw new DomainError(
      "domain_runtime_sync_failed",
      "The runtime could not confirm the Domain lifecycle change",
      503,
    );
}

export async function domainRoutes(
  app: FastifyInstance,
  options: { syncRuntime?: DomainRuntimeSync } = {},
): Promise<void> {
  const syncRuntime = options.syncRuntime ?? synchronizeRuntime;

  app.get<{
    Querystring: { include_archived?: string; includeArchived?: string };
  }>("/domains", async (req, reply) => {
    const ctx = ownerContext(req);
    const includeArchived =
      req.query.include_archived === "1" ||
      req.query.includeArchived === "true";
    const items = listDomains(ctx.tenantId, { includeArchived }).filter(
      (domain) => visible(ctx, domain),
    );
    reply.header("Cache-Control", "no-store");
    return reply.ok(
      DomainListResponseSchema.parse({ items, count: items.length }),
    );
  });

  app.post("/domains", async (req, reply) => {
    const ctx = administrator(req);
    const domain = await createDomain(
      ctx.tenantId,
      CreateDomainBodySchema.parse(req.body),
      ctx.userId,
    );
    return reply.ok(DomainMutationResponseSchema.parse({ domain }), 201);
  });

  app.get<{ Params: { domain: string } }>(
    "/domains/:domain",
    async (req, reply) => {
      const ctx = ownerContext(req);
      const domain = resolveDomain(ctx.tenantId, req.params.domain, {
        includeArchived: true,
      });
      if (!domain || !visible(ctx, domain))
        throw new DomainError(
          "domain_not_found",
          "Domain was not found in this Tenant",
          404,
        );
      reply.header("Cache-Control", "no-store");
      return reply.ok(DomainMutationResponseSchema.parse({ domain }));
    },
  );

  app.patch<{ Params: { domain: string } }>(
    "/domains/:domain",
    async (req, reply) => {
      const ctx = administrator(req);
      return reply.ok(
        DomainMutationResponseSchema.parse({
          domain: updateDomain(
            ctx.tenantId,
            req.params.domain,
            UpdateDomainBodySchema.parse(req.body),
            ctx.userId,
          ),
        }),
      );
    },
  );

  app.delete<{ Params: { domain: string } }>(
    "/domains/:domain",
    async (req, reply) => {
      const ctx = administrator(req);
      const body = ArchiveDomainBodySchema.parse(req.body);
      const domain = await archiveDomain(
        ctx.tenantId,
        req.params.domain,
        body.confirm,
        ctx.userId,
        syncRuntime,
      );
      return reply.ok(DomainMutationResponseSchema.parse({ domain }));
    },
  );

  app.post<{ Params: { domain: string } }>(
    "/domains/:domain/restore",
    async (req, reply) => {
      const ctx = administrator(req);
      const domain = await restoreDomain(
        ctx.tenantId,
        req.params.domain,
        ctx.userId,
        syncRuntime,
      );
      return reply.ok(DomainMutationResponseSchema.parse({ domain }));
    },
  );

  app.get<{ Params: { domain: string } }>(
    "/domains/:domain/members",
    async (req, reply) => {
      const ctx = administrator(req);
      const items = listDomainMembers(ctx.tenantId, req.params.domain);
      reply.header("Cache-Control", "no-store");
      return reply.ok(
        DomainMemberListResponseSchema.parse({ items, count: items.length }),
      );
    },
  );

  app.put<{ Params: { domain: string } }>(
    "/domains/:domain/members",
    async (req, reply) => {
      const ctx = administrator(req);
      const input = PutDomainMembershipBodySchema.parse(req.body);
      const membership = grantDomainMembership(
        ctx.tenantId,
        req.params.domain,
        input.userId,
        input.role,
        ctx.userId,
      );
      return reply.ok({ membership: DomainMembershipSchema.parse(membership) });
    },
  );

  app.delete<{ Params: { domain: string; userId: string } }>(
    "/domains/:domain/members/:userId",
    async (req, reply) => {
      const ctx = administrator(req);
      return reply.ok({
        removed: revokeDomainMembership(
          ctx.tenantId,
          req.params.domain,
          req.params.userId,
          ctx.userId,
        ),
      });
    },
  );
}
