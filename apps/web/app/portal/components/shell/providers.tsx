"use client";

/**
 * PortalProviders — client-only context wrappers.
 *
 * Splits the QueryClient + DirtyProvider out of the server-component
 * layout so React 19 can keep the page tree async-first. Clients are retained
 * per Tenant/Domain pair so revisiting a scope can reuse fresh data without
 * exposing another scope's legacy, unscoped query keys.
 *
 * Note: the SPA bootstrap-snapshot `DataProvider` (formerly wrapping
 * children here) is gone as of 2026-05-26 — every view consumes canonical
 * TanStack Query hooks (`useAgents`, `useDag`, `useEvents`, …) directly.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { QueryClientProvider } from "@tanstack/react-query";
import { PortalQueryCache } from "@/lib/portal-query-cache";
import { DirtyProvider } from "../../lib/dirty-context";
import { PreferencesProvider } from "../../lib/preferences-context";

export { portalScopeKey as portalTenantScope } from "@/lib/portal-scope";
import { portalScopeKey } from "@/lib/portal-scope";

export function PortalProviders({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const tenantScope = portalScopeKey(pathname);
  const [cache] = useState(() => new PortalQueryCache());
  const client = cache.get(tenantScope);
  const mounted = useRef(false);

  useEffect(() => cache.activate(tenantScope), [cache, tenantScope]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // StrictMode replays effects on mount. Keep server-hydrated data through
      // that replay, but cancel requests and erase caches on a real unmount.
      queueMicrotask(() => { if (!mounted.current) cache.clear(); });
    };
  }, [cache]);

  return (
    <PreferencesProvider>
      {/* Query observers bind to their client at mount. Remount only when the
          Tenant/Domain changes, never for ordinary page navigation within it. */}
      <QueryClientProvider key={tenantScope} client={client}>
        <DirtyProvider>{children}</DirtyProvider>
      </QueryClientProvider>
    </PreferencesProvider>
  );
}
