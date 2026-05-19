/**
 * Seed script — inserts the 3 tenant fixtures from prototype data.js plus a
 * single admin user with memberships in all tenants. Run via `pnpm db:seed`.
 *
 * Idempotent: skips rows that already exist by slug/email.
 */

import { makeId } from "@agentic/shared";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "./client";
import { memberships, tenants, users } from "./schema";

const TENANT_FIXTURES = [
  {
    slug: "__system",
    name: "System",
    subtitle: "Code-defined agents (cross-tenant)",
    color: "#6f7178",
  },
  {
    slug: "raas",
    name: "RAAS",
    subtitle: "Recruitment-as-a-Service",
    color: "#d0ff00",
  },
  {
    slug: "support",
    name: "SupportFlow",
    subtitle: "Tier-1 ticket triage",
    color: "#7c9eff",
  },
  {
    slug: "finance",
    name: "FinanceClose",
    subtitle: "Monthly close orchestration",
    color: "#f5c46b",
  },
] as const;

const ADMIN_EMAIL = "ops@agentic.local";
const ADMIN_NAME = "Operator";

async function main() {
  const db = getDb();

  // Tenants
  const tenantIds: Record<string, string> = {};
  for (const t of TENANT_FIXTURES) {
    const existing = db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, t.slug))
      .all();
    if (existing.length > 0) {
      tenantIds[t.slug] = existing[0]!.id;
      console.log(`[seed] tenant ${t.slug} exists → ${tenantIds[t.slug]}`);
      continue;
    }
    const id = makeId("ten");
    db.insert(tenants).values({ id, ...t }).run();
    tenantIds[t.slug] = id;
    console.log(`[seed] tenant ${t.slug} → ${id}`);
  }

  // Admin user
  let adminId: string;
  const existingAdmin = db
    .select()
    .from(users)
    .where(eq(users.email, ADMIN_EMAIL))
    .all();
  if (existingAdmin.length > 0) {
    adminId = existingAdmin[0]!.id;
    console.log(`[seed] admin ${ADMIN_EMAIL} exists → ${adminId}`);
  } else {
    adminId = makeId("usr");
    db.insert(users)
      .values({ id: adminId, email: ADMIN_EMAIL, name: ADMIN_NAME })
      .run();
    console.log(`[seed] admin ${ADMIN_EMAIL} → ${adminId}`);
  }

  // Memberships (admin role in every tenant)
  for (const slug of Object.keys(tenantIds)) {
    const tenantId = tenantIds[slug]!;
    const existing = db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, adminId))
      .all()
      .find((m) => m.tenantId === tenantId);
    if (existing) continue;
    db.insert(memberships)
      .values({ userId: adminId, tenantId, role: "admin" })
      .run();
    console.log(`[seed] admin → ${slug} (admin)`);
  }

  console.log("[seed] done");
  closeDb();
}

main().catch((err) => {
  console.error("[seed] failed", err);
  closeDb();
  process.exit(1);
});
