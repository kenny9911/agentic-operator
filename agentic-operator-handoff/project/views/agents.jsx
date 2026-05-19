// Agents — list + detail (config, versions, deploy, runs)

const { useState: useStateAg, useMemo: useMemoAg } = React;

function Agents({ navigate, params }) {
  const agents = window.RAAS_AGENTS;
  const runs = window.RAAS_RUNS;
  const [query, setQuery] = useStateAg("");
  const [actorFilter, setActorFilter] = useStateAg("all");
  const selectedId = params.agentId;

  const stats = useMemoAg(() => {
    const m = new Map();
    agents.forEach(a => m.set(a.id, { runs: 0, errors: 0, lastRun: 0 }));
    runs.forEach(r => {
      const s = m.get(r.agentId);
      if (s) { s.runs++; if (r.status === "failed") s.errors++; if (r.startedAt > s.lastRun) s.lastRun = r.startedAt; }
    });
    return m;
  }, [agents, runs]);

  const filtered = agents.filter(a => {
    if (actorFilter !== "all" && a.actor !== actorFilter) return false;
    if (query && !a.title.toLowerCase().includes(query.toLowerCase()) && !a.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ViewHeader
        title="Agents"
        subtitle={`${agents.length} agents in this workflow · ${agents.filter(a => a.actor === "Agent").length} automated · ${agents.filter(a => a.actor === "Human").length} human`}
        action={[
          <Button key="upload" icon="upload" small>Import manifest</Button>,
          <Button key="new" icon="plus" tone="primary" small>Deploy agent</Button>,
        ]}
      />

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: selectedId ? "440px 1fr" : "1fr", minHeight: 0 }}>
        {/* List */}
        <aside style={{ borderRight: selectedId ? "1px solid var(--border)" : "none", overflow: "auto", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", gap: 8 }}>
            <SearchInput value={query} onChange={setQuery} placeholder="agent name…" />
          </div>
          <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--border)", display: "flex", gap: 6 }}>
            <FilterChip active={actorFilter === "all"} onClick={() => setActorFilter("all")}>All</FilterChip>
            <FilterChip active={actorFilter === "Agent"} onClick={() => setActorFilter("Agent")}>Agents</FilterChip>
            <FilterChip active={actorFilter === "Human"} onClick={() => setActorFilter("Human")}>Human</FilterChip>
          </div>
          <div style={{ flex: 1, overflow: "auto" }}>
            {!selectedId ? (
              <AgentsGrid agents={filtered} stats={stats} navigate={navigate} />
            ) : (
              <AgentsListCompact agents={filtered} stats={stats} navigate={navigate} selectedId={selectedId} />
            )}
          </div>
        </aside>

        {/* Detail */}
        {selectedId && (
          <div style={{ overflow: "auto", minHeight: 0 }}>
            <AgentDetail agent={agents.find(a => a.id === selectedId)} stats={stats.get(selectedId)} navigate={navigate} />
          </div>
        )}
      </div>
    </div>
  );
}

function AgentsGrid({ agents, stats, navigate }) {
  return (
    <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
      {agents.map(a => {
        const s = stats.get(a.id) || { runs: 0, errors: 0, lastRun: 0 };
        return (
          <button key={a.id} onClick={() => navigate("agents", { agentId: a.id })}
            style={{
              padding: "12px 14px",
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderLeft: `3px solid ${a.actor === "Agent" ? "var(--signal)" : "var(--violet)"}`,
              borderRadius: 6,
              textAlign: "left",
              transition: "background 0.12s, border-color 0.12s",
              cursor: "pointer",
            }}
            onMouseEnter={e => e.currentTarget.style.background = "var(--panel-2)"}
            onMouseLeave={e => e.currentTarget.style.background = "var(--panel)"}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <ActorTag actor={a.actor} />
              <Badge tone="muted">{a.id}</Badge>
              <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--text-3)", fontFamily: "var(--mono)" }}>
                {s.lastRun > 0 ? window.fmtAgo(s.lastRun) : "idle"}
              </span>
            </div>
            <div style={{ fontSize: 13.5, color: "var(--text)", fontWeight: 500, marginBottom: 4, lineHeight: 1.3 }}>{a.title}</div>
            <div style={{ fontSize: 11.5, color: "var(--text-2)", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{a.description}</div>
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, fontSize: 11, fontFamily: "var(--mono)", color: "var(--text-3)" }}>
              <span>{s.runs} runs</span>
              {s.errors > 0 && <span style={{ color: "var(--red)" }}>{s.errors} err</span>}
              {a.model && <span style={{ marginLeft: "auto" }}>{a.model.replace("claude-", "")}</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function AgentsListCompact({ agents, stats, navigate, selectedId }) {
  return (
    <div>
      {agents.map(a => {
        const s = stats.get(a.id) || { runs: 0, errors: 0, lastRun: 0 };
        return (
          <button key={a.id} onClick={() => navigate("agents", { agentId: a.id })}
            style={{
              display: "block", width: "100%", textAlign: "left",
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
              background: a.id === selectedId ? "var(--panel-2)" : "transparent",
              borderLeft: a.id === selectedId ? "2px solid var(--signal)" : "2px solid transparent",
              transition: "background 0.1s",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <ActorTag actor={a.actor} />
              <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>{a.id}</span>
              <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--text-3)", fontFamily: "var(--mono)" }}>
                {s.runs}r {s.errors > 0 && <span style={{ color: "var(--red)" }}>· {s.errors}e</span>}
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text)", fontWeight: 500 }}>{a.title}</div>
          </button>
        );
      })}
    </div>
  );
}

function AgentDetail({ agent, stats, navigate }) {
  if (!agent) return <Empty title="Agent not found" />;
  const recentRuns = window.RAAS_RUNS.filter(r => r.agentId === agent.id).slice(0, 10);
  const [tab, setTab] = useStateAg("config");

  return (
    <div style={{ padding: 24 }}>
      <header style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <ActorTag actor={agent.actor} />
          <Badge tone="muted">{agent.id}</Badge>
          <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>{agent.name}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <Button small icon="external" tone="ghost" onClick={() => navigate("workflows")}>View in graph</Button>
            <Button small icon="run" tone="primary">Test run</Button>
          </div>
        </div>
        <h2 style={{ margin: "4px 0 6px 0", fontSize: 26, fontFamily: "var(--display)", fontWeight: 400 }}>{agent.title}</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)", maxWidth: 720, lineHeight: 1.55 }}>{agent.description}</p>
      </header>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0, border: "1px solid var(--border)", borderRadius: 6, background: "var(--panel)", marginBottom: 16 }}>
        <StatCellA label="Runs 24h" value={stats?.runs || 0} />
        <StatCellA label="Errors" value={stats?.errors || 0} accent={stats?.errors > 0 ? "var(--red)" : null} />
        <StatCellA label="P50 latency" value={agent.actor === "Agent" ? "2.4s" : "—"} />
        <StatCellA label="Last run" value={stats?.lastRun > 0 ? window.fmtAgo(stats.lastRun) : "—"} />
      </div>

      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)", marginBottom: 16 }}>
        {["config", "io", "versions", "runs"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 14px",
            fontSize: 12, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.08em",
            color: tab === t ? "var(--text)" : "var(--text-3)",
            borderBottom: `2px solid ${tab === t ? "var(--signal)" : "transparent"}`,
            marginBottom: -1,
          }}>{t}</button>
        ))}
      </div>

      {tab === "config" && <ConfigTab agent={agent} />}
      {tab === "io" && <IOConfigTab agent={agent} />}
      {tab === "versions" && <VersionsTab agent={agent} />}
      {tab === "runs" && <RunsTab runs={recentRuns} navigate={navigate} />}
    </div>
  );
}

