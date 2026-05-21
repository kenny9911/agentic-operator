"use client";

/**
 * Dashboard — control plane overview (P2-FE-07).
 *
 * Ported from `apps/web/public/portal/views/dashboard.jsx` with Phase 0/1
 * deltas preserved:
 *   - useRaasData() context replaces window.RAAS_* (D-9 → P1-FE-03)
 *   - testRun TEST badge in Active runs table (D-8)
 *   - Live ticker advances on 1.5s clock when liveStream is on
 *
 * Layout matches v1_1 dashboard.jsx:60-141:
 *   - 5 KPI cards
 *   - Active runs + Agent activity (1.4fr column)
 *   - Event stream + Pending tasks + Runtime (1fr column)
 *   - Stage funnel (full-width below)
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ActorTag,
  Badge,
  Button,
  Empty,
  Panel,
  Sparkline,
  StatusDot,
  ViewHeader,
  eventTone,
  Th,
  Td,
  type StatusName,
} from "@/app/portal/components";
import {
  fmtAgo,
  fmtDur,
  fmtNum,
  fmtTime,
} from "@/app/portal/lib/format";
import { useTenant } from "@/app/portal/lib/use-tenant";
import { useRaasData } from "@/lib/hooks/data-context";
import type { SpaAgent } from "@/lib/spa/types";
import { useRuns, type RunListRow } from "@/lib/hooks/useRuns";
import { useHealth, fmtBytes } from "@/lib/hooks/useHealth";

/** Narrowed view of an event-stream item (the context types it loosely). */
interface EventItem {
  id: string;
  name: string;
  color: string;
  category: string;
  at: number;
  source: string;
  sourceTitle: string;
  subject: string;
}

/** Narrowed view of a task row (the context types it loosely). */
interface TaskItem {
  id: string;
  title: string;
  priority: string;
  status: string;
  createdAt: number | null;
  awaitingFrom: string | null;
  agentId?: string;
  type: string;
}

function asEventItem(e: Record<string, unknown>): EventItem {
  return {
    id: String(e.id ?? ""),
    name: String(e.name ?? ""),
    color: String(e.color ?? "muted"),
    category: String(e.category ?? "agent"),
    at: typeof e.at === "number" ? e.at : 0,
    source: String(e.source ?? "external"),
    sourceTitle: String(e.sourceTitle ?? "External"),
    subject: String(e.subject ?? ""),
  };
}

function asTaskItem(t: Record<string, unknown>): TaskItem {
  return {
    id: String(t.id ?? ""),
    title: String(t.title ?? ""),
    priority: String(t.priority ?? "med"),
    status: String(t.status ?? "open"),
    createdAt: typeof t.createdAt === "number" ? t.createdAt : null,
    awaitingFrom:
      typeof t.awaitingFrom === "string" ? t.awaitingFrom : null,
    agentId: typeof t.agentId === "string" ? t.agentId : undefined,
    type: String(t.type ?? ""),
  };
}

/** v1_1 supports running/ok/failed/waiting/paused/idle. API status → dot. */
const STATUS_TO_DOT: Record<string, StatusName> = {
  running: "running",
  queued: "waiting",
  waiting: "waiting",
  ok: "ok",
  failed: "failed",
  cancelled: "paused",
  paused: "paused",
  idle: "idle",
};

// ─── Page (live tick state + liveStream wiring) ──────────────────────────────

export default function DashboardPage() {
  const { agents, stages, tasks, eventStream } = useRaasData();
  const events = useMemo(
    () => eventStream.map((e) => asEventItem(e as Record<string, unknown>)),
    [eventStream],
  );
  const taskItems = useMemo(
    () => tasks.map((t) => asTaskItem(t as Record<string, unknown>)),
    [tasks],
  );

  // Live run data over TanStack Query — invalidated by useStream SSE.
  const { data: liveRuns = [] } = useRuns({ limit: 200 });

  // Live-stream toggle proxy — Phase 2 will wire this through Tweaks panel.
  // Falls back to true (matching the v1_1 default) until the toggle exists.
  const [liveStream] = useState(true);

  return (
    <DashboardView
      agents={agents}
      stages={stages}
      tasks={taskItems}
      eventStream={events}
      liveRuns={liveRuns}
      liveStream={liveStream}
    />
  );
}

