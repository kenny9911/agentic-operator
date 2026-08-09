"use client";

/**
 * PortalChrome — grid frame around every portal view.
 *
 * Mirrors v1_1 app.jsx:42-105 (232px sidebar + 1fr main; main has a 44px
 * TopBar then a scroll container). Globally mounts:
 *   - Tweaks panel       (P2-FE-16)
 *   - Toast region       (P2-FE-22)
 *   - Cmd-K palette host (P2-FE-23)
 *   - useStream SSE hook (Phase 1)
 *
 * Tenants list is fetched live via `useTenants()` (TanStack Query against
 * `GET /v1/tenants`). 2026-05-26 product rule: production mode = ZERO mock
 * data. If `/v1/tenants` errors we render an inline banner instead of
 * falling back to a static fixture — the previous fallback masked an
 * api-down state by pretending RAAS / SupportFlow / FinanceClose existed
 * when they didn't.
 */

import type { ReactNode } from "react";
import { useCallback, useEffect } from "react";
import type { RunStreamEvent } from "@agentic/contracts";
import { useStream } from "@/lib/hooks/useStream";
import { useTenants } from "@/lib/hooks/useTenants";
import { tenantHeader } from "@/lib/hooks/tenant-header";
import { Sidebar } from "./sidebar";
import { TopBar } from "./topbar";
import { TweaksPanel } from "../tweaks/panel";
import { ToastRegion, toast } from "../toast";
import { CommandPalette } from "../cmd-k";
import type { TenantOption } from "./tenant-switcher";
import { SessionProvider, type SessionUser } from "../../lib/session-context";
import {
  persistTenantSelection,
  rewriteTenantInPath,
  TENANT_SYNC_STORAGE_KEY,
  useTenant,
} from "../../lib/use-tenant";
import { isTenantSlug } from "@/lib/tenant-preference";
import styles from "./sidebar.module.css";

export function PortalChrome({
  children,
  user,
}: {
  children: ReactNode;
  user: SessionUser;
}) {
  const activeTenant = useTenant();

  // The bare `/portal` index owns its server-side redirect. Do not turn the
  // intentionally absent dynamic segment into a client-side redirect loop.
  if (!activeTenant) return <>{children}</>;
  if (!isTenantSlug(activeTenant)) {
    return <InvalidTenantRoute />;
  }
  if (user.tenant !== activeTenant) {
    return (
      <TenantSessionGate
        activeTenant={activeTenant}
        sessionTenant={user.tenant}
      />
    );
  }
  return (
    <ActivePortalChrome activeTenant={activeTenant} user={user}>
      {children}
    </ActivePortalChrome>
  );
}

/**
 * Withhold every tenant-bound query and stream until the signed production
 * session matches the URL. This gate also runs during the client component's
 * server render, so a direct `/portal/B` load cannot paint tenant A's data.
 */
