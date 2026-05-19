import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { apiTokens, getDb, tenants } from "@agentic/db";

export interface AuthedContext {
  tenantId: string;
  tenantSlug: string;
  via: "token" | "dev";
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthedContext;
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function devTenant(): AuthedContext | null {
  const slug = process.env.AGENTIC_DEV_TENANT ?? "raas";
  const t = getDb().select().from(tenants).where(eq(tenants.slug, slug)).all()[0];
  return t ? { tenantId: t.id, tenantSlug: t.slug, via: "dev" } : null;
}

export async function authenticate(req: FastifyRequest): Promise<AuthedContext | null> {
  if (process.env.AUTH_MODE === "dev" || process.env.NODE_ENV !== "production") {
    return devTenant();
  }
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const hash = hashToken(token);

  const db = getDb();
  const row = db
    .select({ id: apiTokens.id, tenantId: apiTokens.tenantId })
    .from(apiTokens)
    .where(eq(apiTokens.hash, hash))
    .all()[0];
  if (!row) return null;

  db.update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiTokens.id, row.id))
    .run();

  const tenant = db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, row.tenantId))
    .all()[0];
  if (!tenant) return null;

  return { tenantId: row.tenantId, tenantSlug: tenant.slug, via: "token" };
}

/**
 * Decorate every request with an `auth` context. Routes that need it can read
 * `req.auth`; routes that don't (like /health) ignore it. Bearer auth happens
 * automatically — only fail explicitly inside the route.
 */
export async function registerAuth(app: FastifyInstance) {
  app.addHook("onRequest", async (req) => {
    req.auth = (await authenticate(req)) ?? undefined;
  });
}

/** Convenience: require auth or fail with 401. */
export function requireAuth(req: FastifyRequest): AuthedContext {
  if (!req.auth) {
    const err: Error & { statusCode?: number; code?: string } = new Error(
      "unauthorized",
    );
    err.statusCode = 401;
    err.code = "unauthorized";
    throw err;
  }
  return req.auth;
}

/** HMAC-SHA256 verifier for webhook signatures. */
export function verifyHmac(
  body: string,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (!signature || !secret) return false;
  const sig = signature.replace(/^sha256=/, "");
  const computed = createHash("sha256");
  computed.update(secret);
  // Use HMAC, not raw hash
  const hmac = require("node:crypto").createHmac("sha256", secret);
  hmac.update(body);
  const expected = hmac.digest("hex");
  try {
    return timingSafeEqual(
      Buffer.from(sig, "hex"),
      Buffer.from(expected, "hex"),
    );
  } catch {
    return false;
  }
}
