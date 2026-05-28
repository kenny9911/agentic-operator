/**
 * tenant-header — derive the `x-agentic-tenant` header from the current URL.
 *
 * Hotfix — dashboard render hang (`/portal/hello/dashboard`).
 *
 * Every `/v1/*` fetch on the client side runs through this helper so the api
 * scopes the response to the tenant the user is *looking* at, not the slug
 * pinned in `AGENTIC_DEV_TENANT`. Without this header the dashboard for
 * tenant `hello` shows raas's runs/events/tasks — the URL says `hello`, the
 * sidebar shows `hello`, but every `/v1/*` call resolves to whichever slug
 * the env var pins (default `raas`).
 *
 * The api auth plugin only honors this header when `AUTH_MODE=dev`. In prod
 * the bearer token / session cookie is the *only* source of tenant truth —
 * a client-controlled header can never override it. See
 * `apps/api/src/plugins/auth.ts:devTenantOverride`.
 *
 * Returns an empty object on the server side (`typeof window === "undefined"`)
 * — server components / RSC routes should derive the tenant from `params`
 * and set the header explicitly when they need to call back into the api.
 */

const TENANT_HEADER = "x-agentic-tenant";

/**
 * Pure helper exposed for unit tests: extract the `[tenant]` segment from a
 * portal pathname. Returns null when the path doesn't sit under `/portal/`.
 */
export function tenantFromPathname(pathname: string): string | null {
  const m = pathname.match(/^\/portal\/([a-z0-9_-]{1,32})(?:\/|$)/i);
  return m ? (m[1] ?? null) : null;
}

/**
 * Build a headers fragment carrying the URL-derived tenant slug. Returns
 * `{}` when not in a browser or when the URL isn't a `/portal/<slug>/...`
 * path — that keeps the api on its dev fallback (`AGENTIC_DEV_TENANT`) for
 * non-portal pages.
 */
export function tenantHeader(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const slug = tenantFromPathname(window.location.pathname);
  return slug ? { [TENANT_HEADER]: slug } : {};
}
