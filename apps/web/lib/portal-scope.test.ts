import { describe, expect, it } from "vitest";
import { canonicalPortalHref, domainPortalPath, domainSwitchPath, portalScope, portalScopeKey, scopedResourceHref, scopedStorageKey, scopedStreamPath } from "./portal-scope";
import { portalHeaders } from "./hooks/tenant-header";

const power = "/portal/acme/domains/power-purchase/workflows";
const hiring = "/portal/acme/domains/hiring/agents";

describe("Tenant / Domain navigation", () => {
  it("retains scope for create, build, run and monitor links, query parameters and detail ids", () => {
    for (const feature of ["workflows?new=blank", "agents/agt-1?section=test", "ontocode-workspace/session-1", "runs/run-1", "events?type=purchase.created", "settings?section=integrations"]) {
      expect(canonicalPortalHref(`/portal/acme/${feature}`, power)).toBe(`/portal/acme/domains/power-purchase/${feature}`);
    }
  });
  it("drops record and configuration-task identifiers when switching sibling Domains", () => {
    expect(domainSwitchPath("acme", "hiring", "/portal/acme/domains/purchasing/runs/run-1?view=logs")).toBe("/portal/acme/domains/hiring/runs");
    expect(domainSwitchPath("acme", "hiring", "/portal/acme/domains/purchasing/configure/ocfg-old")).toBe("/portal/acme/domains/hiring/ontocode-workspace");
  });
  it("never rewrites an explicitly selected sibling or another Tenant", () => {
    expect(canonicalPortalHref(hiring, power)).toBe(hiring);
    expect(canonicalPortalHref("/portal/other/agents", power)).toBe("/portal/other/agents");
    expect(canonicalPortalHref("/portal/acme/access", power)).toBe("/portal/acme/access");
    expect(canonicalPortalHref("/portal/acme/domains", power)).toBe("/portal/acme/domains");
  });
  it("separates ontology source configuration from Tenant administration", () => {
    expect(canonicalPortalHref("/portal/acme/tenants#ontology-domains", power)).toBe("/portal/acme/domains/power-purchase/ontology#ontology-domains");
    expect(canonicalPortalHref("/portal/acme/tenants", power)).toBe("/portal/acme/tenants");
  });
  it("resolves the feature after both scope identities and rejects invalid input", () => {
    expect(portalScope("/portal/acme/domains/power-purchase/runs/run-1")).toEqual({ tenant: "acme", domain: "power-purchase", feature: "runs", tail: ["run-1"] });
    expect(portalScope("/portal/acme/domains/%2fadmin/runs")).toBeNull();
    expect(() => domainPortalPath("acme", "../hiring")).toThrow();
  });
});

describe("independent Domain browser state", () => {
  it("changes cache identity on sibling switch but keeps nested views together", () => {
    expect(portalScopeKey(power)).not.toBe(portalScopeKey(hiring));
    expect(portalScopeKey(power)).toBe(portalScopeKey("/portal/acme/domains/power-purchase/runs/run-1"));
    expect(portalScopeKey("/portal/acme/settings")).not.toBe(portalScopeKey(power));
  });
  it("sends both selectors without inferring a Domain for Tenant administration", () => {
    expect(portalHeaders(power)).toEqual({ "x-agentic-tenant": "acme", "x-agentic-domain": "power-purchase" });
    expect(portalHeaders("/portal/acme/domains")).toEqual({ "x-agentic-tenant": "acme" });
  });
  it("keeps sibling drafts separate and preserves migrated default-Domain drafts", () => {
    expect(scopedStorageKey("draft:acme:purchase", power)).not.toBe(scopedStorageKey("draft:acme:purchase", hiring));
    expect(scopedStorageKey("draft:acme:purchase", "/portal/acme/domains/acme/workflows")).toBe("draft:acme:purchase");
  });
  it("forwards both identities for livefeed, reconnect, factory streaming and file reads", () => {
    const feed = new URL(scopedStreamPath("/livefeed?tenant=acme&backfill=100&lastEventId=evt-1", power), "http://test");
    expect(Object.fromEntries(feed.searchParams)).toEqual({ tenant: "acme", domain: "power-purchase", backfill: "100", lastEventId: "evt-1" });
    expect(scopedStreamPath("/factory-stream?tenant=acme&run=run-1", power)).toContain("domain=power-purchase");
    const file = new URL(scopedResourceHref("/v1/artifacts/art-1", hiring), "http://test");
    expect(Object.fromEntries(file.searchParams)).toEqual({ tenant: "acme", domain: "hiring", path: "/v1/artifacts/art-1" });
    expect(scopedResourceHref("https://example.com/file", power)).toBe("https://example.com/file");
  });
});
