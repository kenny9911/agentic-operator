import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookies = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => cookies }));
import { readDomainForRoute } from "./domain-access";

const domain = {
  id: "dom-sales", tenantId: "tnt-alpha", slug: "sales", name: "Sales",
  description: null, runtimeTenantId: "tnt-runtime", runtimeTenantSlug: "runtime-sales",
  isDefault: false, createdAt: 1, updatedAt: 1, archivedAt: null,
};
const fetchMock = vi.fn();
const success = (value: unknown) => new Response(JSON.stringify({ ok: true, data: { domain: value } }));

beforeEach(() => {
  cookies.get.mockReturnValue({ value: "opaque-session" });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("AGENTIC_API_URL", "http://api.internal:3540");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("server domain access", () => {
  it("verifies the explicitly selected owner with the opaque cookie and no shared cache", async () => {
    fetchMock.mockResolvedValue(success(domain));
    await expect(readDomainForRoute("alpha", "sales")).resolves.toEqual(domain);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("http://api.internal:3540/v1/domains/sales", {
      cache: "no-store",
      headers: { Accept: "application/json", cookie: "agentic_session=opaque-session", "x-agentic-tenant": "alpha" },
    });
  });
  it("does not request data without a session or for malformed selectors", async () => {
    cookies.get.mockReturnValue(undefined);
    await expect(readDomainForRoute("alpha", "sales")).resolves.toBeNull();
    cookies.get.mockReturnValue({ value: "opaque-session" });
    await expect(readDomainForRoute("alpha", "../other")).resolves.toBeNull();
    await expect(readDomainForRoute("Alpha", "sales")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404])("fails closed when the API returns %s", async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));
    await expect(readDomainForRoute("alpha", "sales")).resolves.toBeNull();
  });
  it("preserves archival status for the layout guard", async () => {
    fetchMock.mockResolvedValue(success({ ...domain, archivedAt: 20 }));
    await expect(readDomainForRoute("alpha", "sales")).resolves.toMatchObject({ archivedAt: 20 });
  });
  it("surfaces outages separately from denied access", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: false, error: { code: "unavailable", message: "service unavailable" } }), { status: 503 }));
    await expect(readDomainForRoute("alpha", "sales")).rejects.toMatchObject({ status: 503 });
  });
  it("rejects malformed success responses and unexpected domain identities", async () => {
    fetchMock.mockResolvedValue(success({ slug: "sales" }));
    await expect(readDomainForRoute("alpha", "sales")).rejects.toThrow();
    fetchMock.mockResolvedValue(success({ ...domain, slug: "other" }));
    await expect(readDomainForRoute("alpha", "sales")).rejects.toThrow("unexpected scope");
  });
});
