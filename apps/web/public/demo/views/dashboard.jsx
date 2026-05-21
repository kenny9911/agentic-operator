// Dashboard — control plane overview
const { useState: useStateDash, useEffect: useEffectDash, useMemo: useMemoDash } = React;

function Dashboard({ navigate, liveStream }) {
  // Re-render when test runs / new events arrive.
  const [, tickDash] = useStateDash(0);
  useEffectDash(() => {
    const bump = () => tickDash((t) => t + 1);
    window.addEventListener("raas-runs-updated", bump);
    window.addEventListener("raas-events-updated", bump);
    return () => {
      window.removeEventListener("raas-runs-updated", bump);
      window.removeEventListener("raas-events-updated", bump);
    };
  }, []);

  const agents = window.RAAS_AGENTS;
  const runs = window.RAAS_RUNS;
  const stream = window.RAAS_EVENT_STREAM;
  const tasks = window.RAAS_TASKS;

  const active = runs.filter(r => r.status === "running");
  const failed24 = runs.filter(r => r.status === "failed").length;
  const ok24 = runs.filter(r => r.status === "ok").length;
  const total24 = runs.length;

  // Throughput sparkline (events/min over last 60 min)
  const buckets = useMemoDash(() => {
    const now = Date.now();
    const bs = new Array(60).fill(0);
    stream.forEach(e => {
      const ago = Math.floor((now - e.at) / 60_000);
      if (ago >= 0 && ago < 60) bs[59 - ago]++;
    });
    return bs;
  }, [stream]);

  // Token usage spark
  const tokSpark = useMemoDash(() => {
    const arr = new Array(24).fill(0);
    runs.forEach((r, i) => { arr[i % 24] += (r.tokensIn || 0) + (r.tokensOut || 0); });
    return arr;
  }, [runs]);

  // Per-agent activity over last hour
  const agentActivity = useMemoDash(() => {
    const m = new Map();
    agents.forEach(a => m.set(a.id, { agent: a, runs: 0, errors: 0, lastRun: 0 }));
    runs.forEach(r => {
      const e = m.get(r.agentId);
      if (e) {
        e.runs++;
        if (r.status === "failed") e.errors++;
        if (r.startedAt > e.lastRun) e.lastRun = r.startedAt;
      }
    });
    return Array.from(m.values()).sort((a, b) => b.runs - a.runs);
  }, [agents, runs]);

  // Live ticker state — uses real stream items, advances on a clock if liveStream is on
  const [tickerIdx, setTickerIdx] = useStateDash(0);
  useEffectDash(() => {
    if (!liveStream) return;
    const id = setInterval(() => setTickerIdx(i => (i + 1) % stream.length), 1500);
    return () => clearInterval(id);
  }, [liveStream, stream.length]);

  const recentEvents = stream.slice(tickerIdx, tickerIdx + 14);
  if (recentEvents.length < 14) recentEvents.push(...stream.slice(0, 14 - recentEvents.length));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ViewHeader
        title="Dashboard"
        subtitle="Live state of the RAAS workload. All agent runs, events, and queues across the active tenant."
        badge={<Badge tone="signal"><span className="live-dot" style={{ width: 5, height: 5 }} /> LIVE</Badge>}
        action={[
          <Button key="d" icon="deploy" small>Deploy</Button>,
          <Button key="r" icon="replay" small>Replay window</Button>,
        ]}
      />

      <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
        {/* Top KPI row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
          <KPICard label="Active runs" value={active.length} sub={`${ok24}/${total24} ok past hour`} tone="up" accent="var(--signal)" spark={buckets.slice(40)} />
          <KPICard label="Events / hr" value={window.fmtNum(stream.length)} sub="+12% vs 24h avg" tone="up" spark={buckets} />
          <KPICard label="Errors / hr" value={failed24} sub={failed24 > 0 ? `${(failed24 / total24 * 100).toFixed(1)}% failure rate` : "all green"} tone={failed24 > 4 ? "down" : "up"} accent={failed24 > 4 ? "var(--red)" : "var(--green)"} />
          <KPICard label="Pending tasks" value={tasks.length} sub={tasks.filter(t => t.priority === "high").length + " high priority"} accent="var(--amber)" />
          <KPICard label="Tokens / hr" value="142.8K" sub="≈ $1.47" spark={tokSpark} />
        </div>

        {/* Main grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
          {/* LEFT column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Active runs table */}
            <Panel
              title="Active runs"
              subtitle={`${active.length} running`}
              action={<Button small icon="external" tone="ghost" onClick={() => navigate("runs")}>View all</Button>}
              padded={false}
            >
              <RunTable runs={active} navigate={navigate} live />
            </Panel>

            {/* Agent activity grid */}
            <Panel
              title="Agent activity · past hour"
              action={<Button small icon="external" tone="ghost" onClick={() => navigate("agents")}>All agents</Button>}
              padded={false}
            >
              <AgentActivityGrid items={agentActivity} navigate={navigate} />
            </Panel>
          </div>

          {/* RIGHT column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Live event ticker */}
            <Panel
              title="Event stream"
              subtitle={liveStream ? "auto-updating" : "paused"}
              action={<Button small icon="external" tone="ghost" onClick={() => navigate("events")}>Open</Button>}
              padded={false}
              style={{ minHeight: 320 }}
            >
              <EventTicker events={recentEvents} live={liveStream} />
            </Panel>

            {/* Pending tasks */}
            <Panel
              title="Awaiting humans"
              subtitle={`${tasks.length} tasks`}
              action={<Button small icon="external" tone="ghost" onClick={() => navigate("tasks")}>Inbox</Button>}
              padded={false}
            >
              <PendingTasksList tasks={tasks.slice(0, 5)} navigate={navigate} />
            </Panel>

            {/* System health */}
            <Panel title="Runtime" padded>
              <SystemHealth />
            </Panel>
          </div>
        </div>

        {/* Bottom: stage funnel */}
        <div style={{ marginTop: 12 }}>
          <Panel title="RAAS funnel · last 24h" padded>
            <StageFunnel />
          </Panel>
        </div>
      </div>
    </div>
  );
}

