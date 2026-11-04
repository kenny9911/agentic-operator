/**
 * Process-level ownership boundary for tenant Inngest apps.
 *
 * The database flag says whether an operator wants a tenant deployed. The
 * optional AGENTIC_ENABLED_TENANTS allow-list says which API process is
 * allowed to host it. A UI mutation may change desired state only inside this
 * process boundary; this prevents one shard from taking over another shard's
 * tenant app.
 */

import { domains, getDb, tenantRuntimeNamespaces, tenants } from "@agentic/db";
import { eq } from "drizzle-orm";

export function enabledTenantDeploymentScope(
  env: NodeJS.ProcessEnv = process.env,
): Set<string> | null {
  const raw = env.AGENTIC_ENABLED_TENANTS?.trim();
  if (!raw) return null;
  const slugs = raw
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean);
  if (slugs.length === 0) return null;
  const scope = new Set(slugs);
  // Process ownership is assigned to the owning Tenant. Its child Domains
  // have opaque runtime slugs, so inherit the owner allow-list explicitly.
  // Explicit namespace entries remain valid for existing shard deployments.
  const children = getDb()
    .select({
      runtimeTenantId: domains.runtimeTenantId,
      ownerSlug: tenants.slug,
    })
    .from(domains)
    .innerJoin(tenants, eq(tenants.id, domains.tenantId))
    .all();
  const compatibilityNamespaces = getDb()
    .select({
      runtimeTenantId: tenantRuntimeNamespaces.tenantId,
      ownerSlug: tenants.slug,
    })
    .from(tenantRuntimeNamespaces)
    .innerJoin(
      tenants,
      eq(tenants.id, tenantRuntimeNamespaces.businessDomainTenantId),
    )
    .all();
  const runtimeIds = new Set(
    [...children, ...compatibilityNamespaces]
      .filter((row) => scope.has(row.ownerSlug))
      .map((row) => row.runtimeTenantId),
  );
  if (runtimeIds.size > 0) {
    for (const runtime of getDb()
      .select({ id: tenants.id, slug: tenants.slug })
      .from(tenants)
      .all()) {
      if (runtimeIds.has(runtime.id)) scope.add(runtime.slug);
    }
  }
  return scope;
}

export function isTenantInProcessDeploymentScope(
  slug: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const scope = enabledTenantDeploymentScope(env);
  return scope === null || scope.has(slug);
}
