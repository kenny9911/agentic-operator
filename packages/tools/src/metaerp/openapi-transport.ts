/**
 * openapi-form transport: APIGW + IAM application token.
 *
 * Mirrors metaerp-openapi-call/scripts/call_openapi.py — mint a token from the
 * IAM account/secret/appId, then POST to the registered path with the token and
 * the tenant header. The appId is the subject APIG authorises, which is why an
 * unauthorised call comes back as "AppId xxx couldn't access xxx" rather than a
 * 401 (see envelope.ts).
 */

import { httpRequest } from "./http";
import type { MetaerpCredentials } from "./config";
import { normalizeMetaerpPath } from "./config";
import { normalizeMetaerpResponse } from "./envelope";

/**
 * Tokens are cached for well under any plausible IAM lifetime, and a 401 clears
 * the entry so the next call re-mints rather than failing twice. Minting on
 * every ERP call would double the request count for no benefit.
 */
const TOKEN_TTL_MS = 10 * 60_000;

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

export function _clearMetaerpTokenCacheForTests(): void {
  tokenCache.clear();
}

function cacheKey(credentials: MetaerpCredentials): string {
  return `${credentials.env}:${credentials.account}:${credentials.project}`;
}

async function mintToken(
  credentials: MetaerpCredentials,
  timeoutMs: number,
): Promise<string> {
  const { preset } = credentials;
  const response = await httpRequest(preset.iamTokenUrl, {
    method: "POST",
    insecureTls: preset.insecureTls,
    timeoutMs,
    json: {
      data: {
        type: "token",
        attributes: {
          account: credentials.account,
          secret: credentials.secret,
          project: credentials.project,
          enterprise: credentials.enterprise,
        },
      },
    },
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `metaerp: IAM token request failed with HTTP ${response.status} — ${response.body.slice(0, 500)}`,
    );
  }
  let token: unknown;
  try {
    token = (JSON.parse(response.body) as { access_token?: unknown }).access_token;
  } catch {
    throw new Error("metaerp: IAM token response was not JSON");
  }
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("metaerp: IAM token response carried no access_token");
  }
  return token;
}

async function tokenFor(
  credentials: MetaerpCredentials,
  timeoutMs: number,
  forceRefresh: boolean,
): Promise<string> {
  const key = cacheKey(credentials);
  const cached = tokenCache.get(key);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.token;
  const token = await mintToken(credentials, timeoutMs);
  tokenCache.set(key, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

export interface OpenapiCallInput {
  operation: string;
  /** Registration path, with or without an environment prefix. */
  path: string;
  payload: Record<string, unknown>;
  credentials: MetaerpCredentials;
  timeoutMs: number;
  /** 该操作的默认字段，位于部署级范围键之上、调用方之下。 */
  defaults?: Record<string, unknown>;
  /** 强制字段，合并在调用方之上——调用方给了也会被覆盖。 */
  overrides?: Record<string, unknown>;
}

export interface TransportResult {
  data: unknown;
  url: string;
  status: number;
}

export async function callMetaerpOpenapi(
  input: OpenapiCallInput,
): Promise<TransportResult> {
  const { credentials, timeoutMs } = input;
  const { preset } = credentials;
  const url = preset.apigwBase + normalizeMetaerpPath(input.path, preset);

  const send = async (token: string) =>
    httpRequest(url, {
      method: "POST",
      insecureTls: preset.insecureTls,
      timeoutMs,
      json: {
        ...credentials.defaults,
        ...(input.defaults ?? {}),
        ...input.payload,
        ...(input.overrides ?? {}),
      },
      headers: {
        authorization: token,
        "x-renter-id": credentials.renterId,
      },
    });

  let response = await send(await tokenFor(credentials, timeoutMs, false));
  if (response.status === 401) {
    // A cached token outlived its server-side life; mint once and retry.
    response = await send(await tokenFor(credentials, timeoutMs, true));
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
