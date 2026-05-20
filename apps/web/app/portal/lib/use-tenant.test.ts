/**
 * useTenant — happy-path coverage. We can't realistically run React hooks
 * here without a renderer; instead we test the pure helpers exported from
 * `./use-tenant` directly. Wider e2e coverage is in the Playwright suite
 * (P2-FE-26 follow-up, P4-TEST-04).
 */
import { describe, expect, it } from "vitest";
import {
  resolveTenantParam,
  rewriteTenantInPath,
  DEFAULT_TENANT,
} from "./use-tenant";

describe("resolveTenantParam", () => {
  it("returns the raw param when it's a non-empty string", () => {
    expect(resolveTenantParam("support")).toBe("support");
  });

  it("falls back to the default when the param is undefined", () => {
    expect(resolveTenantParam(undefined)).toBe(DEFAULT_TENANT);
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
    expect(
      rewriteTenantInPath("/portal/raas/runs/run-abc", "support"),
    ).toBe("/portal/support/runs/run-abc");
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
