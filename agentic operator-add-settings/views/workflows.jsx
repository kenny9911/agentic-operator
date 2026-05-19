// Workflows — DAG canvas of all agents wired by events

const { useState: useStateWf, useMemo: useMemoWf, useRef: useRefWf, useEffect: useEffectWf } = React;

const NODE_W = 184;
const NODE_H = 64;
const COL_W = 220;
const ROW_H = 90;
const PAD_X = 30;
const PAD_Y = 30;

// Lane positions within each stage (column)
const LAYOUT = {
  "1-1": { stage: 0, lane: 0 },
  "1-2": { stage: 0, lane: 1 },
  "2":   { stage: 1, lane: 0 },
  "3":   { stage: 1, lane: 1 },
  "3-2": { stage: 1, lane: 2 },
  "4":   { stage: 2, lane: 0 },
  "5":   { stage: 2, lane: 1 },
  "6":   { stage: 3, lane: 0 },
  "7-1": { stage: 3, lane: 1 },
  "7-2": { stage: 3, lane: 2 },
  "8":   { stage: 4, lane: 0 },
  "9-1": { stage: 4, lane: 1 },
  "9-2": { stage: 4, lane: 2 },
  "10":  { stage: 5, lane: 0 },
  "11-1":{ stage: 5, lane: 1 },
  "11-2":{ stage: 5, lane: 2 },
  "12":  { stage: 5, lane: 3 },
  "13":  { stage: 6, lane: 0 },
  "14-1":{ stage: 6, lane: 1 },
  "14-2":{ stage: 6, lane: 2 },
  "15":  { stage: 6, lane: 3 },
  "16":  { stage: 7, lane: 1 },
};

function nodePos(id) {
  const p = LAYOUT[id];
  if (!p) return { x: 0, y: 0 };
  return { x: PAD_X + p.stage * COL_W, y: PAD_Y + p.lane * ROW_H };
}

