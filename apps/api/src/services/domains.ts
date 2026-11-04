import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import {
  auditLog,
  agents,
  deployments,
  domainMemberships,
  domains,
  factoryRuns,
  getDb,
  getTenantInngestDeploymentMarker,
  memberships,
  ontocodeCommands,
  ontocodeSessions,
  runs,
  runtimeProfiles,
  tasks,
  tenantBudgets,
  tenantInngestDeploymentEnabledFromMarker,
  tenantInngestDeploymentMarkerId,
  tenantRuntimeNamespaces,
  tenants,
  users,
  workflows,
  TENANT_INNGEST_DEPLOYMENT_NOTE,
  TENANT_INNGEST_DISABLED_VERSION,
  TENANT_INNGEST_ENABLED_VERSION,
  type DB,
} from "@agentic/db";
import {
  CreateDomainBodySchema,
  DomainSchema,
  RuntimeAdapterCoordinatesSchema,
  UpdateDomainBodySchema,
  type CreateDomainBody,
  type Domain,
  type DomainMember,
  type DomainMembership,
  type TenantRole,
  type UpdateDomainBody,
} from "@agentic/contracts";
import { makeId } from "@agentic/shared";
import { withTenantRuntimeMutationLease } from "./tenant-runtime-mutation";
import { hasFactoryActiveWork } from "./agent-factory/active-work";
import { createRuntimeProfile } from "./runtime-profile-store";
import { getRuntimeTenantRegistrySnapshot } from "./agent-factory/tenant-native-tool-provider";
import {
  DOMAIN_NATIVE_PROFILE_NAME,
  DOMAIN_NATIVE_REGISTRY_VERSION,
} from "./domain-native-registry";

type DbLike = Pick<DB, "select" | "insert" | "update" | "delete">;
type DomainRow = typeof domains.$inferSelect;
export type DomainRuntimeSync = (runtimeTenantSlug: string) => Promise<unknown>;

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

function requireOwner(db: DbLike, tenantId: string, allowArchived = false) {
  const owner = db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
  const namespace = db
    .select()
    .from(tenantRuntimeNamespaces)
    .where(eq(tenantRuntimeNamespaces.tenantId, tenantId))
    .get();
  const childRuntime = db
    .select({ id: domains.id })
    .from(domains)
    .where(
      and(
        eq(domains.runtimeTenantId, tenantId),
        ne(domains.tenantId, tenantId),
      ),
    )
    .get();
  if (!owner || namespace || childRuntime)
    throw new DomainError(
      "tenant_not_found",
      "Owning Tenant was not found",
      404,
    );
  if (!allowArchived && owner.archivedAt)
    throw new DomainError(
      "tenant_archived",
      "The owning Tenant is archived",
      409,
    );
  return owner;
}

function projectDomain(row: DomainRow, db: DbLike = getDb()): Domain {
  const runtime = db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, row.runtimeTenantId))
    .get();
  if (!runtime)
    throw new DomainError(
      "domain_runtime_missing",
      "The Domain runtime namespace is missing",
      409,
    );
  return DomainSchema.parse({
    id: row.id,
    tenantId: row.tenantId,
    slug: row.slug,
    name: row.name,
    description: row.description,
    runtimeTenantId: row.runtimeTenantId,
    runtimeTenantSlug: runtime.slug,
    isDefault: row.isDefault,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    archivedAt: row.archivedAt?.getTime() ?? null,
  });
}

