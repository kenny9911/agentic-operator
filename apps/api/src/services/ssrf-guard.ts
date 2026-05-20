/**
 * SSRF guard for outbound `fetch-url` (and any future server-side fetch).
 *
 * Background — review S1 (BLOCKER): the v0 design said "5 MB cap and content-
 * type allow-list" but did not filter the target IP. An operator could `POST
 * { url: "http://169.254.169.254/latest/meta-data/iam/security-credentials/" }`
 * and exfiltrate AWS instance credentials, or hit RFC1918 hosts on the
 * cluster network.
 *
 * The protocol (also documented in
 * `docs/design/import-workflow-manifest.md` §"SSRF protocol for fetch-url"):
 *
 *   1. Require `https:` — or `http:` + hostname `localhost` only when
 *      `AGENTIC_FETCH_ALLOW_HTTP_LOCALHOST=1` (dev opt-in).
 *   2. Resolve the hostname via `dns.promises.lookup({ family: 0 })`.
 *      Reject if the resolved address is:
 *        - loopback (`127.0.0.0/8`)
 *        - RFC1918 private (`10/8`, `172.16/12`, `192.168/16`)
 *        - link-local (`169.254.0.0/16`) including AWS metadata
 *        - IPv6 loopback (`::1`), link-local (`fe80::/10`), or ULA (`fd00::/8`)
 *        - the zero address (`0.0.0.0`)
 *   3. Use `fetch(url, { redirect: 'manual' })`. Follow up to 3 hops,
 *      re-validating each `Location` URL through `assertSafeOutboundUrl`.
 *   4. Stream-count body bytes; abort on > MAX_BYTES (do NOT trust
 *      `Content-Length` — a malicious server can lie or stream forever).
 *   5. Validate content-type against an allow-list before reading the body
 *      AND after (some servers chunk-update headers).
 *   6. 5 s connect timeout, 5 s body timeout (separate AbortControllers).
 *
 * Reject all non-`http(s):` schemes — `file:`, `ftp:`, `data:`, `gopher:`,
 * `dict:`, `ssh:`, etc.
 */

import dns from "node:dns/promises";
import net from "node:net";

const FETCH_CONNECT_TIMEOUT_MS = Number(
  process.env.AGENTIC_FETCH_URL_CONNECT_TIMEOUT_MS ?? "5000",
);
const FETCH_BODY_TIMEOUT_MS = Number(
  process.env.AGENTIC_FETCH_URL_BODY_TIMEOUT_MS ?? "5000",
);
const FETCH_MAX_BYTES_DEFAULT = Number(
  process.env.AGENTIC_FETCH_URL_MAX_BYTES ?? String(5 * 1024 * 1024),
);
const FETCH_MAX_REDIRECTS = Number(process.env.AGENTIC_FETCH_URL_MAX_REDIRECTS ?? "3");

export class SsrfError extends Error {
  constructor(
    public readonly code:
      | "https_only"
      | "scheme_not_allowed"
      | "blocked_target"
      | "dns_resolution_failed"
      | "redirect_limit_exceeded"
      | "body_too_large"
      | "timeout"
      | "bad_url",
    message: string,
  ) {
    super(message);
    this.name = "SsrfError";
  }
}

/**
 * Decide whether an IPv4/IPv6 literal points at an internal/restricted
 * target. Conservative: when in doubt, reject.
 */
function isBlockedAddress(address: string): boolean {
  if (!address) return true;
  const ipVersion = net.isIP(address);
  if (ipVersion === 4) {
    // Parse octets; reject the zero address, loopback, RFC1918, link-local,
    // and AWS metadata in particular.
    const parts = address.split(".").map((x) => Number(x));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return true;
    const [a, b] = parts as [number, number, number, number];
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8 (loopback)
    if (a === 10) return true; // 10.0.0.0/8 (RFC1918)
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 (RFC1918)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 (RFC1918)
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local, includes AWS metadata 169.254.169.254)
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
    if (a >= 224) return true; // 224/4 multicast + 240/4 reserved
    return false;
  }
  if (ipVersion === 6) {
    // Normalize: drop zone-id if any, lowercase.
    const lower = address.split("%")[0]!.toLowerCase();
    if (lower === "::" || lower === "::1") return true; // unspecified / loopback
    if (lower.startsWith("fe80:") || lower.startsWith("fe80::")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA (fc00::/7)
    if (lower.startsWith("ff")) return true; // multicast (ff00::/8)
    // IPv4-mapped (::ffff:a.b.c.d) — strip the prefix and re-check.
    const v4MapMatch = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (v4MapMatch) return isBlockedAddress(v4MapMatch[1]!);
    return false;
  }
  // Unknown format — treat as blocked.
  return true;
}