function Workflows({ navigate, liveStream }) {
  const agents = window.RAAS_AGENTS;
  const events = window.RAAS_EVENTS;
  const stages = window.RAAS_STAGES;

  const [selectedAgent, setSelectedAgent] = useStateWf(null);
  const [selectedEvent, setSelectedEvent] = useStateWf(null);
  const [hoveredEdge, setHoveredEdge] = useStateWf(null);
  const [editing, setEditing] = useStateWf(false);
  const [tool, setTool] = useStateWf("select"); // select | connect | add
  const [showNewModal, setShowNewModal] = useStateWf(false);

  // Build edges: for each agent's emitted event, find listeners
  const edges = useMemoWf(() => {
    const out = [];
    agents.forEach(src => {
      (src.emits || []).forEach(evName => {
        const listeners = agents.filter(a => a.triggers.includes(evName));
        listeners.forEach(dst => {
          if (LAYOUT[src.id] && LAYOUT[dst.id]) {
            out.push({ src: src.id, dst: dst.id, event: evName });
          }
        });
      });
    });
    return out;
  }, [agents]);

  // Event color lookup
  const evColor = useMemoWf(() => {
    const m = {};
    events.forEach(e => { m[e.name] = e.color; });
    return m;
  }, [events]);

  const colorVar = (c) => ({
    green: "var(--green)", blue: "var(--blue)", amber: "var(--amber)",
    red: "var(--red)", muted: "var(--text-3)",
  }[c] || "var(--text-3)");

  // Canvas size
  const maxStage = 7, maxLane = 3;
  const canvasW = PAD_X * 2 + (maxStage + 1) * COL_W;
  const canvasH = PAD_Y * 2 + (maxLane + 1) * ROW_H;

  // Highlight set when an agent or event is selected
  const highlighted = useMemoWf(() => {
    const nodes = new Set();
    const edgeSet = new Set();
    if (selectedAgent) {
      nodes.add(selectedAgent);
      edges.forEach((e, i) => {
        if (e.src === selectedAgent || e.dst === selectedAgent) {
          edgeSet.add(i);
          nodes.add(e.src); nodes.add(e.dst);
        }
      });
    }
    if (selectedEvent) {
      edges.forEach((e, i) => {
        if (e.event === selectedEvent) {
          edgeSet.add(i);
          nodes.add(e.src); nodes.add(e.dst);
        }
      });
    }
    return { nodes, edges: edgeSet };
  }, [selectedAgent, selectedEvent, edges]);

  const dim = (selectedAgent || selectedEvent) ? true : false;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ViewHeader
        title="Workflows"
        subtitle={editing
          ? <>Editing draft of <span className="mono" style={{ color: "var(--text)" }}>raas</span> · changes won't affect live runs until you deploy.</>
          : "The RAAS agent graph — nodes are agents, edges are events. Click any node or event to trace its flow."
        }
        badge={editing
          ? <Badge tone="amber"><Icon name="alert" size={9} /> DRAFT · raas@2026.05.18-draft</Badge>
          : <Badge tone="muted">raas · v2026.05.16-a</Badge>
        }
        action={editing
          ? [
              <Button key="discard" small tone="ghost" onClick={() => setEditing(false)}>Discard draft</Button>,
              <Button key="val" small icon="check" tone="ghost">Validate</Button>,
              <Button key="dep" small icon="deploy" tone="primary">Deploy draft</Button>,
            ]
          : [
              <Button key="edit" icon="code" small onClick={() => setEditing(true)}>Edit workflow</Button>,
              <Button key="new" icon="plus" tone="primary" small onClick={() => setShowNewModal(true)}>New workflow</Button>,
              <Button key="upload" icon="upload" small>Import manifest</Button>,
            ]
        }
      />

      {/* Draft banner with diff */}
      {editing && (
        <EditDraftBanner onDiscard={() => setEditing(false)} />
      )}

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 280px", minHeight: 0 }}>
        {/* Canvas */}
        <div style={{
          position: "relative", overflow: "auto",
          background: `var(--bg)`,
          backgroundImage: `radial-gradient(circle, var(--border) 1px, transparent 1px)`,
          backgroundSize: "22px 22px",
          backgroundPosition: "0 0",
        }}>
          {editing && <EditToolbar tool={tool} setTool={setTool} />}
          {/* Stage headers row */}
          <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 28, display: "flex", paddingLeft: PAD_X, pointerEvents: "none" }}>
            {stages.map((s, i) => (
              <div key={s.id} style={{
                width: COL_W,
                padding: "8px 0 0 6px",
                fontSize: 10, fontFamily: "var(--mono)", fontWeight: 500,
                textTransform: "uppercase", letterSpacing: "0.12em",
                color: "var(--text-3)",
              }}>
                {String(i).padStart(2, "0")} · {s.label}
              </div>
            ))}
          </div>

          <div style={{ width: canvasW, height: canvasH + 30, position: "relative", paddingTop: 30 }}>
            {/* Stage column dividers */}
            <div style={{ position: "absolute", inset: 30 + "px 0 0 0", pointerEvents: "none" }}>
              {stages.map((s, i) => i > 0 && (
                <div key={s.id} style={{
                  position: "absolute", top: 0, bottom: 0,
                  left: PAD_X + i * COL_W - 8,
                  width: 1, background: "var(--border)", opacity: 0.5,
                }} />
              ))}
            </div>

            {/* SVG edges */}
            <svg width={canvasW} height={canvasH} style={{ position: "absolute", top: 30, left: 0, pointerEvents: "none" }}>
              <defs>
                {["green", "blue", "amber", "red", "muted"].map(c => (
                  <marker key={c} id={`arrow-${c}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M0,0 L10,5 L0,10 z" fill={colorVar(c)} />
                  </marker>
                ))}
              </defs>
              {edges.map((e, i) => {
                const s = nodePos(e.src);
                const d = nodePos(e.dst);
                const sx = s.x + NODE_W;
                const sy = s.y + NODE_H / 2;
                const dx = d.x;
                const dy = d.y + NODE_H / 2;
                const c1x = sx + Math.max(40, (dx - sx) * 0.5);
                const c2x = dx - Math.max(40, (dx - sx) * 0.5);
                const path = `M ${sx} ${sy} C ${c1x} ${sy}, ${c2x} ${dy}, ${dx} ${dy}`;
                const color = colorVar(evColor[e.event] || "muted");
                const isHi = highlighted.edges.has(i) || hoveredEdge === i;
                const opacity = dim ? (isHi ? 1 : 0.10) : (isHi ? 1 : 0.55);
                return (
                  <g key={i} style={{ pointerEvents: "auto" }}>
                    <path
                      d={path}
                      stroke={color}
                      strokeWidth={isHi ? 2 : 1.25}
                      fill="none"
                      opacity={opacity}
                      markerEnd={`url(#arrow-${evColor[e.event] || "muted"})`}
                      style={{ cursor: "pointer", transition: "opacity 0.15s, stroke-width 0.15s" }}
                      onMouseEnter={() => setHoveredEdge(i)}
                      onMouseLeave={() => setHoveredEdge(null)}
                      onClick={() => setSelectedEvent(e.event)}
                    />
                    {/* Animated travelling dot on highlighted/live edges */}
                    {(liveStream && (isHi || (!dim && Math.abs((i * 37) % 7) === 0))) && (
                      <circle r="3" fill={color} opacity={isHi ? 1 : 0.85}>
                        <animateMotion dur={`${2.5 + (i % 5) * 0.4}s`} repeatCount="indefinite" begin={`${(i * 0.13) % 2}s`} path={path} />
                      </circle>
                    )}
                  </g>
                );
              })}
            </svg>

            {/* Agent nodes */}
            <div style={{ position: "absolute", top: 30, left: 0, width: canvasW, height: canvasH }}>
              {agents.map(a => {
                const p = nodePos(a.id);
                const isSel = selectedAgent === a.id;
                const isHi = highlighted.nodes.has(a.id);
                const showDim = dim && !isHi;
                // Mark a few mock "draft" nodes when editing
                const isAdded = editing && (a.id === "10" || a.id === "14-1");
                const isModified = editing && (a.id === "2" || a.id === "12");
                return (
                  <button
                    key={a.id}
                    onClick={(e) => { e.stopPropagation(); setSelectedAgent(isSel ? null : a.id); setSelectedEvent(null); }}
                    style={{
                      position: "absolute",
                      left: p.x, top: p.y,
                      width: NODE_W, height: NODE_H,
                      background: a.actor === "Agent" ? "var(--panel)" : "var(--panel-2)",
                      borderTop: `1px ${editing ? "dashed" : "solid"} ${isSel ? "var(--signal)" : isAdded ? "var(--green)" : isModified ? "var(--amber)" : isHi ? "var(--border-3)" : "var(--border-2)"}`,
                      borderRight: `1px ${editing ? "dashed" : "solid"} ${isSel ? "var(--signal)" : isAdded ? "var(--green)" : isModified ? "var(--amber)" : isHi ? "var(--border-3)" : "var(--border-2)"}`,
                      borderBottom: `1px ${editing ? "dashed" : "solid"} ${isSel ? "var(--signal)" : isAdded ? "var(--green)" : isModified ? "var(--amber)" : isHi ? "var(--border-3)" : "var(--border-2)"}`,
                      borderLeft: `3px solid ${a.actor === "Agent" ? "var(--signal)" : "var(--violet)"}`,
                      borderRadius: 5,
                      padding: "8px 10px",
                      textAlign: "left",
                      cursor: editing ? "move" : "pointer",
                      opacity: showDim ? 0.30 : 1,
                      transition: "opacity 0.15s, border-color 0.12s, box-shadow 0.12s",
                      boxShadow: isSel ? "0 0 0 3px rgba(208,255,0,0.12)" : "none",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <ActorTag actor={a.actor} />
                      {isAdded && <Badge tone="green">NEW</Badge>}
                      {isModified && <Badge tone="amber">MOD</Badge>}
                      <span style={{ marginLeft: "auto", fontSize: 10, fontFamily: "var(--mono)", color: "var(--text-3)" }}>{a.id}</span>
                    </div>
                    <div style={{
                      fontSize: 12.5, color: "var(--text)", fontWeight: 500,
                      lineHeight: 1.2,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                    }}>
                      {a.title}
                    </div>
                    {/* Edit-mode handles */}
                    {editing && isSel && (
                      <>
                        {["top","right","bottom","left"].map(s => (
                          <span key={s} style={{
                            position: "absolute",
                            width: 8, height: 8, background: "var(--signal)", border: "1px solid var(--bg)",
                            borderRadius: 1,
                            top: s === "top" ? -4 : s === "bottom" ? "calc(100% - 4px)" : "calc(50% - 4px)",
                            left: s === "left" ? -4 : s === "right" ? "calc(100% - 4px)" : "calc(50% - 4px)",
                          }} />
                        ))}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right sidebar: event legend + selected agent inspector */}
        <aside style={{
          borderLeft: "1px solid var(--border)",
          background: "var(--panel)",
          display: "flex", flexDirection: "column",
          minHeight: 0,
        }}>
          {selectedAgent ? (
            editing
              ? <NodeEditor
                  agent={agents.find(a => a.id === selectedAgent)}
                  onClose={() => setSelectedAgent(null)}
                />
              : <AgentInspector
                  agent={agents.find(a => a.id === selectedAgent)}
                  onClose={() => setSelectedAgent(null)}
                  onOpenFull={() => navigate("agents", { agentId: selectedAgent })}
                />
          ) : selectedEvent ? (
            <EventInspector
              eventName={selectedEvent}
              onClose={() => setSelectedEvent(null)}
              navigate={navigate}
            />
          ) : (
            editing
              ? <DraftPalette onAddNode={() => {}} />
              : <DefaultInspector
                  events={events}
                  onPick={(name) => setSelectedEvent(name)}
                  agents={agents}
                />
          )}
        </aside>
      </div>
      {showNewModal && <NewWorkflowModal onClose={() => setShowNewModal(false)} navigate={navigate} />}
    </div>
  );
}

function DefaultInspector({ events, agents, onPick }) {
  const grouped = {
    agent: [], human: [], data: [], external: [], alert: [], system: [],
  };
  events.forEach(e => grouped[e.category]?.push(e));
  const labels = { agent: "From agents", human: "From humans", data: "Data", external: "External", alert: "Alerts", system: "System" };

  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 11, fontFamily: "var(--mono)", textTransform: "uppercase", color: "var(--text-3)", letterSpacing: "0.08em" }}>Legend</div>
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
          <LegendRow color="var(--signal)" label="Agent node" sub={agents.filter(a => a.actor === "Agent").length + " in workflow"} />
          <LegendRow color="var(--violet)" label="Human node" sub={agents.filter(a => a.actor === "Human").length + " in workflow"} />
        </div>
      </div>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 11, fontFamily: "var(--mono)", textTransform: "uppercase", color: "var(--text-3)", letterSpacing: "0.08em", marginBottom: 8 }}>
          Events · click to trace
        </div>
        {Object.entries(grouped).map(([cat, items]) => items.length > 0 && (
          <div key={cat} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--text-3)", marginBottom: 5 }}>{labels[cat]}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {items.map(e => (
                <button key={e.name} onClick={() => onPick(e.name)} style={{ display: "inline-block" }}>
                  <Badge tone={window.eventTone(e.color)} style={{ fontSize: 9.5, cursor: "pointer" }}>{e.name}</Badge>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ padding: "14px 16px", fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.55 }}>
        <strong style={{ color: "var(--text-2)", fontWeight: 500 }}>Tip</strong>
        <span> · Click any node to see what triggers and emits from it. Click any event to highlight every edge carrying it.</span>
      </div>
    </div>
  );
}

function LegendRow({ color, label, sub }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 10, height: 10, background: color, borderRadius: 2 }} />
      <span style={{ color: "var(--text)" }}>{label}</span>
      <span style={{ marginLeft: "auto", color: "var(--text-3)", fontSize: 11, fontFamily: "var(--mono)" }}>{sub}</span>
    </div>
  );
}

