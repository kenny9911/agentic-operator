"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { ReactNode } from "react";
import { Icon, StatusDot, type IconName } from "@/components";
import { TENANTS, type Tenant } from "@/lib/tenants";

export interface SidebarProps {
  activeTenantId: string;
  agentCount: number;
  liveRunCount: number;
  taskCount: number;
}

export function Sidebar({
  activeTenantId,
  agentCount,
  liveRunCount,
  taskCount,
}: SidebarProps) {
  const tenant =
    TENANTS.find((t) => t.id === activeTenantId) ?? TENANTS[0]!;

  return (
    <aside
      style={{
        background: "var(--bg-2)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Logo + title */}
      <div
        style={{
          padding: "16px 18px 14px 18px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <LogoSvg />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            lineHeight: 1.15,
            minWidth: 0,
            flex: 1,
          }}
        >
          <span
            style={{
              fontSize: 13,
              color: "var(--text)",
              fontWeight: 600,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            Agentic Operator
          </span>
          <span
            style={{
              fontSize: 10,
              color: "var(--text-3)",
              fontFamily: "var(--mono)",
              letterSpacing: "0.06em",
              marginTop: 2,
            }}
          >
            v0.1.0
          </span>
        </div>
      </div>

      <TenantSwitcher activeTenant={tenant} />

      {/* Nav */}
      <nav style={{ padding: "10px 8px", flex: 1, overflow: "auto" }}>
        <NavGroup label="Run">
          <NavItem href="/" icon="dashboard" label="Dashboard" />
          <NavItem href="/workflows" icon="workflow" label="Workflows" />
          <NavItem
            href="/agents"
            icon="agent"
            label="Agents"
            count={agentCount}
          />
          <NavItem
            href="/runs"
            icon="run"
            label="Runs"
            liveCount={liveRunCount}
          />
        </NavGroup>

        <NavGroup label="Observe">
          <NavItem href="/events" icon="event" label="Events" />
          <NavItem
            href="/tasks"
            icon="task"
            label="Human tasks"
            count={taskCount}
            highlight
          />
          <NavItem href="/logs" icon="logs" label="Logs" />
        </NavGroup>

        <NavGroup label="Manage">
          <NavItem
            href="/deployments"
            icon="deploy"
            label="Deployments"
          />
          <NavItem
            href="/settings"
            icon="settings"
            label="Settings"
          />
        </NavGroup>
      </nav>

      {/* Footer — runtime status */}
      <footer
        style={{
          padding: "12px 16px",
          borderTop: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            minWidth: 0,
          }}
        >
          <StatusDot status="ok" size={6} />
          <span
            style={{
              color: "var(--text-2)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
              flex: 1,
            }}
          >
            Inngest
          </span>
          <span
            style={{
              color: "var(--text-3)",
              fontFamily: "var(--mono)",
              whiteSpace: "nowrap",
              fontSize: 10,
            }}
          >
            dev
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            minWidth: 0,
          }}
        >
          <StatusDot status="ok" size={6} />
          <span
            style={{
              color: "var(--text-2)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
              flex: 1,
            }}
          >
            SQLite
          </span>
          <span
            style={{
              color: "var(--text-3)",
              fontFamily: "var(--mono)",
              whiteSpace: "nowrap",
              fontSize: 10,
            }}
          >
            local
          </span>
        </div>
      </footer>
    </aside>
  );
}

function LogoSvg() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24">
      <rect x="2" y="2" width="20" height="20" rx="5" fill="var(--signal)" />
      <g transform="translate(5,5)">
        <circle cx="3" cy="3" r="1.5" fill="#000" />
        <circle cx="11" cy="3" r="1.5" fill="#000" />
        <circle cx="3" cy="11" r="1.5" fill="#000" />
        <circle cx="11" cy="11" r="1.5" fill="#000" />
        <path
          d="M3 3 L11 3 M3 3 L3 11 M11 3 L11 11 M3 11 L11 11 M3 3 L11 11"
          stroke="#000"
          strokeWidth={1.2}
          fill="none"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

function NavGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          padding: "6px 10px 4px 10px",
          fontSize: 10,
          fontFamily: "var(--mono)",
          textTransform: "uppercase",
          color: "var(--text-3)",
          letterSpacing: "0.12em",
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {children}
      </div>
    </div>
  );
}

