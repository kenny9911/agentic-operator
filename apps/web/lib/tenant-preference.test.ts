import { describe, expect, it } from "vitest";
import {
  isTenantSlug,
  parseRememberedTenant,
  resolvePortalTenant,
} from "./tenant-preference";

describe("tenant preferences", () => {
  it("accepts canonical tenant slugs and rejects redirect-unsafe values", () => {
    expect(isTenantSlug("support_flow-2")).toBe(true);
    expect(isTenantSlug("SupportFlow")).toBe(false);
    expect(isTenantSlug("../support")).toBe(false);
    expect(isTenantSlug("")).toBe(false);
  });

  it("reads the remembered tenant from plain or encoded cookie JSON", () => {
    expect(parseRememberedTenant('{"tenant":"support"}')).toBe("support");
    expect(
      parseRememberedTenant(
        encodeURIComponent('{"theme":"dark","tenant":"finance"}'),
      ),
    ).toBe("finance");
  });

  it("ignores malformed and invalid remembered tenants", () => {
    expect(parseRememberedTenant("not-json")).toBeNull();
    expect(parseRememberedTenant('{"tenant":"../raas"}')).toBeNull();
    expect(parseRememberedTenant('{"theme":"dark"}')).toBeNull();
  });

  it("prefers the last opened tenant over the session fallback", () => {
    expect(resolvePortalTenant("support", "finance")).toBe("support");
  });

  it("uses the session tenant only when no valid preference exists", () => {
    expect(resolvePortalTenant(null, "finance")).toBe("finance");
    expect(resolvePortalTenant("../invalid", "finance")).toBe("finance");
    expect(resolvePortalTenant(null, null)).toBeNull();
  });
});
