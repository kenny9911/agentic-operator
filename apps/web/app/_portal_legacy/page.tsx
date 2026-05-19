import {
  Badge,
  Empty,
  Panel,
  Sparkline,
  StatusDot,
  ViewHeader,
  ActorTag,
  Button,
  type StatusName,
} from "@/components";
import { fmtAgo, fmtDur, fmtNum, fmtTime } from "@/lib/format";
import {
  agents as agentsApi,
  counts as countsApi,
  events as eventsApi,
  runs as runsApi,
  tasks as tasksApi,
} from "@/lib/api-client";
import type {
  EventRow,
  ListAgentRow,
  RunRow,
  TaskRow,
} from "@agentic/contracts";
import Link from "next/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const STATUS_TO_DOT: Record<string, StatusName> = {
  running: "running",
  queued: "waiting",
  waiting: "waiting",
  ok: "ok",
  failed: "failed",
  cancelled: "paused",
};

const HOUR_MS = 60 * 60 * 1000;

export default async function DashboardPage() {
  const [counts, allRuns, allEvents, allTasks, allAgents] = await Promise.all([
    countsApi(),
    runsApi.list({ limit: 200 }),
    eventsApi.list({ limit: 200 }),
    tasksApi.list(),
    agentsApi.list(),
  ]);

  const active = allRuns.filter((r) => r.status === "running");
  const failed24 = allRuns.filter(
    (r) =>
      r.status === "failed" &&
      r.startedAt &&
      r.startedAt.getTime() >= Date.now() - 24 * HOUR_MS,
  ).length;
  const ok24 = counts.okRuns24h;
  const totalRecent = ok24 + failed24;

  // events/min over last 60 min (the throughput sparkline)
  const now = Date.now();
  const buckets = new Array(60).fill(0);
  for (const e of allEvents) {
    if (!e.receivedAt) continue;
    const ago = Math.floor((now - e.receivedAt.getTime()) / 60_000);
    if (ago >= 0 && ago < 60) buckets[59 - ago]++;
  }

  // token sparkline (24 buckets, sum tokens per "hour bucket")
  const tokSpark = new Array(24).fill(0);
  for (let i = 0; i < allRuns.length; i++) {
    const r = allRuns[i];
    if (!r) continue;
    tokSpark[i % 24] += (r.tokensIn ?? 0) + (r.tokensOut ?? 0);
  }
  const totalTokens =
    allRuns.reduce(
      (sum, r) => sum + (r.tokensIn ?? 0) + (r.tokensOut ?? 0),
      0,
    ) || 0;

  // Open tasks split
  const openTasks = allTasks.filter((t) => t.status === "open");
  const highPriority = openTasks.filter((t) => t.priority === "high").length;

  // Per-agent activity (sort by run count desc, top 16 for 4x4 grid)
  const agentActivity = computeAgentActivity(allAgents, allRuns).slice(0, 16);

  // Live event ticker (top 14)
  const recentEvents = allEvents.slice(0, 14);

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
            sub={`${ok24}/${ok24 + failed24} ok past hour`}
            tone="up"
            accent="var(--signal)"
            spark={buckets.slice(40)}
          />
          <KPICard
            label="Events / hr"
            value={fmtNum(counts.events24h)}
            sub={`+${Math.max(0, allEvents.length - counts.events24h)} since last 24h`}
            tone="up"
            spark={buckets}
          />
          <KPICard
            label="Errors / hr"
            value={failed24}
            sub={
              totalRecent > 0
                ? `${((failed24 / totalRecent) * 100).toFixed(1)}% failure rate`
                : "all green"
            }
            tone={failed24 > 4 ? "down" : "up"}
            accent={failed24 > 4 ? "var(--red)" : "var(--green)"}
          />
          <KPICard
            label="Pending tasks"
            value={openTasks.length}
            sub={`${highPriority} high priority`}
            accent="var(--amber)"
          />
          <KPICard
            label="Tokens / 24h"
            value={fmtNum(totalTokens)}
            sub={`~ $${(totalTokens / 1000 * 0.01).toFixed(2)}`}
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
          {/* LEFT column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Panel
              title="Active runs"
              subtitle={`${active.length} running`}
              action={
                <Link
                  href="/runs"
                  style={{ fontSize: 11, color: "var(--text-3)" }}
                >
                  View all →
                </Link>
              }
              padded={false}
            >
              <RunTable rows={active} />
            </Panel>

            <Panel
              title="Agent activity · past hour"
              action={
                <Link
                  href="/agents"
                  style={{ fontSize: 11, color: "var(--text-3)" }}
                >
                  All agents →
                </Link>
              }
              padded={false}
            >
              <AgentActivityGrid items={agentActivity} />
            </Panel>
          </div>

          {/* RIGHT column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Panel
              title="Event stream"
              subtitle="auto-updating"
              action={
                <Link
                  href="/events"
                  style={{ fontSize: 11, color: "var(--text-3)" }}
                >
                  Open →
                </Link>
              }
              padded={false}
              style={{ minHeight: 320 }}
            >
              <EventTicker events={recentEvents} />
            </Panel>

            <Panel
              title="Awaiting humans"
              subtitle={`${openTasks.length} tasks`}
              action={
                <Link
                  href="/tasks"
                  style={{ fontSize: 11, color: "var(--text-3)" }}
                >
                  Inbox →
                </Link>
              }
              padded={false}
            >
              <PendingTasksList tasks={openTasks.slice(0, 5)} />
            </Panel>

            <Panel title="Runtime" padded>
              <SystemHealth />
            </Panel>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <Panel title="RAAS funnel · last 24h" padded>
            <StageFunnel agents={allAgents} runs={allRuns} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ─── Components ────────────────────────────────────────────────────────────

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

function RunTable({ rows }: { rows: RunRow[] }) {
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
          <col style={{ width: 170 }} />
          <col style={{ width: 70 }} />
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
            <Th></Th>
            <Th>Run</Th>
            <Th>Agent</Th>
            <Th>Subject</Th>
            <Th>Step</Th>
            <Th align="right">Dur</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              style={{
                borderBottom: "1px solid var(--border)",
              }}
            >
              <Td>
                <StatusDot status={STATUS_TO_DOT[r.status] ?? "idle"} />
              </Td>
              <Td>
                <Link
                  href={`/runs/${r.id}`}
                  className="mono"
                  style={{
                    color: "var(--text-2)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.id.slice(0, 14)}
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
                  {r.agentTitle ?? r.agentName}
                </span>
              </Td>
              <Td>
                <span
                  className="mono"
                  style={{ color: "var(--text-2)", whiteSpace: "nowrap" }}
                >
                  {r.subject ?? "—"}
                </span>
              </Td>
              <Td style={{ overflow: "hidden" }}>
                {r.currentStepName && r.stepCount ? (
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
                      {r.currentStepName}
                    </span>
                    <span
                      style={{
                        color: "var(--text-3)",
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      {r.currentStepOrd ?? "?"}/{r.stepCount}
                    </span>
                  </span>
                ) : (
                  <span style={{ color: "var(--text-3)" }}>—</span>
                )}
              </Td>
              <Td align="right">
                <span
                  className="mono"
                  style={{ color: "var(--signal)", whiteSpace: "nowrap" }}
                >
                  {fmtDur(r.durationMs)}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      style={{
        textAlign: align,
        padding: "8px 12px",
        fontSize: 10.5,
        fontFamily: "var(--mono)",
        fontWeight: 500,
        color: "var(--text-3)",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  style,
  align = "left",
}: {
  children?: React.ReactNode;
  style?: React.CSSProperties;
  align?: "left" | "right";
}) {
  return (
    <td
      style={{
        padding: "8px 12px",
        verticalAlign: "middle",
        textAlign: align,
        ...style,
      }}
    >
      {children}
    </td>
  );
}

interface AgentActivity {
  agent: ListAgentRow;
  runs: number;
  errors: number;
  lastRun: number;
}

function computeAgentActivity(
  agents: ListAgentRow[],
  runs: RunRow[],
): AgentActivity[] {
  const m = new Map<string, AgentActivity>();
  for (const a of agents) {
    m.set(a.name, { agent: a, runs: 0, errors: 0, lastRun: 0 });
  }
  for (const r of runs) {
    const e = m.get(r.agentName);
    if (!e) continue;
    e.runs++;
    if (r.status === "failed") e.errors++;
    const t = r.startedAt?.getTime() ?? 0;
    if (t > e.lastRun) e.lastRun = t;
  }
  return Array.from(m.values()).sort((a, b) => b.runs - a.runs);
}

function AgentActivityGrid({ items }: { items: AgentActivity[] }) {
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
            href={`/agents/${agent.kebabId}`}
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
              {agent.title ?? agent.name}
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

function EventTicker({ events }: { events: EventRow[] }) {
  return (
    <div style={{ maxHeight: 380, overflow: "auto" }}>
      {events.map((e, i) => (
        <div
          key={e.id + i}
          style={{
            display: "grid",
            gridTemplateColumns: "62px 1fr auto",
            gap: 10,
            alignItems: "center",
            padding: "8px 14px",
            borderBottom: "1px solid var(--border)",
            fontSize: 12,
          }}
        >
          <span
            className="mono"
            style={{ color: "var(--text-3)", fontSize: 10.5 }}
          >
            {e.receivedAt ? fmtTime(e.receivedAt.getTime()) : "—"}
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              minWidth: 0,
            }}
          >
            <Badge tone={badgeToneForEvent(e.color)} style={{ fontSize: 9.5 }}>
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
              {e.sourceAgentTitle ?? e.sourceAgentName ?? "external"}
            </span>
          </div>
          <span
            className="mono"
            style={{ color: "var(--text-3)", fontSize: 10.5 }}
          >
            {e.subject ?? "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

function badgeToneForEvent(
  color: string | null | undefined,
): "default" | "green" | "blue" | "amber" | "red" | "muted" {
  const map: Record<
    string,
    "default" | "green" | "blue" | "amber" | "red" | "muted"
  > = {
    green: "green",
    blue: "blue",
    amber: "amber",
    red: "red",
    muted: "muted",
  };
  return color ? (map[color] ?? "default") : "default";
}

function PendingTasksList({ tasks }: { tasks: TaskRow[] }) {
  if (tasks.length === 0)
    return <Empty title="All clear" hint="No pending tasks" />;
  return (
    <div>
      {tasks.map((t) => (
        <Link
          key={t.id}
          href={`/tasks/${t.id}`}
          style={{
            display: "block",
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
                  : t.priority === "medium"
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
              {t.createdAt ? fmtAgo(t.createdAt.getTime()) : "—"}
            </span>
          </div>
          <div
            style={{ fontSize: 12.5, color: "var(--text)", marginBottom: 2 }}
          >
            {t.title}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>
            awaiting · {t.awaitingRole ?? "operator"}
          </div>
        </Link>
      ))}
    </div>
  );
}

function SystemHealth() {
  // Pragmatic placeholder values until we wire to /health for live data.
  const items: Array<{
    label: string;
    status: StatusName;
    note: string;
  }> = [
    { label: "Inngest worker", status: "ok", note: "1 worker · 0 lag" },
    { label: "SQLite", status: "ok", note: "WAL · 0 wal" },
    { label: "Log volume", status: "ok", note: "data/logs" },
    { label: "RMS adapter · Tencent", status: "ok", note: "last sync 2m ago" },
    {
      label: "Channel · BOSS Zhipin",
      status: "waiting",
      note: "rate-limited, 3 retries",
    },
    { label: "Channel · Zhilian", status: "ok", note: "240 reqs/hr" },
  ];
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
          <StatusDot status={i.status} />
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

// Stage funnel derived from agent kebab IDs (1-x → stage 1, 2 → stage 2, etc.)
function StageFunnel({
  agents,
  runs,
}: {
  agents: ListAgentRow[];
  runs: RunRow[];
}) {
  // Stage labels from prototype RAAS_STAGES
  const stages = [
    { id: 0, label: "Intake" },
    { id: 1, label: "Analyze" },
    { id: 2, label: "JD" },
    { id: 3, label: "Publish" },
    { id: 4, label: "Resume" },
    { id: 5, label: "Interview" },
    { id: 6, label: "Package" },
    { id: 7, label: "Submit" },
  ];

  // Group agents by stage (kebab prefix maps to stage 0-7 roughly).
  const stageOfAgent = new Map<string, number>();
  for (const a of agents) {
    const m = a.kebabId.match(/^(\d+)/);
    const prefix = m ? parseInt(m[1]!, 10) : 99;
    // map kebab prefix → stage index
    const stage = Math.max(0, Math.min(stages.length - 1, prefix - 1));
    stageOfAgent.set(a.name, stage);
  }

  const counts = new Array(stages.length).fill(0);
  for (const r of runs) {
    const s = stageOfAgent.get(r.agentName);
    if (s !== undefined) counts[s]++;
  }
  const max = Math.max(1, ...counts);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${stages.length}, 1fr)`,
        gap: 8,
      }}
    >
      {stages.map((s, i) => {
        const pct = counts[i] / max;
        const drop =
          i > 0 && counts[i - 1] > 0
            ? (((counts[i - 1] - counts[i]) / counts[i - 1]) * 100).toFixed(1)
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
              {drop && Number(drop) > 0 && (
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
              {fmtNum(counts[i])}
            </div>
          </div>
        );
      })}
    </div>
  );
}
