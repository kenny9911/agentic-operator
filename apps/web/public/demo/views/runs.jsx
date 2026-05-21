// Runs — list + detail timeline of one run

const { useState: useStateRun, useMemo: useMemoRun, useEffect: useEffectRun } = React;

function Runs({ navigate, params }) {
  // Re-render when window.testAgent (or future writers) mutates RAAS_RUNS.
  const [, tickRun] = useStateRun(0);
  useEffectRun(() => {
    const bump = () => tickRun((t) => t + 1);
    window.addEventListener("raas-runs-updated", bump);
    return () => window.removeEventListener("raas-runs-updated", bump);
  }, []);

  const allRuns = window.RAAS_RUNS;
  const [statusFilter, setStatusFilter] = useStateRun("all");
  const [agentFilter, setAgentFilter] = useStateRun("all");
  const [query, setQuery] = useStateRun("");
  const selectedId = params.runId || allRuns[0]?.id;
  const selected = allRuns.find(r => r.id === selectedId);

  const filtered = useMemoRun(() => {
    return allRuns.filter(r => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (agentFilter !== "all" && r.agentId !== agentFilter) return false;
      if (query) {
        const q = query.toLowerCase();
        if (!r.id.toLowerCase().includes(q) && !r.agentName.toLowerCase().includes(q) && !r.subject.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [allRuns, statusFilter, agentFilter, query]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ViewHeader
        title="Runs"
        subtitle={`${filtered.length} runs · ${allRuns.filter(r => r.status === "running").length} active`}
        action={[<Button key="r" icon="replay" small>Replay selection</Button>]}
      />

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "440px 1fr", minHeight: 0 }}>
        {/* Runs list */}
        <aside style={{ borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", gap: 6 }}>
            <SearchInput value={query} onChange={setQuery} placeholder="run id, agent, subject…" />
          </div>
          <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[
              { id: "all", label: "All" },
              { id: "running", label: "Running" },
              { id: "ok", label: "Ok" },
              { id: "failed", label: "Failed" },
            ].map(t => (
              <FilterChip key={t.id} active={statusFilter === t.id} onClick={() => setStatusFilter(t.id)}>{t.label}</FilterChip>
            ))}
          </div>
          <div style={{ flex: 1, overflow: "auto" }}>
            {filtered.map(r => (
              <button
                key={r.id}
                onClick={() => navigate("runs", { runId: r.id })}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "10px 14px",
                  borderBottom: "1px solid var(--border)",
                  background: r.id === selectedId ? "var(--panel-2)" : "transparent",
                  borderLeft: r.id === selectedId ? "2px solid var(--signal)" : "2px solid transparent",
                  transition: "background 0.1s",
                  overflow: "hidden",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <StatusDot status={r.status} />
                  <span className="mono" style={{ fontSize: 11.5, color: "var(--text-2)", whiteSpace: "nowrap" }}>{r.id}</span>
                  {r.testRun && <Badge tone="signal" style={{ fontSize: 9 }}>TEST</Badge>}
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3)", fontFamily: "var(--mono)", whiteSpace: "nowrap" }}>
                    {r.status === "running" ? window.fmtDur(r.durationMs) : window.fmtAgo(r.startedAt)}
                  </span>
                </div>
                <div style={{ marginTop: 4, fontSize: 12.5, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.agentTitle}
                </div>
                <div style={{ marginTop: 2, fontSize: 11, color: "var(--text-3)", display: "flex", gap: 6, minWidth: 0, overflow: "hidden" }}>
                  <span className="mono" style={{ whiteSpace: "nowrap" }}>{r.subject}</span>
                  <span>·</span>
                  <span className="mono" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.triggerEvent}</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* Run detail */}
        <div style={{ overflow: "auto", minHeight: 0 }}>
          {selected ? <RunDetail run={selected} navigate={navigate} /> : <Empty title="No run selected" />}
        </div>
      </div>
    </div>
  );
}

function SearchInput({ value, onChange, placeholder }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1,
      padding: "5px 8px",
      background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 4,
    }}>
      <Icon name="search" size={12} style={{ color: "var(--text-3)" }} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1, background: "transparent", border: "none", outline: "none",
          color: "var(--text)", fontSize: 12, fontFamily: "var(--sans)",
        }}
      />
    </div>
  );
}
window.SearchInput = SearchInput;

function FilterChip({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: "3px 9px",
      fontSize: 11, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.04em",
      color: active ? "#000" : "var(--text-2)",
      background: active ? "var(--signal)" : "transparent",
      border: `1px solid ${active ? "var(--signal)" : "var(--border-2)"}`,
      borderRadius: 3,
      cursor: "pointer",
    }}>{children}</button>
  );
}
window.FilterChip = FilterChip;