/** Backfill only the legacy default; no new Domain inherits sibling grants. */
export function ensureDefaultDomain(ownerTenantId: string): Domain {
  const db = getDb();
  return db.transaction((tx) => {
    const owner = requireOwner(tx, ownerTenantId, true);
    let row = tx
      .select()
      .from(domains)
      .where(and(eq(domains.tenantId, owner.id), eq(domains.isDefault, true)))
      .get();
    const isNew = !row;
    if (!row) {
      tx.insert(domains)
        .values({
          id: `dom-legacy-${owner.id}`,
          tenantId: owner.id,
          slug: owner.slug,
          name: owner.name,
          description: owner.subtitle,
          runtimeTenantId: owner.id,
          isDefault: true,
          createdAt: owner.createdAt,
          updatedAt: owner.updatedAt,
          // The owner's lifecycle is checked separately. Copying its archived
          // timestamp would keep this Domain archived after the owner restores.
          archivedAt: null,
        })
        .onConflictDoNothing()
        .run();
      row = tx
        .select()
        .from(domains)
        .where(and(eq(domains.tenantId, owner.id), eq(domains.isDefault, true)))
        .get();
    }
    if (!row)
      throw new DomainError(
        "domain_default_conflict",
        "The default Domain could not be resolved",
        409,
      );
    // Existing migration Domains and configured namespaces keep their exact
    // registry/profile identity. A newly created empty Tenant can build with
    // global Tools without first installing a custom TypeScript package.
    if (
      isNew &&
      // Reserved/legacy tenant identities such as __system are valid existing
      // scopes, but cannot name a native adapter. Backfill their Domain without
      // manufacturing a profile or changing the exact runtime identity.
      owner.slug === owner.slug.trim() &&
      RuntimeAdapterCoordinatesSchema.shape.adapterRegistrySlug.safeParse(owner.slug).success &&
      !owner.archivedAt &&
      !tx
        .select({ id: workflows.id })
        .from(workflows)
        .where(eq(workflows.tenantId, owner.id))
        .get() &&
      !tx
        .select({ id: agents.id })
        .from(agents)
        .where(eq(agents.tenantId, owner.id))
        .get() &&
      !tx
        .select({ id: runtimeProfiles.id })
        .from(runtimeProfiles)
        .where(eq(runtimeProfiles.tenantId, owner.id))
        .get() &&
      !tx
        .select({ id: deployments.id })
        .from(deployments)
        .where(
          and(
            eq(deployments.tenantId, owner.id),
            ne(deployments.target, "runtime"),
          ),
        )
        .get() &&
      !getRuntimeTenantRegistrySnapshot(owner.slug)
    ) {
      provisionNativeProfile(owner.id, owner.slug, null);
    }
    const grants = tx
      .select()
      .from(memberships)
      .where(eq(memberships.tenantId, owner.id))
      .all();
    for (const grant of grants) {
      tx.insert(domainMemberships)
        .values({
          domainId: row.id,
          userId: grant.userId,
          role: grant.role,
          createdAt: grant.createdAt,
          createdBy: grant.createdBy,
        })
        .onConflictDoNothing()
        .run();
    }
    return projectDomain(row, tx);
  });
}

function provisionNativeProfile(
  tenantId: string,
  tenantSlug: string,
  actorId?: string | null,
): void {
  createRuntimeProfile(
    { tenantId, tenantSlug, actorId: actorId ?? null },
    {
      name: DOMAIN_NATIVE_PROFILE_NAME,
      description:
        "Use the platform's global Tools without a custom tenant code package",
      adapter: {
        kind: "native",
        adapterRegistrySlug: tenantSlug,
        adapterRegistryVersion: DOMAIN_NATIVE_REGISTRY_VERSION,
        eventNamespace: tenantSlug,
        compatibilityTenantSlug: null,
      },
    },
  );
}

export function resolveDomain(
  ownerTenantId: string,
  idOrSlug: string,
  options: { includeArchived?: boolean } = {},
): Domain | null {
  const db = getDb();
  const row = db
    .select()
    .from(domains)
    .where(
      and(
        eq(domains.tenantId, ownerTenantId),
        or(eq(domains.id, idOrSlug), eq(domains.slug, idOrSlug)),
        ...(options.includeArchived ? [] : [isNull(domains.archivedAt)]),
      ),
    )
    .get();
  return row ? projectDomain(row) : null;
}

/** Read-only reverse lookup used to bind old tokens to their original data. */
export function domainForRuntimeTenant(runtimeTenantId: string): Domain | null {
  const row = getDb()
    .select()
    .from(domains)
    .where(eq(domains.runtimeTenantId, runtimeTenantId))
    .get();
  return row ? projectDomain(row) : null;
}