function KPICard({ label, value, sub, tone, accent, spark }) {
  return (
    <div style={{
      background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8,
      padding: "14px 16px",
    }}>
      <div style={{ fontSize: 10.5, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-3)" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 6 }}>
        <div style={{ fontSize: 26, fontFamily: "var(--mono)", fontWeight: 500, letterSpacing: "-0.01em", color: accent || "var(--text)" }}>{value}</div>
        {spark && <Sparkline values={spark} width={70} height={26} color={accent || "var(--signal)"} />}
      </div>
      {sub && <div style={{ marginTop: 4, fontSize: 11, color: tone === "down" ? "var(--red)" : tone === "up" ? "var(--text-2)" : "var(--text-3)" }}>{sub}</div>}
    </div>
  );
}

function RunTable({ runs, navigate, live }) {
  if (runs.length === 0) return <Empty title="No active runs" hint="Quiet — system idle" />;
  return (
    <div style={{ maxHeight: 280, overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: 28 }} />
          <col style={{ width: 88 }} />
          <col />
          <col style={{ width: 88 }} />
          <col style={{ width: 130 }} />
          <col style={{ width: 60 }} />
        </colgroup>
        <thead>
          <tr style={{ position: "sticky", top: 0, background: "var(--panel)", borderBottom: "1px solid var(--border)" }}>
            <Th></Th>
            <Th>Run</Th>
            <Th>Agent</Th>
            <Th>Subject</Th>
            <Th>Step</Th>
            <Th style={{ textAlign: "right" }}>Dur</Th>
          </tr>
        </thead>
        <tbody>
          {runs.map(r => (
            <tr key={r.id} onClick={() => navigate("runs", { runId: r.id })} style={{ cursor: "pointer", borderBottom: "1px solid var(--border)" }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--panel-2)"}
                onMouseLeave={(e) => e.currentTarget.style.background = ""}>
              <Td><StatusDot status={r.status} /></Td>
              <Td>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span className="mono" style={{ color: "var(--text-2)", whiteSpace: "nowrap" }}>{r.id}</span>
                  {r.testRun && <Badge tone="signal" style={{ fontSize: 9 }}>TEST</Badge>}
                </span>
              </Td>
              <Td style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <span style={{ color: "var(--text)" }}>{r.agentTitle}</span>
              </Td>
              <Td><span className="mono" style={{ color: "var(--text-2)", whiteSpace: "nowrap" }}>{r.subject}</span></Td>
              <Td style={{ overflow: "hidden" }}>
                {r.steps && r.steps.length > 0 ? (() => {
                  const cur = r.steps.find(s => s.status === "running");
                  const done = r.steps.filter(s => s.status === "ok").length;
                  return (
                    <span style={{ fontSize: 11.5, display: "flex", gap: 4, alignItems: "baseline", overflow: "hidden" }}>
                      <span className="mono" style={{ color: "var(--signal)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{cur ? cur.name : "—"}</span>
                      <span style={{ color: "var(--text-3)", whiteSpace: "nowrap", flexShrink: 0 }}>{done + 1}/{r.steps.length}</span>
                    </span>
                  );
                })() : null}
              </Td>
              <Td style={{ textAlign: "right" }}><span className="mono" style={{ color: "var(--signal)", whiteSpace: "nowrap" }}>{window.fmtDur(r.durationMs)}</span></Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, style }) {
  return <th style={{
    textAlign: "left", padding: "8px 12px",
    fontSize: 10.5, fontFamily: "var(--mono)", fontWeight: 500,
    color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.08em",
    ...style,
  }}>{children}</th>;
}
function Td({ children, style }) {
  return <td style={{ padding: "8px 12px", verticalAlign: "middle", ...style }}>{children}</td>;
}
window.Th = Th;
window.Td = Td;

function AgentActivityGrid({ items, navigate }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: "var(--border)" }}>
      {items.map(({ agent, runs, errors, lastRun }) => {
        const intensity = Math.min(1, runs / 20);
        return (
          <button
            key={agent.id}
            onClick={() => navigate("agents", { agentId: agent.id })}
            style={{
              padding: "10px 12px",
              background: "var(--panel)",
              textAlign: "left",
              transition: "background 0.12s",
              position: "relative",
              display: "block",
              minHeight: 78,
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = "var(--panel-2)"}
            onMouseLeave={(e) => e.currentTarget.style.background = "var(--panel)"}
          >
            {/* heat bar */}
            <div style={{
              position: "absolute", left: 0, top: 0, bottom: 0, width: 2,
              background: errors > 0 ? "var(--red)" : `rgba(208,255,0,${0.15 + intensity * 0.6})`,
            }} />
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <ActorTag actor={agent.actor} />
              <span style={{ marginLeft: "auto", fontSize: 11, fontFamily: "var(--mono)", color: errors > 0 ? "var(--red)" : "var(--text)" }}>
                {runs}
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text)", fontWeight: 500, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {agent.title}
            </div>
            <div style={{ fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--text-3)" }}>
              {lastRun > 0 ? window.fmtAgo(lastRun) : "idle"}
              {errors > 0 && <span style={{ color: "var(--red)", marginLeft: 8 }}>{errors} err</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function EventTicker({ events, live }) {
  return (
    <div style={{ maxHeight: 380, overflow: "auto" }}>
      {events.map((e, i) => (
        <div
          key={e.id + i}
          style={{
            display: "grid",
            gridTemplateColumns: "62px 1fr auto",
            gap: 10, alignItems: "center",
            padding: "8px 14px",
            borderBottom: "1px solid var(--border)",
            fontSize: 12,
            animation: i === 0 && live ? "tick 0.4s ease-out" : "none",
          }}
        >
          <span className="mono" style={{ color: "var(--text-3)", fontSize: 10.5 }}>
            {window.fmtTime(e.at)}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <Badge tone={window.eventTone(e.color)} style={{ fontSize: 9.5 }}>{e.name}</Badge>
            <span style={{ color: "var(--text-3)", fontSize: 11 }}>·</span>
            <span style={{ color: "var(--text-2)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {e.sourceTitle}
            </span>
          </div>
          <span className="mono" style={{ color: "var(--text-3)", fontSize: 10.5 }}>{e.subject}</span>
        </div>
      ))}
    </div>
  );
}

function PendingTasksList({ tasks, navigate }) {
  return (
    <div>
      {tasks.map(t => (
        <button
          key={t.id}
          onClick={() => navigate("tasks", { taskId: t.id })}
          style={{
            display: "block", width: "100%", textAlign: "left",
            padding: "10px 14px", borderBottom: "1px solid var(--border)",
            transition: "background 0.12s",
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = "var(--panel-2)"}
          onMouseLeave={(e) => e.currentTarget.style.background = ""}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <Badge tone={t.priority === "high" ? "amber" : t.priority === "med" ? "blue" : "muted"} style={{ fontSize: 9.5 }}>
              {t.priority.toUpperCase()}
            </Badge>
            <span style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--mono)" }}>{t.id}</span>
            <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3)" }}>{window.fmtAgo(t.createdAt)}</span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text)", marginBottom: 2 }}>{t.title}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>awaiting · {t.awaitingFrom}</div>
        </button>
      ))}
    </div>
  );
}

function SystemHealth() {
  const items = [
    { label: "Inngest worker", status: "ok", note: "3 workers · 0 lag" },
    { label: "SQLite", status: "ok", note: "8.4 MB · 0 wal" },
    { label: "Log volume", status: "ok", note: "1.2 GB / 50 GB" },
    { label: "RMS adapter · Tencent", status: "ok", note: "last sync 2m ago" },
    { label: "Channel · BOSS Zhipin", status: "warn", note: "rate-limited, 3 retries" },
    { label: "Channel · Zhilian", status: "ok", note: "240 reqs/hr" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map(i => (
        <div key={i.label} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
          <StatusDot status={i.status === "ok" ? "ok" : i.status === "warn" ? "waiting" : "failed"} />
          <span style={{ color: "var(--text)" }}>{i.label}</span>
          <span style={{ marginLeft: "auto", color: "var(--text-3)", fontSize: 11, fontFamily: "var(--mono)" }}>{i.note}</span>
        </div>
      ))}
    </div>
  );
}

function StageFunnel() {
  const stages = window.RAAS_STAGES;
  const counts = [1842, 1731, 1612, 1598, 1480, 1109, 743, 412];
  const max = counts[0];
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${stages.length}, 1fr)`, gap: 8 }}>
      {stages.map((s, i) => {
        const pct = counts[i] / max;
        const drop = i > 0 ? ((counts[i-1] - counts[i]) / counts[i-1] * 100).toFixed(1) : null;
        return (
          <div key={s.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 10.5, fontFamily: "var(--mono)", textTransform: "uppercase", color: "var(--text-3)", letterSpacing: "0.06em" }}>{s.label}</span>
              {drop && <span style={{ fontSize: 9.5, fontFamily: "var(--mono)", color: "var(--text-3)" }}>−{drop}%</span>}
            </div>
            <div style={{ height: 6, background: "var(--panel-2)", borderRadius: 1, position: "relative", overflow: "hidden" }}>
              <div style={{
                position: "absolute", left: 0, top: 0, bottom: 0,
                width: `${pct * 100}%`,
                background: `linear-gradient(90deg, var(--signal) 0%, var(--signal) 70%, rgba(208,255,0,0.5) 100%)`,
                opacity: 0.3 + pct * 0.7,
              }} />
            </div>
            <div style={{ fontSize: 16, fontFamily: "var(--mono)", color: "var(--text)" }}>{window.fmtNum(counts[i])}</div>
          </div>
        );
      })}
    </div>
  );
}

window.Dashboard = Dashboard;
