"use client";

import { useState } from "react";
import {
  ActorTag,
  Badge,
  Button,
  Icon,
  ViewHeader,
} from "@/components";
import type { DagAgent, DagEdge } from "@agentic/contracts";
import { EditDraftBanner } from "./EditDraftBanner";
import { EditToolbar, type EditTool } from "./EditToolbar";
import { DraftPalette } from "./DraftPalette";
import { NodeEditor } from "./NodeEditor";
import { NewWorkflowModal } from "./NewWorkflowModal";

const STAGES = [
  { id: 0, label: "Intake" },
  { id: 1, label: "Analyze" },
  { id: 2, label: "JD" },
  { id: 3, label: "Publish" },
  { id: 4, label: "Resume" },
  { id: 5, label: "Match & Interview" },
  { id: 6, label: "Package" },
  { id: 7, label: "Submit" },
];

const NODE_W = 184;
const NODE_H = 64;
const COL_W = 220;
const ROW_H = 90;
const PAD_X = 30;
const PAD_Y = 30;

const LAYOUT: Record<string, { stage: number; lane: number }> = {
  "1-1":  { stage: 0, lane: 0 },
  "1-2":  { stage: 0, lane: 1 },
  "2":    { stage: 1, lane: 0 },
  "3":    { stage: 1, lane: 1 },
  "3-2":  { stage: 1, lane: 2 },
  "4":    { stage: 2, lane: 0 },
  "5":    { stage: 2, lane: 1 },
  "6":    { stage: 3, lane: 0 },
  "7-1":  { stage: 3, lane: 1 },
  "7-2":  { stage: 3, lane: 2 },
  "8":    { stage: 4, lane: 0 },
  "9-1":  { stage: 4, lane: 1 },
  "9-2":  { stage: 4, lane: 2 },
  "10":   { stage: 5, lane: 0 },
  "11-1": { stage: 5, lane: 1 },
  "11-2": { stage: 5, lane: 2 },
  "12":   { stage: 5, lane: 3 },
  "13":   { stage: 6, lane: 0 },
  "14-1": { stage: 6, lane: 1 },
  "14-2": { stage: 6, lane: 2 },
  "15":   { stage: 6, lane: 3 },
  "16":   { stage: 7, lane: 1 },
};

// Mock "draft" markings (matching prototype's hardcoded add/mod ids in the
// add-settings design). Only relevant when editing.
const DRAFT_ADDED = new Set(["10", "14-1"]);
const DRAFT_MODIFIED = new Set(["2", "12"]);

function colorVar(c: string | null | undefined): string {
  const map: Record<string, string> = {
    green: "var(--green)",
    blue: "var(--blue)",
    amber: "var(--amber)",
    red: "var(--red)",
    muted: "var(--text-3)",
  };
  return c ? (map[c] ?? "var(--text-3)") : "var(--text-3)";
}

function badgeTone(
  c: string | null | undefined,
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
  return c ? (map[c] ?? "default") : "default";
}

interface PositionedAgent extends DagAgent {
  x: number;
  y: number;
}

interface EventTypeRow {
  name: string;
  category: string | null;
  color: string | null;
}

export interface WorkflowsViewProps {
  agents: DagAgent[];
  edges: DagEdge[];
  workflowVersion: string;
  eventTypes: EventTypeRow[];
}