function AgentInspector({ agent, onClose, onOpenFull }) {
  if (!agent) return null;
  return (
    <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
      <header style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <ActorTag actor={agent.actor} />
            <Badge tone="muted">{agent.id}</Badge>
          </div>
          <div style={{ fontSize: 15, color: "var(--text)", fontWeight: 500, lineHeight: 1.3 }}>{agent.title}</div>
        </div>
        <Button small icon="x" tone="ghost" onClick={onClose} />
      </header>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.55 }}>{agent.description}</div>
      </div>
      {agent.steps && (
        <Section title="Steps">
          <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {agent.steps.map((s, i) => (
              <li key={s} style={{ display: "flex", gap: 8, padding: "4px 0", fontSize: 12 }}>
                <span style={{ color: "var(--text-3)", fontFamily: "var(--mono)", width: 18 }}>{i + 1}.</span>
                <span className="mono" style={{ color: "var(--text)" }}>{s}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}
      <Section title="Triggers">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {agent.triggers.length > 0 ? agent.triggers.map(t => <Badge key={t} tone="blue">{t}</Badge>) : <span style={{ fontSize: 11, color: "var(--text-3)" }}>None (manual)</span>}
        </div>
      </Section>
      <Section title="Emits">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {agent.emits.map(e => <Badge key={e} tone="green">{e}</Badge>)}
        </div>
      </Section>
      {agent.tools && (
        <Section title="Tools">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {agent.tools.map(t => <Badge key={t} tone="muted">{t}</Badge>)}
          </div>
        </Section>
      )}
      {agent.model && (
        <Section title="Model">
          <span className="mono" style={{ fontSize: 12, color: "var(--text)" }}>{agent.model}</span>
        </Section>
      )}
      <div style={{ padding: 14, marginTop: "auto", display: "flex", gap: 8, borderTop: "1px solid var(--border)" }}>
        <Button icon="external" onClick={onOpenFull} style={{ flex: 1 }}>Open agent</Button>
        <Button icon="run" tone="primary">Test run</Button>
      </div>
    </div>
  );
}

function EventInspector({ eventName, onClose, navigate }) {
  const ev = window.RAAS_EVENTS.find(e => e.name === eventName);
  const emitters = window.RAAS_AGENTS.filter(a => a.emits.includes(eventName));
  const listeners = window.RAAS_AGENTS.filter(a => a.triggers.includes(eventName));
  const recentInStream = window.RAAS_EVENT_STREAM.filter(e => e.name === eventName).slice(0, 4);

  return (
    <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
      <header style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <Badge tone={window.eventTone(ev?.color)} style={{ marginBottom: 8 }}>{eventName}</Badge>
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>category · {ev?.category}</div>
        </div>
        <Button small icon="x" tone="ghost" onClick={onClose} />
      </header>
      <Section title={`Emitted by · ${emitters.length}`}>
        <NodeList agents={emitters} onPick={(id) => navigate("agents", { agentId: id })} />
      </Section>
      <Section title={`Listened by · ${listeners.length}`}>
        <NodeList agents={listeners} onPick={(id) => navigate("agents", { agentId: id })} />
      </Section>
      <Section title={`Recent · ${recentInStream.length}`}>
        {recentInStream.map(e => (
          <div key={e.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 11.5 }}>
            <span className="mono" style={{ color: "var(--text-2)" }}>{e.id}</span>
            <span style={{ color: "var(--text-3)" }}>{window.fmtAgo(e.at)}</span>
          </div>
        ))}
      </Section>
      <div style={{ padding: 14, marginTop: "auto", borderTop: "1px solid var(--border)" }}>
        <Button icon="external" onClick={() => navigate("events", { eventName })} style={{ width: "100%" }}>View in event stream</Button>
      </div>
    </div>
  );
}

function NodeList({ agents, onPick }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {agents.map(a => (
        <button
          key={a.id}
          onClick={() => onPick(a.id)}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "6px 8px",
            background: "var(--panel-2)", border: "1px solid var(--border)",
            borderRadius: 4, textAlign: "left",
            fontSize: 12, color: "var(--text)",
          }}>
          <ActorTag actor={a.actor} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span>
        </button>
      ))}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ fontSize: 10.5, fontFamily: "var(--mono)", textTransform: "uppercase", color: "var(--text-3)", letterSpacing: "0.08em", marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

