// Agents — list + detail (config, versions, deploy, runs)

const { useState: useStateAg, useMemo: useMemoAg } = React;

function Agents({ navigate, params }) {
  const agents = window.RAAS_AGENTS;
  const runs = window.RAAS_RUNS;
  const [query, setQuery] = useStateAg("");
  const [actorFilter, setActorFilter] = useStateAg("all");
  const [deployOpen, setDeployOpen] = useStateAg(false);
  const [importOpen, setImportOpen] = useStateAg(false);
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
          <Button key="upload" icon="upload" small onClick={() => setImportOpen(true)}>Import manifest</Button>,
          <Button key="new" icon="plus" tone="primary" small onClick={() => setDeployOpen(true)}>Deploy agent</Button>,
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

      {deployOpen && <DeployAgentModal onClose={() => setDeployOpen(false)} />}
      {importOpen && <window.ImportManifestModal onClose={() => setImportOpen(false)} mode="agent" />}
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
  const [editing, setEditing] = useStateAg(false);

  return (
    <div style={{ padding: 24 }}>
      <header style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <ActorTag actor={agent.actor} />
          <Badge tone="muted">{agent.id}</Badge>
          <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>{agent.name}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <Button small icon="external" tone="ghost" onClick={() => navigate("workflows")}>View in graph</Button>
            {editing
              ? <>
                  <Button small tone="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                  <Button small icon="check" tone="primary" onClick={() => setEditing(false)}>Save & deploy</Button>
                </>
              : <>
                  <Button small icon="code" onClick={() => setEditing(true)}>Edit</Button>
                  <Button small icon="run" tone="primary">Test run</Button>
                </>
            }
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
        {["config", "io", "code", "versions", "runs"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 14px",
            fontSize: 12, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.08em",
            color: tab === t ? "var(--text)" : "var(--text-3)",
            borderBottom: `2px solid ${tab === t ? "var(--signal)" : "transparent"}`,
            marginBottom: -1,
          }}>{t}</button>
        ))}
      </div>

      {tab === "config" && (editing ? <EditConfigTab agent={agent} /> : <ConfigTab agent={agent} />)}
      {tab === "io" && <IOConfigTab agent={agent} />}
      {tab === "code" && <window.AgentCodeTab agent={agent} />}
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
  const hasCode = agent.actor === "Agent";
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
          typescript_code: hasCode ? `<inline · ${agent.name}.ts · see Code tab>` : null,
          tool_use: hasCode ? window.AGENT_SAMPLE_TOOL_USE.map(t => t.name) : [],
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