export function WorkflowsView({
  agents,
  edges,
  workflowVersion,
  eventTypes,
}: WorkflowsViewProps) {
  const [editing, setEditing] = useState(false);
  const [tool, setTool] = useState<EditTool>("select");
  const [newOpen, setNewOpen] = useState(false);
  const [selectedAgentKebab, setSelectedAgentKebab] =
    useState<string | null>(null);

  // Lay out agents by stage+lane
  const overflowByStage = new Map<number, number>();
  const positioned: PositionedAgent[] = agents.map((a) => {
    const p = LAYOUT[a.kebabId];
    let stage: number;
    let lane: number;
    if (p) {
      stage = p.stage;
      lane = p.lane;
    } else {
      stage = STAGES.length - 1;
      lane = 4 + (overflowByStage.get(stage) ?? 0);
      overflowByStage.set(stage, (overflowByStage.get(stage) ?? 0) + 1);
    }
    return {
      ...a,
      x: PAD_X + stage * COL_W,
      y: PAD_Y + lane * ROW_H,
    };
  });

  const maxLane = Math.max(
    0,
    ...positioned.map((a) => Math.round((a.y - PAD_Y) / ROW_H)),
  );
  const canvasW = PAD_X * 2 + STAGES.length * COL_W;
  const canvasH = PAD_Y * 2 + (maxLane + 1) * ROW_H;

  const byName = new Map(positioned.map((a) => [a.name, a]));
  const positionedEdges = edges
    .map((e) => {
      const src = byName.get(e.fromAgent);
      const dst = byName.get(e.toAgent);
      if (!src || !dst) return null;
      return { ...e, src, dst };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const eventColor = new Map<string, string | null>();
  for (const e of eventTypes) eventColor.set(e.name, e.color);

  const groupedEvents = new Map<string, EventTypeRow[]>();
  for (const e of eventTypes) {
    const cat = e.category ?? "other";
    const arr = groupedEvents.get(cat) ?? [];
    arr.push(e);
    groupedEvents.set(cat, arr);
  }
  const CATEGORY_ORDER = [
    "agent",
    "human",
    "data",
    "external",
    "alert",
    "system",
    "other",
  ];
  const sortedCats = Array.from(groupedEvents.entries()).sort(
    (a, b) =>
      (CATEGORY_ORDER.indexOf(a[0]) === -1
        ? 99
        : CATEGORY_ORDER.indexOf(a[0])) -
      (CATEGORY_ORDER.indexOf(b[0]) === -1
        ? 99
        : CATEGORY_ORDER.indexOf(b[0])),
  );
  const CATEGORY_LABELS: Record<string, string> = {
    agent: "From agents",
    human: "From humans",
    data: "Data",
    external: "External",
    alert: "Alerts",
    system: "System",
    other: "Other",
  };

  const agentCount = positioned.filter((a) => a.actor === "Agent").length;
  const humanCount = positioned.filter((a) => a.actor === "Human").length;

  const selectedAgent = selectedAgentKebab
    ? agents.find((a) => a.kebabId === selectedAgentKebab) ?? null
    : null;

  return (
    <div
      style={{ display: "flex", flexDirection: "column", height: "100%" }}
    >
      <ViewHeader
        title="Workflows"
        subtitle={
          editing ? (
            <>
              Editing draft of{" "}
              <span className="mono" style={{ color: "var(--text)" }}>
                raas
              </span>{" "}
              · changes won&apos;t affect live runs until you deploy.
            </>
          ) : (
            "The RAAS agent graph — nodes are agents, edges are events. Click any node or event to trace its flow."
          )
        }
        badge={
          editing ? (
            <Badge tone="amber">
              <Icon name="alert" size={9} /> DRAFT · raas@2026.05.18-draft
            </Badge>
          ) : (
            <Badge tone="muted">raas · {workflowVersion}</Badge>
          )
        }
        action={
          editing ? (
            <>
              <Button
                small
                tone="ghost"
                onClick={() => {
                  setEditing(false);
                  setSelectedAgentKebab(null);
                }}
              >
                Discard draft
              </Button>
              <Button small icon="check" tone="ghost">
                Validate
              </Button>
              <Button small icon="deploy" tone="primary">
                Deploy draft
              </Button>
            </>
          ) : (
            <>
              <Button
                icon="code"
                small
                onClick={() => setEditing(true)}
              >
                Edit workflow
              </Button>
              <Button
                icon="plus"
                tone="primary"
                small
                onClick={() => setNewOpen(true)}
              >
                New workflow
              </Button>
              <Button icon="upload" small>
                Import manifest
              </Button>
            </>
          )
        }
      />

      {editing && <EditDraftBanner onDiscard={() => setEditing(false)} />}

      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "1fr 280px",
          minHeight: 0,
        }}
      >
        {/* Canvas */}
        <div
          style={{
            position: "relative",
            overflow: "auto",
            background: "var(--bg)",
            backgroundImage:
              "radial-gradient(circle, var(--border) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        >
          {editing && <EditToolbar tool={tool} setTool={setTool} />}

          {/* Stage headers */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              height: 28,
              display: "flex",
              paddingLeft: PAD_X,
              pointerEvents: "none",
            }}
          >
            {STAGES.map((s, i) => (
              <div
                key={s.id}
                style={{
                  width: COL_W,
                  padding: "8px 0 0 6px",
                  fontSize: 10,
                  fontFamily: "var(--mono)",
                  fontWeight: 500,
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  color: "var(--text-3)",
                }}
              >
                {String(i).padStart(2, "0")} · {s.label}
              </div>
            ))}
          </div>

          <div
            style={{
              width: canvasW,
              height: canvasH + 30,
              position: "relative",
              paddingTop: 30,
            }}
          >
            {/* Column dividers */}
            <div
              style={{
                position: "absolute",
                inset: "30px 0 0 0",
                pointerEvents: "none",
              }}
            >
              {STAGES.map((s, i) =>
                i > 0 ? (
                  <div
                    key={s.id}
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      left: PAD_X + i * COL_W - 8,
                      width: 1,
                      background: "var(--border)",
                      opacity: 0.5,
                    }}
                  />
                ) : null,
              )}
            </div>

            {/* SVG edges */}
            <svg
              width={canvasW}
              height={canvasH}
              style={{
                position: "absolute",
                top: 30,
                left: 0,
                pointerEvents: "none",
              }}
            >
              <defs>
                {(["green", "blue", "amber", "red", "muted"] as const).map(
                  (c) => (
                    <marker
                      key={c}
                      id={`arrow-${c}`}
                      viewBox="0 0 10 10"
                      refX="8"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto"
                    >
                      <path d="M0,0 L10,5 L0,10 z" fill={colorVar(c)} />
                    </marker>
                  ),
                )}
              </defs>
              {positionedEdges.map((e, i) => {
                const sx = e.src.x + NODE_W;
                const sy = e.src.y + NODE_H / 2;
                const dx = e.dst.x;
                const dy = e.dst.y + NODE_H / 2;
                const c1x = sx + Math.max(40, (dx - sx) * 0.5);
                const c2x = dx - Math.max(40, (dx - sx) * 0.5);
                const path = `M ${sx} ${sy} C ${c1x} ${sy}, ${c2x} ${dy}, ${dx} ${dy}`;
                const c = eventColor.get(e.event) ?? "muted";
                return (
                  <g key={i}>
                    <path
                      d={path}
                      stroke={colorVar(c)}
                      strokeWidth={e.active ? 2 : 1.25}
                      fill="none"
                      opacity={e.active ? 1 : 0.55}
                      markerEnd={`url(#arrow-${c})`}
                    />
                    {e.active && (
                      <circle r={3} fill={colorVar(c)}>
                        <animateMotion
                          dur="2.4s"
                          repeatCount="indefinite"
                          path={path}
                        />
                      </circle>
                    )}
                  </g>
                );
              })}
            </svg>

            {/* Agent nodes */}
            <div
              style={{
                position: "absolute",
                top: 30,
                left: 0,
                width: canvasW,
                height: canvasH,
              }}
            >
              {positioned.map((a) => {
                const isAdded = editing && DRAFT_ADDED.has(a.kebabId);
                const isModified =
                  editing && DRAFT_MODIFIED.has(a.kebabId);
                const isSelected =
                  editing && selectedAgentKebab === a.kebabId;
                const borderStyle = editing ? "dashed" : "solid";
                const borderColor = isSelected
                  ? "var(--signal)"
                  : isAdded
                    ? "var(--green)"
                    : isModified
                      ? "var(--amber)"
                      : "var(--border-2)";

                return (
                  <div
                    key={a.id}
                    onClick={() => {
                      if (editing) {
                        setSelectedAgentKebab(a.kebabId);
                      }
                    }}
                    style={{
                      position: "absolute",
                      left: a.x,
                      top: a.y,
                      width: NODE_W,
                      height: NODE_H,
                      background:
                        a.actor === "Agent"
                          ? "var(--panel)"
                          : "var(--panel-2)",
                      borderTop: `1px ${borderStyle} ${borderColor}`,
                      borderRight: `1px ${borderStyle} ${borderColor}`,
                      borderBottom: `1px ${borderStyle} ${borderColor}`,
                      borderLeft: `3px solid ${
                        a.actor === "Agent"
                          ? "var(--signal)"
                          : "var(--violet)"
                      }`,
                      borderRadius: 5,
                      padding: "8px 10px",
                      cursor: editing ? "move" : "pointer",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        marginBottom: 4,
                      }}
                    >
                      <ActorTag actor={a.actor} />
                      {isAdded && <Badge tone="green">NEW</Badge>}
                      {isModified && <Badge tone="amber">MOD</Badge>}
                      <span
                        style={{
                          marginLeft: "auto",
                          fontSize: 10,
                          fontFamily: "var(--mono)",
                          color: "var(--text-3)",
                        }}
                      >
                        {a.kebabId}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 12.5,
                        color: "var(--text)",
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {a.title || a.name}
                    </div>
                    {isSelected && (
                      <>
                        {(["top", "right", "bottom", "left"] as const).map(
                          (s) => (
                            <span
                              key={s}
                              style={{
                                position: "absolute",
                                width: 8,
                                height: 8,
                                background: "var(--signal)",
                                border: "1px solid var(--bg)",
                                borderRadius: 1,
                                top:
                                  s === "top"
                                    ? -4
                                    : s === "bottom"
                                      ? "calc(100% - 4px)"
                                      : "calc(50% - 4px)",
                                left:
                                  s === "left"
                                    ? -4
                                    : s === "right"
                                      ? "calc(100% - 4px)"
                                      : "calc(50% - 4px)",
                              }}
                            />
                          ),
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right rail */}
        <div
          style={{
            borderLeft: "1px solid var(--border)",
            overflow: "auto",
            background: "var(--bg-2)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {editing && selectedAgent ? (
            <NodeEditor
              agent={selectedAgent}
              onClose={() => setSelectedAgentKebab(null)}
            />
          ) : editing ? (
            <DraftPalette />
          ) : (
            <div style={{ padding: 14 }}>
              {/* Legend */}
              <div style={{ marginBottom: 16 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontFamily: "var(--mono)",
                    textTransform: "uppercase",
                    color: "var(--text-3)",
                    letterSpacing: "0.12em",
                    marginBottom: 8,
                  }}
                >
                  Legend
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    fontSize: 12,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        width: 12,
                        height: 12,
                        background: "var(--signal)",
                        borderRadius: 2,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ color: "var(--text-2)", flex: 1 }}>
                      Agent node
                    </span>
                    <span
                      style={{
                        fontSize: 10.5,
                        fontFamily: "var(--mono)",
                        color: "var(--text-3)",
                      }}
                    >
                      {agentCount} in workflow
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        width: 12,
                        height: 12,
                        background: "var(--violet)",
                        borderRadius: 2,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ color: "var(--text-2)", flex: 1 }}>
                      Human node
                    </span>
                    <span
                      style={{
                        fontSize: 10.5,
                        fontFamily: "var(--mono)",
                        color: "var(--text-3)",
                      }}
                    >
                      {humanCount} in workflow
                    </span>
                  </div>
                </div>
              </div>

              {/* Events catalog */}
              <div
                style={{
                  fontSize: 10,
                  fontFamily: "var(--mono)",
                  textTransform: "uppercase",
                  color: "var(--text-3)",
                  letterSpacing: "0.12em",
                  marginBottom: 8,
                }}
              >
                Events · click to trace
              </div>
              {sortedCats.map(([cat, items]) => (
                <div key={cat} style={{ marginBottom: 12 }}>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-3)",
                      marginBottom: 6,
                    }}
                  >
                    {CATEGORY_LABELS[cat] ?? cat}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 4,
                    }}
                  >
                    {items.map((e) => (
                      <Badge
                        key={e.name}
                        tone={badgeTone(e.color)}
                        style={{ fontSize: 9.5 }}
                      >
                        {e.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {newOpen && (
        <NewWorkflowModal onClose={() => setNewOpen(false)} />
      )}
    </div>
  );
}