// =====================================================
// Edit mode — banner, toolbar, palette, node editor
// =====================================================

function EditDraftBanner({ onDiscard }) {
  return (
    <div style={{
      padding: "10px 24px",
      background: "rgba(255,181,71,0.06)",
      borderBottom: "1px solid rgba(255,181,71,0.25)",
      display: "flex", alignItems: "center", gap: 14,
      flexShrink: 0,
    }}>
      <Icon name="alert" size={12} style={{ color: "var(--amber)" }} />
      <div style={{ fontSize: 12, color: "var(--text)" }}>
        <span style={{ color: "var(--amber)", fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 10.5 }}>EDITING DRAFT</span>
        <span style={{ marginLeft: 12, color: "var(--text-2)" }}>2 nodes added · 2 modified · 0 removed</span>
        <span style={{ marginLeft: 12, color: "var(--text-3)", fontFamily: "var(--mono)" }}>auto-saved 12s ago</span>
      </div>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", fontSize: 11, fontFamily: "var(--mono)", color: "var(--text-3)" }}>
        <span><Kbd>⌘</Kbd> <Kbd>Z</Kbd> undo</span>
        <span><Kbd>V</Kbd> select</span>
        <span><Kbd>C</Kbd> connect</span>
        <span><Kbd>N</Kbd> add node</span>
      </div>
    </div>
  );
}