// =====================================================
// EditConfigTab — form-based editor for an existing agent
// =====================================================
function EditConfigTab({ agent }) {
  const [name, setName] = useStateAg(agent.name);
  const [title, setTitle] = useStateAg(agent.title);
  const [desc, setDesc] = useStateAg(agent.description);
  const [model, setModel] = useStateAg(agent.model || "claude-sonnet-4-5");
  const [retries, setRetries] = useStateAg(3);
  const [timeout, setTimeoutVal] = useStateAg(120);
  const [concurrency, setConcurrency] = useStateAg(8);
  const [tsCode, setTsCode] = useStateAg(window.AGENT_SAMPLE_TS_CODE);
  const [toolUse, setToolUse] = useStateAg(window.AGENT_SAMPLE_TOOL_USE);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", gap: 12 }}>
      {/* Left: form */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <Panel title="Identity" padded>
          <EditField label="Name (id)" hint="Lowercase camelCase. Used in event payloads and logs.">
            <EditText value={name} onChange={setName} mono />
          </EditField>
          <EditField label="Title" hint="Human-readable label shown across the operator.">
            <EditText value={title} onChange={setTitle} />
          </EditField>
          <EditField label="Description" hint="One-paragraph summary of what this agent does. Shown in the graph inspector.">
            <EditTextarea value={desc} onChange={setDesc} rows={3} />
          </EditField>
          <EditField label="Actor type" hint="Agent runs code automatically; Human pauses for operator input.">
            <Seg
              value={agent.actor}
              onChange={() => {}}
              options={[{ value: "Agent", label: "Agent" }, { value: "Human", label: "Human task" }]}
            />
          </EditField>
        </Panel>

        <Panel title="Events" padded>
          <EditField label="Listens to (triggers)" hint="Inbound events. Pick existing or type a new EVENT_NAME.">
            <EditableEventList items={agent.triggers} tone="blue" />
          </EditField>
          <EditField label="Emits (outbound)" hint="Events this agent publishes. Downstream agents subscribe to these.">
            <EditableEventList items={agent.emits} tone="green" />
          </EditField>
        </Panel>

        {agent.actor === "Agent" && (
          <>
            <Panel title="Implementation" padded>
              <EditField label="Steps" hint="Ordered sub-procedures. Drag to reorder; the agent runs them in sequence.">
                {agent.steps && agent.steps.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {agent.steps.map((s, i) => (
                      <div key={s} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 3 }}>
                        <Icon name="filter" size={10} style={{ color: "var(--text-3)", cursor: "grab" }} />
                        <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--text-3)", width: 18 }}>{i + 1}.</span>
                        <input defaultValue={s} style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--text)", fontFamily: "var(--mono)", fontSize: 11.5 }} />
                        <button style={{ color: "var(--text-3)" }}><Icon name="x" size={10} /></button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>No steps defined.</span>
                )}
                <div style={{ marginTop: 6 }}><Button small icon="plus" tone="ghost">Add step</Button></div>
              </EditField>

              <EditField label="Tools" hint="Bindings this agent may call. Permissions inherited from the workspace tool catalog.">
                <EditableEventList items={agent.tools || []} tone="muted" placeholder="tool.name" />
              </EditField>

              <EditField label="Model" hint="Pick a model from the fleet, or leave to use the workflow default.">
                <select value={model} onChange={e => setModel(e.target.value)} style={editSelectStyle}>
                  <option>claude-sonnet-4-5</option>
                  <option>claude-haiku-4-5</option>
                  <option>gpt-4.1-mini</option>
                </select>
              </EditField>

              <EditField label="System prompt" hint="Prepended to every request. Use {{template}} variables to interpolate run context.">
                <EditTextarea
                  value={`You are an automated agent in the RAAS workflow.\nGoal: ${agent.title}.\n\nFollow the steps in order. After each step, emit a structured progress event. Never block on human input — emit a HUMAN_TASK event if needed.\n\nContext variables available: {{requisition}}, {{candidate}}, {{client}}.`}
                  onChange={() => {}}
                  rows={6}
                  mono
                />
              </EditField>
            </Panel>

            {/* TypeScript code + tool_use */}
            <window.AgentCodeEditPanel value={tsCode} onChange={setTsCode} />
            <window.AgentToolUseEditPanel tools={toolUse} onChange={setToolUse} />

            <Panel title="Behavior" padded>
              <EditField label="Retries" hint="Maximum retry attempts on tool/model errors. Exponential backoff.">
                <EditText value={String(retries)} onChange={v => setRetries(parseInt(v) || 0)} mono suffix="attempts" />
              </EditField>
              <EditField label="Timeout" hint="Per-run hard timeout. After this the run is marked failed.">
                <EditText value={String(timeout)} onChange={v => setTimeoutVal(parseInt(v) || 0)} mono suffix="seconds" />
              </EditField>
              <EditField label="Concurrency" hint="Maximum simultaneous runs of this agent. Beyond this, runs queue.">
                <EditText value={String(concurrency)} onChange={v => setConcurrency(parseInt(v) || 0)} mono suffix="runs" />
              </EditField>
              <EditField label="Concurrency key" hint="Partition concurrency by a payload field. e.g. one run per candidate.">
                <EditText value="${event.payload.candidate_id}" mono onChange={() => {}} />
              </EditField>
            </Panel>
          </>
        )}
      </div>

      {/* Right: preview manifest */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Panel title="Preview manifest" subtitle="Live · updates as you edit" padded={false}
          action={<Button small icon="external" tone="ghost">Copy</Button>}>
          <CodeBlock>{JSON.stringify({
            id: agent.id,
            name,
            title,
            actor: agent.actor,
            version: "raas@2026.05.18-draft",
            triggers: agent.triggers,
            emits: agent.emits,
            steps: agent.steps,
            tools: agent.tools,
            model,
            retries: { max: retries, backoff: "exponential" },
            concurrency: { limit: concurrency, key: "${event.payload.candidate_id}" },
            timeout_s: timeout,
            typescript_code: agent.actor === "Agent" ? `<inline · ${tsCode.split("\n").length} lines · ${tsCode.length} chars>` : null,
            tool_use: agent.actor === "Agent" ? toolUse.map(t => ({ name: t.name, params: Object.keys((t.input_schema && t.input_schema.properties) || {}) })) : [],
          }, null, 2)}</CodeBlock>
        </Panel>

        <Panel title="Validation" padded>
          <ValidationLine ok label="Graph reachable" hint="2 inbound · 2 outbound" />
          <ValidationLine ok label="No cycles" />
          <ValidationLine ok label="All emitted events have listeners" />
          <ValidationLine warn label="Tools updated" hint="Will regenerate type bindings on save" />
          <ValidationLine ok label="Model accessible" hint="claude-sonnet-4-5 · primary" />
        </Panel>

        <Panel title="Impact" subtitle="What changes on save" padded>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11.5, color: "var(--text-2)" }}>
            <ImpactLine label="In-flight runs" value="finish on old version" muted />
            <ImpactLine label="New runs" value="use draft" />
            <ImpactLine label="Listening agents" value="3" />
            <ImpactLine label="Downstream agents" value="2" />
            <ImpactLine label="Estimated rollout" value="< 5 s" />
          </div>
        </Panel>
      </div>
    </div>
  );
}

