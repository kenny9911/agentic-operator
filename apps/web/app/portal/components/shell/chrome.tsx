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
 * Tenants list is the same display fixture used by the legacy SPA, in
 * `apps/web/lib/tenants.ts`. Adding a tenant: drop a `models/<slug>/`
 * folder and an entry there.
 */

import type { ReactNode } from "react";
import { TENANTS } from "@/lib/tenants";
import { useStream } from "@/lib/hooks/useStream";
import { Sidebar } from "./sidebar";
import { TopBar } from "./topbar";
import { TweaksPanel } from "../tweaks/panel";
import { ToastRegion } from "../toast";
import { CommandPalette } from "../cmd-k";
import type { TenantOption } from "./tenant-switcher";

export function PortalChrome({
  children,
  user,
}: {
  children: ReactNode;
  user: { name: string; initials: string };
}) {
  // useStream owns the SSE subscription that invalidates the TanStack Query
  // caches; mount it once at the chrome level so every view inherits live
  // updates without re-subscribing.
  useStream();

  const tenants: TenantOption[] = TENANTS.map((t) => ({
    id: t.id,
    name: t.name,
    subtitle: t.subtitle,
    color: t.color,
    agentCount: t.agentCount,
    runs24h: t.runs24h,
  }));

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "232px 1fr",
        gridTemplateAreas: '"side main"',
        height: "100vh",
        background: "var(--bg)",
        overflow: "hidden",
      }}
    >
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
        <TopBar user={user} />
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
      <TweaksPanel tenants={tenants.map((t) => ({ id: t.id, name: t.name }))} />
      <ToastRegion />
      <CommandPalette />
    </div>
  );
}
