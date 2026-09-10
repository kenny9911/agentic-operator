import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import { getDb, hashPassword, memberships, tenants, users } from "@agentic/db";
import { publishStreamEvent } from "@agentic/runtime";
import { registerEnvelope } from "../src/plugins/error";
import { registerAuth, signSessionJwt } from "../src/plugins/auth";
import { requirePermission } from "../src/plugins/rbac";
import { authRoutes } from "../src/routes/v1/auth";
import { membersRoutes } from "../src/routes/v1/members";
import { streamRoutes } from "../src/routes/v1/stream";
import {
  authorityConfig,
  AuthorityPassword,
} from "../src/services/account-authority";

const secret = "test-only-operator-service-key-1234567890";
const password = "operator account password";
const accountId = randomUUID();
const token = "opaque-test-product-session-12345678901234567890";
const owner = {
  id: `ten-authority-${randomUUID()}`,
  slug: `authority-${randomUUID().slice(0, 8)}`,
  name: "Authority owner",
};
const other = {
  id: `ten-authority-${randomUUID()}`,
  slug: `authority-${randomUUID().slice(0, 8)}`,
  name: "Other owner",
};

describe("PostgreSQL account authority through the Operator HTTP boundary", () => {
  let app: FastifyInstance;
  let address: string;
  let active = true;
  let failure: "none" | "network" | "malformed" = "none";
  let loginError: string | null = null;
  let grants: Array<{
    tenantId: string;
    role: "viewer" | "operator" | "admin";
  }> = [];
  const calls: Array<{ operation: string; body: Record<string, unknown> }> = [];
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const nativeFetch = globalThis.fetch;

  function snapshot() {
    return {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      account: {
        id: accountId,
        username: "external-user",
        displayName: "External User",
        status: "active",
      },
      grants,
    };
  }

  beforeAll(async () => {
    vi.stubEnv("AUTH_MODE", "accounts");
    vi.stubEnv("ACCOUNT_AUTHORITY_URL", "http://localhost:35123");
    vi.stubEnv("ACCOUNT_OPERATOR_CLIENT_SECRET", secret);
    getDb().insert(tenants).values([owner, other]).run();
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        if (!String(input).startsWith("http://localhost:35123/"))
          return nativeFetch(input, init);
        expect(new Headers(init?.headers).get("authorization")).toBe(
          `Bearer ${secret}`,
        );
        expect(init?.redirect).toBe("error");
        const operation = String(input).split("/").at(-1)!;
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        calls.push({ operation, body });
        if (failure === "network") throw new Error("network unavailable");
        if (failure === "malformed") return Response.json({ unexpected: true });
        if (operation === "register")
          return Response.json(
            { account: { ...snapshot().account, status: "pending" } },
            { status: 201 },
          );
        if (operation === "login") {
          if (body.password !== password)
            return Response.json(
              { error: "invalid_credentials" },
              { status: 401 },
            );
          if (loginError)
            return Response.json({ error: loginError }, { status: 403 });
          return Response.json({ token, ...snapshot() });
        }
        if (operation === "inspect")
          return active && body.token === token
            ? Response.json(snapshot())
            : Response.json({ error: "invalid_session" }, { status: 401 });
        if (operation === "revoke" || operation === "password") {
          active = false;
          return Response.json({ ok: true });
        }
        throw new Error("unexpected authority operation");
      });
    app = Fastify();
    await registerEnvelope(app);
    await registerAuth(app);
    await app.register(authRoutes, { prefix: "/v1" });
    await app.register(membersRoutes, { prefix: "/v1" });
    await app.register(streamRoutes, { prefix: "/v1" });
    app.get("/v1/auth/probe", async (req) => ({
      userId: requirePermission(req, "agents.invoke").userId,
    }));
    address = await app.listen({ host: "127.0.0.1", port: 0 });
  });
  beforeEach(() => {
    active = true;
    failure = "none";
    loginError = null;
    grants = [{ tenantId: owner.id, role: "admin" }];
    calls.length = 0;
  });
  afterAll(async () => {
    await app.close();
    fetchSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  async function login() {
    return app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { username: "External-User", password },
    });
  }
  const headers = () => ({
    cookie: `agentic_session=${token}`,
    "x-agentic-tenant": owner.slug,
  });

  it("submits a pending registration without cookie, local credentials, or memberships", async () => {
    const before = getDb().select().from(users).all().length;
    const result = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { username: "New-Person", password, displayName: "New Person" },
    });
    expect(result.statusCode).toBe(201);
    expect(result.json().data.account.status).toBe("pending");
    expect(result.headers["set-cookie"]).toBeUndefined();
    expect(getDb().select().from(users).all()).toHaveLength(before);
    expect(calls[0]?.body.username).toBe("new-person");
  });

  it("uses username credentials and preserves a stable local principal without a password", async () => {
    const result = await login();
    expect(result.statusCode).toBe(200);
    expect(result.headers["set-cookie"]).toContain(`agentic_session=${token};`);
    expect(result.headers["set-cookie"]).toContain("HttpOnly; SameSite=Lax");
    const principal = getDb()
      .select()
      .from(users)
      .where(eq(users.authorityAccountId, accountId))
      .get()!;
    expect(principal.passwordHash).toBeNull();
    expect(principal.email).toBe("");
    expect(principal.authorityUsername).toBe("external-user");
    expect(principal.platformRole).toBe("none");
    const second = await login();
    expect(second.json().data.user.id).toBe(principal.id);
    expect(JSON.stringify(second.json())).not.toContain(token);
    const me = await app.inject({ url: "/v1/me", headers: headers() });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.user.accountId).toBe(accountId);
  });

  it.each([undefined, false, true])(
    "forwards rememberMe=%s and sets only the requested persistent cookie",
    async (rememberMe) => {
      const result = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        remoteAddress: "127.0.1.1",
        payload: { username: "External-User", password, rememberMe },
      });
      expect(result.statusCode).toBe(200);
      expect(calls[0]?.body.rememberMe).toBe(rememberMe === true);
      const cookie = String(result.headers["set-cookie"]);
      if (rememberMe) {
        const seconds = Number(/Max-Age=(\d+)/.exec(cookie)?.[1]);
        expect(seconds).toBeGreaterThan(0);
        expect(seconds).toBeLessThanOrEqual(60);
      } else {
        expect(cookie).not.toContain("Max-Age=");
        expect(cookie).not.toContain("Expires=");
      }
    },
  );

  it("rejects non-boolean rememberMe before forwarding credentials", async () => {
    const result = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      remoteAddress: "127.0.1.1",
      payload: { username: "external-user", password, rememberMe: "false" },
    });
    expect(result.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it.each([
    "account_pending",
    "account_rejected",
    "account_paused",
    "product_access_required",
  ])("denies %s without issuing a cookie", async (code) => {
    loginError = code;
    const result = await login();
    expect(result.statusCode).toBe(403);
    expect(result.json().error.code).toBe(code);
    expect(result.headers["set-cookie"]).toBeUndefined();
  });

  it("revalidates revoked sessions and tenant grants before protected requests", async () => {
    await login();
    expect(
      (await app.inject({ url: "/v1/auth/probe", headers: headers() }))
        .statusCode,
    ).toBe(200);
    grants = [{ tenantId: owner.id, role: "viewer" }];
    expect(
      (await app.inject({ url: "/v1/auth/probe", headers: headers() }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          url: "/v1/me",
          headers: { ...headers(), "x-agentic-tenant": other.slug },
        })
      ).statusCode,
    ).toBe(403);
    active = false;
    expect(
      (await app.inject({ url: "/v1/me", headers: headers() })).statusCode,
    ).toBe(401);
  });

  it("rejects foreign or missing owner grants rather than creating or inferring tenants", async () => {
    grants = [{ tenantId: "does-not-exist", role: "admin" }];
    const result = await login();
    expect(result.statusCode).toBe(403);
    expect(result.headers["set-cookie"]).toBeUndefined();
  });

  it("never falls back to a local password/JWT or accepts a local membership override", async () => {
    await login();
    const principal = getDb()
      .select()
      .from(users)
      .where(eq(users.authorityAccountId, accountId))
      .get()!;
    getDb()
      .update(users)
      .set({ passwordHash: hashPassword(password), platformRole: "superadmin" })
      .where(eq(users.id, principal.id))
      .run();
    const forgedLegacy = await signSessionJwt({
      sub: principal.id,
      name: principal.name,
      initials: "EU",
      tenant: owner.slug,
    });
    expect(
      (
        await app.inject({
          url: "/v1/me",
          headers: { cookie: `agentic_session=${forgedLegacy}` },
        })
      ).statusCode,
    ).toBe(401);
    getDb()
      .insert(memberships)
      .values({ userId: principal.id, tenantId: other.id, role: "admin" })
      .run();
    expect(
      (
        await app.inject({
          url: "/v1/me",
          headers: { ...headers(), "x-agentic-tenant": other.slug },
        })
      ).statusCode,
    ).toBe(403);
    const changed = await app.inject({
      method: "PATCH",
      url: `/v1/members/${principal.id}`,
      headers: headers(),
      payload: { role: "admin" },
    });
    expect(changed.statusCode).toBe(403);
    expect(changed.json().error.code).toBe("account_managed_centrally");
  });

  it.each(["network", "malformed"] as const)(
    "fails closed on %s authority failure",
    async (kind) => {
      failure = kind;
      const result = await app.inject({ url: "/v1/me", headers: headers() });
      expect(result.statusCode).toBe(503);
      expect(result.json().error.code).toBe("account_authority_unavailable");
    },
  );

  it("revokes centrally on logout and password change", async () => {
    await login();
    const changed = await app.inject({
      method: "POST",
      url: "/v1/me/password",
      headers: headers(),
      payload: {
        currentPassword: password,
        newPassword: "new long account password",
      },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().data.signInRequired).toBe(true);
    expect(changed.headers["set-cookie"]).toContain("Max-Age=0");
    expect(
      (await app.inject({ url: "/v1/me", headers: headers() })).statusCode,
    ).toBe(401);
    active = true;
    const result = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: headers(),
    });
    expect(result.statusCode).toBe(200);
    expect(calls.at(-1)?.operation).toBe("revoke");
    expect(active).toBe(false);
  });

  it("rejects cross-origin browser credential submissions", async () => {
    const result = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { origin: "https://untrusted.example" },
      payload: { username: "external-user", password },
    });
    expect(result.statusCode).toBe(403);
    expect(result.json().error.code).toBe("forbidden_origin");
    expect(calls).toHaveLength(0);
  });

  it("exposes only an authenticated active owner catalog and public mode", async () => {
    expect(
      (await app.inject({ url: "/v1/auth/config" })).json().data.mode,
    ).toBe("accounts");
    expect(
      (await app.inject({ url: "/v1/auth/authority/tenants" })).statusCode,
    ).toBe(401);
    const result = await app.inject({
      url: "/v1/auth/authority/tenants",
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().tenants).toContainEqual(owner);
    expect(
      result
        .json()
        .tenants.some((row: { slug: string }) => row.slug.startsWith("__")),
    ).toBe(false);
  });

  it("closes an already-open stream before emitting a frame after account pause", async () => {
    await login();
    const abort = new AbortController();
    const response = await nativeFetch(`${address}/v1/stream?backfill=0`, {
      headers: headers(),
      signal: abort.signal,
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const consume = (async () => {
      for (;;) {
        const item = await reader.read();
        if (item.done) return;
        text += decoder.decode(item.value);
      }
    })();
    try {
      await vi.waitFor(() => expect(text).toContain("event: ready"));
      active = false;
      publishStreamEvent({
        type: "run.started",
        tenantId: owner.id,
        at: Date.now(),
        runId: "private-after-pause",
        agentName: "private-after-pause",
        triggerEvent: null,
        subject: null,
        correlationId: "private-after-pause",
      });
      await Promise.race([
        consume,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("stream did not revoke")), 3000),
        ),
      ]);
      expect(text).not.toContain("private-after-pause");
    } finally {
      abort.abort();
      await reader.cancel().catch(() => {});
    }
  });
});

describe("account authority configuration and password boundaries", () => {
  it("rejects production HTTP, URL credentials, and non-origin URLs", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ACCOUNT_OPERATOR_CLIENT_SECRET", secret);
    for (const url of [
      "http://localhost:3500",
      "https://user:pass@example.com",
      "https://example.com/extra",
      "https://example.com?token=x",
    ]) {
      vi.stubEnv("ACCOUNT_AUTHORITY_URL", url);
      expect(() => authorityConfig()).toThrow();
    }
    vi.stubEnv("ACCOUNT_AUTHORITY_URL", "https://accounts.example.com");
    expect(authorityConfig().origin).toBe("https://accounts.example.com");
    vi.unstubAllEnvs();
  });
  it("counts Unicode characters and limits UTF-8 bytes", () => {
    expect(AuthorityPassword.safeParse("a".repeat(14)).success).toBe(false);
    expect(AuthorityPassword.safeParse("密".repeat(15)).success).toBe(true);
    expect(AuthorityPassword.safeParse("密".repeat(25)).success).toBe(false);
  });
});
