import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, memberships, tenants, users } from "@agentic/db";
import { makeId } from "@agentic/shared";
import { buildTestEnv, type TestEnv } from "./harness";

const suffix = Date.now().toString(36).slice(-8);
const tenantA = { id: makeId("ten"), slug: `switch-a-${suffix}` };
const tenantB = { id: makeId("ten"), slug: `switch-b-${suffix}` };
const tenantC = { id: makeId("ten"), slug: `switch-c-${suffix}` };
const createdSlug = `switch-new-${suffix}`;
const person = {
  id: makeId("usr"),
  email: `tenant-switch-${suffix}@example.test`,
};
const sessionSecret = `tenant-switch-${suffix}-session-secret-32-chars`;

async function sessionCookie(): Promise<string> {
  const token = await new SignJWT({
    name: "Tenant Switch User",
    initials: "TS",
    tenant: tenantA.slug,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(person.email)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(sessionSecret));
  return `agentic_session=${token}`;
}

describe("production browser tenant switching", () => {
  let env: TestEnv;
  let cookie: string;

  beforeAll(async () => {
    const db = getDb();
    db.insert(tenants)
      .values([
        { id: tenantA.id, slug: tenantA.slug, name: "Switch tenant A" },
        { id: tenantB.id, slug: tenantB.slug, name: "Switch tenant B" },
        { id: tenantC.id, slug: tenantC.slug, name: "Switch tenant C" },
      ])
      .run();
    db.insert(users)
      .values({
        id: person.id,
        email: person.email,
        name: "Tenant Switch User",
      })
      .run();
    db.insert(memberships)
      .values([
        { tenantId: tenantA.id, userId: person.id, role: "admin" },
        { tenantId: tenantB.id, userId: person.id, role: "viewer" },
      ])
      .run();

    vi.stubEnv("AUTH_MODE", "production");
    vi.stubEnv("AUTH_SESSION_SECRET", sessionSecret);
    env = await buildTestEnv();
    cookie = await sessionCookie();
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    const db = getDb();
    const created = db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, createdSlug))
      .all()[0];
    if (created) db.delete(tenants).where(eq(tenants.id, created.id)).run();
    db.delete(tenants)
      .where(inArray(tenants.id, [tenantA.id, tenantB.id, tenantC.id]))
      .run();
    db.delete(users).where(eq(users.id, person.id)).run();
  });

  it("allows only active tenants where the signed-in user is a member", async () => {
    const list = await env.fetch("/v1/tenants", { headers: { cookie } });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      data: { items: Array<{ slug: string }> };
    };
    expect(listBody.data.items.map((item) => item.slug).sort()).toEqual(
      [tenantA.slug, tenantB.slug].sort(),
    );

    const allowed = await env.fetch(`/v1/tenants/${tenantB.slug}/access`, {
      headers: { cookie },
    });
    expect(allowed.status).toBe(200);
    await expect(allowed.json()).resolves.toMatchObject({
      ok: true,
      data: { tenantSlug: tenantB.slug, role: "viewer" },
    });

    const denied = await env.fetch(`/v1/tenants/${tenantC.slug}/access`, {
      headers: { cookie },
    });
    expect(denied.status).toBe(403);

    const missing = await env.fetch("/v1/tenants/does-not-exist/access", {
      headers: { cookie },
    });
    expect(missing.status).toBe(404);
  });

  it("grants a cookie-session creator membership in the new tenant", async () => {
    const response = await env.fetch("/v1/tenants", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        slug: createdSlug,
        name: "New switch tenant",
        starter: "empty",
        mintToken: false,
      }),
    });
    expect(response.status).toBe(201);

    const created = getDb()
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, createdSlug))
      .all()[0];
    expect(created).toBeDefined();
    const membership = getDb()
      .select({ role: memberships.role })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, person.id),
          eq(memberships.tenantId, created!.id),
        ),
      )
      .all()[0];
    expect(membership?.role).toBe("admin");

    const access = await env.fetch(`/v1/tenants/${createdSlug}/access`, {
      headers: { cookie },
    });
    expect(access.status).toBe(200);
  });
});