function NavItem({
  href,
  icon,
  label,
  count,
  liveCount,
  highlight,
  disabled,
}: {
  href: string;
  icon: IconName;
  label: string;
  count?: number;
  liveCount?: number;
  highlight?: boolean;
  disabled?: boolean;
}) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
  const [hov, setHov] = useState(false);

  const inner = (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "6px 10px",
        background: active
          ? "var(--panel-2)"
          : hov && !disabled
            ? "var(--panel)"
            : "transparent",
        borderLeft: active
          ? "2px solid var(--signal)"
          : "2px solid transparent",
        color: disabled
          ? "var(--text-4)"
          : active
            ? "var(--text)"
            : "var(--text-2)",
        fontSize: 12.5,
        textAlign: "left",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 0.1s",
      }}
    >
      <Icon
        name={icon}
        size={13}
        style={{ color: active ? "var(--text)" : "var(--text-3)" }}
      />
      <span style={{ flex: 1 }}>{label}</span>
      {liveCount != null && liveCount > 0 && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 10.5,
            fontFamily: "var(--mono)",
            color: "var(--signal)",
          }}
        >
          <span className="live-dot" style={{ width: 5, height: 5 }} />
          {liveCount}
        </span>
      )}
      {count != null && (
        <span
          style={{
            fontSize: 10,
            fontFamily: "var(--mono)",
            padding: "1px 6px",
            background: highlight
              ? "rgba(255,181,71,0.12)"
              : "var(--panel-2)",
            color: highlight ? "var(--amber)" : "var(--text-3)",
            borderRadius: 8,
            border: highlight
              ? "1px solid rgba(255,181,71,0.3)"
              : "1px solid var(--border)",
          }}
        >
          {count}
        </span>
      )}
    </div>
  );

  if (disabled) {
    return <div aria-disabled="true">{inner}</div>;
  }
  return (
    <Link href={href} style={{ textDecoration: "none" }}>
      {inner}
    </Link>
  );
}

function TenantSwitcher({ activeTenant }: { activeTenant: Tenant }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  async function pick(slug: string) {
    setOpen(false);
    try {
      await fetch("/api/prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant: slug }),
      });
      router.refresh();
    } catch {
      // surface silently in dev; in production attach a toast
    }
  }

  return (
    <div
      style={{
        padding: "10px 12px",
        borderBottom: "1px solid var(--border)",
        position: "relative",
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: "8px 10px",
          background: "var(--panel)",
          border: "1px solid var(--border-2)",
          borderRadius: 5,
          textAlign: "left",
        }}
      >
        <div
          style={{
            width: 22,
            height: 22,
            background: activeTenant.color,
            borderRadius: 3,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontFamily: "var(--mono)",
            color: "#000",
            fontWeight: 700,
          }}
        >
          {activeTenant.name[0]}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 12,
              color: "var(--text)",
              fontWeight: 500,
            }}
          >
            {activeTenant.name}
          </div>
          <div
            style={{
              fontSize: 10.5,
              color: "var(--text-3)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {activeTenant.subtitle}
          </div>
        </div>
        <Icon
          name="chevron-down"
          size={11}
          style={{ color: "var(--text-3)" }}
        />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 12,
            right: 12,
            zIndex: 50,
            marginTop: 4,
            background: "var(--panel)",
            border: "1px solid var(--border-2)",
            borderRadius: 5,
            boxShadow: "0 8px 20px rgba(0,0,0,0.4)",
            overflow: "hidden",
          }}
        >
          {TENANTS.map((t) => (
            <button
              key={t.id}
              onClick={() => pick(t.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                padding: "8px 10px",
                background:
                  activeTenant.id === t.id ? "var(--panel-2)" : "transparent",
                textAlign: "left",
                fontSize: 12,
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div
                style={{
                  width: 18,
                  height: 18,
                  background: t.color,
                  borderRadius: 3,
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ color: "var(--text)" }}>{t.name}</div>
                <div style={{ fontSize: 10, color: "var(--text-3)" }}>
                  {t.agentCount} agents · {t.runs24h} runs/24h
                </div>
              </div>
              {activeTenant.id === t.id && (
                <Icon
                  name="check"
                  size={12}
                  style={{ color: "var(--signal)" }}
                />
              )}
            </button>
          ))}
          <button
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "8px 10px",
              fontSize: 12,
              color: "var(--text-2)",
            }}
          >
            <Icon name="plus" size={11} /> New tenant
          </button>
        </div>
      )}
    </div>
  );
}
