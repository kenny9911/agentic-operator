/**
 * Shared tenant-preference helpers.
 *
 * Tenant slugs are user-controlled through both the URL and the preferences
 * cookie, so landing-page redirects only use values that match the canonical
 * slug shape. These helpers are deliberately framework-free so the redirect
 * and cookie behaviour can be covered without a browser or Next runtime.
 */

export const TENANT_SLUG_PATTERN = /^[a-z0-9_-]{1,32}$/;

export function isTenantSlug(value: unknown): value is string {
  return typeof value === "string" && TENANT_SLUG_PATTERN.test(value);
}

/** Extract a valid tenant from the JSON preferences cookie, if one exists. */
export function parseRememberedTenant(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;

  // Next's cookie store normally returns the decoded JSON value. Accept an
  // encoded value as well because browsers and proxies may percent-encode it.
  const candidates = [raw];
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded !== raw) candidates.push(decoded);
  } catch {
    // A malformed escape sequence is handled by the JSON parse below.
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { tenant?: unknown };
      if (isTenantSlug(parsed?.tenant)) return parsed.tenant;
    } catch {
      // Try the next representation, then fall back to the session tenant.
    }
  }
  return null;
}

/**
 * Pick the tenant for a bare `/portal` visit. The longer-lived preference is
 * the user's explicit last-opened choice; the signed session is the fallback
 * for a first visit that has no saved preference yet.
 */
export function resolvePortalTenant(
  rememberedTenant: unknown,
  sessionTenant: unknown,
): string | null {
  if (isTenantSlug(rememberedTenant)) return rememberedTenant;
  if (isTenantSlug(sessionTenant)) return sessionTenant;
  return null;
}
