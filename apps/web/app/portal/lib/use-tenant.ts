"use client";

/**
 * useTenant (P2-FE-25) — extract the active tenant slug from the URL.
 *
 * The portal is routed at /portal/[tenant]/<view>; this hook is the canonical
 * way to read that param. It returns an empty string when the route isn't
 * mounted under a tenant segment rather than guessing a tenant.
 *
 * Use `useTenantNavigate` to push a new tenant while keeping the rest of the
 * path intact — used by the TenantSwitcher dropdown.
 */

import { useParams, usePathname } from "next/navigation";
import { useCallback } from "react";
import { isTenantSlug } from "@/lib/tenant-preference";
import { useDirty } from "./dirty-context";

const DEFAULT_TENANT = "";

/**
 * Pure helper exposed for unit tests: given the raw `tenant` URL param
 * (which Next.js may surface as `string`, `string[]`, or `undefined`),
 * return a stable string. An empty string means there is no tenant segment;
 * callers must not silently substitute a real tenant.
 */
export function resolveTenantParam(raw: string | string[] | undefined): string {
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

let tenantPersistenceTail: Promise<void> = Promise.resolve();
export const TENANT_SYNC_STORAGE_KEY = "agentic.active-tenant";

export interface PersistTenantOptions {
  /** Notify other tabs after the signed tenant session has been updated. */
  broadcast?: boolean;
}

/** Persist a tenant as both the last-opened preference and session scope. */
export function persistTenantSelection(
  nextTenant: string,
  options: PersistTenantOptions = {},
): Promise<void> {
  if (!isTenantSlug(nextTenant)) {
    return Promise.reject(new TypeError(`Invalid tenant slug: ${nextTenant}`));
  }
  // Serialize overlapping writes within a tab so an earlier request cannot
  // finish after a later selection and restore the wrong session scope.
  const operation = tenantPersistenceTail
    .catch(() => undefined)
    .then(async () => {
      const response = await fetch("/api/prefs", {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant: nextTenant }),
      });
      if (!response.ok) {
        throw new Error(`Unable to remember tenant ${nextTenant}`);
      }
      if (options.broadcast && typeof window !== "undefined") {
        // Cross-tab coordination is helpful but must never turn a successful
        // server-side session rotation into a failed switch. Browsers may
        // disable localStorage or throw on quota/security policies.
        try {
          window.localStorage.setItem(
            TENANT_SYNC_STORAGE_KEY,
            JSON.stringify({ tenant: nextTenant, at: Date.now() }),
          );
        } catch {
          // The current tab still completes its hard navigation below.
        }
      }
    });
  tenantPersistenceTail = operation;
  return operation;
}

/**
 * Persist the selected tenant, then perform a full document navigation. A
 * hard navigation intentionally replaces every tenant-scoped React state and
 * TanStack Query cache entry before the new screen is shown.
 */
export async function refreshToTenant(
  nextTenant: string,
  pathname: string,
  assign: (destination: string) => void = (destination) =>
    window.location.assign(destination),
): Promise<boolean> {
  if (!isTenantSlug(nextTenant)) return false;
  const destination = rewriteTenantInPath(pathname, nextTenant);
  try {
    await persistTenantSelection(nextTenant, { broadcast: true });
  } catch {
    // Do not put the URL and signed production session into different tenant
    // scopes. The caller stays on the current screen and may retry.
    return false;
  }
  assign(destination);
  return true;
}

export function useTenantNavigate(): (nextTenant: string) => Promise<boolean> {
  const pathname = usePathname() ?? "/portal";
  const dirty = useDirty();
  return useCallback(
    async (nextTenant: string) => {
      if (!isTenantSlug(nextTenant)) return false;
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
        if (!ok) return false;
      }
      return refreshToTenant(nextTenant, pathname);
    },
    [pathname, dirty],
  );
}

export { DEFAULT_TENANT };
