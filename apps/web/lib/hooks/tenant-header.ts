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
 * Build a headers fragment carrying the active tenant slug. Most callers use
 * the URL-derived tenant. Flows that intentionally operate on a new tenant
 * before changing the URL (manifest import after tenant creation) may pass an
 * explicit override.
 */
export function tenantHeader(overrideTenant?: string): Record<string, string> {
  const slug =
    overrideTenant ??
    (typeof window === "undefined"
      ? null
      : tenantFromPathname(window.location.pathname));
  if (!slug || !/^[a-z0-9_-]{1,32}$/.test(slug)) return {};
  return slug ? { [TENANT_HEADER]: slug } : {};
}
