"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Icon, Kbd } from "@/components";

export interface TopBarProps {
  initialLiveStream: boolean;
}

const ROUTE_LABELS: Record<string, string> = {
  "/": "Dashboard",
  "/workflows": "Workflows",
  "/agents": "Agents",
  "/runs": "Runs",
  "/events": "Events",
  "/tasks": "Human tasks",
  "/logs": "Logs",
  "/deployments": "Deployments",
  "/settings": "Settings",
};

export function TopBar({ initialLiveStream }: TopBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [liveStream, setLiveStream] = useState(initialLiveStream);

  async function toggleLive() {
    const next = !liveStream;
    setLiveStream(next);
    try {
      await fetch("/api/prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ liveStream: next }),
      });
      router.refresh();
    } catch {
      // dev-mode: silent failure
    }
  }

  // Crumb derivation: base route + optional segment-id (e.g. /runs/run-01000)
  const segments = pathname.split("/").filter(Boolean);
  const baseRoute = segments.length === 0 ? "/" : "/" + segments[0];
  const baseLabel =
    ROUTE_LABELS[baseRoute] ?? capitalize(segments[0] ?? "");
  const trailingId = segments[1];

  return (
    <div
      style={{
        height: 44,
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        padding: "0 18px",
        gap: 14,
        background: "var(--bg)",
        flexShrink: 0,
      }}
    >
      {/* Breadcrumb */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12,
          color: "var(--text-3)",
        }}
      >
        {trailingId ? (
          <>
            <span style={{ color: "var(--text-2)" }}>{baseLabel}</span>
            <Icon
              name="chevron-right"
              size={10}
              style={{ color: "var(--text-4)" }}
            />
            <span
              style={{ color: "var(--text)" }}
              className={/^(run|TASK|REQ|CAN|evt|agt|dpl)-/.test(trailingId) ? "mono" : ""}
            >
              {trailingId}
            </span>
          </>
        ) : (
          <span style={{ color: "var(--text-2)" }}>{baseLabel}</span>
        )}
      </div>

      {/* ⌘K search */}
      <button
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 9px",
          background: "var(--panel)",
          border: "1px solid var(--border-2)",
          borderRadius: 5,
          fontSize: 11.5,
          color: "var(--text-3)",
          minWidth: 240,
        }}
      >
        <Icon name="search" size={11} />
        <span>Jump to agent, event, run…</span>
        <span style={{ marginLeft: "auto" }}>
          <Kbd>⌘</Kbd> <Kbd>K</Kbd>
        </span>
      </button>

      {/* Live / Paused toggle */}
      <button
        onClick={toggleLive}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 10px",
          background: liveStream ? "rgba(208,255,0,0.08)" : "transparent",
          border: `1px solid ${
            liveStream ? "rgba(208,255,0,0.3)" : "var(--border-2)"
          }`,
          borderRadius: 5,
          fontSize: 11.5,
          fontFamily: "var(--mono)",
          letterSpacing: "0.04em",
          color: liveStream ? "var(--signal)" : "var(--text-3)",
        }}
      >
        <Icon name={liveStream ? "pause" : "play"} size={10} />
        {liveStream ? "LIVE" : "PAUSED"}
      </button>

      {/* User chip — replaced with real session in M10 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "var(--violet)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            color: "#000",
            fontWeight: 600,
          }}
        >
          OP
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-2)" }}>Operator</div>
      </div>
    </div>
  );
}

function capitalize(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}
