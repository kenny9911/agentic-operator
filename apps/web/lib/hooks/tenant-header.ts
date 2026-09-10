import { browserPortalPathname, portalScope } from "@/lib/portal-scope";

/** The authenticated API validates membership and Domain ownership independently. */
export function tenantFromPathname(pathname: string): string | null {
  return portalScope(pathname)?.tenant ?? null;
}

export function domainFromPathname(pathname: string): string | null {
  return portalScope(pathname)?.domain ?? null;
}

export function portalHeaders(pathname: string | null): Record<string, string> {
  const scope = portalScope(pathname);
  return scope ? {
    "x-agentic-tenant": scope.tenant,
    ...(scope.domain ? { "x-agentic-domain": scope.domain } : {}),
  } : {};
}

/** Non-browser callers supply their verified scope explicitly. */
export function tenantHeader(): Record<string, string> {
  return portalHeaders(browserPortalPathname());
}

/** Explicit parent selectors keep the current Domain only when their owner agrees. */
export function tenantHeaderFor(tenant: string, pathname = browserPortalPathname()): Record<string, string> {
  const scope = portalScope(pathname);
  return { "x-agentic-tenant": tenant, ...(scope?.tenant === tenant && scope.domain ? { "x-agentic-domain": scope.domain } : {}) };
}