const editSelectStyle = {
  background: "var(--panel-2)", border: "1px solid var(--border-2)", borderRadius: 4,
  padding: "5px 8px", color: "var(--text)", fontFamily: "var(--mono)", fontSize: 12, outline: "none",
  width: "100%",
};

function EditField({ label, hint, children }) {
  return (
    <div style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
      <div style={{ fontSize: 11, color: "var(--text)", marginBottom: 3, fontWeight: 500 }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 6, lineHeight: 1.5 }}>{hint}</div>}
      {children}
    </div>
  );
}
function EditText({ value, onChange, mono, suffix }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--panel-2)", border: "1px solid var(--border-2)", borderRadius: 4, padding: "5px 8px" }}>
      <input value={value} onChange={e => onChange(e.target.value)} style={{
        flex: 1, background: "transparent", border: "none", outline: "none",
        color: "var(--text)", fontFamily: mono ? "var(--mono)" : "var(--sans)", fontSize: mono ? 11.5 : 12,
      }} />
      {suffix && <span style={{ fontSize: 10.5, color: "var(--text-3)", fontFamily: "var(--mono)" }}>{suffix}</span>}
    </div>
  );
}
function EditTextarea({ value, onChange, rows = 3, mono }) {
  return (
    <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows} style={{
      width: "100%",
      background: "var(--panel-2)", border: "1px solid var(--border-2)", borderRadius: 4,
      padding: "6px 8px", color: "var(--text)",
      fontFamily: mono ? "var(--mono)" : "var(--sans)", fontSize: mono ? 11.5 : 12,
      outline: "none", resize: "vertical",
      lineHeight: 1.55,
    }} />
  );
}
function Seg({ value, onChange, options }) {
  return (
    <div style={{ display: "inline-flex", border: "1px solid var(--border-2)", borderRadius: 4, overflow: "hidden" }}>
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)} style={{
          padding: "5px 12px", fontSize: 11.5,
          background: value === o.value ? "var(--panel-3)" : "var(--panel-2)",
          color: value === o.value ? "var(--text)" : "var(--text-3)",
          borderRight: "1px solid var(--border-2)",
          borderBottom: value === o.value ? "2px solid var(--signal)" : "2px solid transparent",
        }}>{o.label}</button>
      ))}
    </div>
  );
}
function EditableEventList({ items, tone, placeholder = "EVENT_NAME" }) {
  const colorMap = {
    blue:  { fg: "var(--blue)",   bg: "rgba(132,169,255,0.10)", bd: "rgba(132,169,255,0.32)" },
    green: { fg: "var(--green)",  bg: "rgba(101,224,163,0.08)", bd: "rgba(101,224,163,0.30)" },
    muted: { fg: "var(--text-2)", bg: "var(--panel-2)",          bd: "var(--border)" },
  };
  const c = colorMap[tone] || colorMap.muted;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {items.map(t => (
        <span key={t} style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "2px 4px 2px 7px",
          fontSize: 10.5, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.04em",
          color: c.fg, background: c.bg, border: `1px solid ${c.bd}`, borderRadius: 3,
        }}>
          {t}
          <button style={{ color: "currentColor", opacity: 0.6, padding: 1 }}><Icon name="x" size={8} /></button>
        </span>
      ))}
      <button style={{
        padding: "3px 7px", fontSize: 10.5, fontFamily: "var(--mono)",
        color: "var(--text-3)", border: "1px dashed var(--border-2)", borderRadius: 3,
      }}>+ {placeholder}</button>
    </div>
  );
}
function ValidationLine({ ok, warn, label, hint }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 11.5 }}>
      <Icon name={ok ? "check" : warn ? "alert" : "x"} size={11} style={{ color: ok ? "var(--green)" : warn ? "var(--amber)" : "var(--red)" }} />
      <span style={{ color: "var(--text-2)" }}>{label}</span>
      {hint && <span style={{ marginLeft: "auto", color: "var(--text-3)", fontFamily: "var(--mono)", fontSize: 10.5 }}>{hint}</span>}
    </div>
  );
}
function ImpactLine({ label, value, muted }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
      <span style={{ color: "var(--text-3)" }}>{label}</span>
      <span style={{ color: muted ? "var(--text-3)" : "var(--text)", fontFamily: "var(--mono)" }}>{value}</span>
    </div>
  );
}

