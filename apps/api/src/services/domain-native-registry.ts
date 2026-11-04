import { and, eq, isNull } from "drizzle-orm";
import {
  deployments,
  domains,
  getDb,
  runtimeProfiles,
  runtimeProfileVersions,
  tenants,
} from "@agentic/db";
import type { TenantRegistry } from "@agentic/agent-kit";

/** Version of the empty native adapter; global Tools keep their own identities. */
export const DOMAIN_NATIVE_REGISTRY_VERSION = "global-tools-v1";
export const DOMAIN_NATIVE_PROFILE_NAME = "Global tools";

const registry: TenantRegistry = Object.freeze({
  tools: Object.freeze({}),
  prompts: Object.freeze({}),
  factory: Object.freeze({
    source: Object.freeze({
      kind: "builtin",
      id: "agentic-operator/domain-native",
      version: DOMAIN_NATIVE_REGISTRY_VERSION,
    }),
  }),
});

/**
 * Fresh Domains need no custom TypeScript package to use global Tools. This
 * adapter contributes no tools, prompts, credentials or cross-Domain access.
 * An explicit tenant-code deployment supersedes it and must load exactly.
 */
export function resolveDomainNativeRegistry(
  tenantSlug: string,
): TenantRegistry | undefined {
  const db = getDb();
  const target = db
    .select({
      ownerId: domains.tenantId,
      runtimeId: tenants.id,
      isDefault: domains.isDefault,
    })
    .from(domains)
    .innerJoin(tenants, eq(tenants.id, domains.runtimeTenantId))
    .where(
      and(
        eq(tenants.slug, tenantSlug),
        isNull(domains.archivedAt),
        isNull(tenants.archivedAt),
      ),
    )
    .get();
  if (!target) return undefined;
  if (target.isDefault) {
    // Only an explicitly pinned profile opts a default Domain into this
    // adapter. Migration never changes a legacy Domain's registry identity.
    const nativeProfile = db
      .select({ id: runtimeProfileVersions.id })
      .from(runtimeProfileVersions)
      .innerJoin(
        runtimeProfiles,
        eq(runtimeProfiles.id, runtimeProfileVersions.profileId),
      )
      .where(
        and(
          eq(runtimeProfiles.tenantId, target.runtimeId),
          eq(runtimeProfiles.status, "active"),
          isNull(runtimeProfiles.archivedAt),
          eq(runtimeProfileVersions.tenantId, target.runtimeId),
          eq(runtimeProfileVersions.adapterKind, "native"),
          eq(runtimeProfileVersions.adapterRegistrySlug, tenantSlug),
          eq(
            runtimeProfileVersions.adapterRegistryVersion,
            DOMAIN_NATIVE_REGISTRY_VERSION,
          ),
          eq(runtimeProfileVersions.eventNamespace, tenantSlug),
          isNull(runtimeProfileVersions.compatibilityTenantId),
        ),
      )
      .get();
    if (!nativeProfile) return undefined;
  } else if (!/^dr-[a-f0-9]{24}$/.test(tenantSlug)) return undefined;
  const owner = db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.id, target.ownerId), isNull(tenants.archivedAt)))
    .get();
  if (!owner) return undefined;
  const code = db
    .select({ id: deployments.id })
    .from(deployments)
    .where(
      and(
        eq(deployments.tenantId, target.runtimeId),
        eq(deployments.target, "tenant_code"),
        eq(deployments.status, "live"),
      ),
    )
    .get();
  return code ? undefined : registry;
}