export function domainRoleForUser(
  domainId: string,
  userId: string,
): TenantRole | null {
  const row = getDb()
    .select({ role: domainMemberships.role })
    .from(domainMemberships)
    .where(
      and(
        eq(domainMemberships.domainId, domainId),
        eq(domainMemberships.userId, userId),
      ),
    )
    .get();
  return row?.role ?? null;
}

export function listDomains(
  ownerTenantId: string,
  options: { includeArchived?: boolean } = {},
): Domain[] {
  ensureDefaultDomain(ownerTenantId);
  return getDb()
    .select()
    .from(domains)
    .where(
      and(
        eq(domains.tenantId, ownerTenantId),
        ...(options.includeArchived ? [] : [isNull(domains.archivedAt)]),
      ),
    )
    .orderBy(desc(domains.isDefault), asc(domains.name), asc(domains.id))
    .all()
    .map((row) => projectDomain(row));
}

function requireDomain(
  ownerTenantId: string,
  idOrSlug: string,
  includeArchived = false,
): Domain {
  const domain = resolveDomain(ownerTenantId, idOrSlug, { includeArchived });
  if (!domain)
    throw new DomainError(
      "domain_not_found",
      "Domain was not found in this Tenant",
      404,
    );
  return domain;
}

function audit(
  db: DbLike,
  ownerTenantId: string,
  domainId: string,
  action: string,
  actorId?: string | null,
): string {
  const id = makeId("aud");
  db.insert(auditLog)
    .values({
      id,
      tenantId: ownerTenantId,
      targetType: "domain",
      targetId: domainId,
      actorUserId: actorId ?? null,
      action,
      at: new Date(),
      metaJson: { domainId },
    })
    .run();
  return id;
}