/**
 * Parse + validate a URL for outbound fetch. Resolves DNS and rejects any
 * internal target. Returns the parsed URL on success; throws SsrfError on
 * any policy violation.
 */
export async function assertSafeOutboundUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SsrfError("bad_url", `not a valid URL: ${raw}`);
  }
  // Scheme allow-list.
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new SsrfError(
      "scheme_not_allowed",
      `scheme "${u.protocol}" is not allowed; only https: (or http://localhost in dev) is accepted`,
    );
  }
  if (u.protocol === "http:") {
    const httpLocalhostAllowed =
      process.env.AGENTIC_FETCH_ALLOW_HTTP_LOCALHOST === "1" &&
      (u.hostname === "localhost" ||
        u.hostname === "127.0.0.1" ||
        u.hostname === "::1");
    if (!httpLocalhostAllowed) {
      throw new SsrfError(
        "https_only",
        `http: is only allowed for localhost in dev (set AGENTIC_FETCH_ALLOW_HTTP_LOCALHOST=1)`,
      );
    }
  }
  // DNS-resolve. Strip IPv6 brackets for `dns.lookup`.
  const hostname = u.hostname.replace(/^\[|\]$/g, "");
  // If hostname is already an IP literal, lookup will echo it back; either
  // way we apply the same address policy.
  let address: string;
  try {
    const resolved = await dns.lookup(hostname, { family: 0 });
    address = resolved.address;
  } catch (err) {
    throw new SsrfError(
      "dns_resolution_failed",
      `dns lookup failed for "${hostname}": ${(err as Error).message}`,
    );
  }
  if (isBlockedAddress(address)) {
    throw new SsrfError(
      "blocked_target",
      `target "${hostname}" resolves to ${address}, which is a private/loopback/link-local/metadata address`,
    );
  }
  return u;
}

export interface SafeFetchOptions {
  /** Hard cap on the response body in bytes. Defaults to 5 MB. */
  maxBytes?: number;
  /** Allowed content-types (lowercased, sans `;charset=…`). */
  allowedContentTypes?: ReadonlySet<string>;
  /** Custom abort signal (chained to the internal one). */
  signal?: AbortSignal;
  /** Forwarded request headers. */
  headers?: Record<string, string>;
}

export interface SafeFetchResult {
  /** Final URL after any redirects (already validated). */
  finalUrl: URL;
  /** Lowercased content-type without parameters. */
  contentType: string;
  /** Raw body bytes. */
  body: Buffer;
}

/**
 * Outbound fetch with SSRF guard, manual redirect handling, byte cap, and
 * content-type allow-list. Throws `SsrfError` on policy violation,
 * `Error("upstream_status_<N>")` on non-2xx response, `Error("body_too_large")`
 * on body cap.
 */