interface DashboardViewProps {
  agents: SpaAgent[];
  stages: { id: number; label: string }[];
  tasks: TaskItem[];
  eventStream: EventItem[];
  liveRuns: RunListRow[];
  liveStream: boolean;
}

function DashboardView({
  agents,
  stages,
  tasks,
  eventStream,
  liveRuns,
  liveStream,
}: DashboardViewProps) {
  const tenant = useTenant();

  // Live runs (from /v1/runs) override the snapshot from /api/spa/bootstrap —
  // they auto-invalidate on every SSE event.
  const active = liveRuns.filter((r) => r.status === "running");
  const failed24 = liveRuns.filter((r) => r.status === "failed").length;
  const ok24 = liveRuns.filter((r) => r.status === "ok").length;
  const total24 = liveRuns.length;

  // Throughput sparkline — events / min over last 60 min from the bootstrap
  // snapshot (events are refreshed via context on testAgent push).
  const buckets = useMemo(() => {
    const now = Date.now();
    const bs = new Array(60).fill(0);
    eventStream.forEach((e) => {
      const ago = Math.floor((now - e.at) / 60_000);
      if (ago >= 0 && ago < 60) bs[59 - ago]++;
    });
    return bs;
  }, [eventStream]);

  // Token usage sparkline — sum tokens across runs per 24h bucket.
  const tokSpark = useMemo(() => {
    const arr = new Array(24).fill(0);
    liveRuns.forEach((r, i) => {
      arr[i % 24] += (r.tokensIn || 0) + (r.tokensOut || 0);
    });
    return arr;
  }, [liveRuns]);

  // Per-agent activity over the last hour.
  const agentActivity = useMemo(() => {
    interface Bucket {
      agent: SpaAgent;
      runs: number;
      errors: number;
      lastRun: number;
    }
    const m = new Map<string, Bucket>();
    agents.forEach((a) =>
      m.set(a.name, { agent: a, runs: 0, errors: 0, lastRun: 0 }),
    );
    liveRuns.forEach((r) => {
      const e = m.get(r.agentName);
      if (!e) return;
      e.runs++;
      if (r.status === "failed") e.errors++;
      const t = r.startedAt ? Date.parse(r.startedAt) : 0;
      if (t > e.lastRun) e.lastRun = t;
    });
    return Array.from(m.values()).sort((a, b) => b.runs - a.runs);
  }, [agents, liveRuns]);

  // Live ticker state — advances every 1.5s when liveStream is on.
  const [tickerIdx, setTickerIdx] = useState(0);
  useEffect(() => {
    if (!liveStream || eventStream.length === 0) return;
    const id = setInterval(
      () => setTickerIdx((i) => (i + 1) % eventStream.length),
      1500,
    );
    return () => clearInterval(id);
  }, [liveStream, eventStream.length]);

  const recentEvents = useMemo(() => {
    const slice = eventStream.slice(tickerIdx, tickerIdx + 14);
    if (slice.length < 14) {
      slice.push(...eventStream.slice(0, 14 - slice.length));
    }
    return slice;
  }, [eventStream, tickerIdx]);

  const tokensTotal = useMemo(
    () =>
      liveRuns.reduce(
        (sum, r) => sum + (r.tokensIn ?? 0) + (r.tokensOut ?? 0),
        0,
      ),
    [liveRuns],
  );
  const tokensEstCost = (tokensTotal / 1000) * 0.01;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ViewHeader
        title="Dashboard"
        subtitle="Live state of the RAAS workload. All agent runs, events, and queues across the active tenant."
        badge={
          <Badge tone="signal">
            <span className="live-dot" style={{ width: 5, height: 5 }} /> LIVE
          </Badge>
        }
        action={
          <>
            <Button icon="deploy" small>
              Deploy
            </Button>
            <Button icon="replay" small>
              Replay window
            </Button>
          </>
        }
      />

      <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
        {/* Top KPI row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <KPICard
            label="Active runs"
            value={active.length}
            sub={`${ok24}/${total24} ok past hour`}
            tone="up"
            accent="var(--signal)"
            spark={buckets.slice(40)}
          />
          <KPICard
            label="Events / hr"
            value={fmtNum(eventStream.length)}
            sub="+12% vs 24h avg"
            tone="up"
            spark={buckets}
          />
          <KPICard
            label="Errors / hr"
            value={failed24}
            sub={
              failed24 > 0 && total24 > 0
                ? `${((failed24 / total24) * 100).toFixed(1)}% failure rate`
                : "all green"
            }
            tone={failed24 > 4 ? "down" : "up"}
            accent={failed24 > 4 ? "var(--red)" : "var(--green)"}
          />
          <KPICard
            label="Pending tasks"
            value={tasks.length}
            sub={`${tasks.filter((t) => t.priority === "high").length} high priority`}
            accent="var(--amber)"
          />
          <KPICard
            label="Tokens / hr"
            value={fmtNum(tokensTotal)}
            sub={`≈ $${tokensEstCost.toFixed(2)}`}
            spark={tokSpark}
          />
        </div>

        {/* Main grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 1fr",
            gap: 12,
          }}
        >
          {/* LEFT */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Panel
              title="Active runs"
              subtitle={`${active.length} running`}
              action={
                <Link
                  href={`/portal/${tenant}/runs` as never}
                  style={{ textDecoration: "none" }}
                >
                  <Button small icon="external" tone="ghost">
                    View all
                  </Button>
                </Link>
              }
              padded={false}
            >
              <RunTable rows={active} tenant={tenant} />
            </Panel>

            <Panel
              title="Agent activity · past hour"
              action={
                <Link
                  href={`/portal/${tenant}/agents` as never}
                  style={{ textDecoration: "none" }}
                >
                  <Button small icon="external" tone="ghost">
                    All agents
                  </Button>
                </Link>
              }
              padded={false}
            >
              <AgentActivityGrid items={agentActivity} tenant={tenant} />
            </Panel>
          </div>

          {/* RIGHT */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Panel
              title="Event stream"
              subtitle={liveStream ? "auto-updating" : "paused"}
              action={
                <Link
                  href={`/portal/${tenant}/events` as never}
                  style={{ textDecoration: "none" }}
                >
                  <Button small icon="external" tone="ghost">
                    Open
                  </Button>
                </Link>
              }
              padded={false}
              style={{ minHeight: 320 }}
            >
              <EventTicker events={recentEvents} live={liveStream} />
            </Panel>

            <Panel
              title="Awaiting humans"
              subtitle={`${tasks.length} tasks`}
              action={
                <Link
                  href={`/portal/${tenant}/tasks` as never}
                  style={{ textDecoration: "none" }}
                >
                  <Button small icon="external" tone="ghost">
                    Inbox
                  </Button>
                </Link>
              }
              padded={false}
            >
              <PendingTasksList tasks={tasks.slice(0, 5)} tenant={tenant} />
            </Panel>

            <Panel title="Runtime" padded>
              <SystemHealth />
            </Panel>
          </div>
        </div>

        {/* Bottom: stage funnel */}
        <div style={{ marginTop: 12 }}>
          <Panel title="RAAS funnel · last 24h" padded>
            <StageFunnel stages={stages} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ─── KPI card ────────────────────────────────────────────────────────────────

function KPICard({
  label,
  value,
  sub,
  tone,
  accent,
  spark,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "up" | "down";
  accent?: string;
  spark?: number[];
}) {
  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontFamily: "var(--mono)",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: "var(--text-3)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginTop: 6,
        }}
      >
        <div
          style={{
            fontSize: 26,
            fontFamily: "var(--mono)",
            fontWeight: 500,
            letterSpacing: "-0.01em",
            color: accent || "var(--text)",
          }}
        >
          {value}
        </div>
        {spark && spark.length > 0 && (
          <Sparkline
            values={spark}
            width={70}
            height={26}
            color={accent || "var(--signal)"}
          />
        )}
      </div>
      {sub && (
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            color:
              tone === "down"
                ? "var(--red)"
                : tone === "up"
                  ? "var(--text-2)"
                  : "var(--text-3)",
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

// ─── Active runs table ───────────────────────────────────────────────────────

function RunTable({ rows, tenant }: { rows: RunListRow[]; tenant: string }) {
  if (rows.length === 0)
    return <Empty title="No active runs" hint="Quiet — system idle" />;
  return (
    <div style={{ maxHeight: 280, overflow: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 12.5,
          tableLayout: "fixed",
        }}
      >
        <colgroup>
          <col style={{ width: 28 }} />
          <col style={{ width: 110 }} />
          <col />
          <col style={{ width: 88 }} />
          <col style={{ width: 150 }} />
          <col style={{ width: 60 }} />
        </colgroup>
        <thead>
          <tr
            style={{
              position: "sticky",
              top: 0,
              background: "var(--panel)",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <Th />
            <Th>Run</Th>
            <Th>Agent</Th>
            <Th>Subject</Th>
            <Th>Step</Th>
            <Th style={{ textAlign: "right" }}>Dur</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <RunTableRow key={r.id} row={r} tenant={tenant} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunTableRow({ row, tenant }: { row: RunListRow; tenant: string }) {
  // Detect a TEST run — RunListRow doesn't surface testRun yet (Phase 2
  // backend wiring lands in Cleanup); falling back to the SPA snapshot row.
  const testRun = (row as { testRun?: boolean }).testRun === true;
  return (
    <tr
      style={{
        borderBottom: "1px solid var(--border)",
      }}
    >
      <Td>
        <StatusDot status={STATUS_TO_DOT[row.status] ?? "idle"} />
      </Td>
      <Td>
        <Link
          href={`/portal/${tenant}/runs/${row.id}` as never}
          style={{ textDecoration: "none" }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <span
              className="mono"
              style={{ color: "var(--text-2)", whiteSpace: "nowrap" }}
            >
              {row.id}
            </span>
            {testRun && (
              <Badge tone="signal" style={{ fontSize: 9 }}>
                TEST
              </Badge>
            )}
          </span>
        </Link>
      </Td>
      <Td
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ color: "var(--text)" }}>
          {row.agentTitle ?? row.agentName}
        </span>
      </Td>
      <Td>
        <span
          className="mono"
          style={{ color: "var(--text-2)", whiteSpace: "nowrap" }}
        >
          {row.subject ?? "—"}
        </span>
      </Td>
      <Td style={{ overflow: "hidden" }}>
        {row.currentStepName && row.stepCount ? (
          <span
            style={{
              fontSize: 11.5,
              display: "flex",
              gap: 4,
              alignItems: "baseline",
              overflow: "hidden",
            }}
          >
            <span
              className="mono"
              style={{
                color: "var(--signal)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
              }}
            >
              {row.currentStepName}
            </span>
            <span
              style={{
                color: "var(--text-3)",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {(row.currentStepOrd ?? "?") + "/" + row.stepCount}
            </span>
          </span>
        ) : (
          <span style={{ color: "var(--text-3)" }}>—</span>
        )}
      </Td>
      <Td style={{ textAlign: "right" }}>
        <span
          className="mono"
          style={{ color: "var(--signal)", whiteSpace: "nowrap" }}
        >
          {fmtDur(row.durationMs)}
        </span>
      </Td>
    </tr>
  );
}

// ─── Agent activity ──────────────────────────────────────────────────────────

interface AgentActivity {
  agent: SpaAgent;
  runs: number;
  errors: number;
  lastRun: number;
}

function AgentActivityGrid({
  items,
  tenant,
}: {
  items: AgentActivity[];
  tenant: string;
}) {
  if (items.length === 0)
    return <Empty title="No agent activity" hint="—" />;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 1,
        background: "var(--border)",
      }}
    >
      {items.map(({ agent, runs, errors, lastRun }) => {
        const intensity = Math.min(1, runs / 20);
        return (
          <Link
            key={agent.id}
            href={`/portal/${tenant}/agents/${agent.id}` as never}
            style={{
              padding: "10px 12px",
              background: "var(--panel)",
              textAlign: "left",
              position: "relative",
              display: "block",
              minHeight: 78,
              textDecoration: "none",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: 2,
                background:
                  errors > 0
                    ? "var(--red)"
                    : `rgba(208,255,0,${0.15 + intensity * 0.6})`,
              }}
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 4,
              }}
            >
              <ActorTag actor={agent.actor} />
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 11,
                  fontFamily: "var(--mono)",
                  color: errors > 0 ? "var(--red)" : "var(--text)",
                }}
              >
                {runs}
              </span>
            </div>
            <div
              style={{
                fontSize: 12.5,
                color: "var(--text)",
                fontWeight: 500,
                marginBottom: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {agent.title}
            </div>
            <div
              style={{
                fontSize: 10.5,
                fontFamily: "var(--mono)",
                color: "var(--text-3)",
              }}
            >
              {lastRun > 0 ? fmtAgo(lastRun) : "idle"}
              {errors > 0 && (
                <span style={{ color: "var(--red)", marginLeft: 8 }}>
                  {errors} err
                </span>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// ─── Event ticker ────────────────────────────────────────────────────────────

function EventTicker({
  events,
  live,
}: {
  events: EventItem[];
  live: boolean;
}) {
  return (
    <div style={{ maxHeight: 380, overflow: "auto" }}>
      {events.map((e, i) => (
        <div
          key={e.id + ":" + i}
          style={{
            display: "grid",
            gridTemplateColumns: "62px 1fr auto",
            gap: 10,
            alignItems: "center",
            padding: "8px 14px",
            borderBottom: "1px solid var(--border)",
            fontSize: 12,
            animation: i === 0 && live ? "tick 0.4s ease-out" : "none",
          }}
        >
          <span
            className="mono"
            style={{ color: "var(--text-3)", fontSize: 10.5 }}
          >
            {fmtTime(e.at)}
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              minWidth: 0,
            }}
          >
            <Badge tone={eventTone(e.color)} style={{ fontSize: 9.5 }}>
              {e.name}
            </Badge>
            <span style={{ color: "var(--text-3)", fontSize: 11 }}>·</span>
            <span
              style={{
                color: "var(--text-2)",
                fontSize: 11,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {e.sourceTitle}
            </span>
          </div>
          <span
            className="mono"
            style={{ color: "var(--text-3)", fontSize: 10.5 }}
          >
            {e.subject}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Pending tasks ───────────────────────────────────────────────────────────

function PendingTasksList({
  tasks,
  tenant,
}: {
  tasks: TaskItem[];
  tenant: string;
}) {
  if (tasks.length === 0)
    return <Empty title="All clear" hint="No pending tasks" />;
  return (
    <div>
      {tasks.map((t) => (
        <Link
          key={t.id}
          href={`/portal/${tenant}/tasks?id=${encodeURIComponent(t.id)}` as never}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            padding: "10px 14px",
            borderBottom: "1px solid var(--border)",
            textDecoration: "none",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 4,
            }}
          >
            <Badge
              tone={
                t.priority === "high"
                  ? "amber"
                  : t.priority === "med"
                    ? "blue"
                    : "muted"
              }
              style={{ fontSize: 9.5 }}
            >
              {t.priority.toUpperCase()}
            </Badge>
            <span
              style={{
                fontSize: 11,
                color: "var(--text-3)",
                fontFamily: "var(--mono)",
              }}
            >
              {t.id}
            </span>
            <span
              style={{
                marginLeft: "auto",
                fontSize: 11,
                color: "var(--text-3)",
              }}
            >
              {t.createdAt ? fmtAgo(t.createdAt) : "—"}
            </span>
          </div>
          <div
            style={{
              fontSize: 12.5,
              color: "var(--text)",
              marginBottom: 2,
            }}
          >
            {t.title}
          </div>
          {t.awaitingFrom ? (
            <div style={{ fontSize: 11, color: "var(--text-3)" }}>
              awaiting · {t.awaitingFrom}
            </div>
          ) : null}
        </Link>
      ))}
    </div>
  );
}

// ─── System health ───────────────────────────────────────────────────────────

function SystemHealth() {
  // FE-P0-4 sub-fix 4b: wired to `/health` (apps/api/src/routes/health.ts)
  // via `useHealth()`. The endpoint exposes three sub-components — inngest,
  // sqlite, disk — and polls every 15s. When the api is unreachable we
  // render fallback rows tagged "fail · unreachable" so the operator still
  // sees a panel rather than a blank.
  const { data: health, isError } = useHealth();
  const items: Array<{
    label: string;
    status: "ok" | "warn" | "fail";
    note: string;
  }> = [];
  if (health) {
    items.push({
      label: "Inngest worker",
      status: health.inngest.ok ? "ok" : "fail",
      note:
        health.inngest.note ??
        (health.inngest.reachable === false
          ? "unreachable"
          : health.inngest.ok
            ? "reachable"
            : "degraded"),
    });
    items.push({
      label: "SQLite",
      status: health.sqlite.ok ? "ok" : "fail",
      note: health.sqlite.ok
        ? `${fmtBytes(health.sqlite.sizeBytes)} · ${health.sqlite.journalMode ?? "—"}`
        : "unreachable",
    });
    items.push({
      label: "Log volume",
      status: health.disk.ok ? "ok" : "fail",
      note: health.disk.ok
        ? `${fmtBytes(health.disk.freeBytes)} free · ${health.disk.logsDir ?? ""}`
        : "stat failed",
    });
  } else if (isError) {
    items.push({
      label: "Inngest worker",
      status: "fail",
      note: "api unreachable",
    });
    items.push({ label: "SQLite", status: "fail", note: "api unreachable" });
    items.push({ label: "Log volume", status: "fail", note: "api unreachable" });
  } else {
    items.push({ label: "Inngest worker", status: "ok", note: "checking…" });
    items.push({ label: "SQLite", status: "ok", note: "checking…" });
    items.push({ label: "Log volume", status: "ok", note: "checking…" });
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((i) => (
        <div
          key={i.label}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 12,
          }}
        >
          <StatusDot
            status={
              i.status === "ok"
                ? "ok"
                : i.status === "warn"
                  ? "waiting"
                  : "failed"
            }
          />
          <span style={{ color: "var(--text)" }}>{i.label}</span>
          <span
            style={{
              marginLeft: "auto",
              color: "var(--text-3)",
              fontSize: 11,
              fontFamily: "var(--mono)",
            }}
          >
            {i.note}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Stage funnel ────────────────────────────────────────────────────────────

function StageFunnel({ stages }: { stages: { id: number; label: string }[] }) {
  // FE-P0-4 sub-fix 4a: removed hardcoded `[1842, 1731, …]` magic numbers.
  // Render 0 per stage until the forthcoming /v1/funnel endpoint ships.
  // `useRaasData()` does not currently expose funnel counts (see
  // lib/hooks/data-context.tsx — RaasData has no `funnel` field).
  const counts = stages.map(() => 0);
  const max = 1;
  if (stages.length === 0) {
    return <Empty title="No stages defined" hint="Workflow not yet loaded" />;
  }
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${stages.length}, 1fr)`,
        gap: 8,
      }}
    >
      {stages.map((s, i) => {
        const c = counts[i] ?? 0;
        const pct = c / max;
        const prior = counts[i - 1];
        const drop =
          i > 0 && prior != null && prior > 0
            ? (((prior - c) / prior) * 100).toFixed(1)
            : null;
        return (
          <div
            key={s.id}
            style={{ display: "flex", flexDirection: "column", gap: 6 }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
              }}
            >
              <span
                style={{
                  fontSize: 10.5,
                  fontFamily: "var(--mono)",
                  textTransform: "uppercase",
                  color: "var(--text-3)",
                  letterSpacing: "0.06em",
                }}
              >
                {s.label}
              </span>
              {drop && (
                <span
                  style={{
                    fontSize: 9.5,
                    fontFamily: "var(--mono)",
                    color: "var(--text-3)",
                  }}
                >
                  −{drop}%
                </span>
              )}
            </div>
            <div
              style={{
                height: 6,
                background: "var(--panel-2)",
                borderRadius: 1,
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${pct * 100}%`,
                  background:
                    "linear-gradient(90deg, var(--signal) 0%, var(--signal) 70%, rgba(208,255,0,0.5) 100%)",
                  opacity: 0.3 + pct * 0.7,
                }}
              />
            </div>
            <div
              style={{
                fontSize: 16,
                fontFamily: "var(--mono)",
                color: "var(--text)",
              }}
            >
              {fmtNum(c)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