// =====================================================
// Deploy agent — wizard modal
// =====================================================
const AGENT_TEMPLATES = [
  { id: "blank",   actor: "Agent", name: "Blank agent",          desc: "Empty handler. Bring your own steps + prompt.",                                color: "var(--text-3)" },
  { id: "classify",actor: "Agent", name: "Classifier",           desc: "Single LLM call, returns one of N labels. Cheap and fast.",                    color: "var(--blue)" },
  { id: "extract", actor: "Agent", name: "Extractor",            desc: "Pulls structured JSON from unstructured input. JSON schema enforced.",         color: "var(--blue)" },
  { id: "rag",     actor: "Agent", name: "RAG retriever",        desc: "Embeds question, fetches top-k chunks, answers with citations.",               color: "var(--violet)" },
  { id: "loop",    actor: "Agent", name: "Tool-loop agent",      desc: "Iterates tool calls until done. Use for research, browsing, data lookups.",    color: "var(--signal)" },
  { id: "human",   actor: "Human", name: "Human approval",       desc: "Pauses the workflow for an operator to approve, reject, or supplement.",       color: "var(--violet)" },
];

const COMMON_TOOLS = [
  { id: "db.query",      kind: "Data",         hint: "Read from the run-state DB" },
  { id: "db.upsert",     kind: "Data",         hint: "Write/update rows" },
  { id: "db.lock",       kind: "Data",         hint: "Acquire a distributed lock" },
  { id: "http.fetch",    kind: "Network",      hint: "HTTP GET/POST with retry" },
  { id: "llm.generate",  kind: "Model",        hint: "Direct LLM call (escape hatch)" },
  { id: "llm.evaluate",  kind: "Model",        hint: "LLM-as-judge rubric scoring" },
  { id: "ocr.parse",     kind: "Document",     hint: "PDF → text + structure" },
  { id: "nlp.extract",   kind: "Document",     hint: "Entity / field extraction" },
  { id: "pdf.compose",   kind: "Document",     hint: "Render markdown → PDF" },
  { id: "scoring.match", kind: "Domain",       hint: "Resume↔JD matcher (RAAS)" },
  { id: "email.send",    kind: "Notify",       hint: "Transactional email" },
  { id: "wechat.notify", kind: "Notify",       hint: "WeChat Work bot" },
  { id: "ats.adapter",   kind: "Integration",  hint: "Client ATS submit" },
];