/** Creating a Domain allocates fresh execution state, never copies credentials or data. */
export async function createDomain(
  ownerTenantId: string,
  raw: CreateDomainBody,
  actorId?: string | null,
): Promise<Domain> {
  const input = CreateDomainBodySchema.parse(raw);
  return withTenantRuntimeMutationLease({
    tenantId: ownerTenantId,
    kind: "domain_create",
    workId: input.slug,
    fn: async (lease) => {
      lease.assertOwned();
      ensureDefaultDomain(ownerTenantId);
      return getDb().transaction((tx) => {
        requireOwner(tx, ownerTenantId);
        const existing = tx
          .select({ id: domains.id })
          .from(domains)
          .where(
            and(
              eq(domains.tenantId, ownerTenantId),
              eq(domains.slug, input.slug),
            ),
          )
          .get();
        if (existing)
          throw new DomainError(
            "domain_slug_taken",
            "This Domain slug is already used in the Tenant",
            409,
          );
        const id = `dom-${randomUUID().replace(/-/g, "")}`;
        const runtimeTenantId = makeId("ten");
        const runtimeSlug = `dr-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
        const now = new Date();
        tx.insert(tenants)
          .values({
            id: runtimeTenantId,
            slug: runtimeSlug,
            name: input.name,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        tx.insert(tenantRuntimeNamespaces)
          .values({
            tenantId: runtimeTenantId,
            businessDomainTenantId: ownerTenantId,
            status: "active",
            createdBy: actorId ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        tx.insert(domains)
          .values({
            id,
            tenantId: ownerTenantId,
            slug: input.slug,
            name: input.name,
            description: input.description ?? null,
            runtimeTenantId,
            isDefault: false,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        tx.insert(deployments)
          .values({
            id: tenantInngestDeploymentMarkerId(runtimeTenantId),
            tenantId: runtimeTenantId,
            target: "runtime",
            status: "live",
            versionId: TENANT_INNGEST_DISABLED_VERSION,
            note: TENANT_INNGEST_DEPLOYMENT_NOTE,
            deployedBy: actorId ?? null,
            deployedAt: now,
          })
          .run();
        tx.insert(tenantBudgets)
          .values({
            tenantId: runtimeTenantId,
            monthlyTokenCap: null,
            monthlyUsdCap: null,
            usedTokensMonth: 0,
            usedUsdMonth: 0,
            periodStart: now,
            updatedAt: now,
          })
          .run();
        // This is an empty built-in native adapter, not a sample workflow or
        // copied tenant configuration. OntoCode can bind it immediately.
        provisionNativeProfile(runtimeTenantId, runtimeSlug, actorId);
        if (actorId)
          tx.insert(domainMemberships)
            .values({
              domainId: id,
              userId: actorId,
              role: "admin",
              createdBy: actorId,
            })
            .run();
        audit(tx, ownerTenantId, id, "domain.create", actorId);
        lease.assertOwned();
        return projectDomain(
          tx.select().from(domains).where(eq(domains.id, id)).get()!,
          tx,
        );
      });
    },
  });
}

export function updateDomain(
  ownerTenantId: string,
  idOrSlug: string,
  raw: UpdateDomainBody,
  actorId?: string | null,
): Domain {
  const input = UpdateDomainBodySchema.parse(raw);
  const domain = requireDomain(ownerTenantId, idOrSlug);
  return getDb().transaction((tx) => {
    requireOwner(tx, ownerTenantId);
    tx.update(domains)
      .set({ ...input, updatedAt: new Date() })
      .where(
        and(
          eq(domains.id, domain.id),
          eq(domains.tenantId, ownerTenantId),
          isNull(domains.archivedAt),
        ),
      )
      .run();
    audit(tx, ownerTenantId, domain.id, "domain.update", actorId);
    return projectDomain(
      tx.select().from(domains).where(eq(domains.id, domain.id)).get()!,
      tx,
    );
  });
}

export function domainHasActiveWork(runtimeTenantId: string): boolean {
  const db = getDb();
  const activeRun = db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.tenantId, runtimeTenantId),
        isNull(runs.deletedAt),
        inArray(runs.status, ["queued", "running", "waiting", "paused"]),
      ),
    )
    .get();
  const activeTask = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.tenantId, runtimeTenantId),
        isNull(tasks.deletedAt),
        inArray(tasks.status, ["open", "resolving"]),
      ),
    )
    .get();
  const factory = db
    .select({ id: factoryRuns.id })
    .from(factoryRuns)
    .where(
      and(
        eq(factoryRuns.tenantId, runtimeTenantId),
        inArray(factoryRuns.status, ["running", "waiting_human"]),
      ),
    )
    .get();
  const session = db
    .select({ id: ontocodeSessions.id })
    .from(ontocodeSessions)
    .where(
      and(
        eq(ontocodeSessions.tenantId, runtimeTenantId),
        inArray(ontocodeSessions.activityState, [
          "ai_planning",
          "queued",
          "running",
          "paused",
        ]),
      ),
    )
    .get();
  const command = db
    .select({ id: ontocodeCommands.id })
    .from(ontocodeCommands)
    .where(
      and(
        eq(ontocodeCommands.tenantId, runtimeTenantId),
        inArray(ontocodeCommands.status, ["approved", "queued", "running"]),
      ),
    )
    .get();
  return Boolean(
    activeRun ||
    activeTask ||
    factory ||
    session ||
    command ||
    hasFactoryActiveWork(runtimeTenantId),
  );
}

/** Archive/restore compensates the exact prior deployment selection on sync failure. */
async function transitionDomain(
  ownerTenantId: string,
  idOrSlug: string,
  action: "archive" | "restore",
  actorId: string | null | undefined,
  syncRuntime: DomainRuntimeSync,
): Promise<Domain> {
  const beforeDomain = requireDomain(ownerTenantId, idOrSlug, true);
  const transition = async () =>
    withTenantRuntimeMutationLease({
      tenantId: beforeDomain.runtimeTenantId,
      kind: `domain_${action}`,
      workId: beforeDomain.id,
      waitMs: 0,
      fn: async (lease) => {
        lease.assertOwned();
        const db = getDb();
        requireOwner(db, ownerTenantId);
        const before = db
          .select()
          .from(domains)
          .where(
            and(
              eq(domains.id, beforeDomain.id),
              eq(domains.tenantId, ownerTenantId),
            ),
          )
          .get()!;
        if ((action === "archive") === (before.archivedAt !== null)) {
          throw new DomainError(
            action === "archive"
              ? "domain_already_archived"
              : "domain_not_archived",
            `Domain is ${action === "archive" ? "already archived" : "not archived"}`,
            409,
          );
        }
        if (
          action === "archive" &&
          domainHasActiveWork(before.runtimeTenantId)
        ) {
          throw new DomainError(
            "domain_has_active_work",
            "Resolve or cancel the Domain's active work before archiving it",
            409,
          );
        }
        const markerBefore = getTenantInngestDeploymentMarker(
          before.runtimeTenantId,
        );
        const wasEnabled =
          tenantInngestDeploymentEnabledFromMarker(markerBefore);
        const targetEnabled =
          action === "archive"
            ? false
            : (before.runtimeEnabledBeforeArchive ?? false);
        const changedAt = new Date();
        const auditId = db.transaction((tx) => {
          tx.update(domains)
            .set({
              archivedAt: action === "archive" ? changedAt : null,
              runtimeEnabledBeforeArchive:
                action === "archive" ? wasEnabled : null,
              updatedAt: changedAt,
            })
            .where(eq(domains.id, before.id))
            .run();
          tx.insert(deployments)
            .values({
              id: tenantInngestDeploymentMarkerId(before.runtimeTenantId),
              tenantId: before.runtimeTenantId,
              target: "runtime",
              status: "live",
              deployedBy: actorId ?? null,
              deployedAt: changedAt,
              versionId: targetEnabled
                ? TENANT_INNGEST_ENABLED_VERSION
                : TENANT_INNGEST_DISABLED_VERSION,
              note: TENANT_INNGEST_DEPLOYMENT_NOTE,
            })
            .onConflictDoUpdate({
              target: deployments.id,
              set: {
                versionId: targetEnabled
                  ? TENANT_INNGEST_ENABLED_VERSION
                  : TENANT_INNGEST_DISABLED_VERSION,
                status: "live",
                deployedBy: actorId ?? null,
                deployedAt: changedAt,
                note: TENANT_INNGEST_DEPLOYMENT_NOTE,
              },
            })
            .run();
          return audit(
            tx,
            ownerTenantId,
            before.id,
            `domain.${action}`,
            actorId,
          );
        });
        try {
          lease.assertOwned();
          await syncRuntime(beforeDomain.runtimeTenantSlug);
          lease.assertOwned();
        } catch (error) {
          db.transaction((tx) => {
            tx.update(domains)
              .set({
                archivedAt: before.archivedAt,
                updatedAt: before.updatedAt,
                runtimeEnabledBeforeArchive: before.runtimeEnabledBeforeArchive,
              })
              .where(eq(domains.id, before.id))
              .run();
            if (markerBefore)
              tx.update(deployments)
                .set(markerBefore)
                .where(eq(deployments.id, markerBefore.id))
                .run();
            else
              tx.delete(deployments)
                .where(
                  eq(
                    deployments.id,
                    tenantInngestDeploymentMarkerId(before.runtimeTenantId),
                  ),
                )
                .run();
            tx.delete(auditLog).where(eq(auditLog.id, auditId)).run();
          });
          try {
            await syncRuntime(beforeDomain.runtimeTenantSlug);
          } catch (compensation) {
            throw new AggregateError(
              [error, compensation],
              "Domain lifecycle failed and runtime compensation failed",
            );
          }
          throw error;
        }
        return requireDomain(ownerTenantId, before.id, true);
      },
    });
  if (beforeDomain.runtimeTenantId === ownerTenantId) return transition();
  return withTenantRuntimeMutationLease({
    tenantId: ownerTenantId,
    kind: `domain_${action}_owner`,
    workId: beforeDomain.id,
    waitMs: 0,
    fn: async (lease) => {
      lease.assertOwned();
      const domain = await transition();
      lease.assertOwned();
      return domain;
    },
  });
}

export async function archiveDomain(
  ownerTenantId: string,
  idOrSlug: string,
  confirm: string,
  actorId: string | null | undefined,
  syncRuntime: DomainRuntimeSync,
): Promise<Domain> {
  const domain = requireDomain(ownerTenantId, idOrSlug, true);
  if (confirm !== domain.slug)
    throw new DomainError(
      "domain_confirmation_mismatch",
      "Confirmation must match the Domain slug",
      400,
    );
  return transitionDomain(
    ownerTenantId,
    domain.id,
    "archive",
    actorId,
    syncRuntime,
  );
}

export async function restoreDomain(
  ownerTenantId: string,
  idOrSlug: string,
  actorId: string | null | undefined,
  syncRuntime: DomainRuntimeSync,
): Promise<Domain> {
  return transitionDomain(
    ownerTenantId,
    idOrSlug,
    "restore",
    actorId,
    syncRuntime,
  );
}

export function listDomainMembers(
  ownerTenantId: string,
  idOrSlug: string,
): DomainMember[] {
  const domain = requireDomain(ownerTenantId, idOrSlug, true);
  return getDb()
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      tenantRole: memberships.role,
      domainRole: domainMemberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(
      domainMemberships,
      and(
        eq(domainMemberships.userId, users.id),
        eq(domainMemberships.domainId, domain.id),
      ),
    )
    .where(eq(memberships.tenantId, ownerTenantId))
    .orderBy(asc(users.name), asc(users.id))
    .all()
    .map((member) => ({
      ...member,
      // Default Domain authorization follows the current owning membership.
      // A migration grant is historical and must not display a stale role.
      domainRole: domain.isDefault ? member.tenantRole : member.domainRole,
    }));
}

export function grantDomainMembership(
  ownerTenantId: string,
  idOrSlug: string,
  userId: string,
  role: TenantRole,
  actorId?: string | null,
): DomainMembership {
  const domain = requireDomain(ownerTenantId, idOrSlug);
  return getDb().transaction((tx) => {
    requireOwner(tx, ownerTenantId);
    const member = tx
      .select({ id: users.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.tenantId, ownerTenantId),
          eq(users.id, userId),
          eq(users.status, "active"),
        ),
      )
      .get();
    if (!member)
      throw new DomainError(
        "domain_member_not_in_tenant",
        "Only an active member of the owning Tenant can receive a Domain grant",
        409,
      );
    if (domain.isDefault)
      throw new DomainError(
        "domain_default_membership_inherited",
        "Default Domain access follows Tenant membership; manage it from Tenant access",
        409,
      );
    tx.insert(domainMemberships)
      .values({ domainId: domain.id, userId, role, createdBy: actorId ?? null })
      .onConflictDoUpdate({
        target: [domainMemberships.domainId, domainMemberships.userId],
        set: { role, createdBy: actorId ?? null },
      })
      .run();
    audit(tx, ownerTenantId, domain.id, "domain.member.grant", actorId);
    const row = tx
      .select()
      .from(domainMemberships)
      .where(
        and(
          eq(domainMemberships.domainId, domain.id),
          eq(domainMemberships.userId, userId),
        ),
      )
      .get()!;
    return {
      domainId: domain.id,
      userId,
      role: row.role,
      createdAt: row.createdAt.getTime(),
    };
  });
}

export function revokeDomainMembership(
  ownerTenantId: string,
  idOrSlug: string,
  userId: string,
  actorId?: string | null,
): boolean {
  const domain = requireDomain(ownerTenantId, idOrSlug, true);
  if (domain.isDefault)
    throw new DomainError(
      "domain_default_membership_inherited",
      "Default Domain access follows Tenant membership; manage it from Tenant access",
      409,
    );
  return getDb().transaction((tx) => {
    requireOwner(tx, ownerTenantId);
    const removed = tx
      .delete(domainMemberships)
      .where(
        and(
          eq(domainMemberships.domainId, domain.id),
          eq(domainMemberships.userId, userId),
        ),
      )
      .run();
    if (removed.changes)
      audit(tx, ownerTenantId, domain.id, "domain.member.revoke", actorId);
    return removed.changes > 0;
  });
}
