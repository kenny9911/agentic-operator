/**
 * Auth + identity (P6-AUTH).
 *
 *   POST /v1/auth/register   public · self-service signup (email + password)
 *   POST /v1/auth/login      public · password verify → session cookie
 *   POST /v1/auth/logout     clear session cookie
 *   GET  /v1/me              identity + active-tenant role + capability set
 *   POST /v1/me/password     change own password
 *
 * The api owns auth because apps/web has zero DB access (password hashes live
 * here). The web sign-in/up forms POST these endpoints through the Next
 * `/v1/*` rewrite so the Set-Cookie lands same-origin.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import {
  getDb,
  hashPassword,
  memberships,
  tenants,
  users,
  verifyPassword,
} from "@agentic/db";
import { makeId } from "@agentic/shared";
import {
  ChangePasswordBody,
  LoginBody,
  RegisterBody,
  capabilitiesFor,
  type MeMembership,
  type TenantRole,
} from "@agentic/contracts";
import {
  clearSessionCookie,
  readCookie,
  initialsFor,
  requireAuth,
  setSessionCookie,
  signSessionJwt,
  type AuthedContext,
} from "../../plugins/auth";
import { writeAudit } from "../../plugins/rbac";
import { z } from "zod";
import {
  accountsMode,
  authorizedAuthorityClient,
  authorityTenants,
  AuthorityRegistration,
  AuthorityLogin,
  AuthorityPassword,
  registerAuthorityAccount,
  loginAuthorityAccount,
  projectAuthorityAccount,
  revokeAuthoritySession,
  changeAuthorityPassword,
  AccountAuthorityError,
} from "../../services/account-authority";

// ─── Light in-memory rate limit (anti-abuse for register/login) ──────────────

interface Bucket {
  count: number;
  resetAt: number;
}
const WINDOW_MS = 60_000;
const buckets = new Map<string, Bucket>();

function rateLimited(key: string, max: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  b.count += 1;
  return b.count > max;
}

function clientIp(req: FastifyRequest): string {
  // Fastify derives this from the socket (or from trusted proxy hops when
  // `trustProxy` is explicitly configured). Never trust a caller-supplied
  // x-forwarded-for value directly or the auth rate limit is trivially bypassed.
  return req.ip;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function membershipsFor(userId: string): MeMembership[] {
  const rows = getDb()
    .select({
      role: memberships.role,
      slug: tenants.slug,
      name: tenants.name,
    })
    .from(memberships)
    .innerJoin(tenants, eq(memberships.tenantId, tenants.id))
    .where(eq(memberships.userId, userId))
    .all();
  return rows.map((r) => ({
    tenantSlug: r.slug,
    tenantName: r.name,
    role: r.role as TenantRole,
  }));
}

/** Pick the slug to stamp into the session cookie (display/redirect hint). */
function preferredTenantSlug(userId: string, hint?: string): string {
  const mine = membershipsFor(userId);
  if (hint && mine.some((m) => m.tenantSlug === hint)) return hint;
  if (mine[0]) return mine[0].tenantSlug;
  return hint ?? process.env.AGENTIC_DEV_TENANT?.trim() ?? "";
}

async function issueSession(
  reply: FastifyReply,
  user: { id: string; name: string },
  tenantSlug: string,
): Promise<void> {
  const jwt = await signSessionJwt({
    sub: user.id,
    name: user.name,
    initials: initialsFor(user.name),
    tenant: tenantSlug,
  });
  setSessionCookie(reply, jwt);
}

