/**
 * useTenant — happy-path coverage. We can't realistically run React hooks
 * here without a renderer; instead we test the pure helpers exported from
 * `./use-tenant` directly. Wider e2e coverage is in the Playwright suite
 * (P2-FE-26 follow-up, P4-TEST-04).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveTenantParam,
  rewriteTenantInPath,
  refreshToTenant,
  DEFAULT_TENANT,
} from "./use-tenant";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveTenantParam", () => {
  it("returns the raw param when it's a non-empty string", () => {
    expect(resolveTenantParam("support")).toBe("support");
  });

  it("does not guess a tenant when the param is undefined", () => {
    expect(DEFAULT_TENANT).toBe("");
    expect(resolveTenantParam(undefined)).toBe("");
  });

  it("returns the first element of an array param", () => {
    expect(resolveTenantParam(["foo", "bar"])).toBe("foo");
  });

  it("falls back to the default when the array is empty", () => {
    expect(resolveTenantParam([])).toBe(DEFAULT_TENANT);
  });
});

describe("rewriteTenantInPath", () => {
  it("swaps tenant on a typical view path", () => {
    expect(rewriteTenantInPath("/portal/raas/runs", "support")).toBe(
      "/portal/support/runs",
    );
  });

  it("preserves the trailing detail segment", () => {
    expect(rewriteTenantInPath("/portal/raas/runs/run-abc", "support")).toBe(
      "/portal/support/runs/run-abc",
    );
  });

  it("treats /portal alone as no-rest", () => {
    expect(rewriteTenantInPath("/portal", "support")).toBe("/portal/support");
  });

  it("falls back to /portal/<tenant> when not under /portal", () => {
    expect(rewriteTenantInPath("/sign-in", "support")).toBe("/portal/support");
  });

  it("handles an empty path", () => {
    expect(rewriteTenantInPath("/", "support")).toBe("/portal/support");
  });
});

describe("refreshToTenant", () => {
  it("persists the selection before doing a full tenant navigation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    const assign = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      refreshToTenant("support", "/portal/raas/runs", assign),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/prefs",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
        body: JSON.stringify({ tenant: "support" }),
      }),
    );
    expect(assign).toHaveBeenCalledWith("/portal/support/runs");
  });

  it("stays on the current tenant if access/persistence fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const assign = vi.fn();

    await expect(
      refreshToTenant("support", "/portal/raas/dashboard", assign),
    ).resolves.toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it("still navigates when cross-tab storage is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    vi.stubGlobal("window", {
      localStorage: {
        setItem: vi.fn(() => {
          throw new DOMException("Storage is disabled", "SecurityError");
        }),
      },
    });
    const assign = vi.fn();

    await expect(
      refreshToTenant("support", "/portal/raas/dashboard", assign),
    ).resolves.toBe(true);
    expect(assign).toHaveBeenCalledWith("/portal/support/dashboard");
  });

  it("does not navigate to a malformed tenant slug", async () => {
    const fetchMock = vi.fn();
    const assign = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      refreshToTenant("../support", "/portal/raas/runs", assign),
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});
