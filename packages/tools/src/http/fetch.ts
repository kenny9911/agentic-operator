/**
 * http.fetch — generic JSON HTTP client.
 *
 * Lets any agent talk to any HTTP API without shipping a tenant-specific
 * wrapper. The agent's manifest binds the base URL + auth scheme + default
 * headers via `tool_use[].config`; the LLM only supplies the per-call
 * `{ method, path, body?, query? }` it needs.
 *
 * Per-tenant configuration (manifest `tool_use[].config`):
 *   {
 *     base_url?:        string,           // prepended to `path` (no trailing /)
 *     timeout_ms?:      number,           // default 30000
 *     default_headers?: Record<string,string>, // merged with per-call headers
 *     api_key?:         string,           // literal key (dev/local override)
 *     api_key_env?:     string,           // env var holding the key
 *     auth_scheme?:     "bearer" | "header" | "query" | "none",
 *                                         // bearer (default) → Authorization: Bearer <key>
 *                                         // header          → uses `auth_header_name` (default "X-API-Key")
 *                                         // query           → uses `auth_query_name` (default "api_key")
 *                                         // none            → no auth
 *     auth_header_name?: string,
 *     auth_query_name?:  string,
 *     allow_methods?:   ("GET"|"POST"|"PUT"|"PATCH"|"DELETE")[],
 *                                         // safety allow-list; default any
 *     allow_host?:      string | string[],
 *                                         // safety allow-list; default any
 *   }
 *
 * LLM-provided args:
 *   {
 *     method:   "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
 *     path:     string,                    // joined to base_url
 *     query?:   Record<string, string|number|boolean>,
 *     body?:    unknown,                   // JSON-encoded
 *     headers?: Record<string, string>,    // merged on top of default_headers
 *   }
 *
 * Returns:
 *   { status, ok, headers, body }   // body is parsed JSON when content-type
 *                                   // includes "json"; otherwise raw text
 *
 * Errors:
 *   - Throws on network failure / timeout / unparseable URL.
 *   - Returns `{ status: 4xx/5xx, ok: false, body }` for non-2xx; the LLM
 *     can branch on `ok` to decide whether to retry. This is intentionally
 *     different from `parseResumeApi` which throws on 4xx — generic clients
 *     should let the model see error bodies so it can self-correct.
 */

import type { ToolContext } from "@agentic/agent-kit";
import { defineTool } from "@agentic/agent-kit";
import { z } from "zod";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const ALL_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

interface HttpFetchConfig {
  base_url?: string;
  timeout_ms?: number;
  default_headers?: Record<string, string>;
  api_key?: string;
  api_key_env?: string;
  auth_scheme?: "bearer" | "header" | "query" | "none";
  auth_header_name?: string;
  auth_query_name?: string;
  allow_methods?: HttpMethod[];
  allow_host?: string | string[];
}

function readConfig(ctx: ToolContext): HttpFetchConfig {
  return (ctx.config ?? {}) as HttpFetchConfig;
}

function resolveApiKey(cfg: HttpFetchConfig): string | null {
  if (typeof cfg.api_key === "string" && cfg.api_key.length > 0) return cfg.api_key;
  if (typeof cfg.api_key_env === "string" && cfg.api_key_env.length > 0) {
    const v = (process.env[cfg.api_key_env] ?? "").trim();
    if (v.length > 0) return v;
  }
  return null;
}

function buildUrl(cfg: HttpFetchConfig, path: string, query?: Record<string, unknown>): URL {
  const base = (cfg.base_url ?? "").replace(/\/$/, "");
  const absoluteIncoming = /^https?:\/\//i.test(path);
  const composed = absoluteIncoming ? path : `${base}${path.startsWith("/") ? path : `/${path}`}`;
  if (composed.length === 0) {
    throw new Error(
      "http.fetch: no URL — set tool_use[].config.base_url or pass an absolute path.",
    );
  }
  let url: URL;
  try {
    url = new URL(composed);
  } catch {
    throw new Error(`http.fetch: invalid URL '${composed}'.`);
  }
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v == null) continue;
      url.searchParams.append(k, String(v));
    }
  }
  return url;
}

