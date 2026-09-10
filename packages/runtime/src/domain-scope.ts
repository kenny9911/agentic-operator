import { domains, getDb, tenantRuntimeNamespaces, tenants } from "@agentic/db";
import { eq } from "drizzle-orm";

/**
 * Runtime tenant ids are durable execution namespaces. A Domain maps exactly
 * one of those namespaces to its owning Tenant. Compatibility namespace
 * markers retain their explicit owners; standalone/system rows retain their
 * own tenant lifecycle.
 *
 * Do not substitute the owner's id in runtime queries or event names: siblings
 * deliberately retain separate workflows, events, logs and dispatch identities.
 */
export function isDomainRuntimeActive(runtimeTenantId: string): boolean {
  const db = getDb();
  const runtime = db
    .select({ archivedAt: tenants.archivedAt })
    .from(tenants)
    .where(eq(tenants.id, runtimeTenantId))
    .get();
  if (!runtime || runtime.archivedAt !== null) return false;
  const domain = db
    .select({ tenantId: domains.tenantId, archivedAt: domains.archivedAt })
    .from(domains)
    .where(eq(domains.runtimeTenantId, runtimeTenantId))
    .get();
  const namespace = db
    .select()
    .from(tenantRuntimeNamespaces)
    .where(eq(tenantRuntimeNamespaces.tenantId, runtimeTenantId))
    .get();
  if (
    namespace &&
    (namespace.status !== "active" || namespace.archivedAt !== null)
  )
    return false;
  if (
    domain &&
    namespace &&
    domain.tenantId !== namespace.businessDomainTenantId
  )
    return false;
  if (domain && domain.archivedAt !== null) return false;
  // Older reviewed Runtime Profiles can own a compatibility namespace without
  // a product Domain. Their recorded owner is still a lifecycle boundary.
  const ownerId = domain?.tenantId ?? namespace?.businessDomainTenantId;
  if (!ownerId) return true;
  const owner = db
    .select({ archivedAt: tenants.archivedAt })
    .from(tenants)
    .where(eq(tenants.id, ownerId))
    .get();
  return owner !== undefined && owner.archivedAt === null;
}

export function assertDomainRuntimeActive(runtimeTenantId: string): void {
  if (!isDomainRuntimeActive(runtimeTenantId)) {
    throw new Error(
      "Domain runtime is unavailable: the Domain or its owning Tenant is archived or missing",
    );
  }
}

/** Re-check cron deliveries already queued before a lifecycle transition. */
export function isDomainRuntimeSlugActive(runtimeTenantSlug: string): boolean {
  const runtime = getDb()
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, runtimeTenantSlug))
    .get();
  return runtime !== undefined && isDomainRuntimeActive(runtime.id);
}
