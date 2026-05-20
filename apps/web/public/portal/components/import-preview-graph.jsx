// ImportPreviewGraph — read-only DAG of a migrated workflow manifest.
//
// Used by the Import Manifest wizard (Preview step). Renders agents as
// rectangles laid out in stage columns; edges are quadratic Bezier curves.
// Nodes are colored by their diff classification (added/modified/removed/
// unchanged); a hover highlight dims everything else.
//
// SPA global-scope gotcha: every component name in this file is prefixed
// with "Ipg" so we never collide with another view's top-level helpers.

const { useState: useStateIpg, useMemo: useMemoIpg } = React;

const IPG = {
  PAD_X: 24,
  PAD_Y: 28,
  COL_W: 188,
  ROW_H: 76,
  NODE_W: 156,
  NODE_H: 56,
};

// ── Manifest helpers ──────────────────────────────────────────────────────
// Accepts the raw input shape: either a bare AgentSpec[] (v1) or
// { $schemaVersion: 2, agents: [...] } (v2). We normalize to a flat array
// of `{ id, name, kebabId, actor, triggers, emits }`.

function ipgNormalizeManifest(raw) {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : Array.isArray(raw.agents) ? raw.agents : [];
  return list.map((a, idx) => {
    const id = a.id ?? a.kebab_id ?? a.kebabId ?? String(idx);
    const name = a.name || a.title || id;
    const kebabId = a.kebabId || a.kebab_id || ipgToKebab(name) || id;
    const actorList = Array.isArray(a.actor) ? a.actor : (a.actor ? [a.actor] : []);
    const actor = actorList.includes("Human") ? "Human" : "Agent";
    const triggers = Array.isArray(a.trigger) ? a.trigger : Array.isArray(a.triggers) ? a.triggers : [];
    const emits = Array.isArray(a.triggered_event) ? a.triggered_event
      : Array.isArray(a.emits) ? a.emits
      : Array.isArray(a.emitted_events) ? a.emitted_events
      : [];
    return { id, name, kebabId, actor, triggers, emits };
  });
}

