/** First-party account backchannel. Credentials and sessions are owned by Studio/PostgreSQL. */
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import {
  getDb,
  memberships,
  tenants,
  users,
} from "@agentic/db";
import { makeId } from "@agentic/shared";

export const AuthorityUsername = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_.-]{2,31}$/);
export const AuthorityPassword = z
  .string()
  .refine(
    (value) =>
      [...value].length >= 15 && Buffer.byteLength(value, "utf8") <= 72,
    "Password must contain at least 15 characters and at most 72 UTF-8 bytes",
  );
export const AuthorityLogin = z.object({
  username: AuthorityUsername,
  password: z.string().min(1).max(256),
  rememberMe: z.boolean().default(false),
});
export const AuthorityRegistration = z.object({
  username: AuthorityUsername,
  password: AuthorityPassword,
  displayName: z.string().trim().min(1).max(120).optional(),
});
const Account = z.object({
  id: z.string().uuid(),
  username: AuthorityUsername,
  displayName: z.string().min(1).max(120),
  status: z.literal("active"),
});
const SessionSnapshot = z.object({
  expiresAt: z.string().datetime({ offset: true }),
  account: Account,
  grants: z
    .array(
      z.object({
        tenantId: z.string().min(1).max(200),
        role: z.enum(["viewer", "operator", "admin"]),
      }),
    )
    .max(1000),
});
const LoginSnapshot = SessionSnapshot.extend({
  token: z.string().regex(/^[A-Za-z0-9._~-]{32,256}$/),
});
export type AuthoritySnapshot = z.infer<typeof SessionSnapshot>;

export class AccountAuthorityError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
  ) {
    super(code);
  }
}

export function accountsMode(): boolean {
  return process.env.AUTH_MODE === "accounts";
}

