/**
 * Tenant-scoping helpers per DESIGN.md §11.
 *
 * Every query against a tenant-scoped table goes through these so we cannot
 * accidentally leak rows across tenants. Tables without `tenant_id` (users,
 * memberships, …) are not eligible — use getDb() directly for those.
 *
 *   const where = tenantScope(ctx, runs);
 *   await getDb().select().from(runs).where(where(eq(runs.id, 'run-x')));
 */

import { eq, and, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { getDb, type DB } from "./client";

export interface TenantContext {
  tenantId: string;
}

interface TenantScopedTable {
  tenantId: SQLiteColumn;
}

export function tenantScope<T extends TenantScopedTable>(
  ctx: TenantContext,
  table: T,
): (extra?: SQL) => SQL {
  const tenantPred = eq(table.tenantId, ctx.tenantId);
  return (extra?: SQL): SQL => (extra ? and(tenantPred, extra)! : tenantPred);
}

/** Convenience: returns the global db (still requires the caller to scope by tenant). */
export function db(): DB {
  return getDb();
}
