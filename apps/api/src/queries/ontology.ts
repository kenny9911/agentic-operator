import { eq } from "drizzle-orm";
import {
  entityTypes,
  eventTypes,
  getDb,
  tenants,
} from "@agentic/db";

async function resolveTenantId(slug: string): Promise<string | null> {
  const db = getDb();
  return db.select().from(tenants).where(eq(tenants.slug, slug)).all()[0]?.id ?? null;
}

export interface EventTypeRow {
  name: string;
  category: string | null;
  color: string | null;
  description: string | null;
}

export async function listEventTypes(
  tenantSlug: string,
): Promise<EventTypeRow[]> {
  const db = getDb();
  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return [];
  return db
    .select({
      name: eventTypes.name,
      category: eventTypes.category,
      color: eventTypes.color,
      description: eventTypes.description,
    })
    .from(eventTypes)
    .where(eq(eventTypes.tenantId, tenantId))
    .orderBy(eventTypes.name)
    .all();
}

export interface EntityTypeRow {
  entityId: string;
  name: string;
  description: string | null;
  primaryKeyName: string | null;
}

export async function listEntityTypes(
  tenantSlug: string,
): Promise<EntityTypeRow[]> {
  const db = getDb();
  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return [];
  return db
    .select({
      entityId: entityTypes.entityId,
      name: entityTypes.name,
      description: entityTypes.description,
      primaryKeyName: entityTypes.primaryKeyName,
    })
    .from(entityTypes)
    .where(eq(entityTypes.tenantId, tenantId))
    .orderBy(entityTypes.entityId)
    .all();
}
