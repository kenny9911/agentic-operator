/** URL scope is a selector; the API independently authorizes both identities. */
export interface PortalScope {
  tenant: string;
  domain: string | null;
  feature: string | null;
  tail: string[];
}

const IDENTIFIER = /^[a-z0-9_-]{1,64}$/i;
export const DOMAIN_FEATURES = new Set([
  "dashboard", "workflows", "agents", "runs", "events", "tasks", "logs",
  "reasoning", "factory", "ontocode", "ontocode-workspace", "deployments",
  "system-check", "tools", "tool-library", "skills", "configure", "ontology",
]);

export function portalScope(pathname: string | null | undefined): PortalScope | null {
  const parts = (pathname ?? "").split(/[?#]/, 1)[0]!.split("/").filter(Boolean);
  if (parts[0] !== "portal" || !parts[1] || !IDENTIFIER.test(parts[1])) return null;
  const tenant = parts[1];
  if (parts[2] === "domains" && parts[3]) {
    if (!IDENTIFIER.test(parts[3])) return null;
    return { tenant, domain: parts[3], feature: parts[4] ?? null, tail: parts.slice(5) };
  }
  return { tenant, domain: null, feature: parts[2] ?? null, tail: parts.slice(3) };
}

export function domainPortalPath(tenant: string, domain: string, feature = "dashboard"): string {
  if (!IDENTIFIER.test(tenant) || !IDENTIFIER.test(domain)) throw new Error("Invalid portal scope");
  return `/portal/${tenant}/domains/${domain}${feature ? `/${feature.replace(/^\//, "")}` : ""}`;
}

/** Switching sibling Domains never carries resource IDs or configuration-task IDs. */
export function domainSwitchPath(tenant: string, domain: string, pathname: string | null): string {
  const scope = portalScope(pathname);
  const feature = scope?.tenant === tenant && scope.domain ? scope.feature ?? "dashboard" : "dashboard";
  return domainPortalPath(tenant, domain, feature === "configure" ? "ontocode-workspace" : feature);
}

/** Preserve an explicit target scope; adapt old shared-feature links in one place. */
export function canonicalPortalHref(href: string, pathname: string | null | undefined): string {
  const current = portalScope(pathname);
  const target = portalScope(href);
  if (!current?.domain || !target || target.tenant !== current.tenant || target.domain) return href;
  if (target.feature === "tenants" && /#(?:ontology-domains|runtime-profiles)$/.test(href)) {
    return domainPortalPath(current.tenant, current.domain, "ontology") + href.slice(href.indexOf("#"));
  }
  if (!target.feature || (!DOMAIN_FEATURES.has(target.feature) && target.feature !== "settings")) return href;
  const prefix = `/portal/${target.tenant}`;
  return domainPortalPath(current.tenant, current.domain, "") + href.slice(prefix.length);
}

export function portalScopeKey(pathname: string | null | undefined): string {
  const scope = portalScope(pathname);
  if (scope) return scope.domain ? `${scope.tenant}/domains/${scope.domain}` : scope.tenant;
  const segment = pathname?.match(/^\/portal\/([^/]+)/)?.[1];
  return segment ? `__invalid__:${segment}` : "__portal__";
}

export function browserPortalPathname(): string | null {
  return typeof window === "undefined" ? null : window.location.pathname;
}

/** The default migrated Domain preserves existing local drafts; siblings never share them. */
export function scopedStorageKey(key: string, pathname = browserPortalPathname()): string {
  const scope = portalScope(pathname);
  return scope?.domain && scope.domain !== scope.tenant && !key.endsWith(`:domain:${scope.domain}`)
    ? `${key}:domain:${scope.domain}`
    : key;
}

export function scopedStreamPath(path: string, pathname = browserPortalPathname()): string {
  const scope = portalScope(pathname);
  if (!scope?.domain) return path;
  const url = new URL(path, "http://portal.invalid");
  const selectedTenant = url.searchParams.get("tenant");
  if (selectedTenant && selectedTenant !== scope.tenant) return path;
  url.searchParams.set("tenant", scope.tenant);
  url.searchParams.set("domain", scope.domain);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function scopedResourceHref(href: string, pathname = browserPortalPathname()): string {
  const scope = portalScope(pathname);
  if (!scope || !href.startsWith("/v1/")) return href;
  const query = new URLSearchParams({ path: href, tenant: scope.tenant });
  if (scope.domain) query.set("domain", scope.domain);
  return `/scoped-file?${query.toString()}`;
}

/** Preferences remain global; drafts, run pointers and feature state use this adapter. */
export const domainStorage = {
  getItem(key: string): string | null { return globalThis.localStorage.getItem(scopedStorageKey(key)); },
  setItem(key: string, value: string): void { globalThis.localStorage.setItem(scopedStorageKey(key), value); },
  removeItem(key: string): void { globalThis.localStorage.removeItem(scopedStorageKey(key)); },
};
