import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { jwtVerify, SignJWT } from "jose";
import { apiTokens, getDb, memberships, tenants, users } from "@agentic/db";
import type { PlatformRole, TenantRole } from "@agentic/contracts";
import {
  accountsMode,
  authorityConfig,
  inspectAuthoritySession,
  projectAuthorityAccount,
  AccountAuthorityError,
} from "../services/account-authority";

/**
 * P6-AUTH — authenticated request context.
 *
 * Identity (`userId`/`email`/`name`/`platformRole`) is resolved once per
 * request; the *active tenant* and the caller's `role` within it are resolved
 * from the request (the `x-agentic-tenant` header the portal forwards, or the
 * caller's first membership) and verified against `memberships`. RBAC
 * decisions read `platformRole` + `role` — see plugins/rbac.ts.
 *
 * `userId` is null only for legacy bearer tokens that carry no user link.
 */
export interface AuthedContext {
  userId: string | null;
  email: string | null;
  name: string | null;
  platformRole: PlatformRole;
  tenantId: string;
  tenantSlug: string;
  role: TenantRole | null;
  via: "token" | "dev" | "cookie";
  /** Bearer-token capabilities. Browser/dev sessions do not use token scopes. */
  scopes?: string[];
  /** Stable credential record id; never contains bearer-token material. */
  credentialId?: string;
  /** Expiry of the verified cookie, retained for long-lived responses. */
  sessionExpiresAt?: number;
  /** Canonical account provenance, never a credential or local authority grant. */
  authorityAccountId?: string;
  username?: string;
}

const COOKIE_NAME = "agentic_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30d

/**
 * Session JWT signing secret. Accepts both `AUTH_SESSION_SECRET` (canonical
 * api name) and `SESSION_SECRET` (what apps/web sets). Returns null when
 * neither is configured. Only the test process has a deterministic fallback;
 * every runnable server must provide a real secret.
 */
const TEST_SESSION_SECRET_FALLBACK = "test-only-session-secret-not-for-servers";
function getSessionSecret(): Uint8Array {
  const raw = process.env.AUTH_SESSION_SECRET ?? process.env.SESSION_SECRET;
  if (!raw && process.env.NODE_ENV !== "test") {
    throw new Error("AUTH_SESSION_SECRET/SESSION_SECRET is required");
  }
  return new TextEncoder().encode(raw ?? TEST_SESSION_SECRET_FALLBACK);
}

/**
 * Single-cookie reader. Avoids `@fastify/cookie` because we only need one
 * well-known key and adding the plugin would force a plugin-order change.
 */
export function readCookie(
  header: string | undefined,
  name: string,
): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    if (k !== name) continue;
    let v = part.slice(idx + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    return v;
  }
  return null;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  const first = parts[0]?.[0] ?? "";
  const last = parts[parts.length - 1]?.[0] ?? "";
  return (first + last).toUpperCase();
}

// ─── Session cookie (API-owned auth, P6-AUTH) ────────────────────────────────

interface SessionClaims {
  sub: string; // userId
  name: string;
  initials: string;
  tenant: string; // last-active tenant slug (display/redirect hint only)
}

/** Sign an HS256 session JWT. Shape stays compatible with apps/web Session. */
export async function signSessionJwt(claims: SessionClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSessionSecret());
}

/** Set the HttpOnly session cookie on a reply (manual Set-Cookie string). */
export function setSessionCookie(
  reply: FastifyReply,
  jwt: string,
  expiresAt?: number,
  persistent = true,
): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const maxAge =
    expiresAt === undefined
      ? SESSION_TTL_SECONDS
      : Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  reply.header(
    "set-cookie",
    `${COOKIE_NAME}=${jwt}; Path=/; HttpOnly; SameSite=Lax${persistent ? `; Max-Age=${maxAge}` : ""}${secure}`,
  );
}

/** Clear the session cookie (logout). */
export function clearSessionCookie(reply: FastifyReply): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  reply.header(
    "set-cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  );
}

// ─── Tenant / role resolution ────────────────────────────────────────────────

/**
 * Dev-only tenant override header, now also the production signal for "which
 * tenant is this request acting on". The portal forwards the URL's `[tenant]`
 * segment here. It is SAFE to trust in production because the active role is
 * always re-derived from `memberships` server-side — a forged header for a
 * tenant the user isn't a member of yields `role = null` and the RBAC guard
 * denies. Slug shape mirrors tenants.slug.
 */
const TENANT_HEADER = "x-agentic-tenant";

function headerTenantSlug(req: FastifyRequest | null): string | null {
  if (!req) return null;
  const raw = req.headers[TENANT_HEADER];
  const slug = Array.isArray(raw) ? raw[0] : raw;
  if (typeof slug !== "string") return null;
  const trimmed = slug.trim();
  if (!/^[a-z0-9_-]{1,64}$/.test(trimmed)) return null;
  return trimmed;
}

