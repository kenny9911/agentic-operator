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
        subtitle="The RAAS agent graph — nodes are agents, edges are events. Click any node or event to trace its flow."
        badge={<Badge tone="muted">raas · v2026.05.16-a</Badge>}
        action={[
          <Button key="new" icon="plus" tone="primary" small>New workflow</Button>,
          <Button key="upload" icon="upload" small>Import manifest</Button>,
        ]}
      />

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 280px", minHeight: 0 }}>
        {/* Canvas */}
        <div style={{
          position: "relative", overflow: "auto",
          background: `var(--bg)`,
          backgroundImage: `radial-gradient(circle, var(--border) 1px, transparent 1px)`,
          backgroundSize: "22px 22px",
          backgroundPosition: "0 0",
        }}>
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
                return (
                  <button
                    key={a.id}
                    onClick={(e) => { e.stopPropagation(); setSelectedAgent(isSel ? null : a.id); setSelectedEvent(null); }}
                    style={{
                      position: "absolute",
                      left: p.x, top: p.y,
                      width: NODE_W, height: NODE_H,
                      background: a.actor === "Agent" ? "var(--panel)" : "var(--panel-2)",
                      border: `1px solid ${isSel ? "var(--signal)" : isHi ? "var(--border-3)" : "var(--border-2)"}`,
                      borderLeftWidth: 3,
                      borderLeftColor: a.actor === "Agent" ? "var(--signal)" : "var(--violet)",
                      borderRadius: 5,
                      padding: "8px 10px",
                      textAlign: "left",
                      cursor: "pointer",
                      opacity: showDim ? 0.30 : 1,
                      transition: "opacity 0.15s, border-color 0.12s, box-shadow 0.12s",
                      boxShadow: isSel ? "0 0 0 3px rgba(208,255,0,0.12)" : "none",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <ActorTag actor={a.actor} />
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
            <AgentInspector
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
            <DefaultInspector
              events={events}
              onPick={(name) => setSelectedEvent(name)}
              agents={agents}
            />
          )}
        </aside>
      </div>
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

window.Workflows = Workflows;