export function authorityConfig(): { origin: string; secret: string } {
  const raw = process.env.ACCOUNT_AUTHORITY_URL?.trim();
  const secret = process.env.ACCOUNT_OPERATOR_CLIENT_SECRET?.trim();
  if (!raw || !secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new AccountAuthorityError("account_authority_unconfigured", 503);
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AccountAuthorityError("account_authority_unconfigured", 503);
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(
        process.env.NODE_ENV !== "production" &&
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  ) {
    throw new AccountAuthorityError("account_authority_unconfigured", 503);
  }
  return { origin: url.origin, secret };
}

export function authorizedAuthorityClient(header: string | undefined): boolean {
  if (!accountsMode()) return false;
  const { secret } = authorityConfig();
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(header ?? "");
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

const publicErrors = new Set([
  "invalid_credentials",
  "account_pending",
  "account_rejected",
  "account_paused",
  "product_access_required",
  "username_taken",
  "invalid_session",
  "rate_limited",
  "invalid_password",
  "invalid_body",
  "invalid_username",
  "invalid_display_name",
]);

async function callAuthority<T>(
  operation: string,
  body: unknown,
  schema: z.ZodType<T>,
): Promise<T> {
  const config = authorityConfig();
  let response: Response;
  try {
    response = await fetch(
      `${config.origin}/api/accounts/operator/${operation}`,
      {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        headers: {
          authorization: `Bearer ${config.secret}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      },
    );
  } catch {
    throw new AccountAuthorityError("account_authority_unavailable", 503);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AccountAuthorityError("account_authority_unavailable", 503);
  }
  if (!response.ok) {
    const code =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error
        : undefined;
    if (response.status === 401 && operation === "inspect")
      throw new AccountAuthorityError("invalid_session", 401);
    if (
      typeof code === "string" &&
      publicErrors.has(code) &&
      [400, 401, 403, 409, 429].includes(response.status)
    ) {
      throw new AccountAuthorityError(code, response.status);
    }
    throw new AccountAuthorityError("account_authority_unavailable", 503);
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success)
    throw new AccountAuthorityError("account_authority_unavailable", 503);
  return parsed.data;
}

export const registerAuthorityAccount = (
  body: z.infer<typeof AuthorityRegistration>,
) =>
  callAuthority(
    "register",
    body,
    z.object({ account: Account.extend({ status: z.literal("pending") }) }),
  );
export const loginAuthorityAccount = (body: z.infer<typeof AuthorityLogin>) =>
  callAuthority("login", body, LoginSnapshot);
export const inspectAuthoritySession = (token: string) =>
  callAuthority("inspect", { token }, SessionSnapshot);
export const revokeAuthoritySession = (token: string) =>
  callAuthority("revoke", { token }, z.object({ ok: z.literal(true) }));
export const changeAuthorityPassword = (body: {
  token: string;
  currentPassword: string;
  newPassword: string;
}) => callAuthority("password", body, z.object({ ok: z.literal(true) }));

/** Only canonical active product owners can receive central grants. No slug inference. */
export function authorityTenants() {
  const db = getDb();
  return db
    .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
    .from(tenants)
    .where(isNull(tenants.archivedAt))
    .all()
    .filter(
      (tenant) => !tenant.slug.startsWith("__"),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Durable projection only. Never stores passwords, sessions, or review authority. */
export function projectAuthorityAccount(snapshot: AuthoritySnapshot) {
  if (Date.parse(snapshot.expiresAt) <= Date.now())
    throw new AccountAuthorityError("invalid_session", 401);
  const allowed = new Set(authorityTenants().map((tenant) => tenant.id));
  const granted = new Set<string>();
  for (const grant of snapshot.grants) {
    if (!allowed.has(grant.tenantId) || granted.has(grant.tenantId))
      throw new AccountAuthorityError("product_access_required", 403);
    granted.add(grant.tenantId);
  }
  if (granted.size === 0)
    throw new AccountAuthorityError("product_access_required", 403);
  const db = getDb();
  return db.transaction(() => {
    let user = db
      .select()
      .from(users)
      .where(eq(users.authorityAccountId, snapshot.account.id))
      .get();
    if (!user) {
      const id = makeId("usr");
      db.insert(users)
        .values({
          id,
          email: "",
          name: snapshot.account.displayName,
          authorityAccountId: snapshot.account.id,
          authorityUsername: snapshot.account.username,
          platformRole: "none",
          status: "active",
          passwordHash: null,
        })
        .run();
      user = db.select().from(users).where(eq(users.id, id)).get()!;
    }
    db.update(users)
      .set({
        name: snapshot.account.displayName,
        authorityUsername: snapshot.account.username,
        passwordHash: null,
        status: "active",
        platformRole: "none",
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .run();
    const existing = db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, user.id))
      .all();
    for (const membership of existing) {
      if (!granted.has(membership.tenantId))
        db.delete(memberships)
          .where(
            and(
              eq(memberships.userId, user.id),
              eq(memberships.tenantId, membership.tenantId),
            ),
          )
          .run();
    }
    for (const grant of snapshot.grants) {
      const prior = existing.find((row) => row.tenantId === grant.tenantId);
      if (!prior)
        db.insert(memberships)
          .values({
            userId: user.id,
            tenantId: grant.tenantId,
            role: grant.role,
          })
          .run();
      else if (prior.role !== grant.role)
        db.update(memberships)
          .set({ role: grant.role })
          .where(
            and(
              eq(memberships.userId, user.id),
              eq(memberships.tenantId, grant.tenantId),
            ),
          )
          .run();
    }
    return {
      id: user.id,
      email: "",
      name: snapshot.account.displayName,
      accountId: snapshot.account.id,
      username: snapshot.account.username,
    };
  });
}

export function rejectManagedAccountMutation(userId: string): void {
  const user = getDb()
    .select({ accountId: users.authorityAccountId })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (user?.accountId)
    throw new AccountAuthorityError("account_managed_centrally", 403);
}