function EditToolbar({ tool, setTool }) {
  const tools = [
    { id: "select",  icon: "filter", label: "Select" },
    { id: "connect", icon: "git",    label: "Connect" },
    { id: "add",     icon: "plus",   label: "Add" },
  ];
  return (
    <div style={{
      position: "absolute", top: 12, left: 12, zIndex: 20,
      display: "flex", gap: 1,
      background: "var(--panel)",
      border: "1px solid var(--border-2)",
      borderRadius: 6,
      padding: 2,
      boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
    }}>
      {tools.map(t => (
        <button key={t.id} onClick={() => setTool(t.id)} title={t.label} style={{
          width: 32, height: 32,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: tool === t.id ? "var(--signal)" : "transparent",
          color: tool === t.id ? "#000" : "var(--text-2)",
          borderRadius: 4,
        }}>
          <Icon name={t.icon} size={13} />
        </button>
      ))}
      <div style={{ width: 1, background: "var(--border)", margin: "4px 4px" }} />
      <button title="Auto-layout" style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-2)" }}>
        <Icon name="dashboard" size={13} />
      </button>
      <button title="Zoom to fit" style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-2)" }}>
        <Icon name="external" size={13} />
      </button>
    </div>
  );
}

function DraftPalette({ onAddNode }) {
  const presets = [
    { kind: "Agent", title: "New agent node",    sub: "Code-backed step",    color: "var(--signal)" },
    { kind: "Human", title: "Human task",        sub: "Pause for approval",  color: "var(--violet)" },
    { kind: "Agent", title: "From template…",    sub: "matchResume, etc.",   color: "var(--text-3)" },
  ];
  return (
    <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 11, fontFamily: "var(--mono)", textTransform: "uppercase", color: "var(--text-3)", letterSpacing: "0.08em", marginBottom: 4 }}>Editing</div>
        <div style={{ fontSize: 14, color: "var(--text)" }}>raas <span style={{ color: "var(--amber)", fontFamily: "var(--mono)", fontSize: 11 }}>· DRAFT</span></div>
      </div>

      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 11, fontFamily: "var(--mono)", textTransform: "uppercase", color: "var(--text-3)", letterSpacing: "0.08em", marginBottom: 8 }}>Drag onto canvas</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {presets.map((p, i) => (
            <div key={i} draggable style={{
              padding: "8px 10px",
              background: "var(--panel-2)",
              border: "1px dashed var(--border-2)",
              borderLeft: `3px solid ${p.color}`,
              borderRadius: 4,
              cursor: "grab",
            }}>
              <div style={{ fontSize: 12, color: "var(--text)" }}>{p.title}</div>
              <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{p.sub}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 11, fontFamily: "var(--mono)", textTransform: "uppercase", color: "var(--text-3)", letterSpacing: "0.08em", marginBottom: 8 }}>Pending changes</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
          <DiffRow kind="mod" name="matchResume" hint="Bonus weights for WXG" />
          <DiffRow kind="mod" name="analyzeRequirement" hint="Added market.lookup tool" />
          <DiffRow kind="add" name="enrichCandidateLinkedIn" hint="New agent · stage 4" />
          <DiffRow kind="add" name="generateRecommendationPackage" hint="Wired to evaluateInterview" />
        </div>
      </div>

      <div style={{ padding: "14px 16px", marginTop: "auto", borderTop: "1px solid var(--border)", fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.55 }}>
        <Icon name="check" size={11} style={{ color: "var(--green)" }} /> Graph valid · 0 cycles · 0 orphans
      </div>
    </div>
  );
}

function DiffRow({ kind, name, hint }) {
  const tone = kind === "add" ? "var(--green)" : kind === "del" ? "var(--red)" : "var(--amber)";
  const sigil = kind === "add" ? "+" : kind === "del" ? "−" : "~";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 3 }}>
      <span className="mono" style={{ color: tone, width: 12, fontWeight: 700 }}>{sigil}</span>
      <span className="mono" style={{ color: "var(--text-2)", fontSize: 11.5 }}>{name}</span>
      <span style={{ marginLeft: "auto", color: "var(--text-3)", fontSize: 10.5 }}>{hint}</span>
    </div>
  );
}