function assertHostAllowed(url: URL, cfg: HttpFetchConfig): void {
  if (!cfg.allow_host) return;
  const allow = Array.isArray(cfg.allow_host) ? cfg.allow_host : [cfg.allow_host];
  if (!allow.includes(url.hostname)) {
    throw new Error(
      `http.fetch: host '${url.hostname}' not in allow_host (${allow.join(", ")}).`,
    );
  }
}

function assertMethodAllowed(method: HttpMethod, cfg: HttpFetchConfig): void {
  const allow = cfg.allow_methods ?? ALL_METHODS;
  if (!allow.includes(method)) {
    throw new Error(
      `http.fetch: method '${method}' not in allow_methods (${allow.join(", ")}).`,
    );
  }
}

function buildHeaders(cfg: HttpFetchConfig, perCall: Record<string, string> | undefined, url: URL): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (cfg.default_headers) {
    for (const [k, v] of Object.entries(cfg.default_headers)) headers[k] = v;
  }
  if (perCall) {
    for (const [k, v] of Object.entries(perCall)) headers[k] = v;
  }
  // Auth injection
  const scheme = cfg.auth_scheme ?? (resolveApiKey(cfg) ? "bearer" : "none");
  if (scheme !== "none") {
    const key = resolveApiKey(cfg);
    if (key) {
      if (scheme === "bearer") {
        headers.Authorization = `Bearer ${key}`;
      } else if (scheme === "header") {
        headers[cfg.auth_header_name ?? "X-API-Key"] = key;
      } else if (scheme === "query") {
        url.searchParams.set(cfg.auth_query_name ?? "api_key", key);
      }
    }
  }
  return headers;
}

export const httpFetchTool = defineTool({
  name: "http.fetch",
  description:
    "Generic JSON HTTP client. Pass { method, path, body?, query?, headers? }. " +
    "The base URL, auth scheme, default headers, timeout, method/host allow-lists, and " +
    "per-tenant API key are bound in the manifest's tool_use[].config block. " +
    "Returns { status, ok, headers, body }. 4xx/5xx return with ok:false (does NOT throw) " +
    "so the LLM can self-correct from the error body.",
  output: z.object({
    status: z.number().int(),
    ok: z.boolean(),
    headers: z.record(z.string(), z.string()),
    body: z.unknown(),
  }),
  async handler(ctx) {
    const args = (ctx.event?.data ?? {}) as Record<string, unknown>;
    const cfg = readConfig(ctx);

    const rawMethod = typeof args.method === "string" ? args.method.toUpperCase() : "GET";
    if (!ALL_METHODS.includes(rawMethod as HttpMethod)) {
      throw new Error(
        `http.fetch: method must be one of ${ALL_METHODS.join(", ")} (got '${args.method}').`,
      );
    }
    const method = rawMethod as HttpMethod;
    assertMethodAllowed(method, cfg);

    const path =
      typeof args.path === "string"
        ? args.path
        : typeof args.url === "string"
          ? args.url
          : "";
    if (!path) {
      throw new Error("http.fetch: required arg `path` (or `url`) is missing.");
    }

    const url = buildUrl(cfg, path, (args.query ?? undefined) as Record<string, unknown> | undefined);
    assertHostAllowed(url, cfg);
    const headers = buildHeaders(
      cfg,
      (args.headers ?? undefined) as Record<string, string> | undefined,
      url,
    );

    let body: BodyInit | undefined;
    if (args.body !== undefined && method !== "GET") {
      if (typeof args.body === "string") {
        body = args.body;
      } else {
        body = JSON.stringify(args.body);
        if (!headers["Content-Type"] && !headers["content-type"]) {
          headers["Content-Type"] = "application/json";
        }
      }
    }

    const timeoutMs =
      typeof cfg.timeout_ms === "number" && cfg.timeout_ms > 0 ? cfg.timeout_ms : 30_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method,
        headers,
        body,
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(
        `http.fetch: ${method} ${url.toString()} — ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    const ctype = res.headers.get("content-type") ?? "";
    let parsed: unknown = text;
    if (text.length > 0 && /json/i.test(ctype)) {
      try {
        parsed = JSON.parse(text);
      } catch {
        /* keep as text */
      }
    }

    const headerObj: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headerObj[k] = v;
    });

    return {
      data: {
        status: res.status,
        ok: res.ok,
        headers: headerObj,
        body: parsed,
      },
      meta: { url: url.toString(), method },
    };
  },
});