function RunDetail({ run, navigate }) {
  const agent = window.RAAS_AGENTS.find(a => a.id === run.agentId);
  const [tab, setTab] = useStateRun("timeline");
  // "agent" tab needs to fill space + own its scroll, same as the Code tab in
  // AgentDetail. Other tabs flow naturally inside the outer scroll.
  const isAgentTab = tab === "agent";
  return (
    <div style={{
      padding: 24,
      display: "flex", flexDirection: "column",
      gap: 16,
      height: isAgentTab ? "100%" : "auto",
      minHeight: 0,
    }}>
      {/* Header */}
      <header style={{ flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
          <StatusDot status={run.status} size={9} />
          <span className="mono" style={{ fontSize: 13, color: "var(--text-2)" }}>{run.id}</span>
          <Badge tone={run.status === "running" ? "signal" : run.status === "failed" ? "red" : "green"} style={{ marginLeft: 4 }}>{run.status}</Badge>
          {run.testRun && <Badge tone="signal">TEST RUN</Badge>}
          {run.triggerEvent && <Badge tone="muted">↑ {run.triggerEvent}</Badge>}
          {run.emittedEvent && <Badge tone="green">↓ {run.emittedEvent}</Badge>}
          {agent && (
            <Button
              small icon="agent" tone="ghost"
              style={{ marginLeft: "auto" }}
              onClick={() => navigate("agents", { agentId: agent.id })}
            >Open agent</Button>
          )}
        </div>
        <h2 style={{ margin: "4px 0 0 0", fontSize: 24, fontFamily: "var(--display)", fontWeight: 400, color: "var(--text)" }}>
          {run.agentTitle}
        </h2>
      </header>

      {/* Stats strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 0, border: "1px solid var(--border)", borderRadius: 6, background: "var(--panel)", flexShrink: 0 }}>
        <StatCell label="Started" value={new Date(run.startedAt).toLocaleString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} />
        <StatCell label="Duration" value={window.fmtDur(run.durationMs)} accent={run.status === "running" ? "var(--signal)" : null} />
        <StatCell label="Steps" value={run.steps ? run.steps.length : "—"} />
        <StatCell label="Tokens in/out" value={`${window.fmtNum(run.tokensIn)} · ${window.fmtNum(run.tokensOut)}`} />
        <StatCell label="Subject" value={run.subject} mono />
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        {["timeline", "logs", "io", "events", "agent"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 14px",
            fontSize: 12, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.08em",
            color: tab === t ? "var(--text)" : "var(--text-3)",
            borderBottom: `2px solid ${tab === t ? "var(--signal)" : "transparent"}`,
            marginBottom: -1,
          }}>{t}</button>
        ))}
      </div>

      {/* "agent" tab uses the full AgentCodeTab — same view as Agent detail's Code tab.
          Wrap in a flex-1 container so the splitter/maximize layout has bounded height. */}
      {isAgentTab && (
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          {agent
            ? <window.AgentCodeTab agent={agent} />
            : <Empty title="Agent not found" hint={`agentId=${run.agentId}`} />}
        </div>
      )}
      {tab === "timeline" && <TimelineTab run={run} agent={agent} />}
      {tab === "logs" && <LogsTab />}
      {tab === "io" && <IOTab run={run} agent={agent} />}
      {tab === "events" && <RunEventsTab run={run} />}

      {!isAgentTab && run.status === "failed" && run.error && (
        <Panel title="Error" style={{ borderColor: "rgba(255,100,112,0.3)" }} padded>
          <div className="mono" style={{ fontSize: 12, color: "var(--red)", lineHeight: 1.5 }}>
            {run.error}
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <Button icon="replay" small>Retry</Button>
            <Button icon="external" small tone="ghost">View error trace</Button>
          </div>
        </Panel>
      )}
    </div>
  );
}

function StatCell({ label, value, mono, accent }) {
  return (
    <div style={{ padding: "10px 14px", borderRight: "1px solid var(--border)" }}>
      <div style={{ fontSize: 10, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-3)" }}>{label}</div>
      <div style={{ marginTop: 3, fontSize: 14, fontFamily: mono ? "var(--mono)" : "var(--sans)", color: accent || "var(--text)" }}>{value}</div>
    </div>
  );
}

function TimelineTab({ run, agent }) {
  if (!run.steps || run.steps.length === 0) {
    return <Empty title="No steps recorded" hint="Manual / human task — see Events tab" />;
  }
  const total = run.durationMs || (Date.now() - run.startedAt);
  return (
    <Panel title="Step timeline" padded={false}>
      <div style={{ padding: 16 }}>
        {run.steps.map((s, i) => {
          const start = ((s.startedAt - run.startedAt) / total) * 100;
          const dur = ((s.durationMs || total - (s.startedAt - run.startedAt)) / total) * 100;
          return (
            <div key={s.name} style={{ display: "grid", gridTemplateColumns: "26px 220px 1fr 80px", gap: 12, alignItems: "center", padding: "8px 0", borderBottom: i < run.steps.length - 1 ? "1px solid var(--border)" : "none" }}>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <StatusDot status={s.status} />
              </div>
              <div>
                <div className="mono" style={{ fontSize: 12, color: "var(--text)" }}>{s.name}</div>
                <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>step {i + 1}</div>
              </div>
              <div style={{ position: "relative", height: 16, background: "var(--bg-2)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{
                  position: "absolute",
                  left: `${Math.min(99, start)}%`,
                  width: `${Math.max(1, dur)}%`,
                  top: 0, bottom: 0,
                  background: s.status === "failed" ? "var(--red)" : s.status === "running" ? "var(--signal)" : "var(--green)",
                  opacity: s.status === "running" ? 0.85 : 0.45,
                  borderLeft: `2px solid ${s.status === "failed" ? "var(--red)" : s.status === "running" ? "var(--signal)" : "var(--green)"}`,
                }}>
                  {s.status === "running" && (
                    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)", backgroundSize: "200px 100%", animation: "shimmer 1.5s linear infinite" }} />
                  )}
                </div>
              </div>
              <div className="mono" style={{ fontSize: 11.5, color: s.status === "running" ? "var(--signal)" : "var(--text-2)", textAlign: "right" }}>
                {window.fmtDur(s.durationMs)}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function LogsTab() {
  return (
    <Panel title="logs/run-01000.log" subtitle="tail -f · file-backed" padded={false}
      action={<Button small icon="external" tone="ghost">Open file</Button>}>
      <pre style={{
        margin: 0, padding: 16,
        background: "var(--bg-2)",
        fontFamily: "var(--mono)",
        fontSize: 11.5, lineHeight: 1.65, color: "var(--text-2)",
        whiteSpace: "pre-wrap", wordBreak: "break-all",
        maxHeight: 420, overflow: "auto",
      }}>
        {window.RAAS_SAMPLE_LOG.split("\n").map((line, i) => {
          let color = "var(--text-2)";
          if (line.includes("ERROR")) color = "var(--red)";
          else if (line.includes(" WARN ")) color = "var(--amber)";
          else if (line.includes("DEBUG")) color = "var(--text-3)";
          else if (line.includes("emit") || line.includes("run.end")) color = "var(--signal)";
          return <div key={i} style={{ color }}>{line}</div>;
        })}
      </pre>
    </Panel>
  );
}

function IOTab({ run, agent }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <Panel title="Input" padded>
        <CodeBlock>{JSON.stringify({
          event: run.triggerEvent,
          subject: run.subject,
          context: {
            tenant: "raas",
            agent: agent?.name,
            agent_version: "raas@2026.05.16-a",
          },
          payload: {
            job_requisition_id: "REQ-2041",
            candidate_id: run.subject,
            resume_parsed: true,
            client: "Tencent",
          },
        }, null, 2)}</CodeBlock>
      </Panel>
      <Panel title="Output" padded>
        <CodeBlock>{JSON.stringify({
          status: run.status,
          duration_ms: run.durationMs,
          emitted: run.emittedEvent || (run.status === "running" ? "<pending>" : "<none>"),
          result: {
            match_score: 87,
            recommendation: "interview",
            dimensions: { hard_match: 0.95, bonus: 0.78, redline: "clear", reflux: "ok" },
            missing_items: [],
          },
          tokens: { in: run.tokensIn, out: run.tokensOut, model: run.model },
        }, null, 2)}</CodeBlock>
      </Panel>
    </div>
  );
}

function CodeBlock({ children }) {
  return (
    <pre style={{
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
    }}>{children}</pre>
  );
}
window.CodeBlock = CodeBlock;

function RunEventsTab({ run }) {
  const events = [
    { name: run.triggerEvent, kind: "trigger", at: run.startedAt },
    ...(run.emittedEvent ? [{ name: run.emittedEvent, kind: "emit", at: run.endedAt || Date.now() }] : []),
  ];
  return (
    <Panel title="Event flow for this run" padded>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {events.map((e, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--text-3)", width: 60 }}>{e.kind}</span>
            <Icon name={e.kind === "trigger" ? "chevron-right" : "chevron-right"} size={12} style={{ color: "var(--text-3)" }} />
            <Badge tone={e.kind === "trigger" ? "blue" : "green"}>{e.name}</Badge>
            <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3)", fontFamily: "var(--mono)" }}>{window.fmtTime(e.at)}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

window.Runs = Runs;