function NodeEditor({ agent, onClose }) {
  const [name, setName] = useStateWf(agent.name);
  const [title, setTitle] = useStateWf(agent.title);
  const [desc, setDesc] = useStateWf(agent.description);
  if (!agent) return null;
  return (
    <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
      <header style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <Badge tone="amber"><Icon name="alert" size={9} /> EDITING</Badge>
            <Badge tone="muted">{agent.id}</Badge>
          </div>
          <div style={{ fontSize: 15, color: "var(--text)", fontWeight: 500, lineHeight: 1.3 }}>Edit node</div>
        </div>
        <Button small icon="x" tone="ghost" onClick={onClose} />
      </header>

      <Section title="Identity">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <FieldInline label="Name (id)">
            <InlineText value={name} onChange={setName} mono />
          </FieldInline>
          <FieldInline label="Title">
            <InlineText value={title} onChange={setTitle} />
          </FieldInline>
          <FieldInline label="Description">
            <InlineTextarea value={desc} onChange={setDesc} />
          </FieldInline>
          <FieldInline label="Actor">
            <div style={{ display: "flex", gap: 0, border: "1px solid var(--border-2)", borderRadius: 4, overflow: "hidden", width: "fit-content" }}>
              {["Agent", "Human"].map(o => (
                <button key={o} style={{
                  padding: "4px 10px", fontSize: 11, fontFamily: "var(--mono)", textTransform: "uppercase",
                  background: agent.actor === o ? "var(--panel-3)" : "var(--panel-2)",
                  color: agent.actor === o ? "var(--text)" : "var(--text-3)",
                  borderRight: "1px solid var(--border-2)",
                  borderBottom: agent.actor === o ? "2px solid var(--signal)" : "2px solid transparent",
                }}>{o}</button>
              ))}
            </div>
          </FieldInline>
        </div>
      </Section>

      <Section title="Triggers · inbound events">
        <EditableBadgeList items={agent.triggers} tone="blue" placeholder="EVENT_NAME" />
      </Section>

      <Section title="Emits · outbound events">
        <EditableBadgeList items={agent.emits} tone="green" placeholder="EVENT_NAME" />
      </Section>

      {agent.steps && (
        <Section title="Steps">
          <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
            {agent.steps.map((s, i) => (
              <li key={s} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 3, fontSize: 11.5 }}>
                <Icon name="filter" size={10} style={{ color: "var(--text-3)" }} title="Drag to reorder" />
                <span style={{ color: "var(--text-3)", fontFamily: "var(--mono)", width: 14 }}>{i + 1}.</span>
                <span className="mono" style={{ color: "var(--text)", flex: 1 }}>{s}</span>
                <button style={{ color: "var(--text-3)" }}><Icon name="x" size={10} /></button>
              </li>
            ))}
            <li><Button small icon="plus" tone="ghost">Add step</Button></li>
          </ol>
        </Section>
      )}

      {agent.tools && (
        <Section title="Tools">
          <EditableBadgeList items={agent.tools} tone="muted" placeholder="tool.name" />
        </Section>
      )}

      {agent.model && (
        <Section title="Model">
          <select defaultValue={agent.model} style={{
            background: "var(--panel-2)", border: "1px solid var(--border-2)", borderRadius: 4,
            padding: "5px 8px", color: "var(--text)", fontSize: 12, fontFamily: "var(--mono)", outline: "none",
            width: "100%",
          }}>
            <option>claude-sonnet-4-5</option>
            <option>claude-haiku-4-5</option>
            <option>gpt-4.1-mini</option>
          </select>
        </Section>
      )}

      <div style={{ padding: 14, marginTop: "auto", display: "flex", gap: 8, borderTop: "1px solid var(--border)" }}>
        <Button tone="danger" icon="x">Delete node</Button>
        <Button icon="check" tone="primary" style={{ marginLeft: "auto" }}>Apply</Button>
      </div>
    </div>
  );
}

