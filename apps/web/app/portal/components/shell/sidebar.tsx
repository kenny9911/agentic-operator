"use client";

/**
 * Sidebar — fixed-width left rail (232px). v1_1 app.jsx:108-164.
 *
 * Top to bottom: Logo + version, TenantSwitcher, 3 nav groups (Run / Observe
 * / Manage), footer status dots (Inngest + SQLite).
 *
 * Live + count pills are derived from data the views already fetch:
 *   - Agents nav count: `RaasData.agents.length` (snapshot)
 *   - Runs nav liveCount: TanStack-Query `useRuns` filtered to running
 *   - Tasks nav count: `useTasks().length`
 *
 * The host layout passes in the resolved tenant list so we don't refetch.
 */

import { useMemo } from "react";
import { useTenant } from "../../lib/use-tenant";
import { useRaasData } from "@/lib/hooks/data-context";
import { useRuns } from "@/lib/hooks/useRuns";
import { useTasks } from "@/lib/hooks/useTasks";
import { StatusDot } from "../atoms";
import { Logo } from "./logo";
import { NavGroup, NavItem } from "./nav";
import { TenantSwitcher, type TenantOption } from "./tenant-switcher";

export interface SidebarProps {
  tenants: TenantOption[];
  version?: string;
}

export function Sidebar({ tenants, version = "v0.6.2" }: SidebarProps) {
  const tenantSlug = useTenant();
  const base = `/portal/${tenantSlug}`;
  const data = useRaasData();
  const { data: runs = [] } = useRuns({ limit: 200 });
  const { data: tasks = [] } = useTasks();

  const runningCount = useMemo(
    () => runs.filter((r) => r.status === "running").length,
    [runs],
  );

  return (
    <aside
      style={{
        background: "var(--bg-2)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        gridArea: "side",
      }}
    >
      {/* Logo block */}
      <div
        style={{
          padding: "16px 18px 14px 18px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <Logo />
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
            {version}
          </span>
        </div>
      </div>

      <TenantSwitcher tenants={tenants} />

      <nav style={{ padding: "10px 8px", flex: 1, overflow: "auto" }}>
        <NavGroup label="Run">
          <NavItem
            href={`${base}/dashboard`}
            icon="dashboard"
            label="Dashboard"
          />
          <NavItem
            href={`${base}/workflows`}
            icon="workflow"
            label="Workflows"
          />
          <NavItem
            href={`${base}/agents`}
            icon="agent"
            label="Agents"
            count={data.agents.length || null}
            matchPrefix
          />
          <NavItem
            href={`${base}/runs`}
            icon="run"
            label="Runs"
            liveCount={runningCount}
            matchPrefix
          />
        </NavGroup>
        <NavGroup label="Observe">
          <NavItem
            href={`${base}/events`}
            icon="event"
            label="Events"
            matchPrefix
          />
          <NavItem
            href={`${base}/tasks`}
            icon="task"
            label="Human tasks"
            count={tasks.length || null}
            highlight={tasks.length > 0}
            matchPrefix
          />
          <NavItem href={`${base}/logs`} icon="logs" label="Logs" />
        </NavGroup>
        <NavGroup label="Manage">
          <NavItem
            href={`${base}/deployments`}
            icon="deploy"
            label="Deployments"
          />
          <NavItem
            href={`${base}/tenants`}
            icon="agent"
            label="Tenants"
            matchPrefix
          />
          <NavItem
            href={`${base}/settings`}
            icon="settings"
            label="Settings"
            matchPrefix
          />
        </NavGroup>
      </nav>

      <footer
        style={{
          padding: "12px 16px",
          borderTop: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <FooterRow status="ok" label="Inngest" meta="3w · 0 lag" />
        <FooterRow status="ok" label="SQLite" meta="8.4 MB" />
      </footer>
    </aside>
  );
}

function FooterRow({
  status,
  label,
  meta,
}: {
  status: "ok" | "failed";
  label: string;
  meta: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        minWidth: 0,
      }}
    >
      <StatusDot status={status} size={6} />
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
        {label}
      </span>
      <span
        style={{
          color: "var(--text-3)",
          fontFamily: "var(--mono)",
          whiteSpace: "nowrap",
          fontSize: 10,
        }}
      >
        {meta}
      </span>
    </div>
  );
}
