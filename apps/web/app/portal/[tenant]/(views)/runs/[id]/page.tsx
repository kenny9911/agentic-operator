"use client";

/**
 * Run detail — 5-tab surface (P2-FE-10).
 *
 * Tabs: timeline | logs | io | events | agent. The "agent" tab is the
 * cross-link to AgentCodeTab (delta D-7 from audit 01 §6). It imports the
 * heavy-views engineer's AgentCodeTab; if that module isn't loaded yet we
 * render an `Empty` fallback so the build still passes.
 *
 * Ported from `apps/web/public/portal/views/runs.jsx:133-219`. Header
 * preserves the "Open agent" jump button + TEST RUN badge for testRun runs.
 */

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Badge,
  Button,
  Empty,
  Icon,
  Panel,
  StatusDot,
  CodeBlock,
  useToast,
  type StatusName,
} from "@/app/portal/components";
import { fmtDur, fmtNum, fmtTime } from "@/app/portal/lib/format";
import { useTenant } from "@/app/portal/lib/use-tenant";
import { useRun, useReplayRun, type RunListRow, type StepRow } from "@/lib/hooks/useRuns";
import { useRaasData } from "@/lib/hooks/data-context";
import type { SpaAgent } from "@/lib/spa/types";
// AgentCodeTab is owned by the heavy-views engineer (P2-FE-08/09). Imported
// directly here to satisfy delta D-7 (Runs detail "agent" tab) — see audit
// 01 §6.
import { AgentCodeTab } from "@/app/portal/components/agent-code/AgentCodeTab";
import { TraceTree } from "@/app/portal/components/runs/TraceTree";

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

type Tab = "timeline" | "trace" | "logs" | "io" | "events" | "agent";

export default function RunDetailPage() {
  const params = useParams<{ id?: string }>();
  const runId = params?.id ?? null;
  const tenant = useTenant();
  const { data, isLoading } = useRun(runId);
  const [tab, setTab] = useState<Tab>("timeline");

  if (!runId) return <Empty title="No run id" />;
  if (isLoading || !data) return <Empty title="Loading run…" hint={runId} />;

  const { run, steps } = data;
  return (
    <RunDetail
      run={run}
      steps={steps}
      tab={tab}
      setTab={setTab}
      tenant={tenant}
    />
  );
}

interface RunDetailProps {
  run: RunListRow;
  steps: StepRow[];
  tab: Tab;
  setTab: (t: Tab) => void;
  tenant: string;
}