function DeployAgentModal({ onClose }) {
  const [step, setStep] = useStateAg(0); // 0..4
  const [template, setTemplate] = useStateAg(null);
  const [name, setName] = useStateAg("");
  const [title, setTitle] = useStateAg("");
  const [desc, setDesc] = useStateAg("");
  const [stage, setStage] = useStateAg(5);
  const [model, setModel] = useStateAg("claude-sonnet-4-5");
  const [tools, setTools] = useStateAg([]);
  const [triggers, setTriggers] = useStateAg([]);
  const [emits, setEmits] = useStateAg([]);
  const [retries, setRetries] = useStateAg(3);
  const [timeout, setTimeoutVal] = useStateAg(120);
  const [concurrency, setConcurrency] = useStateAg(8);
  const [implTab, setImplTab] = useStateAg("prompt");
  const [tsCode, setTsCode] = useStateAg(window.AGENT_SAMPLE_TS_CODE);
  const [toolUse, setToolUse] = useStateAg(window.AGENT_SAMPLE_TOOL_USE);

  const steps = ["Template", "Identity", "Events", "Implementation", "Behavior", "Review"];

  function pickTemplate(t) {
    setTemplate(t);
    // Hydrate sensible defaults
    if (t.id === "classify") { setTools(["llm.generate"]); }
    if (t.id === "extract")  { setTools(["llm.generate", "db.upsert"]); }
    if (t.id === "rag")      { setTools(["http.fetch", "llm.generate"]); }
    if (t.id === "loop")     { setTools(["http.fetch", "db.query", "llm.generate"]); }
    setStep(1);
  }
  function next() { setStep(s => Math.min(steps.length - 1, s + 1)); }
  function back() { setStep(s => Math.max(0, s - 1)); }
  function toggleTool(id) { setTools(ts => ts.includes(id) ? ts.filter(t => t !== id) : [...ts, id]); }
  function addEvent(set, val) { const v = val.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_"); if (v) set(arr => arr.includes(v) ? arr : [...arr, v]); }
  function removeEvent(set, v) { set(arr => arr.filter(x => x !== v)); }

  return (
    <ModalOverlayA onClose={onClose}>
      <div style={{ width: 1080, maxHeight: "88vh", background: "var(--panel)", border: "1px solid var(--border-2)", borderRadius: 8, overflow: "hidden", boxShadow: "0 24px 60px -20px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column" }}>
        {/* Header + stepper */}
        <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <Icon name="agent" size={14} style={{ color: "var(--signal)" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 500 }}>Deploy new agent</div>
            <div style={{ fontSize: 11, color: "var(--text-3)" }}>Added as a draft to workflow <span className="mono">raas</span>. Connect it to events on the workflow canvas after deploy.</div>
          </div>
          <button onClick={onClose} style={{ color: "var(--text-3)" }}><Icon name="x" size={13} /></button>
        </header>

        <div style={{ display: "flex", gap: 6, padding: "10px 18px", borderBottom: "1px solid var(--border)", background: "var(--bg-2)" }}>
          {steps.map((s, i) => (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 6, opacity: i === step ? 1 : i < step ? 0.85 : 0.45 }}>
              <span style={{
                width: 18, height: 18, borderRadius: "50%",
                background: i < step ? "var(--signal)" : i === step ? "transparent" : "transparent",
                border: `1px solid ${i <= step ? "var(--signal)" : "var(--border-2)"}`,
                color: i < step ? "#000" : i === step ? "var(--signal)" : "var(--text-3)",
                fontSize: 10, fontFamily: "var(--mono)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>{i < step ? "✓" : i + 1}</span>
              <span style={{ fontSize: 11, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.06em", color: i === step ? "var(--text)" : "var(--text-3)" }}>{s}</span>
              {i < steps.length - 1 && <span style={{ width: 14, height: 1, background: "var(--border)", marginLeft: 4 }} />}
            </div>
          ))}
        </div>

        <div style={{ padding: 20, overflow: "auto", flex: 1, minHeight: 0 }}>
          {step === 0 && (
            <div>
              <div style={{ fontSize: 11, fontFamily: "var(--mono)", textTransform: "uppercase", color: "var(--text-3)", letterSpacing: "0.08em", marginBottom: 10 }}>Pick a template</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                {AGENT_TEMPLATES.map(t => (
                  <button key={t.id} onClick={() => pickTemplate(t)} style={{
                    padding: "12px 14px",
                    background: "var(--panel-2)",
                    border: "1px solid var(--border)",
                    borderLeft: `3px solid ${t.color}`,
                    borderRadius: 5,
                    textAlign: "left", cursor: "pointer",
                    transition: "background 0.12s, border-color 0.12s",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.background = "var(--panel-3)"; e.currentTarget.style.borderColor = "var(--signal)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "var(--panel-2)"; e.currentTarget.style.borderColor = "var(--border)"; }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <ActorTag actor={t.actor} />
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 500, marginBottom: 3 }}>{t.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-2)", lineHeight: 1.5 }}>{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 1 && template && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, maxWidth: 760 }}>
              <EditField label="Name (id)" hint="lowercase camelCase, used in events & logs">
                <EditText value={name} onChange={setName} mono />
              </EditField>
              <EditField label="Title" hint="Shown in the operator UI">
                <EditText value={title} onChange={setTitle} />
              </EditField>
              <div style={{ gridColumn: "1 / -1" }}>
                <EditField label="Description" hint="One paragraph. Shown in the workflow graph inspector.">
                  <EditTextarea value={desc} onChange={setDesc} rows={3} />
                </EditField>
              </div>
              <EditField label="Workflow stage" hint="Column on the workflow canvas.">
                <select value={stage} onChange={e => setStage(parseInt(e.target.value))} style={editSelectStyle}>
                  {window.RAAS_STAGES.map(s => <option key={s.id} value={s.id}>{String(s.id).padStart(2, "0")} · {s.label}</option>)}
                </select>
              </EditField>
              <EditField label="Actor" hint={template.actor === "Human" ? "Pauses for operator input" : "Runs automatically"}>
                <Seg value={template.actor} onChange={() => {}} options={[{ value: "Agent", label: "Agent" }, { value: "Human", label: "Human task" }]} />
              </EditField>
            </div>
          )}

          {step === 2 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, maxWidth: 760 }}>
              <EditField label="Listens to (triggers)" hint="Pick existing events from the workflow, or type new EVENT_NAMEs.">
                <EventPicker selected={triggers} onAdd={(v) => addEvent(setTriggers, v)} onRemove={(v) => removeEvent(setTriggers, v)} tone="blue" />
              </EditField>
              <EditField label="Emits (outbound)" hint="The events this agent publishes. Downstream agents listen to these.">
                <EventPicker selected={emits} onAdd={(v) => addEvent(setEmits, v)} onRemove={(v) => removeEvent(setEmits, v)} tone="green" />
              </EditField>
            </div>
          )}

          {step === 3 && (
            <div>
              {/* Implementation tabs */}
              <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)", marginBottom: 14 }}>
                {[
                  { id: "prompt", label: "System prompt", icon: "logs" },
                  { id: "code",   label: "TypeScript code", icon: "code" },
                  { id: "tools",  label: "tool_use",      icon: "spark" },
                  { id: "bind",   label: "Tool bindings", icon: "git" },
                ].map(t => (
                  <button key={t.id} onClick={() => setImplTab(t.id)} style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "8px 14px",
                    fontSize: 11.5, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.06em",
                    color: implTab === t.id ? "var(--text)" : "var(--text-3)",
                    borderBottom: `2px solid ${implTab === t.id ? "var(--signal)" : "transparent"}`,
                    marginBottom: -1,
                  }}>
                    <Icon name={t.icon} size={11} />
                    {t.label}
                    {t.id === "tools" && <span style={{ marginLeft: 4, padding: "0 5px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 9.5, color: "var(--text-3)" }}>{toolUse.length}</span>}
                    {t.id === "bind" && <span style={{ marginLeft: 4, padding: "0 5px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 9.5, color: "var(--text-3)" }}>{tools.length}</span>}
                  </button>
                ))}
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                  <span style={{ fontSize: 11, color: "var(--text-3)" }}>Model</span>
                  <select value={model} onChange={e => setModel(e.target.value)} style={{
                    background: "var(--panel-2)", border: "1px solid var(--border-2)", borderRadius: 4,
                    padding: "4px 8px", color: "var(--text)", fontFamily: "var(--mono)", fontSize: 11.5, outline: "none",
                  }}>
                    <option>claude-sonnet-4-5</option>
                    <option>claude-haiku-4-5</option>
                    <option>gpt-4.1-mini</option>
                  </select>
                </div>
              </div>

              {implTab === "prompt" && (
                <EditField label="System prompt" hint="Prepended to every request. Use {{vars}} to interpolate run context.">
                  <EditTextarea
                    value={`You are an automated agent named ${name || "<name>"} in the RAAS workflow.\nGoal: ${title || "<title>"}.\n\nFollow these rules:\n- Emit one structured progress event per step.\n- Never block on human input — emit a HUMAN_TASK event if needed.\n- Be conservative; if uncertain, fall through to manual review.`}
                    onChange={() => {}}
                    rows={14}
                    mono
                  />
                </EditField>
              )}

              {implTab === "code" && (
                <window.AgentCodeEditPanel value={tsCode} onChange={setTsCode} height={480} />
              )}

              {implTab === "tools" && (
                <window.AgentToolUseEditPanel tools={toolUse} onChange={setToolUse} />
              )}

              {implTab === "bind" && (
                <EditField label={`Tool bindings · ${tools.length} selected`} hint="Workspace tools this agent's code may invoke at runtime. These are infrastructure (DB, HTTP, etc.) — separate from tool_use definitions handed to the LLM.">
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, maxHeight: 420, overflow: "auto", padding: 2 }}>
                    {COMMON_TOOLS.map(t => {
                      const on = tools.includes(t.id);
                      return (
                        <button key={t.id} onClick={() => toggleTool(t.id)} style={{
                          display: "flex", alignItems: "center", gap: 8,
                          padding: "7px 9px",
                          background: on ? "rgba(208,255,0,0.06)" : "var(--panel-2)",
                          border: `1px solid ${on ? "var(--signal)" : "var(--border)"}`,
                          borderRadius: 4, textAlign: "left",
                        }}>
                          <span style={{
                            width: 12, height: 12, borderRadius: 2,
                            background: on ? "var(--signal)" : "transparent",
                            border: `1px solid ${on ? "var(--signal)" : "var(--border-3)"}`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                            {on && <Icon name="check" size={9} style={{ color: "#000" }} />}
                          </span>
                          <span className="mono" style={{ fontSize: 11.5, color: "var(--text)" }}>{t.id}</span>
                          <Badge tone="muted" style={{ marginLeft: "auto" }}>{t.kind}</Badge>
                        </button>
                      );
                    })}
                  </div>
                </EditField>
              )}
            </div>
          )}

          {step === 4 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, maxWidth: 760 }}>
              <EditField label="Retries" hint="On tool/model errors. Exponential backoff.">
                <EditText value={String(retries)} onChange={v => setRetries(parseInt(v) || 0)} mono suffix="attempts" />
              </EditField>
              <EditField label="Per-run timeout">
                <EditText value={String(timeout)} onChange={v => setTimeoutVal(parseInt(v) || 0)} mono suffix="seconds" />
              </EditField>
              <EditField label="Concurrency" hint="Max simultaneous runs.">
                <EditText value={String(concurrency)} onChange={v => setConcurrency(parseInt(v) || 0)} mono suffix="runs" />
              </EditField>
              <EditField label="Concurrency key" hint="Partition by a payload field — one run per key at a time.">
                <EditText value="${event.payload.candidate_id}" mono onChange={() => {}} />
              </EditField>
              <div style={{ gridColumn: "1 / -1" }}>
                <EditField label="Dead-letter queue" hint="Where failed runs go after retries are exhausted.">
                  <Seg value="audit" onChange={() => {}} options={[
                    { value: "audit", label: "Audit log (default)" },
                    { value: "queue", label: "DLQ for replay" },
                    { value: "human", label: "Page human · #ops-alerts" },
                  ]} />
                </EditField>
              </div>
            </div>
          )}

          {step === 5 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Panel title="Manifest" padded={false}>
                <CodeBlock>{JSON.stringify({
                  id: `${stage}-new`,
                  name: name || "newAgent",
                  title: title || "New agent",
                  actor: template?.actor || "Agent",
                  stage,
                  template: template?.id,
                  triggers,
                  emits,
                  tools,
                  model,
                  retries: { max: retries, backoff: "exponential" },
                  concurrency: { limit: concurrency, key: "${event.payload.candidate_id}" },
                  timeout_s: timeout,
                  typescript_code: template?.actor === "Human" ? null : `<inline · ${tsCode.split("\n").length} lines>`,
                  tool_use: template?.actor === "Human" ? [] : toolUse.map(t => ({
                    name: t.name,
                    description: t.description,
                    params: Object.keys((t.input_schema && t.input_schema.properties) || {}),
                  })),
                }, null, 2)}</CodeBlock>
              </Panel>
              <div>
                <Panel title="Pre-flight" padded>
                  <ValidationLine ok label="Identity valid" hint={name ? "✓" : "name required"} warn={!name} />
                  <ValidationLine ok label={`${triggers.length} trigger event(s)`} warn={triggers.length === 0} />
                  <ValidationLine ok label={`${emits.length} emit event(s)`} warn={emits.length === 0} />
                  <ValidationLine ok label={`${tools.length} tool bindings`} />
                  {template?.actor !== "Human" && <ValidationLine ok label={`typescript_code · ${tsCode.split("\n").length} lines`} hint="compiles" />}
                  {template?.actor !== "Human" && <ValidationLine ok label={`tool_use · ${toolUse.length} defined`} hint="schemas valid" warn={toolUse.length === 0} />}
                  <ValidationLine ok label="Model accessible" hint={model} />
                </Panel>
                <Panel title="Deploy target" padded style={{ marginTop: 12 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <DeployTargetRow on label="Staging · raas-stage" sub="Smoke test before prod" />
                    <DeployTargetRow label="Production · raas" sub="Live event stream" warn />
                  </div>
                  <div style={{ marginTop: 10, padding: "8px 10px", background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 4, fontSize: 11, color: "var(--text-3)", lineHeight: 1.55 }}>
                    Will save as <span className="mono" style={{ color: "var(--text-2)" }}>raas@2026.05.18-draft</span>. Roll forward to prod from the Deployments page.
                  </div>
                </Panel>
              </div>
            </div>
          )}
        </div>

        <footer style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 18px", borderTop: "1px solid var(--border)", background: "var(--panel-2)" }}>
          {step > 0 && <Button tone="ghost" icon="chevron-left" onClick={back}>Back</Button>}
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>Step {step + 1} of {steps.length}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <Button tone="ghost" onClick={onClose}>Cancel</Button>
            {step < steps.length - 1
              ? <Button tone="primary" onClick={next}>Continue</Button>
              : <Button tone="primary" icon="deploy" onClick={onClose}>Deploy to staging</Button>}
          </div>
        </footer>
      </div>
    </ModalOverlayA>
  );
}

function EventPicker({ selected, onAdd, onRemove, tone }) {
  const [input, setInput] = useStateAg("");
  const allEvents = window.RAAS_EVENTS.map(e => e.name);
  const colorMap = {
    blue:  { fg: "var(--blue)",   bg: "rgba(132,169,255,0.10)", bd: "rgba(132,169,255,0.32)" },
    green: { fg: "var(--green)",  bg: "rgba(101,224,163,0.08)", bd: "rgba(101,224,163,0.30)" },
  };
  const c = colorMap[tone] || colorMap.blue;
  const suggestions = input
    ? allEvents.filter(e => e.toLowerCase().includes(input.toLowerCase()) && !selected.includes(e)).slice(0, 6)
    : [];

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6, minHeight: 22 }}>
        {selected.length === 0 && <span style={{ fontSize: 11, color: "var(--text-3)" }}>None yet — type a name below to add.</span>}
        {selected.map(t => (
          <span key={t} style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "2px 4px 2px 7px",
            fontSize: 10.5, fontFamily: "var(--mono)", textTransform: "uppercase",
            color: c.fg, background: c.bg, border: `1px solid ${c.bd}`, borderRadius: 3,
          }}>
            {t}
            <button onClick={() => onRemove(t)} style={{ color: "currentColor", opacity: 0.6, padding: 1 }}><Icon name="x" size={8} /></button>
          </span>
        ))}
      </div>
      <div style={{ position: "relative" }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && input.trim()) { onAdd(input); setInput(""); }
          }}
          placeholder="Type EVENT_NAME, press enter…"
          style={{
            width: "100%",
            background: "var(--panel-2)", border: "1px solid var(--border-2)", borderRadius: 4,
            padding: "5px 8px", color: "var(--text)", fontFamily: "var(--mono)", fontSize: 11.5, outline: "none",
          }}
        />
        {suggestions.length > 0 && (
          <div style={{
            position: "absolute", top: "100%", left: 0, right: 0, marginTop: 2,
            background: "var(--panel)", border: "1px solid var(--border-2)", borderRadius: 4,
            boxShadow: "0 8px 20px rgba(0,0,0,0.4)", zIndex: 50,
            maxHeight: 180, overflow: "auto",
          }}>
            {suggestions.map(s => (
              <button key={s} onClick={() => { onAdd(s); setInput(""); }} style={{
                display: "flex", width: "100%", padding: "5px 8px",
                fontSize: 11.5, fontFamily: "var(--mono)", color: "var(--text-2)",
                textAlign: "left",
              }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--panel-2)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >{s}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DeployTargetRow({ label, sub, on, warn }) {
  return (
    <label style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "8px 10px",
      background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 4,
      cursor: "pointer",
    }}>
      <input type="checkbox" defaultChecked={on} style={{ accentColor: "var(--signal)" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: "var(--text)" }}>{label}</div>
        <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{sub}</div>
      </div>
      {warn && <Badge tone="amber">requires approval</Badge>}
    </label>
  );
}

function ModalOverlayA({ onClose, children }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.5)",
      display: "flex", justifyContent: "center", alignItems: "center",
      backdropFilter: "blur(2px)",
      animation: "fadein 0.14s ease",
    }}>
      <div onClick={e => e.stopPropagation()}>{children}</div>
    </div>
  );
}

window.Agents = Agents;