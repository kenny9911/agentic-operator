import type { FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { getDb, tenantRuntimeNamespaces, tenants } from "@agentic/db";
import type { TenantRole } from "@agentic/contracts";
import {
  domainForRuntimeTenant,
  domainRoleForUser,
  ensureDefaultDomain,
  resolveDomain,
} from "../services/domains";
import type { AuthedContext } from "./auth";

function fail(code: string, message: string, statusCode = 403): never {
  throw Object.assign(new Error(message), { code, statusCode });
}

function selectedDomain(req: FastifyRequest): string | null {
  const raw = req.headers["x-agentic-domain"];
  if (raw === undefined) return null;
  if (typeof raw !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(raw)) {
    fail("invalid_domain", "A valid Domain identifier is required", 400);
  }
  return raw;
}

/** These legacy routes deploy/read runtime state, despite their Tenant prefix. */
function runtimeTenantOperation(req: FastifyRequest): boolean {
  const pathname = req.url.split("?", 1)[0] ?? "/";
  return /^\/v1\/tenants\/[^/]+\/(?:inngest-(?:app|deployment)|manifest-import|code)(?:\/|$)/.test(
    pathname,
  );
}

/** These routes administer the owner, never the selected execution namespace. */
function ownerOperation(req: FastifyRequest, hasDomain: boolean): boolean {
  const pathname = req.url.split("?", 1)[0] ?? "/";
  if (runtimeTenantOperation(req)) return false;
  return (
    /^\/v1\/(?:tenants|domains|members|admin-users|auth)(?:\/|$)/.test(
      pathname,
    ) ||
    (!hasDomain && /^\/v1\/me(?:\/|$)/.test(pathname))
  );
}

/** Adapt the legacy deployment control route using the already-authorized Domain. */
export function resolveDomainRuntimeParams(req: FastifyRequest): void {
  if (!req.auth || !runtimeTenantOperation(req)) return;
  const pathname = req.url.split("?", 1)[0] ?? "/";
  if (
    req.headers["x-agentic-domain"] === undefined &&
    req.auth.via !== "token" &&
    req.auth.ownerTenantId === req.auth.tenantId &&
    /^\/v1\/tenants\/[^/]+\/inngest-(?:app|deployment)$/.test(pathname)
  ) {
    // The Tenant manager has always addressed the actual target in :slug.
    // Its routes independently verify platform authority or membership of
    // that target, which may differ from the browser's active owner. Only an
    // explicit Domain selection turns this into a Domain-control alias.
    return;
  }
  const params = req.params as { slug?: string };
  const ownerAlias = req.auth.domainId ? req.auth.ownerTenantSlug : undefined;
  if (params.slug !== ownerAlias && params.slug !== req.auth.tenantSlug) {
    fail(
      "forbidden_domain",
      "The runtime control does not belong to the selected Domain",
    );
  }
  params.slug = req.auth.tenantSlug;
}

/**
 * Resolve a product Tenant + Domain to its one-to-one execution namespace.
 * All existing stores, jobs, event channels and files retain their namespace
 * identity. Membership is checked on the owning Tenant before the effective
 * Domain role is selected; a namespace id or URL can never confer access.
 */
export function resolveRequestDomain(
  req: FastifyRequest,
  identity: AuthedContext,
): AuthedContext {
  const selected = selectedDomain(req);
  if (!identity.tenantId) {
    if (selected) fail("forbidden_domain", "Domain access requires a Tenant");
    return identity;
  }

  const bound = domainForRuntimeTenant(identity.tenantId);
  const namespace = getDb()
    .select()
    .from(tenantRuntimeNamespaces)
    .where(eq(tenantRuntimeNamespaces.tenantId, identity.tenantId))
    .get();
  if (
    namespace &&
    bound &&
    namespace.businessDomainTenantId !== bound.tenantId
  ) {
    fail(
      "domain_namespace_conflict",
      "The Domain and runtime namespace have conflicting ownership",
    );
  }
  if (namespace && (namespace.status !== "active" || namespace.archivedAt)) {
    fail("domain_unavailable", "The runtime namespace is archived", 404);
  }
  if (namespace && !bound) {
    // Pre-hierarchy Runtime Profiles can retain an explicit compatibility
    // namespace that is not itself a product Domain. Preserve its existing
    // exact token/membership scope without manufacturing a default Domain or
    // allowing those credentials to administer the namespace's owner.
    if (selected)
      fail(
        "domain_unmapped",
        "This compatibility namespace has no product Domain binding",
      );
    const pathname = req.url.split("?", 1)[0] ?? "/";
    if (ownerOperation(req, false) && pathname !== "/v1/me") {
      fail(
        "namespace_scope_mismatch",
        "A runtime namespace cannot administer its owning Tenant",
      );
    }
    if (
      identity.via !== "token" &&
      identity.platformRole !== "superadmin" &&
      !identity.role
    ) {
      fail(
        "forbidden_domain",
        "Access to this runtime namespace has not been granted",
      );
    }
    const db = getDb();
    const owner = db
      .select()
      .from(tenants)
      .where(eq(tenants.id, namespace.businessDomainTenantId))
      .get();
    const runtime = db
      .select({ archivedAt: tenants.archivedAt })
      .from(tenants)
      .where(eq(tenants.id, identity.tenantId))
      .get();
    if (!owner || owner.archivedAt || !runtime || runtime.archivedAt) {
      fail(
        "domain_unavailable",
        "The runtime namespace or its owning Tenant is unavailable",
        404,
      );
    }
    return {
      ...identity,
      ownerTenantId: owner.id,
      ownerTenantSlug: owner.slug,
      ownerRole: null,
    };
  }
  const isChildNamespace = bound && bound.tenantId !== identity.tenantId;
  if (isChildNamespace && identity.via !== "token") {
    fail("domain_owner_required", "Select the owning Tenant and Domain");
  }

  const ownerId = isChildNamespace ? bound.tenantId : identity.tenantId;
  const owner = getDb()
    .select()
    .from(tenants)
    .where(eq(tenants.id, ownerId))
    .get();
  if (!owner) fail("forbidden_domain", "The owning Tenant is unavailable");

  const ownerRole = isChildNamespace ? null : identity.role;
  const ownerContext: AuthedContext = {
    ...identity,
    ownerTenantId: owner.id,
    ownerTenantSlug: owner.slug,
    ownerRole,
  };
  if (selected) {
    // Legacy tenant selection historically falls back on an unknown header.
    // Explicit Domain requests must never combine that fallback with a Domain,
    // including requests to owner administration surfaces.
    const requestedOwner = req.headers["x-agentic-tenant"];
    if (
      requestedOwner !== undefined &&
      requestedOwner !== owner.slug &&
      !(identity.via === "token" && requestedOwner === identity.tenantSlug)
    ) {
      fail("forbidden_domain", "The selected Tenant does not own this Domain");
    }
  }
  const pathname = req.url.split("?", 1)[0] ?? "/";
  if (
    ownerOperation(req, selected !== null) &&
    !(isChildNamespace && pathname === "/v1/me")
  ) {
    if (isChildNamespace) {
      fail(
        "token_scope_mismatch",
        "A Domain credential cannot administer its parent Tenant",
      );
    }
    return ownerContext;
  }

  if (owner.archivedAt)
    fail("tenant_archived", "The owning Tenant is archived");
  if (
    identity.via !== "token" &&
    identity.platformRole !== "superadmin" &&
    !ownerRole
  ) {
    fail("forbidden_domain", "Membership in the owning Tenant is required");
  }
  const domain = selected
    ? resolveDomain(owner.id, selected)
    : (bound ?? ensureDefaultDomain(owner.id));
  if (!domain || domain.archivedAt) {
    fail("domain_unavailable", "The selected Domain is unavailable", 404);
  }
  if (domain.tenantId !== owner.id)
    fail("forbidden_domain", "Domain ownership mismatch");
  const runtime = getDb()
    .select({ archivedAt: tenants.archivedAt })
    .from(tenants)
    .where(eq(tenants.id, domain.runtimeTenantId))
    .get();
  if (!runtime || runtime.archivedAt)
    fail("domain_unavailable", "The Domain runtime is unavailable", 404);
  // Browser requests start from the owner row, so their initial namespace
  // check above does not examine the selected child's marker.
  const runtimeNamespace = getDb()
    .select()
    .from(tenantRuntimeNamespaces)
    .where(eq(tenantRuntimeNamespaces.tenantId, domain.runtimeTenantId))
    .get();
  if (
    runtimeNamespace &&
    runtimeNamespace.businessDomainTenantId !== owner.id
  ) {
    fail(
      "domain_namespace_conflict",
      "The Domain and runtime namespace have conflicting ownership",
    );
  }
  if (
    runtimeNamespace &&
    (runtimeNamespace.status !== "active" || runtimeNamespace.archivedAt)
  ) {
    fail("domain_unavailable", "The Domain runtime namespace is archived", 404);
  }

  let role: TenantRole | null;
  if (identity.via === "token") {
    if (domain.runtimeTenantId !== identity.tenantId) {
      fail(
        "token_scope_mismatch",
        "This credential is restricted to its original Domain",
      );
    }
    role = identity.role;
  } else if (identity.platformRole === "superadmin" || ownerRole === "admin") {
    role = "admin";
  } else if (domain.runtimeTenantId === owner.id) {
    // The legacy/default Domain retains the user's current owner role, not a
    // possibly stale migrated grant after a membership downgrade.
    role = ownerRole;
  } else {
    role = identity.userId
      ? domainRoleForUser(domain.id, identity.userId)
      : null;
  }
  if (!role && identity.platformRole !== "superadmin") {
    fail("forbidden_domain", "Access to this Domain has not been granted");
  }

  return {
    ...ownerContext,
    tenantId: domain.runtimeTenantId,
    tenantSlug: domain.runtimeTenantSlug,
    domainId: domain.id,
    domainSlug: domain.slug,
    role,
  };
}
