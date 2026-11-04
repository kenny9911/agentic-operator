import { NextResponse, type NextRequest } from "next/server";
import { DOMAIN_FEATURES, domainPortalPath, portalScope } from "./lib/portal-scope";
import { serverApiUrl } from "./lib/server-api-url";

/** Old bookmarks map only to the API's recorded default, never a first list item. */
export async function proxy(request: NextRequest) {
  const scope = portalScope(request.nextUrl.pathname);
  if (!scope || scope.domain || !scope.feature || !DOMAIN_FEATURES.has(scope.feature)) return NextResponse.next();
  let domain: string | null = null;
  try {
    const response = await fetch(`${serverApiUrl()}/v1/domains`, {
      headers: { cookie: request.headers.get("cookie") ?? "", "x-agentic-tenant": scope.tenant },
      cache: "no-store",
    });
    if (response.ok) {
      const body = await response.json();
      const defaults = (body?.data?.items ?? []).filter((item: { isDefault?: boolean; archivedAt?: number | null }) => item.isDefault && item.archivedAt === null);
      if (defaults.length === 1 && typeof defaults[0].slug === "string") domain = defaults[0].slug;
    }
  } catch { /* The Domain picker reports the API error without choosing a scope. */ }
  const url = request.nextUrl.clone();
  url.pathname = domain
    ? domainPortalPath(scope.tenant, domain, [scope.feature === "ontocode" ? "ontocode-workspace" : scope.feature, ...scope.tail].join("/"))
    : `/portal/${scope.tenant}/domains`;
  return NextResponse.redirect(url);
}

export const config = { matcher: "/portal/:path*" };