function roleFor(userId: string, tenantId: string): TenantRole | null {
  const hit = getDb()
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)))
    .all()[0];
  return (hit?.role as TenantRole | undefined) ?? null;
}

interface TenantResolution {
  tenantId: string;
  tenantSlug: string;
  role: TenantRole | null;
}

/**
 * Resolve the active tenant + the caller's role in it. Honours an explicit
 * request (header / cookie tenant claim) first — even when the user isn't a
 * member (role stays null so the guard denies) — then falls back to the
 * caller's first membership, then a configured default.
 */
function resolveTenant(
  userId: string,
  explicit: Array<string | null>,
): TenantResolution {
  const db = getDb();
  const seen = new Set<string>();
  for (const slug of explicit) {
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const t = db.select().from(tenants).where(eq(tenants.slug, slug)).all()[0];
    if (!t) continue;
    return { tenantId: t.id, tenantSlug: t.slug, role: roleFor(userId, t.id) };
  }
  // First membership.
  const first = db
    .select({ tenantId: memberships.tenantId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .all()[0];
  if (first) {
    const t = db.select().from(tenants).where(eq(tenants.id, first.tenantId)).all()[0];
    if (t) return { tenantId: t.id, tenantSlug: t.slug, role: first.role as TenantRole };
  }
  // Configured default (superadmin with no memberships, or none at all).
  const fbSlug = process.env.AGENTIC_DEV_TENANT?.trim();
  if (fbSlug) {
    const fb = db.select().from(tenants).where(eq(tenants.slug, fbSlug)).all()[0];
    if (fb) return { tenantId: fb.id, tenantSlug: fb.slug, role: roleFor(userId, fb.id) };
  }
  return { tenantId: "", tenantSlug: "", role: null };
}

/** Map a bearer token's scopes to an effective tenant role. */
function roleFromScopes(scopes: string[]): TenantRole {
  if (scopes.includes("tenant:write")) return "admin";
  if (scopes.some((s) => s.endsWith(":invoke") || s === "agents:invoke")) {
    return "operator";
  }
  return "viewer";
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthedContext;
  }
}

// ─── authenticate ────────────────────────────────────────────────────────────

async function authenticateCookie(
  jwt: string,
  req: FastifyRequest,
): Promise<AuthedContext | null> {
  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(jwt, getSessionSecret(), {
      algorithms: ["HS256"],
    });
    payload = verified.payload as unknown as Record<string, unknown>;
  } catch {
    return null;
  }
  const userId = typeof payload.sub === "string" ? payload.sub : null;
  if (!userId) return null;
  const u = getDb().select().from(users).where(eq(users.id, userId)).all()[0];
  if (!u || u.status !== "active" || u.authorityAccountId) return null;
  const cookieTenant =
    typeof payload.tenant === "string" ? payload.tenant : null;
  const resolved = resolveTenant(u.id, [headerTenantSlug(req), cookieTenant]);
  return {
    userId: u.id,
    email: u.email,
    name: u.name,
    platformRole: u.platformRole as PlatformRole,
    ...resolved,
    via: "cookie",
    sessionExpiresAt:
      typeof payload.exp === "number" ? payload.exp * 1000 : undefined,
  };
}

async function authenticateAuthorityCookie(
  token: string,
  req: FastifyRequest,
): Promise<AuthedContext | null> {
  if (!/^[A-Za-z0-9._~-]{32,256}$/.test(token)) return null;
  let snapshot;
  try {
    snapshot = await inspectAuthoritySession(token);
  } catch (error) {
    if (
      error instanceof AccountAuthorityError &&
      [401, 403].includes(error.statusCode)
    )
      return null;
    throw error;
  }
  const principal = projectAuthorityAccount(snapshot);
  const selected = headerTenantSlug(req);
  if (req.headers[TENANT_HEADER] !== undefined && !selected)
    throw new AccountAuthorityError("product_access_required", 403);
  const active = selected
    ? getDb().select().from(tenants).where(eq(tenants.slug, selected)).get()
    : getDb()
        .select()
        .from(tenants)
        .where(eq(tenants.id, snapshot.grants[0]!.tenantId))
        .get();
  const grant =
    active && snapshot.grants.find((row) => row.tenantId === active.id);
  if (!active || !grant || active.archivedAt)
    throw new AccountAuthorityError("product_access_required", 403);
  return {
    userId: principal.id,
    email: null,
    name: principal.name,
    username: principal.username,
    authorityAccountId: principal.accountId,
    platformRole: "none",
    tenantId: active.id,
    tenantSlug: active.slug,
    role: grant.role,
    via: "cookie",
    sessionExpiresAt: Date.parse(snapshot.expiresAt),
  };
}