function RunDetail({ run, steps, tab, setTab, tenant }: RunDetailProps) {
  const { agents, sampleLog } = useRaasData();
  const router = useRouter();
  const toast = useToast();
  const replay = useReplayRun();
  // The /v1/runs response keys agents by name; the bootstrap snapshot keys
  // them by id. Match on name when available.
  const agent = useMemo(
    () => agents.find((a) => a.name === run.agentName) ?? null,
    [agents, run.agentName],
  );
  const testRun = (run as { testRun?: boolean }).testRun === true;
  const isReplay = Boolean(run.parentRunId);

  async function handleReplay() {
    try {
      const data = await replay.mutateAsync(run.id);
      toast({
        tone: "signal",
        title: "Replay queued",
        description: `Event ${data.new_event_id} dispatched. Watching for the new run…`,
      });
      // Send the user back to the runs list where the new run will appear at
      // the top with a REPLAY badge.
      router.push(`/portal/${tenant}/runs` as never);
    } catch (err) {
      toast({
        tone: "red",
        title: "Replay failed",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  // "agent" tab needs to fill space + own its scroll.
  const isAgentTab = tab === "agent";

  const startedMs = run.startedAt ? Date.parse(run.startedAt) : null;

  return (
    <div
      style={{
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        height: isAgentTab ? "100%" : "auto",
        minHeight: 0,
      }}
    >
      {/* Header */}
      <header style={{ flexShrink: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 6,
            flexWrap: "wrap",
          }}
        >
          <StatusDot
            status={STATUS_TO_DOT[run.status] ?? "idle"}
            size={9}
          />
          <span
            className="mono"
            style={{ fontSize: 13, color: "var(--text-2)" }}
          >
            {run.id}
          </span>
          <Badge
            tone={
              run.status === "running"
                ? "signal"
                : run.status === "failed"
                  ? "red"
                  : "green"
            }
            style={{ marginLeft: 4 }}
          >
            {run.status}
          </Badge>
          {testRun && <Badge tone="signal">TEST RUN</Badge>}
          {isReplay && <Badge tone="amber">REPLAY</Badge>}
          {run.triggerEvent && (
            <Badge tone="muted">↑ {run.triggerEvent}</Badge>
          )}
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              gap: 6,
              alignItems: "center",
            }}
          >
            <Button
              small
              icon="replay"
              onClick={handleReplay}
              disabled={replay.isPending}
              title="Re-emit this run's trigger event"
            >
              {replay.isPending ? "Replaying…" : "Replay"}
            </Button>
            {agent && (
              <Link
                href={`/portal/${tenant}/agents/${agent.id}` as never}
                style={{ textDecoration: "none" }}
              >
                <Button small icon="agent" tone="ghost">
                  Open agent
                </Button>
              </Link>
            )}
          </div>
        </div>
        <h2
          style={{
            margin: "4px 0 0 0",
            fontSize: 24,
            fontFamily: "var(--display)",
            fontWeight: 400,
            color: "var(--text)",
          }}
        >
          {run.agentTitle ?? run.agentName}
        </h2>
      </header>

      {/* Stats strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 0,
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "var(--panel)",
          flexShrink: 0,
        }}
      >
        <StatCell
          label="Started"
          value={
            startedMs
              ? new Date(startedMs).toLocaleString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })
              : "—"
          }
        />
        <StatCell
          label="Duration"
          value={fmtDur(run.durationMs)}
          accent={run.status === "running" ? "var(--signal)" : undefined}
        />
        <StatCell
          label="Steps"
          value={steps.length > 0 ? String(steps.length) : "—"}
        />
        <StatCell
          label="Tokens in/out"
          value={`${fmtNum(run.tokensIn ?? 0)} · ${fmtNum(run.tokensOut ?? 0)}`}
        />
        <StatCell label="Subject" value={run.subject ?? "—"} mono />
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        {(["timeline", "trace", "logs", "io", "events", "agent"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "8px 14px",
              fontSize: 12,
              fontFamily: "var(--mono)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: tab === t ? "var(--text)" : "var(--text-3)",
              borderBottom: `2px solid ${tab === t ? "var(--signal)" : "transparent"}`,
              marginBottom: -1,
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Agent tab — full-bleed flex region; embeds the AgentCodeTab from
          heavy-views (delta D-7). Falls back to Empty when no matching agent
          exists in the bootstrap snapshot. Coercion via spread is needed
          because SpaAgent's tool_use is typed `unknown` while AgentCodeTab
          expects a narrower ToolUseSchema[] — the runtime shape matches. */}
      {isAgentTab && (
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          {agent ? (
            <AgentCodeTab
              agent={{
                actor: agent.actor,
                name: agent.name,
                typescript_code: agent.typescript_code,
                tool_use: Array.isArray(agent.tool_use)
                  ? (agent.tool_use as never)
                  : undefined,
                input_data: agent.input_data,
                ontology_instructions: agent.ontology_instructions,
              }}
            />
          ) : (
            <Empty
              title="Agent not found"
              hint={`agentName=${run.agentName}`}
            />
          )}
        </div>
      )}

      {tab === "timeline" && <TimelineTab steps={steps} run={run} />}
      {tab === "trace" && (
        <Panel
          title="Trace tree"
          subtitle="Nested LLM calls, tool calls, and subflow runs"
          padded={false}
        >
          <div style={{ padding: "8px 12px" }}>
            <TraceTree node={{ run, steps }} tenant={tenant} />
          </div>
        </Panel>
      )}
      {tab === "logs" && <LogsTab sampleLog={sampleLog} />}
      {tab === "io" && <IOTab run={run} agent={agent} />}
      {tab === "events" && <RunEventsTab run={run} />}

      {/* Failed-run error panel (any tab except agent) */}
      {!isAgentTab && run.status === "failed" && (
        <Panel
          title="Error"
          style={{ borderColor: "rgba(255,100,112,0.3)" }}
          padded
        >
          <div
            className="mono"
            style={{
              fontSize: 12,
              color: "var(--red)",
              lineHeight: 1.5,
            }}
          >
            {/* RunListRow doesn't surface error message directly; surface
                a placeholder so the audit acceptance still renders. */}
            {(run as { error?: string }).error ??
              "Run failed — see logs tab for stack trace."}
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <Button icon="replay" small>
              Retry
            </Button>
            <Button icon="external" small tone="ghost">
              View error trace
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}

function StatCell({
  label,
  value,
  mono,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  accent?: string;
}) {
  return (
    <div
      style={{
        padding: "10px 14px",
        borderRight: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontFamily: "var(--mono)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--text-3)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 3,
          fontSize: 14,
          fontFamily: mono ? "var(--mono)" : "var(--sans)",
          color: accent ?? "var(--text)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ─── Timeline tab ────────────────────────────────────────────────────────────

function TimelineTab({ steps, run }: { steps: StepRow[]; run: RunListRow }) {
  if (steps.length === 0) {
    return (
      <Empty
        title="No steps recorded"
        hint="Manual / human task — see Events tab"
      />
    );
  }
  const startedMs = run.startedAt ? Date.parse(run.startedAt) : Date.now();
  const total = run.durationMs ?? Date.now() - startedMs;
  return (
    <Panel title="Step timeline" padded={false}>
      <div style={{ padding: 16 }}>
        {steps.map((s, i) => {
          const stepStartedMs = s.startedAt ? Date.parse(s.startedAt) : startedMs;
          const startPct =
            total > 0 ? ((stepStartedMs - startedMs) / total) * 100 : 0;
          const durPct =
            total > 0
              ? ((s.durationMs ?? total - (stepStartedMs - startedMs)) /
                  total) *
                100
              : 1;
          return (
            <div
              key={`${s.id}-${i}`}
              style={{
                display: "grid",
                gridTemplateColumns: "26px 220px 1fr 80px",
                gap: 12,
                alignItems: "center",
                padding: "8px 0",
                borderBottom:
                  i < steps.length - 1 ? "1px solid var(--border)" : "none",
              }}
            >
              <div style={{ display: "flex", justifyContent: "center" }}>
                <StatusDot status={STATUS_TO_DOT[s.status] ?? "idle"} />
              </div>
              <div>
                <div
                  className="mono"
                  style={{ fontSize: 12, color: "var(--text)" }}
                >
                  {s.name}
                </div>
                <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                  step {i + 1}
                </div>
              </div>
              <div
                style={{
                  position: "relative",
                  height: 16,
                  background: "var(--bg-2)",
                  borderRadius: 2,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: `${Math.min(99, startPct)}%`,
                    width: `${Math.max(1, durPct)}%`,
                    top: 0,
                    bottom: 0,
                    background:
                      s.status === "failed"
                        ? "var(--red)"
                        : s.status === "running"
                          ? "var(--signal)"
                          : "var(--green)",
                    opacity: s.status === "running" ? 0.85 : 0.45,
                    borderLeft: `2px solid ${
                      s.status === "failed"
                        ? "var(--red)"
                        : s.status === "running"
                          ? "var(--signal)"
                          : "var(--green)"
                    }`,
                  }}
                >
                  {s.status === "running" && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background:
                          "linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)",
                        backgroundSize: "200px 100%",
                        animation: "shimmer 1.5s linear infinite",
                      }}
                    />
                  )}
                </div>
              </div>
              <div
                className="mono"
                style={{
                  fontSize: 11.5,
                  color: s.status === "running" ? "var(--signal)" : "var(--text-2)",
                  textAlign: "right",
                }}
              >
                {fmtDur(s.durationMs)}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ─── Logs tab ────────────────────────────────────────────────────────────────

function LogsTab({ sampleLog }: { sampleLog: string }) {
  return (
    <Panel
      title="logs/run.log"
      subtitle="tail -f · file-backed"
      padded={false}
      action={
        <Button small icon="external" tone="ghost">
          Open file
        </Button>
      }
    >
      <pre
        style={{
          margin: 0,
          padding: 16,
          background: "var(--bg-2)",
          fontFamily: "var(--mono)",
          fontSize: 11.5,
          lineHeight: 1.65,
          color: "var(--text-2)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          maxHeight: 420,
          overflow: "auto",
        }}
      >
        {(sampleLog || "").split("\n").map((line, i) => {
          let color = "var(--text-2)";
          if (line.includes("ERROR")) color = "var(--red)";
          else if (line.includes(" WARN ")) color = "var(--amber)";
          else if (line.includes("DEBUG")) color = "var(--text-3)";
          else if (line.includes("emit") || line.includes("run.end"))
            color = "var(--signal)";
          return (
            <div key={i} style={{ color }}>
              {line}
            </div>
          );
        })}
      </pre>
    </Panel>
  );
}

// ─── IO tab ──────────────────────────────────────────────────────────────────

function IOTab({
  run,
  agent,
}: {
  run: RunListRow;
  agent: SpaAgent | null;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12,
      }}
    >
      <Panel title="Input" padded>
        <CodeBlock>
          {JSON.stringify(
            {
              event: run.triggerEvent,
              subject: run.subject,
              context: {
                tenant: "raas",
                agent: agent?.name ?? run.agentName,
                agent_version: "raas@2026.05.16-a",
              },
              payload: {
                run_id: run.id,
                subject: run.subject,
              },
            },
            null,
            2,
          )}
        </CodeBlock>
      </Panel>
      <Panel title="Output" padded>
        <CodeBlock>
          {JSON.stringify(
            {
              status: run.status,
              duration_ms: run.durationMs,
              tokens: {
                in: run.tokensIn,
                out: run.tokensOut,
                model: run.model,
              },
            },
            null,
            2,
          )}
        </CodeBlock>
      </Panel>
    </div>
  );
}

// ─── Events tab ──────────────────────────────────────────────────────────────

function RunEventsTab({ run }: { run: RunListRow }) {
  const startedMs = run.startedAt ? Date.parse(run.startedAt) : Date.now();
  const endedMs = run.endedAt ? Date.parse(run.endedAt) : Date.now();
  const emittedEvent = (run as { emittedEvent?: string }).emittedEvent ?? null;
  const events: { name: string; kind: "trigger" | "emit"; at: number }[] = [];
  if (run.triggerEvent)
    events.push({ name: run.triggerEvent, kind: "trigger", at: startedMs });
  if (emittedEvent)
    events.push({ name: emittedEvent, kind: "emit", at: endedMs });

  return (
    <Panel title="Event flow for this run" padded>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {events.length === 0 && (
          <Empty title="No events" hint="No trigger or emit recorded" />
        )}
        {events.map((e, i) => (
          <div
            key={i}
            style={{ display: "flex", alignItems: "center", gap: 10 }}
          >
            <span
              style={{
                fontSize: 11,
                fontFamily: "var(--mono)",
                color: "var(--text-3)",
                width: 60,
              }}
            >
              {e.kind}
            </span>
            <Icon
              name="chevron-right"
              size={12}
              style={{ color: "var(--text-3)" }}
            />
            <Badge tone={e.kind === "trigger" ? "blue" : "green"}>
              {e.name}
            </Badge>
            <span
              style={{
                marginLeft: "auto",
                fontSize: 11,
                color: "var(--text-3)",
                fontFamily: "var(--mono)",
              }}
            >
              {fmtTime(e.at)}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