function meResponse(ctx: AuthedContext) {
  const mine = ctx.userId ? membershipsFor(ctx.userId) : [];
  const activeTenant = ctx.tenantSlug
    ? {
        slug: ctx.tenantSlug,
        name:
          getDb()
            .select({ name: tenants.name })
            .from(tenants)
            .where(eq(tenants.id, ctx.tenantId))
            .all()[0]?.name ?? ctx.tenantSlug,
        role: ctx.role,
      }
    : null;
  return {
    user: {
      id: ctx.userId ?? "",
      email: ctx.email ?? "",
      name: ctx.name ?? "",
      platformRole: ctx.platformRole,
      ...(ctx.authorityAccountId
        ? {
            username: ctx.username,
            accountId: ctx.authorityAccountId,
            identityProvider: "accounts",
          }
        : {}),
    },
    activeTenant,
    memberships: mine,
    capabilities: capabilitiesFor(ctx.role, ctx.platformRole).filter(
      (permission) => !ctx.authorityAccountId || permission !== "members.write",
    ),
  };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get("/auth/config", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    return reply.ok({ mode: accountsMode() ? "accounts" : "local" });
  });
  app.get("/auth/authority/tenants", async (req, reply) => {
    if (!authorizedAuthorityClient(req.headers.authorization))
      return reply.fail("unauthorized", "unauthorized", 401);
    reply.header("Cache-Control", "no-store");
    return { tenants: authorityTenants() };
  });
  // ── POST /v1/auth/register ──────────────────────────────────────────────
  app.post("/auth/register", async (req, reply) => {
    if (rateLimited(`reg:${clientIp(req)}`, 10)) {
      return reply.fail(
        "rate_limited",
        "too many attempts, try again shortly",
        429,
      );
    }
    if (accountsMode()) {
      const result = await registerAuthorityAccount(
        AuthorityRegistration.parse(req.body),
      );
      reply.header("Cache-Control", "no-store");
      return reply.ok(result, 201);
    }
    const body = RegisterBody.parse(req.body);
    const email = body.email.toLowerCase();
    const db = getDb();

    const existing = db.select({ id: users.id }).from(users).where(eq(users.email, email)).all()[0];
    if (existing) {
      return reply.fail("email_taken", "an account with this email already exists", 409);
    }

    const userId = makeId("usr");
    const now = new Date();
    // The account and its required supervision record commit together. Issuing a
    // cookie before either write completed previously let a 500 response carry a
    // valid session, or leave an unaudited account behind.
    db.transaction((tx) => {
      tx.insert(users)
        .values({
          id: userId,
          email,
          name: body.name,
          passwordHash: hashPassword(body.password),
          platformRole: "none",
          status: "active",
          createdAt: now,
          updatedAt: now,
        })
        .run();
      writeAudit(
        {
          userId,
          email,
          name: body.name,
          platformRole: "none",
          tenantId: "",
          tenantSlug: "",
          role: null,
          via: "cookie",
        },
        { action: "user.register", targetType: "user", targetId: userId, meta: { email } },
      );
    });

    const tenantSlug = preferredTenantSlug(userId);
    await issueSession(reply, { id: userId, name: body.name }, tenantSlug);

    // New self-registered users have no memberships yet — the portal shows a
    // "request access" state until an admin grants one.
    return reply.ok(
      {
        user: { id: userId, email, name: body.name, platformRole: "none" as const },
        memberships: [],
      },
      201,
    );
  });

  // ── POST /v1/auth/login ─────────────────────────────────────────────────
  app.post("/auth/login", async (req, reply) => {
    if (rateLimited(`login:${clientIp(req)}`, 20)) {
      return reply.fail(
        "rate_limited",
        "too many attempts, try again shortly",
        429,
      );
    }
    if (accountsMode()) {
      const body = AuthorityLogin.parse(req.body);
      const snapshot = await loginAuthorityAccount(body);
      const principal = projectAuthorityAccount(snapshot);
      setSessionCookie(reply, snapshot.token, Date.parse(snapshot.expiresAt), body.rememberMe);
      reply.header("Cache-Control", "no-store");
      return reply.ok({
        user: {
          id: principal.id,
          name: principal.name,
          username: principal.username,
          email: "",
          platformRole: "none",
        },
        tenant: preferredTenantSlug(principal.id),
        memberships: membershipsFor(principal.id),
      });
    }
    const body = LoginBody.parse(req.body);
    const email = body.email.toLowerCase();
    const u = getDb().select().from(users).where(eq(users.email, email)).all()[0];

    // Uniform failure for unknown email / bad password / no credential set, so
    // we don't leak which accounts exist.
    if (
      !u ||
      u.authorityAccountId ||
      u.status !== "active" ||
      !verifyPassword(body.password, u.passwordHash)
    ) {
      return reply.fail(
        "invalid_credentials",
        "email or password is incorrect",
        401,
      );
    }

    const tenantSlug = preferredTenantSlug(u.id, body.tenant);
    writeAudit(
      {
        userId: u.id,
        email: u.email,
        name: u.name,
        platformRole: u.platformRole as "none" | "superadmin",
        tenantId: "",
        tenantSlug: "",
        role: null,
        via: "cookie",
      },
      { action: "user.login", targetType: "user", targetId: u.id },
    );
    await issueSession(reply, { id: u.id, name: u.name }, tenantSlug);

    return reply.ok({
      user: {
        id: u.id,
        email: u.email,
        name: u.name,
        platformRole: u.platformRole as "none" | "superadmin",
      },
      tenant: tenantSlug,
      memberships: membershipsFor(u.id),
    });
  });

  // ── POST /v1/auth/logout ────────────────────────────────────────────────
  app.post("/auth/logout", async (req, reply) => {
    if (accountsMode()) {
      const token = readCookie(req.headers.cookie, "agentic_session");
      // Clear locally even if the authority is unavailable, while reporting
      // that server-side revocation could not be confirmed.
      clearSessionCookie(reply);
      if (token) await revokeAuthoritySession(token);
      return reply.ok({ ok: true });
    }
    if (req.auth) {
      writeAudit(req.auth, { action: "user.logout", targetType: "user", targetId: req.auth.userId });
    }
    clearSessionCookie(reply);
    return reply.ok({ ok: true });
  });

  // ── GET /v1/me ──────────────────────────────────────────────────────────
  app.get("/me", async (req, reply) => {
    const ctx = requireAuth(req);
    return reply.ok(meResponse(ctx));
  });

  // ── POST /v1/me/password ────────────────────────────────────────────────
  app.post("/me/password", async (req, reply) => {
    const ctx = requireAuth(req);
    if (!ctx.userId) {
      return reply.fail(
        "no_user",
        "this credential is not tied to a user account",
        400,
      );
    }
    if (accountsMode()) {
      const token = readCookie(req.headers.cookie, "agentic_session");
      if (!token || !ctx.authorityAccountId)
        throw new AccountAuthorityError("invalid_session", 401);
      const body = z
        .object({
          currentPassword: z.string().min(1).max(256),
          newPassword: AuthorityPassword,
        })
        .parse(req.body);
      await changeAuthorityPassword({ token, ...body });
      clearSessionCookie(reply);
      return reply.ok({ ok: true, signInRequired: true });
    }
    const body = ChangePasswordBody.parse(req.body);
    const db = getDb();
    const u = db.select().from(users).where(eq(users.id, ctx.userId)).all()[0];
    if (!u || !verifyPassword(body.currentPassword, u.passwordHash)) {
      return reply.fail("invalid_credentials", "current password is incorrect", 401);
    }
    db.transaction((tx) => {
      tx.update(users)
        .set({ passwordHash: hashPassword(body.newPassword), updatedAt: new Date() })
        .where(eq(users.id, ctx.userId!))
        .run();
      writeAudit(ctx, { action: "user.password_change", targetType: "user", targetId: ctx.userId });
    });
    return reply.ok({ ok: true });
  });
}