function configuredDevUser() {
  const db = getDb();
  const email = process.env.AGENTIC_DEV_USER_EMAIL?.trim().toLowerCase();
  if (email) return db.select().from(users).where(eq(users.email, email)).all()[0];
  const admins = db
    .select()
    .from(users)
    .where(and(eq(users.platformRole, "superadmin"), eq(users.status, "active")))
    .all();
  return admins.length === 1 ? admins[0] : undefined;
}

function authenticateDev(req: FastifyRequest): AuthedContext | null {
  const u = configuredDevUser();
  if (!u || u.authorityAccountId) return null;
  // Pin the active tenant to AGENTIC_DEV_TENANT when the request carries no
  // explicit tenant header — preserves the legacy dev default (the seeded dev
  // user is a member of every tenant, so "first membership" would be
  // non-deterministic and break tenant-scoped tests/dashboards).
  const resolved = resolveTenant(u.id, [
    headerTenantSlug(req),
    process.env.AGENTIC_DEV_TENANT?.trim() ?? null,
  ]);
  return {
    userId: u.id,
    email: u.email,
    name: u.name,
    platformRole: u.platformRole as PlatformRole,
    ...resolved,
    via: "dev",
  };
}

function authenticateBearer(token: string, touch = true): AuthedContext | null {
  const db = getDb();
  const row = db
    .select({ id: apiTokens.id, tenantId: apiTokens.tenantId, scopes: apiTokens.scopes })
    .from(apiTokens)
    .where(eq(apiTokens.hash, hashToken(token)))
    .all()[0];
  if (!row) return null;
  if (touch) db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.id)).run();
  const t = db.select().from(tenants).where(eq(tenants.id, row.tenantId)).all()[0];
  if (!t) return null;
  const scopes = (row.scopes as string[] | null) ?? [];
  return {
    userId: null,
    email: null,
    name: t.name,
    platformRole: "none",
    tenantId: t.id,
    tenantSlug: t.slug,
    role: roleFromScopes(scopes),
    via: "token",
    scopes,
    credentialId: row.id,
  };
}

/**
 * Resolve an authenticated context for `req`, or null if no credential matched.
 *
 * Dev-mode (`AUTH_MODE=dev`) resolves a REAL seeded user (default
 * configured development operator so audit + RBAC always have a concrete `userId` — it no
 * longer fabricates a userless tenant context.
 */
