import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOMAIN_KEYS } from "@/lib/domain-query-keys";

const readDomain = vi.hoisted(() => vi.fn());
vi.mock("@/lib/domain-access", () => ({ readDomainForRoute: readDomain }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ tenant: "alpha", domain: "sales" }),
  usePathname: () => "/portal/alpha/domains/sales/dashboard",
}));
vi.mock("@/app/portal/lib/preferences-context", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
import DomainLayout from "../../[tenant]/domains/[domain]/layout";
import { DomainBoundary } from "./DomainBoundary";

const domain = {
  id: "dom-sales", tenantId: "tnt-alpha", slug: "sales", name: "Sales",
  description: null, runtimeTenantId: "tnt-runtime", runtimeTenantSlug: "runtime-sales",
  isDefault: false, createdAt: 1, updatedAt: 1, archivedAt: null,
};
let client: QueryClient;
beforeEach(() => { client = new QueryClient(); readDomain.mockReset(); readDomain.mockResolvedValue(domain); });
afterEach(() => client.clear());
const page = <div>Protected domain page</div>;
const render = async () => renderToStaticMarkup(<QueryClientProvider client={client}>
  {await DomainLayout({ children: page, params: Promise.resolve({ tenant: "alpha", domain: "sales" }) })}
</QueryClientProvider>);

describe("server-verified domain hydration", () => {
  it("renders child content immediately from verified metadata without a client gate request", async () => {
    const html = await render();
    expect(html).toContain("Protected domain page");
    expect(html).not.toContain("domains.loading");
    expect(readDomain).toHaveBeenCalledExactlyOnceWith("alpha", "sales");
    expect(client.getQueryData(DOMAIN_KEYS.detail("alpha", "sales"))).toEqual({ domain });
    expect(client.getQueryData(DOMAIN_KEYS.detail("other", "sales"))).toBeUndefined();
  });
  it.each([null, { ...domain, archivedAt: 20 }])("omits children when fresh access is denied or archived despite cached success", async (verified) => {
    client.setQueryData(DOMAIN_KEYS.detail("alpha", "sales"), { domain }, { updatedAt: Date.now() + 60_000 });
    readDomain.mockResolvedValue(verified);
    const html = await render();
    expect(html).not.toContain("Protected domain page");
    expect(html).toContain("domains.unavailable");
    expect(html).toContain('href="/portal/alpha/domains"');
  });
  it("does not overwrite newer client data with an older server snapshot", async () => {
    const newer = { ...domain, name: "Renamed sales", archivedAt: 20 };
    client.setQueryData(DOMAIN_KEYS.detail("alpha", "sales"), { domain: newer }, { updatedAt: Date.now() + 60_000 });
    const html = await render();
    expect(html).not.toContain("Protected domain page");
    expect(html).toContain("domains.archived");
    expect(client.getQueryData(DOMAIN_KEYS.detail("alpha", "sales"))).toEqual({ domain: newer });
  });
  it("keeps the client guard closed while metadata is pending", () => {
    const html = renderToStaticMarkup(<QueryClientProvider client={client}><DomainBoundary>{page}</DomainBoundary></QueryClientProvider>);
    expect(html).toContain("domains.loading");
    expect(html).not.toContain("Protected domain page");
  });
});