function FieldInline({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      {children}
    </label>
  );
}
function InlineText({ value, onChange, mono }) {
  return (
    <input value={value} onChange={e => onChange(e.target.value)}
      style={{
        background: "var(--panel-2)", border: "1px solid var(--border-2)", borderRadius: 4,
        padding: "5px 8px", color: "var(--text)",
        fontFamily: mono ? "var(--mono)" : "var(--sans)", fontSize: mono ? 11.5 : 12, outline: "none",
      }}
    />
  );
}
function InlineTextarea({ value, onChange }) {
  return (
    <textarea value={value} onChange={e => onChange(e.target.value)} rows={3}
      style={{
        background: "var(--panel-2)", border: "1px solid var(--border-2)", borderRadius: 4,
        padding: "5px 8px", color: "var(--text)", fontFamily: "var(--sans)", fontSize: 12, outline: "none",
        resize: "vertical",
      }}
    />
  );
}
function EditableBadgeList({ items, tone, placeholder }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
      {items.map(t => (
        <span key={t} style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "2px 4px 2px 7px",
          fontSize: 10.5, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.04em",
          color: `var(--${tone === "muted" ? "text-3" : tone})`,
          background: `rgba(${tone === "blue" ? "132,169,255" : tone === "green" ? "101,224,163" : tone === "muted" ? "111,113,120" : "208,255,0"},0.10)`,
          border: `1px solid rgba(${tone === "blue" ? "132,169,255" : tone === "green" ? "101,224,163" : tone === "muted" ? "111,113,120" : "208,255,0"},0.32)`,
          borderRadius: 3,
        }}>
          {t}
          <button style={{ color: "currentColor", opacity: 0.6, padding: 1 }}><Icon name="x" size={8} /></button>
        </span>
      ))}
      <button style={{
        padding: "2px 7px", fontSize: 10.5, fontFamily: "var(--mono)",
        color: "var(--text-3)", border: "1px dashed var(--border-2)", borderRadius: 3,
      }}>+ {placeholder}</button>
    </div>
  );
}

// =====================================================
// New workflow modal
// =====================================================
const WORKFLOW_TEMPLATES = [
  { id: "raas",   name: "RAAS · Recruitment",  desc: "22-agent pipeline: sync → JD → match → submit", agents: 22, events: 33, color: "#d0ff00" },
  { id: "support",name: "Tier-1 Ticket Triage", desc: "Classify → enrich → route → draft reply",     agents: 11, events: 18, color: "#7c9eff" },
  { id: "finance",name: "Monthly Close",        desc: "GL reconcile → variance review → sign-off",   agents: 8,  events: 12, color: "#f5c46b" },
  { id: "rag",    name: "Doc Q&A · RAG",        desc: "Ingest → chunk → embed → answer",             agents: 5,  events: 7,  color: "#b594ff" },
  { id: "sales",  name: "Outbound Sequence",    desc: "Enrich lead → personalize → followups",       agents: 9,  events: 14, color: "#65e0a3" },
  { id: "compl",  name: "Compliance Review",    desc: "Detect PII → redact → audit → archive",       agents: 6,  events: 9,  color: "#ff6470" },
];