function StatCellA({ label, value, accent }) {
  return (
    <div style={{ padding: "12px 16px", borderRight: "1px solid var(--border)" }}>
      <div style={{ fontSize: 10, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-3)" }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 18, fontFamily: "var(--mono)", color: accent || "var(--text)" }}>{value}</div>
    </div>
  );
}

function ConfigTab({ agent }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <Panel title="Manifest" padded={false}
        action={<Button small icon="external" tone="ghost">Edit</Button>}>
        <CodeBlock>{JSON.stringify({
          id: agent.id,
          name: agent.name,
          title: agent.title,
          actor: agent.actor,
          version: "raas@2026.05.16-a",
          triggers: agent.triggers,
          emits: agent.emits,
          steps: agent.steps,
          tools: agent.tools,
          model: agent.model,
          retries: { max: 3, backoff: "exponential" },
          concurrency: { limit: 8, key: "${event.payload.candidate_id}" },
          timeout_s: 120,
        }, null, 2)}</CodeBlock>
      </Panel>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Panel title="Triggers" padded>
          {agent.triggers.length === 0 ? <span style={{ fontSize: 12, color: "var(--text-3)" }}>Manual — operator-initiated.</span> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {agent.triggers.map(t => (
                <div key={t} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 4 }}>
                  <Badge tone="blue">{t}</Badge>
                  <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--text-3)", fontFamily: "var(--mono)" }}>↓ inbound</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Emits" padded>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {agent.emits.map(t => (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 4 }}>
                <Badge tone="green">{t}</Badge>
                <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--text-3)", fontFamily: "var(--mono)" }}>↑ outbound</span>
              </div>
            ))}
          </div>
        </Panel>
        {agent.tools && (
          <Panel title="Tool bindings" padded>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {agent.tools.map(t => (
                <div key={t} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 4 }}>
                  <Icon name="code" size={11} style={{ color: "var(--text-3)" }} />
                  <span className="mono" style={{ fontSize: 11.5, color: "var(--text)" }}>{t}</span>
                  <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-3)", fontFamily: "var(--mono)" }}>bound</span>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

function IOConfigTab({ agent }) {
  return (
    <Panel title="Schema" padded>
      <CodeBlock>{`// inputs
{
  ${agent.triggers.length > 0 ? `trigger_event: ${JSON.stringify(agent.triggers)},` : "trigger: 'manual',"}
  subject_type: "Job_Requisition | Candidate",
  payload: {
    job_requisition_id?: string,
    candidate_id?: string,
    client_id: string,
  },
  context: {
    tenant: "raas",
    agent_version: string,
    correlation_id: string,
  }
}

// outputs
{
  emit_event: ${JSON.stringify(agent.emits)},
  result: { ... },          // see step outputs
  artifacts: ["files/..."], // any file paths written
  metrics: { tokens_in, tokens_out, duration_ms }
}`}</CodeBlock>
    </Panel>
  );
}

function VersionsTab({ agent }) {
  // Filter deployments related to this agent (best-effort)
  const versions = window.RAAS_DEPLOYMENTS.filter(d => d.agent === agent.name);
  return (
    <Panel title="Versions" padded={false}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            <Th>Version</Th>
            <Th>Status</Th>
            <Th>Deployed by</Th>
            <Th>When</Th>
            <Th>Notes</Th>
            <Th></Th>
          </tr>
        </thead>
        <tbody>
          {versions.length === 0 ? (
            <tr><td colSpan={6} style={{ padding: 24, textAlign: "center", color: "var(--text-3)" }}>No agent-specific deploys recorded; running on workflow-level version.</td></tr>
          ) : versions.map(v => (
            <tr key={v.id} style={{ borderBottom: "1px solid var(--border)" }}>
              <Td><span className="mono">{v.version}</span></Td>
              <Td>
                {v.status === "live" ? <Badge tone="signal">LIVE</Badge> :
                 v.status === "rolled-back" ? <Badge tone="muted">ROLLED BACK</Badge> :
                 <Badge tone="muted">{v.status}</Badge>}
              </Td>
              <Td><span style={{ color: "var(--text-2)" }}>{v.by}</span></Td>
              <Td><span style={{ color: "var(--text-3)" }}>{window.fmtAgo(v.at)}</span></Td>
              <Td><span style={{ color: "var(--text-2)" }}>{v.note}</span></Td>
              <Td>
                <Button small tone="ghost">Rollback</Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function RunsTab({ runs, navigate }) {
  if (runs.length === 0) return <Empty title="No recent runs" />;
  return (
    <Panel title={`Recent runs · ${runs.length}`} padded={false}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr><Th></Th><Th>Run</Th><Th>Subject</Th><Th>Trigger</Th><Th>Duration</Th><Th>When</Th></tr>
        </thead>
        <tbody>
          {runs.map(r => (
            <tr key={r.id} onClick={() => navigate("runs", { runId: r.id })} style={{ cursor: "pointer", borderBottom: "1px solid var(--border)" }}>
              <Td><StatusDot status={r.status} /></Td>
              <Td><span className="mono" style={{ color: "var(--text-2)" }}>{r.id}</span></Td>
              <Td><span className="mono" style={{ color: "var(--text-2)" }}>{r.subject}</span></Td>
              <Td><Badge tone="muted">{r.triggerEvent}</Badge></Td>
              <Td><span className="mono" style={{ color: "var(--text-2)" }}>{window.fmtDur(r.durationMs)}</span></Td>
              <Td><span style={{ color: "var(--text-3)" }}>{window.fmtAgo(r.startedAt)}</span></Td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

window.Agents = Agents;
