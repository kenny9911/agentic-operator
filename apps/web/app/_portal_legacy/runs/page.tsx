import {
  Badge,
  Button,
  Empty,
  Panel,
  StatusDot,
  ViewHeader,
  type StatusName,
} from "@/components";
import { fmtAgo, fmtDur, fmtNum, fmtTime } from "@/lib/format";
import { runs as runsApi } from "@/lib/api-client";
import type { RunRow } from "@agentic/contracts";
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

interface SearchParams {
  id?: string;
  status?: "all" | "running" | "ok" | "failed";
  q?: string;
  tab?: "timeline" | "logs" | "io" | "events";
}

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const status = params.status ?? "all";
  const tab = params.tab ?? "timeline";
  const q = params.q?.trim() ?? "";

  const all = await runsApi.list({ limit: 200 });
  const filtered = all.filter((r) => {
    if (status !== "all" && r.status !== status) return false;
    if (q) {
      const ql = q.toLowerCase();
      if (
        !r.id.toLowerCase().includes(ql) &&
        !(r.agentName ?? "").toLowerCase().includes(ql) &&
        !(r.subject ?? "").toLowerCase().includes(ql)
      )
        return false;
    }
    return true;
  });

  const activeCount = all.filter((r) => r.status === "running").length;
  const selectedId = params.id ?? filtered[0]?.id ?? null;
  const selected = selectedId
    ? (filtered.find((r) => r.id === selectedId) ??
      all.find((r) => r.id === selectedId) ??
      null)
    : null;

  const detail = selected ? await runsApi.get(selected.id).catch(() => null) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ViewHeader
        title="Runs"
        subtitle={`${filtered.length} runs · ${activeCount} active`}
        action={<Button icon="replay" small>Replay selection</Button>}
      />

      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "440px 1fr",
          minHeight: 0,
        }}
      >
        {/* Runs list */}
        <aside
          style={{
            borderRight: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <form
            action="/runs"
            method="get"
            style={{
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              gap: 6,
            }}
          >
            {status !== "all" && (
              <input type="hidden" name="status" value={status} />
            )}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                flex: 1,
                padding: "5px 8px",
                background: "var(--panel-2)",
                border: "1px solid var(--border)",
                borderRadius: 4,
              }}
            >
              <svg
                width={12}
                height={12}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{ color: "var(--text-3)" }}
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                name="q"
                defaultValue={q}
                placeholder="run id, agent, subject…"
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "var(--text)",
                  fontSize: 12,
                  fontFamily: "var(--sans)",
                }}
              />
            </div>
          </form>
          <div
            style={{
              padding: "8px 14px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            {(["all", "running", "ok", "failed"] as const).map((s) => (
              <StatusChip key={s} active={status === s} value={s} q={q} />
            ))}
          </div>
          <div style={{ flex: 1, overflow: "auto" }}>
            {filtered.length === 0 ? (
              <Empty title="No runs match" hint="Try clearing the filter" />
            ) : (
              filtered.map((r) => (
                <RunCard
                  key={r.id}
                  run={r}
                  active={selectedId === r.id}
                  status={status}
                  q={q}
                />
              ))
            )}
          </div>
        </aside>

        {/* Run detail */}
        <div style={{ overflow: "auto", minHeight: 0 }}>
          {selected && detail ? (
            <RunDetail
              run={selected}
              steps={detail.steps}
              tab={tab}
              status={status}
              q={q}
            />
          ) : (
            <Empty title="No run selected" />
          )}
        </div>
      </div>
    </div>
  );
}

function StatusChip({
  active,
  value,
  q,
}: {
  active: boolean;
  value: "all" | "running" | "ok" | "failed";
  q?: string;
}) {
  const sp = new URLSearchParams();
  if (value !== "all") sp.set("status", value);
  if (q) sp.set("q", q);
  const label = value === "all" ? "All" : value.toUpperCase();
  return (
    <Link
      href={`/runs${sp.toString() ? `?${sp.toString()}` : ""}`}
      style={{
        padding: "3px 9px",
        fontSize: 11,
        fontFamily: "var(--mono)",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: active ? "#000" : "var(--text-2)",
        background: active ? "var(--signal)" : "transparent",
        border: `1px solid ${active ? "var(--signal)" : "var(--border-2)"}`,
        borderRadius: 3,
        textDecoration: "none",
      }}
    >
      {label}
    </Link>
  );
}