function NewWorkflowModal({ onClose, navigate }) {
  const [path, setPath] = useStateWf("template"); // blank | template | import
  const [name, setName] = useStateWf("");
  const [id, setId] = useStateWf("");
  const [tenant, setTenant] = useStateWf("raas");
  const [template, setTemplate] = useStateWf("raas");

  function suggestId(n) {
    const slug = n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!id || id === slugify(name)) setId(slug);
    setName(n);
  }
  function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

  return (
    <ModalOverlayW onClose={onClose}>
      <div style={{ width: 780, maxHeight: "86vh", background: "var(--panel)", border: "1px solid var(--border-2)", borderRadius: 8, overflow: "hidden", boxShadow: "0 24px 60px -20px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <Icon name="workflow" size={14} style={{ color: "var(--signal)" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 500 }}>New workflow</div>
            <div style={{ fontSize: 11, color: "var(--text-3)" }}>Workflows are versioned per-tenant. You'll be able to deploy to staging before prod.</div>
          </div>
          <button onClick={onClose} style={{ color: "var(--text-3)" }}><Icon name="x" size={13} /></button>
        </header>

        <div style={{ padding: 18, overflow: "auto", flex: 1 }}>
          {/* Starting point picker */}
          <div style={{ fontSize: 11, fontFamily: "var(--mono)", textTransform: "uppercase", color: "var(--text-3)", letterSpacing: "0.08em", marginBottom: 8 }}>Start from</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 20 }}>
            <PathCard active={path === "blank"}    onClick={() => setPath("blank")}    icon="plus"     title="Blank canvas" sub="Start with one trigger agent and build out from there." />
            <PathCard active={path === "template"} onClick={() => setPath("template")} icon="workflow" title="From template" sub="Pre-built workflows for common patterns." />
            <PathCard active={path === "import"}   onClick={() => setPath("import")}   icon="upload"   title="Import manifest" sub="Drop a workflow.json + actions.json." />
          </div>

          {/* Identity */}
          <div style={{ fontSize: 11, fontFamily: "var(--mono)", textTransform: "uppercase", color: "var(--text-3)", letterSpacing: "0.08em", marginBottom: 8 }}>Identity</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
            <FieldInline label="Display name">
              <InlineText value={name} onChange={suggestId} />
            </FieldInline>
            <FieldInline label="Workflow id (slug)">
              <InlineText value={id} onChange={setId} mono />
            </FieldInline>
            <FieldInline label="Tenant">
              <select value={tenant} onChange={e => setTenant(e.target.value)} style={{
                background: "var(--panel-2)", border: "1px solid var(--border-2)", borderRadius: 4,
                padding: "5px 8px", color: "var(--text)", fontSize: 12, outline: "none",
              }}>
                {window.TENANTS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </FieldInline>
            <FieldInline label="Default model">
              <select defaultValue="claude-sonnet-4-5" style={{
                background: "var(--panel-2)", border: "1px solid var(--border-2)", borderRadius: 4,
                padding: "5px 8px", color: "var(--text)", fontSize: 12, fontFamily: "var(--mono)", outline: "none",
              }}>
                <option>claude-sonnet-4-5</option>
                <option>claude-haiku-4-5</option>
                <option>gpt-4.1-mini</option>
              </select>
            </FieldInline>
          </div>

          {/* Path-specific body */}
          {path === "blank" && (
            <div>
              <div style={{ fontSize: 11, fontFamily: "var(--mono)", textTransform: "uppercase", color: "var(--text-3)", letterSpacing: "0.08em", marginBottom: 8 }}>Trigger</div>
              <div style={{ padding: 14, background: "var(--panel-2)", border: "1px dashed var(--border-3)", borderRadius: 6 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <FieldInline label="Trigger type">
                    <select style={{ background: "var(--panel)", border: "1px solid var(--border-2)", borderRadius: 4, padding: "5px 8px", color: "var(--text)", fontSize: 12, outline: "none" }}>
                      <option>Event (raised by another agent)</option>
                      <option>Scheduled (cron)</option>
                      <option>Webhook (HTTP)</option>
                      <option>Manual (operator)</option>
                    </select>
                  </FieldInline>
                  <FieldInline label="First agent name">
                    <InlineText value="processNewRequest" mono onChange={() => {}} />
                  </FieldInline>
                </div>
                <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.55 }}>
                  We'll create a single agent stub. You'll add downstream agents and wire events on the canvas.
                </div>
              </div>
            </div>
          )}

          {path === "template" && (
            <div>
              <div style={{ fontSize: 11, fontFamily: "var(--mono)", textTransform: "uppercase", color: "var(--text-3)", letterSpacing: "0.08em", marginBottom: 8 }}>Pick a template</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
                {WORKFLOW_TEMPLATES.map(t => (
                  <button key={t.id} onClick={() => setTemplate(t.id)} style={{
                    padding: "12px 14px",
                    background: template === t.id ? "var(--panel-3)" : "var(--panel-2)",
                    border: `1px solid ${template === t.id ? "var(--signal)" : "var(--border)"}`,
                    borderRadius: 5,
                    textAlign: "left",
                    cursor: "pointer",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <div style={{ width: 14, height: 14, background: t.color, borderRadius: 2 }} />
                      <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>{t.name}</span>
                      {template === t.id && <Icon name="check" size={11} style={{ color: "var(--signal)", marginLeft: "auto" }} />}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--text-2)", marginBottom: 6 }}>{t.desc}</div>
                    <div style={{ fontSize: 10.5, color: "var(--text-3)", fontFamily: "var(--mono)" }}>{t.agents} agents · {t.events} events</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {path === "import" && (
            <div>
              <div style={{ fontSize: 11, fontFamily: "var(--mono)", textTransform: "uppercase", color: "var(--text-3)", letterSpacing: "0.08em", marginBottom: 8 }}>Manifest</div>
              <div style={{
                padding: 28, textAlign: "center",
                background: "var(--bg-2)",
                border: "1px dashed var(--border-3)",
                borderRadius: 6,
              }}>
                <Icon name="upload" size={22} style={{ color: "var(--text-3)" }} />
                <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--text-2)" }}>
                  Drop <span className="mono">workflow.json</span> and <span className="mono">actions.json</span>
                </div>
                <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-3)" }}>or <span style={{ color: "var(--signal)" }}>browse files</span></div>
              </div>
              <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.55 }}>
                We accept the same schema as <span className="mono">RAAS</span>: <span className="mono">id, name, actor, trigger[], actions[], triggered_event[]</span>. We'll validate the graph and report any cycles or orphans before letting you save.
              </div>
            </div>
          )}
        </div>

        <footer style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 18px", borderTop: "1px solid var(--border)", background: "var(--panel-2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-3)" }}>
            <Icon name="check" size={10} style={{ color: "var(--green)" }} />
            <span>Will save as draft. Deploy later from the workflow page.</span>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <Button tone="ghost" onClick={onClose}>Cancel</Button>
            <Button tone="primary" icon="check" onClick={onClose}>Create workflow</Button>
          </div>
        </footer>
      </div>
    </ModalOverlayW>
  );
}

function PathCard({ active, onClick, icon, title, sub }) {
  return (
    <button onClick={onClick} style={{
      padding: "12px 14px",
      background: active ? "var(--panel-3)" : "var(--panel-2)",
      border: `1px solid ${active ? "var(--signal)" : "var(--border)"}`,
      borderRadius: 5,
      textAlign: "left",
      cursor: "pointer",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
        <Icon name={icon} size={12} style={{ color: active ? "var(--signal)" : "var(--text-2)" }} />
        <span style={{ fontSize: 12.5, color: "var(--text)", fontWeight: 500 }}>{title}</span>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.45 }}>{sub}</div>
    </button>
  );
}

function ModalOverlayW({ onClose, children }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.5)",
        display: "flex", justifyContent: "center", alignItems: "center",
        backdropFilter: "blur(2px)",
        animation: "fadein 0.14s ease",
      }}
    >
      <div onClick={e => e.stopPropagation()}>{children}</div>
    </div>
  );
}

window.Workflows = Workflows;