export async function safeFetch(
  raw: string,
  opts: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? FETCH_MAX_BYTES_DEFAULT;
  const allowed = opts.allowedContentTypes;

  let currentUrl = await assertSafeOutboundUrl(raw);
  for (let hop = 0; hop <= FETCH_MAX_REDIRECTS; hop += 1) {
    const ac = new AbortController();
    const connectTimer = setTimeout(
      () => ac.abort(new SsrfError("timeout", "connect timeout")),
      FETCH_CONNECT_TIMEOUT_MS,
    );
    // Chain user abort.
    const userSignal = opts.signal;
    const userAbortListener = userSignal
      ? () => ac.abort(userSignal.reason ?? new Error("aborted"))
      : null;
    if (userSignal && userAbortListener) {
      if (userSignal.aborted) ac.abort(userSignal.reason ?? new Error("aborted"));
      else userSignal.addEventListener("abort", userAbortListener, { once: true });
    }

    let res: Response;
    try {
      res = await fetch(currentUrl.toString(), {
        method: "GET",
        headers: opts.headers ?? { accept: "application/json, text/plain" },
        signal: ac.signal,
        redirect: "manual",
      });
    } catch (err) {
      clearTimeout(connectTimer);
      if (userSignal && userAbortListener) userSignal.removeEventListener("abort", userAbortListener);
      if ((err as Error).name === "AbortError" || (err as Error).message?.includes("aborted")) {
        throw new SsrfError("timeout", `connect timed out after ${FETCH_CONNECT_TIMEOUT_MS}ms`);
      }
      throw err;
    }
    clearTimeout(connectTimer);

    // Manual redirect handling. fetch with redirect:'manual' surfaces the
    // raw status; 3xx with a Location requires re-validation through the
    // SSRF guard.
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) {
        if (userSignal && userAbortListener) userSignal.removeEventListener("abort", userAbortListener);
        throw new Error(`upstream_status_${res.status}`);
      }
      if (hop >= FETCH_MAX_REDIRECTS) {
        if (userSignal && userAbortListener) userSignal.removeEventListener("abort", userAbortListener);
        throw new SsrfError(
          "redirect_limit_exceeded",
          `more than ${FETCH_MAX_REDIRECTS} redirects`,
        );
      }
      const nextRaw = new URL(loc, currentUrl).toString();
      currentUrl = await assertSafeOutboundUrl(nextRaw);
      if (userSignal && userAbortListener) userSignal.removeEventListener("abort", userAbortListener);
      continue;
    }

    if (!res.ok) {
      if (userSignal && userAbortListener) userSignal.removeEventListener("abort", userAbortListener);
      throw new Error(`upstream_status_${res.status}`);
    }

    // Content-type check #1 (before body).
    const ctRaw = (res.headers.get("content-type") ?? "")
      .split(";")[0]!
      .trim()
      .toLowerCase();
    if (allowed && !allowed.has(ctRaw)) {
      if (userSignal && userAbortListener) userSignal.removeEventListener("abort", userAbortListener);
      throw new Error(
        `content_type_not_allowed: "${ctRaw}" not in {${[...allowed].join(", ")}}`,
      );
    }

    // Stream-count the body. We do NOT trust the Content-Length header — a
    // malicious server can omit it or lie about it. Re-arm the abort timer
    // for the body phase.
    const bodyTimer = setTimeout(
      () => ac.abort(new SsrfError("timeout", "body timeout")),
      FETCH_BODY_TIMEOUT_MS,
    );
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      if (!res.body) {
        if (userSignal && userAbortListener) userSignal.removeEventListener("abort", userAbortListener);
        clearTimeout(bodyTimer);
        return { finalUrl: currentUrl, contentType: ctRaw, body: Buffer.alloc(0) };
      }
      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          throw new SsrfError(
            "body_too_large",
            `body exceeded ${maxBytes} bytes (read ${total})`,
          );
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      clearTimeout(bodyTimer);
      if (userSignal && userAbortListener) userSignal.removeEventListener("abort", userAbortListener);
    }

    // Content-type check #2 (after body — some servers update headers in
    // trailers; cheap defense in depth).
    const ctAfter = (res.headers.get("content-type") ?? "")
      .split(";")[0]!
      .trim()
      .toLowerCase();
    if (allowed && !allowed.has(ctAfter)) {
      throw new Error(
        `content_type_not_allowed_after_body: "${ctAfter}" not in {${[...allowed].join(", ")}}`,
      );
    }
    return {
      finalUrl: currentUrl,
      contentType: ctAfter || ctRaw,
      body: Buffer.concat(chunks),
    };
  }
  // The loop returns or throws; unreachable in practice.
  throw new SsrfError("redirect_limit_exceeded", "redirect loop exited unexpectedly");
}

/** Exposed for unit tests — pure address predicate, no IO. */
export const __test = {
  isBlockedAddress,
};