function TenantSessionGate({
  activeTenant,
  sessionTenant,
}: {
  activeTenant: string;
  sessionTenant: string;
}) {
  useEffect(() => {
    let cancelled = false;
    void persistTenantSelection(activeTenant, { broadcast: true })
      .then(() => {
        if (!cancelled) window.location.reload();
      })
      .catch(async () => {
        // Do not let a stale/deleted remembered tenant win every future bare
        // `/portal` redirect. The signed session remains the safe fallback.
        try {
          await fetch("/api/prefs", {
            method: "DELETE",
            credentials: "same-origin",
          });
        } catch {
          // Recovery navigation below is still preferable when offline.
        }
        if (!cancelled && isTenantSlug(sessionTenant)) {
          window.location.replace(
            rewriteTenantInPath(window.location.pathname, sessionTenant),
          );
        } else if (!cancelled) {
          window.location.replace("/sign-in?return=/portal");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeTenant, sessionTenant]);

  return <TenantTransitionStatus message="Opening tenant…" />;
}

function InvalidTenantRoute() {
  useEffect(() => {
    window.location.replace("/portal");
  }, []);
  return <TenantTransitionStatus message="Finding your tenant…" />;
}

function TenantTransitionStatus({ message }: { message: string }) {
  return (
    <div
      role="status"
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "var(--bg)",
        color: "var(--text-2)",
        fontSize: 13,
      }}
    >
      {message}
    </div>
  );
}

function ActivePortalChrome({
  children,
  user,
  activeTenant,
}: {
  children: ReactNode;
  user: SessionUser;
  activeTenant: string;
}) {
  // If a once-valid remembered tenant is later archived or access is revoked,
  // clear the unusable browser state and require a fresh sign-in instead of
  // leaving the operator trapped behind repeated tenant-scoped 401s/404s.
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    void fetch(`/v1/tenants/${encodeURIComponent(activeTenant)}/access`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: tenantHeader(activeTenant),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.ok || ![401, 403, 404].includes(response.status)) return;
        await Promise.allSettled([
          fetch("/api/prefs", {
            method: "DELETE",
            credentials: "same-origin",
          }),
          fetch("/api/auth/logout", {
            method: "POST",
            credentials: "same-origin",
          }),
        ]);
        if (!cancelled) {
          window.location.replace("/sign-in?return=/portal");
        }
      })
      .catch(() => {
        // Network failures are handled by the existing API-unreachable UI.
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeTenant]);

  // The production session cookie is browser-wide. When one tab switches,
  // move every other portal tab to the same URL tenant immediately so no tab
  // remains labelled A while authenticating requests as B.
  useEffect(() => {
    function followTenantSwitch(event: StorageEvent) {
      if (event.key !== TENANT_SYNC_STORAGE_KEY || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue) as { tenant?: unknown };
        if (!isTenantSlug(parsed.tenant) || parsed.tenant === activeTenant) {
          return;
        }
        window.location.assign(
          rewriteTenantInPath(window.location.pathname, parsed.tenant),
        );
      } catch {
        // Ignore malformed localStorage written by extensions or old builds.
      }
    }
    window.addEventListener("storage", followTenantSwitch);
    return () => window.removeEventListener("storage", followTenantSwitch);
  }, [activeTenant]);

  // UC-V11-06 — when the SSE stream surfaces a `deployment.created` event
  // for tenant code, fire a hot-reload toast so engineers see their CLI
  // deploy land without a manual refresh. Manifest deploys already get an
  // explicit "Manifest deployed" toast at save time, so we only fire here
  // for `kind: 'tenant_code'`.
  const onStreamEvent = useCallback((event: RunStreamEvent) => {
    if (event.type === "deployment.created" && event.kind === "tenant_code") {
      toast({
        tone: "signal",
        title: `Tenant code ${event.version} active`,
        description: event.workflowSlug
          ? `Hot-reloaded for ${event.workflowSlug}`
          : "Hot-reloaded",
      });
    }
  }, []);

  // useStream owns the SSE subscription that invalidates the TanStack Query
  // caches; mount it once at the chrome level so every view inherits live
  // updates without re-subscribing.
  useStream({ onEvent: onStreamEvent });

  // Live tenant list. No static fallback — when /v1/tenants errors we
  // surface a banner so the operator knows the api is unreachable rather
  // than seeing a misleading switcher full of stale entries.
  const tenantsQuery = useTenants();
  const liveItems = tenantsQuery.data?.items;
  const tenants: TenantOption[] = liveItems
    ? liveItems
        .filter((t) => t.archivedAt == null)
        .map((t) => ({
          id: t.slug,
          name: t.name,
          subtitle: t.subtitle ?? undefined,
          color: t.color ?? "#d0ff00",
          agentCount: t.agentCount,
          runs24h: t.runs24h,
        }))
    : [];

  const apiUnreachable =
    tenantsQuery.isError || (!tenantsQuery.isLoading && !tenantsQuery.data);

  return (
    <SessionProvider value={user}>
      <div className={styles.shell}>
        {/* P2-FE-24 — skip-link is the first focusable element so keyboard
         * users can jump past the sidebar straight to the view body.
         * Styled in tokens.css `.skip-link`. */}
        <a href="#portal-view-content" className="skip-link">
          Skip to content
        </a>
        <Sidebar tenants={tenants} />
        <main
          style={{
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            minWidth: 0,
            gridArea: "main",
          }}
        >
          <TopBar user={{ name: user.name, initials: user.initials }} />
          {apiUnreachable ? <ApiUnreachableBanner /> : null}
          <div
            id="portal-view-content"
            tabIndex={-1}
            style={{
              flex: 1,
              overflow: "hidden",
              minHeight: 0,
              position: "relative",
            }}
          >
            {children}
          </div>
        </main>
        <TweaksPanel
          tenants={tenants.map((t) => ({ id: t.id, name: t.name }))}
        />
        <ToastRegion />
        <CommandPalette />
      </div>
    </SessionProvider>
  );
}

/**
 * Inline banner shown when `/v1/tenants` is unreachable. Single source of
 * truth for the "api down" error UX in the portal shell.
 */
function ApiUnreachableBanner() {
  return (
    <div
      role="alert"
      style={{
        background: "rgba(239, 68, 68, 0.12)",
        borderBottom: "1px solid rgba(239, 68, 68, 0.35)",
        color: "var(--text)",
        padding: "8px 16px",
        fontSize: 12,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "rgb(239, 68, 68)",
          flexShrink: 0,
        }}
        aria-hidden
      />
      <span>
        Cannot reach api on{" "}
        <code style={{ fontFamily: "var(--mono)" }}>:3501</code>
        {" — check that `pnpm dev` is running. The portal will keep retrying."}
      </span>
    </div>
  );
}