export async function authenticate(req: FastifyRequest): Promise<AuthedContext | null> {
  if (process.env.AUTH_MODE === "dev") {
    return authenticateDev(req);
  }

  const sessionJwt = readCookie(req.headers.cookie, COOKIE_NAME);
  if (sessionJwt) {
    const cookieCtx = accountsMode()
      ? await authenticateAuthorityCookie(sessionJwt, req)
      : await authenticateCookie(sessionJwt, req);
    if (cookieCtx) return cookieCtx;
    // An invalid account session must not switch to another credential.
    if (accountsMode()) return null;
    // Legacy cookie present but invalid — fall through to bearer.
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  return authenticateBearer(token);
}

/**
 * Revalidate an open response without tenant fallback or credential switching.
 * A cookie was verified when the request opened; only its expiry and mutable
 * identity/grants need refreshing. Bearers must still match the exact record
 * and original token, including after a record's hash is rotated in place.
 */
export async function refreshRequestAuth(
  req: FastifyRequest,
  original: AuthedContext,
): Promise<AuthedContext | null> {
  if (original.authorityAccountId) {
    if (!accountsMode()) return null;
    const token = readCookie(req.headers.cookie, COOKIE_NAME);
    if (!token) return null;
    const fresh = await authenticateAuthorityCookie(token, req);
    if (
      !fresh ||
      fresh.authorityAccountId !== original.authorityAccountId ||
      fresh.userId !== original.userId
    )
      return null;
    return fresh;
  }
  if (accountsMode() && original.via === "cookie") return null;
  let identity: AuthedContext;
  if (original.via === "token") {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return null;
    const fresh = authenticateBearer(header.slice(7).trim(), false);
    if (!fresh || fresh.credentialId !== original.credentialId) return null;
    identity = fresh;
  } else {
    if (!original.userId) return null;
    if (original.sessionExpiresAt !== undefined && original.sessionExpiresAt <= Date.now()) return null;
    const db = getDb();
    const user = db.select().from(users).where(eq(users.id, original.userId)).get();
    if (!user || user.status !== "active") return null;
    const tenant = db.select().from(tenants).where(eq(tenants.id, original.tenantId)).get();
    if (!tenant) return null;
    identity = {
      userId: user.id,
      email: user.email,
      name: user.name,
      platformRole: user.platformRole as PlatformRole,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      role: roleFor(user.id, tenant.id),
      via: original.via,
      sessionExpiresAt: original.sessionExpiresAt,
    };
  }
  return identity;
}

/**
 * Boot-time guard: fail fast on env combos that would silently bypass auth.
 */
export function assertAuthModeSafe(): void {
  const isDev = process.env.AUTH_MODE === "dev";
  const isProd = process.env.NODE_ENV === "production";

  // AUTH_MODE=dev + NODE_ENV=production is the single biggest footgun (every unauth'd request becomes
  // the dev-tenant admin). Name it FIRST so the error is actionable for exactly that combo, before the
  // more generic secret check below.
  if (isDev && isProd) {
    throw new Error(
      "AUTH_MODE=dev is incompatible with NODE_ENV=production — the dev-user " +
        "unlock would bypass real authentication. Unset AUTH_MODE for prod or " +
        "run with NODE_ENV=development.",
    );
  }

  if (accountsMode()) {
    authorityConfig();
    return;
  }

  // #AUDIT-FIX(P0-07) — production 必须配置一个真实、足够随机的 session secret；缺失或仍是 dev
  // 固定回退值即启动失败（否则攻击者可伪造/预测会话签名）。这个检查独立于 AUTH_MODE。
  if (process.env.NODE_ENV !== "test") {
    const secret = process.env.AUTH_SESSION_SECRET ?? process.env.SESSION_SECRET ?? "";
    if (!secret || secret === TEST_SESSION_SECRET_FALLBACK) {
      throw new Error(
        "启动失败：AUTH_SESSION_SECRET/SESSION_SECRET 未设置或仍是测试回退值——会话签名可被伪造。请设置一个 ≥32 字节的随机密钥。",
      );
    }
    if (Buffer.byteLength(secret, "utf8") < 32) {
      throw new Error("生产启动失败：session secret 少于 32 字节，随机性不足。请设置一个 ≥32 字节的随机密钥。");
    }
  }

  if (!isDev) return;

  const slug = process.env.AGENTIC_DEV_TENANT?.trim();
  if (!slug) {
    throw new Error("AUTH_MODE=dev requires an explicit AGENTIC_DEV_TENANT; no hard-coded tenant fallback is used.");
  }
  const tenant = getDb().select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).all()[0];
  if (!tenant) {
    throw new Error(
      `AUTH_MODE=dev requires AGENTIC_DEV_TENANT to match an existing tenant slug; ` +
        `'${slug}' was not found. Seed the tenant (e.g. \`pnpm db:seed\`) or set ` +
        `AGENTIC_DEV_TENANT to an existing slug.`,
    );
  }

  const email = process.env.AGENTIC_DEV_USER_EMAIL?.trim().toLowerCase();
  const user = configuredDevUser();
  if (!user) {
    throw new Error(
      email
        ? `AUTH_MODE=dev requires AGENTIC_DEV_USER_EMAIL to match an active user; '${email}' was not found.`
        : "AUTH_MODE=dev requires AGENTIC_DEV_USER_EMAIL, unless exactly one active superadmin exists.",
    );
  }
}

export async function registerAuth(app: FastifyInstance) {
  assertAuthModeSafe();
  app.addHook("onRequest", async (req) => {
    // Public credential routes and the dedicated service-key endpoint do not
    // consume a stale browser cookie or require the authority to be available.
    if (
      accountsMode() &&
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin
    ) {
      // The existing WEB_ORIGIN is the browser origin allowlist. Do not trust
      // forwarded host headers supplied by a caller to authorize mutations.
      const expected =
        process.env.WEB_ORIGIN?.trim() || "http://localhost:3599";
      if (req.headers.origin !== new URL(expected).origin)
        throw new AccountAuthorityError("forbidden_origin", 403);
    }
    if (
      accountsMode() &&
      /^\/v1\/auth\/(?:config|login|register|logout|authority\/tenants)$/.test(
        req.url.split("?", 1)[0] ?? "",
      )
    )
      return;
    const identity = await authenticate(req);
    req.auth = identity ?? undefined;
  });
}

/** Require auth or fail with 401. */
export function requireAuth(req: FastifyRequest): AuthedContext {
  if (!req.auth) {
    const err: Error & { statusCode?: number; code?: string } = new Error("unauthorized");
    err.statusCode = 401;
    err.code = "unauthorized";
    throw err;
  }
  return req.auth;
}

// ─── Enterprise-route guards (merge-compat shims) ────────────────────────────
// Kenny's routes import `requireWorkspaceWriter` / `requireTenantAdmin` from
// this module. They are implemented as thin wrappers over `requirePermission`
// in plugins/rbac.ts so tenant RBAC + deny-audit stay single-sourced; the
// re-export keeps the historical import path stable. The auth↔rbac cycle is
// call-time only (both modules just reference each other's functions inside
// handler bodies), which ESM live bindings resolve safely.
export { requireTenantAdmin, requireWorkspaceWriter } from "./rbac";
