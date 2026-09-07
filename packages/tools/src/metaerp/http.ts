/**
 * Minimal HTTPS client for the real Meta ERP transports.
 *
 * WHY NOT `fetch`
 * ---------------
 * Two requirements the global fetch cannot meet here without pulling undici in
 * as a direct dependency:
 *
 *  1. **Self-signed certificates.** The HCS estate serves its own CA. Node's
 *     fetch has no per-request TLS knob, and `NODE_TLS_REJECT_UNAUTHORIZED=0`
 *     disables verification for the WHOLE process — every outbound call the
 *     platform makes, including LLM providers. Here the opt-out is per request,
 *     and only reachable through an explicit config flag.
 *  2. **Cookies across a redirect chain.** The UIAPI login is a 302 chain that
 *     sets the session cookie on an intermediate hop. `redirect: "follow"`
 *     throws those responses away, so the jar has to be filled while the
 *     redirects are being followed — which means following them by hand.
 *
 * Nothing here is Meta-ERP specific; it is a transport primitive.
 */

import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

/** Redirect hops to follow before calling it a loop. */
const MAX_REDIRECTS = 5;

export interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  /** The URL that actually produced this response, after any redirects. */
  url: string;
}

export interface HttpRequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  /** Serialised as JSON with a matching content-type when present. */
  json?: unknown;
  /** Cookie jar, mutated in place as Set-Cookie headers arrive. */
  jar?: CookieJar;
  /** Follow 3xx responses (collecting cookies on the way). Default false. */
  followRedirects?: boolean;
  timeoutMs?: number;
  /**
   * Skip TLS certificate verification for THIS request. Only ever set from an
   * explicit operator configuration flag — never inferred from the hostname,
   * because "it looked internal" is not a security boundary.
   */
  insecureTls?: boolean;
}

/**
 * Cookie storage for one login session.
 *
 * Deliberately name→value only: no domain/path/expiry matching. The session is
 * built and used against a single origin within one call, so the extra
 * machinery would add failure modes without changing behaviour. If cookies ever
 * need to span origins, that is the moment to reach for a real jar.
 */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  absorb(setCookie: string[] | undefined): void {
    for (const raw of setCookie ?? []) {
      const pair = raw.split(";", 1)[0] ?? "";
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!name) continue;
      // An expiry-based deletion arrives as an empty value; honour it so a
      // logged-out session cannot look logged in.
      if (!value) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  has(name: string): boolean {
    return this.cookies.has(name);
  }

  names(): string[] {
    return [...this.cookies.keys()].sort();
  }

  header(): string {
    return [...this.cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

function once(
  url: string,
  options: HttpRequestOptions,
): Promise<HttpResponse> {
  const target = new URL(url);
  const secure = target.protocol === "https:";
  const body =
    options.json === undefined ? undefined : JSON.stringify(options.json);
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (body !== undefined) {
    headers["content-type"] = headers["content-type"] ?? "application/json";
    headers["content-length"] = String(Buffer.byteLength(body));
  }
  const cookie = options.jar?.header();
  if (cookie) headers.cookie = cookie;

  return new Promise((resolve, reject) => {
    const request = (secure ? https : http).request(
      target,
      {
        method: options.method ?? "GET",
        headers,
        ...(secure && options.insecureTls ? { rejectUnauthorized: false } : {}),
      },
      (response) => {
        options.jar?.absorb(response.headers["set-cookie"]);
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            url,
          }),
        );
      },
    );
    request.setTimeout(options.timeoutMs ?? 30_000, () => {
      request.destroy(
        new Error(`request to ${target.origin}${target.pathname} timed out`),
      );
    });
    request.on("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

/** Issue a request, optionally following redirects while filling the jar. */
export async function httpRequest(
  url: string,
  options: HttpRequestOptions = {},
): Promise<HttpResponse> {
  let current = url;
  let response = await once(current, options);
  if (!options.followRedirects) return response;
  for (let hop = 0; hop < MAX_REDIRECTS; hop += 1) {
    const { status } = response;
    const location = response.headers.location;
    if (status < 300 || status > 399 || !location) return response;
    current = new URL(location, current).toString();
    // A redirected request is always a GET without the original body: the
    // login POST's 302 leads to the federation page, not to a second login.
    response = await once(current, {
      ...options,
      method: "GET",
      json: undefined,
    });
  }
  throw new Error(`too many redirects starting at ${url}`);
}
