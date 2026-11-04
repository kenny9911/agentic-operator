import type { ReactNode } from "react";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { DomainBoundary, DomainUnavailable } from "@/app/portal/components/domains/DomainBoundary";
import { readDomainForRoute } from "@/lib/domain-access";
import { DOMAIN_KEYS } from "@/lib/domain-query-keys";

export default async function DomainLayout({ children, params }: {
  children: ReactNode;
  params: Promise<{ tenant: string; domain: string }>;
}) {
  const { tenant, domain } = await params;
  const verified = await readDomainForRoute(tenant, domain);
  if (!verified || verified.archivedAt !== null) {
    return <DomainUnavailable tenant={tenant} archived={verified?.archivedAt != null} />;
  }
  // A request-local cache supplies the verified metadata before child queries
  // mount. HydrationBoundary preserves any newer browser-side query data.
  const client = new QueryClient();
  client.setQueryData(DOMAIN_KEYS.detail(tenant, domain), { domain: verified });
  return <HydrationBoundary state={dehydrate(client)}>
    <DomainBoundary>{children}</DomainBoundary>
  </HydrationBoundary>;
}
