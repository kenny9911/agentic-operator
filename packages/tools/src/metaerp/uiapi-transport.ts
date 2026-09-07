/**
 * UI-form transport: portal gateway + browser-style user session.
 *
 * `x-scope: SCOPE_UI` operations are not reachable with an IAM application
 * token — that combination answers "userId is null! please check your
 * x-meta-token". They authenticate as a portal USER, so this reproduces the
 * browser's own four-step chain, transcribed from
 * metaerp-openapi-call/scripts/call_uiapi.py and the 2026-09-07 ablation study:
 *
 *   1. console login          → session cookies on .chinasoftinc.com
 *   2. CSB federation callback → CSB-Auth-Token on the portal domain
 *   3. getCurrentInfo          → x-csrf-token, read from the RESPONSE HEADER
 *   4. the UIAPI call          → cookie + x-csrf-token + Referer
 *
 * The ablation established the minimal set precisely, and each omission has its
 * own misleading failure: no x-csrf-token → 412; forged one → 401 "csrf token
 * 不正确"; X-Auth-Token instead of CSB-Auth-Token → 401 "user has not logged
 * in"; and **no Referer → 401 "权限点不存在"**, because the gateway resolves the
 * permission-point context from Referer. None of these read as "you are missing
 * a header", so all four are sent every time rather than trimmed later.
 */

import { CookieJar, httpRequest } from "./http";
import type { MetaerpCredentials } from "./config";
import { normalizeMetaerpResponse } from "./envelope";
import type { TransportResult } from "./openapi-transport";

/** Portal sessions outlive a burst of calls; the ceiling keeps a stale one from
 * being reused indefinitely. Any auth-shaped rejection re-logs in anyway. */
const SESSION_TTL_MS = 10 * 60_000;

interface PortalSession {
  jar: CookieJar;
  csrf: string;
  expiresAt: number;
}

const sessionCache = new Map<string, PortalSession>();

export function _clearMetaerpSessionCacheForTests(): void {
  sessionCache.clear();
}

async function login(
  credentials: MetaerpCredentials,
  timeoutMs: number,
): Promise<PortalSession> {
  const { preset } = credentials;
  const user = credentials.portalUser;
  const password = credentials.portalPassword;
  if (!user || !password) {
    throw new Error(
      "metaerp: this operation is UI-form and needs a portal account — set PORTAL_USER/PORTAL_PASSWORD (optionally suffixed _V15 / _BETA) in the metaerp config file",
    );
  }
  const jar = new CookieJar();
  const shared = { jar, insecureTls: preset.insecureTls, timeoutMs };

  // 1) Console login. Referer/Origin are load-bearing: without them the server
  // sets the session cookie on Domain=huawei.com and every later hop is
  // anonymous. A 401 "Account logged in" means a session already exists —
  // x-login-out:false opens an additional one instead of stealing it.
  const loginUrl = `${preset.consoleBase}/gw/iam/auth/login`;
  const loginHeaders = (logout: string): Record<string, string> => ({
    "x-login-out": logout,
    "iam-csrf-token": "",
    referer: `${preset.consoleBase}/epstenant/`,
    origin: preset.consoleBase,
  });
  const body = { username: user, password, redirect: "" };
  let response = await httpRequest(loginUrl, {
    ...shared,
    method: "POST",
    json: body,
    headers: loginHeaders(""),
  });
  if (response.status === 401) {
    response = await httpRequest(loginUrl, {
      ...shared,
      method: "POST",
      json: body,
      headers: loginHeaders("false"),
    });
  }
  if (response.status !== 200) {
    throw new Error(
      `metaerp: portal login failed with HTTP ${response.status} — ${response.body.slice(0, 300)}`,
    );
  }

  // 2) Federation callback plants the portal-domain session cookie.
  const redirect = encodeURIComponent(`${preset.portalBase}/`);
  const federation =
    `${preset.csbBase}/csb/csb-enterprise-adapter/federation-callback` +
    `?TENANTSPACEID=${credentials.enterprise}&protocol=context&redirect=${redirect}`;
  await httpRequest(federation, { ...shared, followRedirects: true });
  if (!jar.has("CSB-Auth-Token")) {
    throw new Error(
      `metaerp: federation callback did not yield CSB-Auth-Token (cookies: ${jar.names().join(", ") || "none"})`,
    );
  }

  // 3) Mint the CSRF token. It arrives as a response HEADER — it is in no
  // cookie, no body and no storage, which is also how the front end reads it.
  const info = await httpRequest(
    `${preset.portalBase}/gateway/metasaas/one/user/services/current/getCurrentInfo`,
    { ...shared, headers: { referer: `${preset.portalBase}/` } },
  );
  const csrf = info.headers["x-csrf-token"];
  const token = Array.isArray(csrf) ? csrf[0] : csrf;
  if (!token) {
    throw new Error(
      `metaerp: getCurrentInfo issued no x-csrf-token (HTTP ${info.status}) — ${info.body.slice(0, 200)}`,
    );
  }
  return { jar, csrf: token, expiresAt: Date.now() + SESSION_TTL_MS };
}

async function sessionFor(
  credentials: MetaerpCredentials,
  timeoutMs: number,
  forceRefresh: boolean,
): Promise<PortalSession> {
  const key = `${credentials.env}:${credentials.portalUser ?? ""}`;
  const cached = sessionCache.get(key);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached;
  const session = await login(credentials, timeoutMs);
  sessionCache.set(key, session);
  return session;
}

export interface UiapiCallInput {
  operation: string;
  /** Portal path, e.g. /gateway/hinv/minv/services/queryReservation. */
  path: string;
  payload: Record<string, unknown>;
  credentials: MetaerpCredentials;
  timeoutMs: number;
}

export async function callMetaerpUiapi(
  input: UiapiCallInput,
): Promise<TransportResult> {
  const { credentials, timeoutMs } = input;
  const { preset } = credentials;
  const suffix = input.path.startsWith("/") ? input.path : `/${input.path}`;
  const url = preset.portalBase + suffix;

  const send = async (session: PortalSession) =>
    httpRequest(url, {
      method: "POST",
      insecureTls: preset.insecureTls,
      timeoutMs,
      json: { ...credentials.defaults, ...input.payload },
      jar: session.jar,
      headers: {
        "x-csrf-token": session.csrf,
        referer: `${preset.portalBase}/`,
        isstandard: "Y",
        singleton: "true",
      },
    });

  let response = await send(await sessionFor(credentials, timeoutMs, false));
  if (response.status === 401 || response.status === 412) {
    // Expired session or stale CSRF; both are cured by logging in again. A
    // genuine permission-point failure returns 401 too and will simply fail
    // twice, which is the correct outcome — the message names the cause.
    response = await send(await sessionFor(credentials, timeoutMs, true));
  }
  return {
    data: normalizeMetaerpResponse({
      operation: input.operation,
      status: response.status,
      body: response.body,
      url,
    }),
    url,
    status: response.status,
  };
}
