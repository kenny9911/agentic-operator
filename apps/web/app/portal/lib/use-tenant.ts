"use client";

/**
 * useTenant (P2-FE-25) — extract the active tenant slug from the URL.
 *
 * The portal is routed at /portal/[tenant]/<view>; this hook is the canonical
 * way to read that param. Falls back to `raas` when the route isn't mounted
 * under a tenant segment (e.g. top-level not-found / loading boundary).
 *
 * Use `useTenantNavigate` to push a new tenant while keeping the rest of the
 * path intact — used by the TenantSwitcher dropdown.
 */

import { useParams, usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import { useDirty } from "./dirty-context";

const DEFAULT_TENANT = "raas";

/**
 * Pure helper exposed for unit tests: given the raw `tenant` URL param
 * (which Next.js may surface as `string`, `string[]`, or `undefined`),
 * return a stable string. Falls back to `raas` when the route isn't
 * mounted under a tenant segment.
 */
export function resolveTenantParam(
  raw: string | string[] | undefined,
): string {
  if (!raw) return DEFAULT_TENANT;
  return Array.isArray(raw) ? (raw[0] ?? DEFAULT_TENANT) : raw;
}

/**
 * Pure helper: rewrite the tenant segment in a portal path. Used by
 * `useTenantNavigate` to swap tenant without losing the rest of the URL.
 */
export function rewriteTenantInPath(
  pathname: string,
  nextTenant: string,
): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "portal" && parts.length >= 2) {
    parts[1] = nextTenant;
  } else {
    parts.splice(0, parts.length, "portal", nextTenant);
  }
  return "/" + parts.join("/");
}

export function useTenant(): string {
  const params = useParams<{ tenant?: string | string[] }>();
  if (!params) return DEFAULT_TENANT;
  return resolveTenantParam(params.tenant);
}

export function useTenantNavigate(): (nextTenant: string) => void {
  const router = useRouter();
  const pathname = usePathname() ?? "/portal";
  const dirty = useDirty();
  return useCallback(
    (nextTenant: string) => {
      // UC-V11-15: when an editor has unsaved changes, require explicit
      // confirmation before tearing down the tenant scope (which discards
      // every in-flight draft because the URL drives the data context).
      if (dirty.isDirty()) {
        const detail = dirty.describe();
        const ok =
          typeof window !== "undefined" &&
          window.confirm(
            `You have unsaved changes${detail ? ` (${detail})` : ""}. Switch tenants anyway? Your draft will be lost.`,
          );
        if (!ok) return;
      }
      router.push(rewriteTenantInPath(pathname, nextTenant) as never);
    },
    [pathname, router, dirty],
  );
}

export { DEFAULT_TENANT };