function ipgToKebab(s) {
  return String(s || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

// Compute the stage index for each agent by longest-path topological sort
// over the trigger/emit graph. Cyclic stragglers fall back to stage 0.
function ipgComputeStages(agents) {
  const byTrigger = new Map(); // event name -> emitter ids
  agents.forEach((a) => {
    a.emits.forEach((ev) => {
      const arr = byTrigger.get(ev) || [];
      arr.push(a.id);
      byTrigger.set(ev, arr);
    });
  });

  const stage = new Map();
  agents.forEach((a) => stage.set(a.id, 0));

  // Run a few passes (bounded) to relax longest-path stage assignment.
  const PASSES = Math.min(agents.length + 1, 32);
  for (let pass = 0; pass < PASSES; pass++) {
    let changed = false;
    agents.forEach((a) => {
      let maxParent = -1;
      a.triggers.forEach((ev) => {
        const emitters = byTrigger.get(ev) || [];
        emitters.forEach((eId) => {
          if (eId === a.id) return; // self-loop, ignore for staging
          const s = stage.get(eId);
          if (s != null && s > maxParent) maxParent = s;
        });
      });
      const want = maxParent + 1;
      if (want > (stage.get(a.id) || 0)) {
        stage.set(a.id, want);
        changed = true;
      }
    });
    if (!changed) break;
  }
  return stage;
}

// ── Public component ─────────────────────────────────────────────────────
function ImportPreviewGraph({ manifest, actions, diff }) {
  const agents = useMemoIpg(() => ipgNormalizeManifest(manifest), [manifest]);
  const stages = useMemoIpg(() => ipgComputeStages(agents), [agents]);

  // Group by stage
  const byStage = useMemoIpg(() => {
    const m = new Map();
    agents.forEach((a) => {
      const s = stages.get(a.id) || 0;
      const arr = m.get(s) || [];
      arr.push(a);
      m.set(s, arr);
    });
    // Order each lane by name (stable)
    for (const [k, v] of m.entries()) v.sort((x, y) => String(x.name).localeCompare(String(y.name)));
    return m;
  }, [agents, stages]);

  // Compute node positions
  const positions = useMemoIpg(() => {
    const pos = new Map();
    const stageKeys = Array.from(byStage.keys()).sort((a, b) => a - b);
    stageKeys.forEach((s, colIdx) => {
      const lane = byStage.get(s);
      lane.forEach((a, laneIdx) => {
        pos.set(a.id, {
          x: IPG.PAD_X + colIdx * IPG.COL_W,
          y: IPG.PAD_Y + laneIdx * IPG.ROW_H,
        });
      });
    });
    return { pos, stageKeys };
  }, [byStage]);

  // Edges: emit → trigger
  const edges = useMemoIpg(() => {
    const out = [];
    const listeners = new Map(); // event name -> agent ids
    agents.forEach((a) => {
      a.triggers.forEach((ev) => {
        const arr = listeners.get(ev) || [];
        arr.push(a.id);
        listeners.set(ev, arr);
      });
    });
    agents.forEach((src) => {
      src.emits.forEach((ev) => {
        const dsts = listeners.get(ev) || [];
        dsts.forEach((dstId) => {
          if (dstId !== src.id) out.push({ src: src.id, dst: dstId, event: ev });
        });
      });
    });
    return out;
  }, [agents]);

  // Diff classification
  const tag = useMemoIpg(() => {
    const map = new Map();
    if (diff) {
      (diff.added || []).forEach((id) => map.set(id, "added"));
      (diff.modified || []).forEach((id) => map.set(id, "modified"));
      // Note: removed agents are not in `agents` (they're in the live workflow only).
    }
    return map;
  }, [diff]);

  // Canvas size
  const maxStage = positions.stageKeys.length ? Math.max(...positions.stageKeys) : 0;
  const maxLane = useMemoIpg(() => {
    let m = 0;
    for (const v of byStage.values()) m = Math.max(m, v.length);
    return m;
  }, [byStage]);

  const W = IPG.PAD_X * 2 + Math.max(1, maxStage + 1) * IPG.COL_W;
  const H = IPG.PAD_Y * 2 + Math.max(1, maxLane) * IPG.ROW_H;

  const [hovered, setHovered] = useStateIpg(null); // agent id

  // What's highlighted when hovered
  const highlighted = useMemoIpg(() => {
    if (!hovered) return { nodes: new Set(), edges: new Set() };
    const nodes = new Set([hovered]);
    const edgeSet = new Set();
    edges.forEach((e, i) => {
      if (e.src === hovered || e.dst === hovered) {
        edgeSet.add(i);
        nodes.add(e.src);
        nodes.add(e.dst);
      }
    });
    return { nodes, edges: edgeSet };
  }, [hovered, edges]);

  if (agents.length === 0) {
    return (
      <div style={{ padding: "32px 12px", textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
        No agents to preview. Pick a manifest source first.
      </div>
    );
  }

  return (
    <div style={{ width: "100%", overflow: "auto", background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 6 }}>
      <svg width={W} height={H + 24} style={{ display: "block", minWidth: "100%" }} viewBox={`0 0 ${W} ${H + 24}`}>
        {/* Stage column headers + dividers */}
        {positions.stageKeys.map((s, i) => (
          <g key={"stage-" + s}>
            <line
              x1={IPG.PAD_X + i * IPG.COL_W - 6}
              x2={IPG.PAD_X + i * IPG.COL_W - 6}
              y1={4}
              y2={H + 16}
              stroke="var(--border)"
              opacity="0.5"
            />
            <text
              x={IPG.PAD_X + i * IPG.COL_W}
              y={16}
              fill="var(--text-3)"
              fontSize="9"
              fontFamily="var(--mono)"
              letterSpacing="0.08em"
            >
              {String(i).padStart(2, "0")} · STAGE
            </text>
          </g>
        ))}

        {/* Edges (drawn first so nodes sit on top) */}
        <defs>
          <marker id="ipg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--text-3)" />
          </marker>
          <marker id="ipg-arrow-hi" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--signal)" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const sPos = positions.pos.get(e.src);
          const dPos = positions.pos.get(e.dst);
          if (!sPos || !dPos) return null;
          const sx = sPos.x + IPG.NODE_W;
          const sy = sPos.y + IPG.NODE_H / 2;
          const dx = dPos.x;
          const dy = dPos.y + IPG.NODE_H / 2;
          const midX = (sx + dx) / 2;
          const cp1x = midX;
          const cp1y = sy;
          const cp2x = midX;
          const cp2y = dy;
          const d = `M ${sx} ${sy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${dx} ${dy}`;
          const isHi = highlighted.edges.has(i);
          const dim = hovered && !isHi;
          return (
            <path
              key={i}
              d={d}
              stroke={isHi ? "var(--signal)" : "var(--text-3)"}
              strokeWidth={isHi ? 1.6 : 1}
              fill="none"
              opacity={dim ? 0.18 : isHi ? 1 : 0.5}
              markerEnd={isHi ? "url(#ipg-arrow-hi)" : "url(#ipg-arrow)"}
              style={{ transition: "opacity 0.12s, stroke 0.12s" }}
            />
          );
        })}

        {/* Nodes */}
        {agents.map((a) => {
          const p = positions.pos.get(a.id);
          if (!p) return null;
          const klass = tag.get(a.id) || tag.get(a.kebabId);
          const isHi = !hovered || highlighted.nodes.has(a.id);
          const stroke = klass === "added"
            ? "var(--green)"
            : klass === "modified"
              ? "var(--amber)"
              : a.actor === "Human"
                ? "var(--violet)"
                : "var(--signal)";
          const fill = klass === "added"
            ? "rgba(101,224,163,0.08)"
            : klass === "modified"
              ? "rgba(255,181,71,0.06)"
              : "var(--panel)";
          return (
            <g
              key={a.id}
              onMouseEnter={() => setHovered(a.id)}
              onMouseLeave={() => setHovered((h) => (h === a.id ? null : h))}
              style={{ cursor: "default", opacity: isHi ? 1 : 0.30, transition: "opacity 0.12s" }}
            >
              <rect
                x={p.x}
                y={p.y}
                width={IPG.NODE_W}
                height={IPG.NODE_H}
                rx={5}
                fill={fill}
                stroke={stroke}
                strokeWidth={klass ? 1.5 : 1}
                strokeDasharray={klass === "modified" ? "3 2" : "0"}
              />
              <text x={p.x + 10} y={p.y + 16} fill="var(--text-3)" fontSize="9.5" fontFamily="var(--mono)" letterSpacing="0.04em">
                {String(a.id).slice(0, 24)}
              </text>
              <text x={p.x + 10} y={p.y + 32} fill="var(--text)" fontSize="11.5" fontFamily="var(--sans)" fontWeight="500">
                {ipgTrim(a.name, 22)}
              </text>
              <text x={p.x + 10} y={p.y + 46} fill="var(--text-3)" fontSize="9.5" fontFamily="var(--mono)">
                {a.actor === "Human" ? "HUMAN" : "AGENT"}{klass ? ` · ${klass.toUpperCase()}` : ""}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ipgTrim(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

window.ImportPreviewGraph = ImportPreviewGraph;