function RunCard({
  run,
  active,
  status,
  q,
}: {
  run: RunRow;
  active: boolean;
  status: string;
  q?: string;
}) {
  const sp = new URLSearchParams();
  sp.set("id", run.id);
  if (status !== "all") sp.set("status", status);
  if (q) sp.set("q", q);
  return (
    <Link
      href={`/runs?${sp.toString()}`}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "10px 14px",
        borderBottom: "1px solid var(--border)",
        background: active ? "var(--panel-2)" : "transparent",
        borderLeft: active
          ? "2px solid var(--signal)"
          : "2px solid transparent",
        textDecoration: "none",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
        }}
      >
        <StatusDot status={STATUS_TO_DOT[run.status] ?? "idle"} />
        <span
          className="mono"
          style={{
            fontSize: 11.5,
            color: "var(--text-2)",
            whiteSpace: "nowrap",
          }}
        >
          {run.id.length > 14 ? run.id.slice(0, 14) + "…" : run.id}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "var(--text-3)",
            fontFamily: "var(--mono)",
            whiteSpace: "nowrap",
          }}
        >
          {run.status === "running"
            ? fmtDur(run.durationMs)
            : run.startedAt
              ? fmtAgo(run.startedAt.getTime())
              : "—"}
        </span>
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 12.5,
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {run.agentTitle ?? run.agentName}
      </div>
      <div
        style={{
          marginTop: 2,
          fontSize: 11,
          color: "var(--text-3)",
          display: "flex",
          gap: 6,
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        <span className="mono" style={{ whiteSpace: "nowrap" }}>
          {run.subject ?? "—"}
        </span>
        {run.triggerEvent && (
          <>
            <span>·</span>
            <span
              className="mono"
              style={{
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {run.triggerEvent}
            </span>
          </>
        )}
      </div>
    </Link>
  );
}

type StepLike = {
  id: string;
  name: string;
  type: string;
  ord: number;
  status: string;
  startedAt: Date | null;
  endedAt: Date | null;
  durationMs: number | null;
  error: string | null;
};

function RunDetail({
  run,
  steps,
  tab,
  status,
  q,
}: {
  run: RunRow;
  steps: StepLike[];
  tab: "timeline" | "logs" | "io" | "events";
  status: string;
  q?: string;
}) {
  return (
    <div
      style={{
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {/* Header */}
      <header>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 6,
            flexWrap: "wrap",
          }}
        >
          <StatusDot status={STATUS_TO_DOT[run.status] ?? "idle"} size={9} />
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
          {run.triggerEvent && <Badge tone="muted">↑ {run.triggerEvent}</Badge>}
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
        }}
      >
        <StatCell
          label="Started"
          value={run.startedAt ? fmtTime(run.startedAt.getTime()) : "—"}
        />
        <StatCell
          label="Duration"
          value={fmtDur(run.durationMs)}
          accent={run.status === "running" ? "var(--signal)" : null}
        />
        <StatCell
          label="Steps"
          value={steps.length > 0 ? String(steps.length) : "—"}
        />
        <StatCell
          label="Tokens in/out"
          value={
            run.tokensIn != null && run.tokensOut != null
              ? `${fmtNum(run.tokensIn)} · ${fmtNum(run.tokensOut)}`
              : "—"
          }
        />
        <StatCell label="Subject" value={run.subject ?? "—"} mono />
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: "1px solid var(--border)",
        }}
      >
        {(["timeline", "logs", "io", "events"] as const).map((t) => {
          const sp = new URLSearchParams();
          sp.set("id", run.id);
          if (t !== "timeline") sp.set("tab", t);
          if (status !== "all") sp.set("status", status);
          if (q) sp.set("q", q);
          return (
            <Link
              key={t}
              href={`/runs?${sp.toString()}`}
              style={{
                padding: "8px 14px",
                fontSize: 12,
                fontFamily: "var(--mono)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: tab === t ? "var(--text)" : "var(--text-3)",
                borderBottom: `2px solid ${tab === t ? "var(--signal)" : "transparent"}`,
                marginBottom: -1,
                textDecoration: "none",
              }}
            >
              {t}
            </Link>
          );
        })}
      </div>

      {tab === "timeline" && <TimelineTab run={run} steps={steps} />}
      {tab === "logs" && <LogsPlaceholder run={run} />}
      {tab === "io" && <IOTab run={run} />}
      {tab === "events" && <EventsTab run={run} />}

      {run.status === "failed" && run.errorMessage && (
        <Panel
          title="Error"
          style={{ borderColor: "rgba(255,100,112,0.3)" }}
          padded
        >
          <div
            className="mono"
            style={{ fontSize: 12, color: "var(--red)", lineHeight: 1.5 }}
          >
            {run.errorMessage}
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
  value: string;
  mono?: boolean;
  accent?: string | null;
}) {
  return (
    <div
      style={{ padding: "10px 14px", borderRight: "1px solid var(--border)" }}
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
          color: accent || "var(--text)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function TimelineTab({ run, steps }: { run: RunRow; steps: StepLike[] }) {
  if (steps.length === 0) {
    return (
      <Empty
        title="No steps recorded"
        hint="Manual / human task — see Events tab"
      />
    );
  }
  const startMs = run.startedAt ? run.startedAt.getTime() : 0;
  const total =
    run.durationMs ?? (startMs ? Date.now() - startMs : 1);
  return (
    <Panel title="Step timeline" padded={false}>
      <div style={{ padding: 16 }}>
        {steps.map((s, i) => {
          const sStart = s.startedAt ? s.startedAt.getTime() : startMs;
          const start = Math.max(0, ((sStart - startMs) / total) * 100);
          const dur =
            ((s.durationMs ?? total - (sStart - startMs)) / total) * 100;
          const color =
            s.status === "failed"
              ? "var(--red)"
              : s.status === "running"
                ? "var(--signal)"
                : "var(--green)";
          return (
            <div
              key={s.id}
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
                <StatusDot
                  status={
                    s.status === "ok"
                      ? "ok"
                      : s.status === "running"
                        ? "running"
                        : s.status === "failed"
                          ? "failed"
                          : "idle"
                  }
                />
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
                    left: `${Math.min(99, start)}%`,
                    width: `${Math.max(1, dur)}%`,
                    top: 0,
                    bottom: 0,
                    background: color,
                    opacity: s.status === "running" ? 0.85 : 0.45,
                    borderLeft: `2px solid ${color}`,
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
                  color:
                    s.status === "running" ? "var(--signal)" : "var(--text-2)",
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

function LogsPlaceholder({ run }: { run: RunRow }) {
  return (
    <Panel
      title={`logs/${run.id}.log`}
      subtitle="tail -f · file-backed"
      padded={false}
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
        {`# Live log tail is served from /v1/runs/${run.id}/logs (SSE).\n# Open the dedicated Logs view for the file-tree explorer.\n`}
      </pre>
    </Panel>
  );
}

function IOTab({ run }: { run: RunRow }) {
  return (
    <div
      style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
    >
      <Panel title="Input" padded>
        <CodeBlock>
          {JSON.stringify(
            {
              event: run.triggerEvent ?? "<none>",
              subject: run.subject,
              context: {
                tenant: "raas",
                agent: run.agentName,
                correlation_id: run.correlationId,
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

function EventsTab({ run }: { run: RunRow }) {
  const events = [
    run.triggerEvent && {
      name: run.triggerEvent,
      kind: "trigger",
      at: run.startedAt ?? new Date(),
    },
  ].filter(Boolean) as { name: string; kind: string; at: Date }[];
  if (events.length === 0) {
    return <Empty title="No events on this run yet" />;
  }
  return (
    <Panel title="Event flow for this run" padded>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {events.map((e, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
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
            <Badge tone="blue">{e.name}</Badge>
            <span
              style={{
                marginLeft: "auto",
                fontSize: 11,
                color: "var(--text-3)",
                fontFamily: "var(--mono)",
              }}
            >
              {fmtTime(e.at.getTime())}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre
      style={{
        margin: 0,
        padding: 12,
        background: "var(--bg-2)",
        border: "1px solid var(--border)",
        borderRadius: 4,
        fontFamily: "var(--mono)",
        fontSize: 11.5,
        lineHeight: 1.6,
        color: "var(--text-2)",
        whiteSpace: "pre",
        overflow: "auto",
        maxHeight: 360,
      }}
    >
      {children}
    </pre>
  );
}
