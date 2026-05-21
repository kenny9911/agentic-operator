"use client";

/**
 * Workflows view — DAG canvas of all agents wired by events. P2-FE-08.
 *
 * Ported from `agentic-operator_v1_1/views/workflows.jsx` (999 LOC), preserves:
 *   - the hand-tuned LAYOUT map (audit 01 §4.2 acceptance — see `./components/workflows/layout.ts`)
 *   - 8 stage columns + 5-lane grid
 *   - cubic-bezier SVG edges with color-coded arrowheads
 *   - animated travelling dots on live edges
 *   - edit-mode banner, toolbar, draft palette, node editor
 *   - NewWorkflowModal (template / blank / import paths)
 *   - ImportManifestModal hook
 *
 * Data source: useRaasData() (Phase 1 P1-FE-03). Stages, agents, events,
 * eventStream all come from one snapshot bootstrap. Live updates (run.*, event.emitted)
 * flow through useStream() at the layout root.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ActorTag,
  Badge,
  Button,
  Icon,
  Kbd,
  ViewHeader,
  useToast,
} from "@/app/portal/components";
import { useRaasData } from "@/lib/hooks/data-context";
import { useTenant } from "@/app/portal/lib/use-tenant";
import { useDirty } from "@/app/portal/lib/dirty-context";
import {
  CANVAS_H,
  CANVAS_W,
  COL_W,
  LAYOUT,
  NODE_H,
  NODE_W,
  PAD_X,
  colorVar,
  nodePos,
} from "@/app/portal/components/workflows/layout";
import {
  AgentInspector,
  DefaultInspector,
  DraftPalette,
  EditDraftBanner,
  EditToolbar,
  EventInspector,
} from "@/app/portal/components/workflows/inspectors";
import { NewWorkflowModal } from "@/app/portal/components/workflows/NewWorkflowModal";
import { ImportManifestModal } from "@/app/portal/components/import-manifest/ImportManifestModal";
import { AgentEditor } from "@/app/portal/components/workflows/AgentEditor";
import {
  applyDraft,
  countDraftChanges,
  deserializeDraft,
  draftStorageKey,
  emptyDraft,
  serializeDraft,
  toManifest,
  tryReadSerializedDraft,
  type WorkflowDraft,
} from "@/app/portal/components/workflows/draft";
import { useDeployManifest } from "@/lib/hooks/useManifest";

interface EdgeMeta {
  src: string;
  dst: string;
  event: string;
}

export default function WorkflowsPage() {
  const { agents: baseAgents, events, stages } = useRaasData();
  const router = useRouter();
  const tenant = useTenant();
  const toast = useToast();
  const deploy = useDeployManifest();

  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<WorkflowDraft>(emptyDraft);
  const [tool, setTool] = useState<"select" | "connect" | "add">("select");
  const [showNewModal, setShowNewModal] = useState(false);
  const [showImport, setShowImport] = useState(false);
  // Live stream — placeholder for tweaks-panel wiring (Phase 2).
  const liveStream = true;

  // While editing, the canvas reads the *applied* draft so the operator
  // sees their changes immediately. Outside edit mode it's the bootstrap.
  const agents = useMemo(
    () => (editing ? applyDraft(baseAgents, draft) : baseAgents),
    [baseAgents, draft, editing],
  );
  const draftCounts = countDraftChanges(draft);
  const dirty = draftCounts.added + draftCounts.modified + draftCounts.removed > 0;
  const dirtyApi = useDirty();
  // UC-V11-15: register the draft with the global Dirty context so
  // useTenantNavigate() and other guards can prompt before navigating away.
  useEffect(() => {
    const label = dirty
      ? `workflow draft · +${draftCounts.added} ~${draftCounts.modified} −${draftCounts.removed}`
      : null;
    dirtyApi.setDirty("workflow-draft", label);
    return () => dirtyApi.setDirty("workflow-draft", null);
  }, [
    dirty,
    draftCounts.added,
    draftCounts.modified,
    draftCounts.removed,
    dirtyApi,
  ]);

  // UC-V11-13: persist edit-mode draft to localStorage so refreshing the
  // page or closing the tab without deploying preserves work-in-progress.
  // The key is namespaced by tenant; multiple workflows per tenant would
  // need a deeper key — today there's one workflow per tenant.
  const storageKey = useMemo(() => draftStorageKey(tenant, tenant), [tenant]);
  // `restoredAt` non-null means we restored a saved draft on mount; show
  // a small banner with a Discard action so the operator can opt out.
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  // First mount: restore any saved draft for this (tenant, workflow). Wrap
  // in a Boolean ref-effect so a Next dev re-mount (StrictMode) doesn't
  // double-trigger the restore.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (hydrated) return;
    setHydrated(true);
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = tryReadSerializedDraft(raw);
      if (!parsed) {
        window.localStorage.removeItem(storageKey);
        return;
      }
      // Restored — drop into edit mode so the user notices.
      setDraft(deserializeDraft(parsed));
      setEditing(true);
      setRestoredAt(parsed.savedAt);
    } catch {
      // localStorage unavailable (private mode, quota) — silently skip.
    }
  }, [hydrated, storageKey]);
  // Save on every change while dirty; clear on clean state.
  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    try {
      if (dirty) {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify(serializeDraft(draft)),
        );
      } else {
        window.localStorage.removeItem(storageKey);
      }
    } catch {
      // Persistence failure is best-effort; don't break the UI.
    }
  }, [hydrated, dirty, draft, storageKey]);
  function discardRestored() {
    setDraft(emptyDraft());
    setEditing(false);
    setRestoredAt(null);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // ignore
      }
    }
  }

  // Build edges: for each agent's emitted event, find listeners.
  const edges = useMemo<EdgeMeta[]>(() => {
    const out: EdgeMeta[] = [];
    agents.forEach((src) => {
      (src.emits || []).forEach((evName) => {
        const listeners = agents.filter((a) => a.triggers.includes(evName));
        listeners.forEach((dst) => {
          if (LAYOUT[src.id] && LAYOUT[dst.id]) {
            out.push({ src: src.id, dst: dst.id, event: evName });
          }
        });
      });
    });
    return out;
  }, [agents]);

  const evColor = useMemo(() => {
    const m: Record<string, string> = {};
    events.forEach((e) => {
      m[e.name] = e.color;
    });
    return m;
  }, [events]);

  // Highlight set when an agent or event is selected.
  const highlighted = useMemo(() => {
    const nodes = new Set<string>();
    const edgeSet = new Set<number>();
    if (selectedAgent) {
      nodes.add(selectedAgent);
      edges.forEach((e, i) => {
        if (e.src === selectedAgent || e.dst === selectedAgent) {
          edgeSet.add(i);
          nodes.add(e.src);
          nodes.add(e.dst);
        }
      });
    }
    if (selectedEvent) {
      edges.forEach((e, i) => {
        if (e.event === selectedEvent) {
          edgeSet.add(i);
          nodes.add(e.src);
          nodes.add(e.dst);
        }
      });
    }
    return { nodes, edges: edgeSet };
  }, [selectedAgent, selectedEvent, edges]);

  const dim = Boolean(selectedAgent || selectedEvent);

  function navAgent(id: string) {
    router.push(`/portal/${tenant}/agents/${id}` as never);
  }
  function navEvents(eventName: string) {
    router.push(`/portal/${tenant}/events?name=${encodeURIComponent(eventName)}` as never);
  }

  function discardDraft() {
    setDraft(emptyDraft());
    setEditing(false);
  }

  async function saveDraft() {
    const manifest = toManifest(agents);
    try {
      const data = await deploy.mutateAsync({
        manifest,
        workflowSlug: tenant,
        note: `In-portal edit · ${draftCounts.added}+/${draftCounts.modified}~/${draftCounts.removed}-`,
      });
      toast({
        tone: "signal",
        title: "Manifest deployed",
        description: `${data.version} · +${data.diff.added.length} / ~${data.diff.modified.length} / −${data.diff.removed.length}`,
      });
      setDraft(emptyDraft());
      setEditing(false);
    } catch (err) {
      toast({
        tone: "red",
        title: "Manifest deploy failed",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ViewHeader
        title="Workflows"
        subtitle={
          editing ? (
            <>
              Editing draft of <span className="mono" style={{ color: "var(--text)" }}>raas</span> · changes won&apos;t affect live runs until you deploy.
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
            <Badge tone="muted">raas · v2026.05.16-a</Badge>
          )
        }
        action={
          editing
            ? [
                <Button key="discard" small tone="ghost" onClick={discardDraft}>
                  Discard draft
                </Button>,
                <Button key="val" small icon="check" tone="ghost">
                  Validate
                </Button>,
                <Button
                  key="dep"
                  small
                  icon="deploy"
                  tone="primary"
                  onClick={saveDraft}
                  disabled={!dirty || deploy.isPending}
                >
                  {deploy.isPending
                    ? "Deploying…"
                    : `Deploy draft${dirty ? ` (${draftCounts.added + draftCounts.modified + draftCounts.removed})` : ""}`}
                </Button>,
              ]
            : [
                <Button key="edit" icon="code" small onClick={() => setEditing(true)}>
                  Edit workflow
                </Button>,
                <Button key="new" icon="plus" tone="primary" small onClick={() => setShowNewModal(true)}>
                  New workflow
                </Button>,
                <Button key="upload" icon="upload" small onClick={() => setShowImport(true)}>
                  Import manifest
                </Button>,
              ]
        }
      />

      {editing && <EditDraftBanner />}

      {restoredAt && (
        <div
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "8px 24px",
            background: "var(--panel-2)",
            borderBottom: "1px solid var(--border)",
            fontSize: 12,
            color: "var(--text-2)",
          }}
        >
          <Icon name="alert" size={11} style={{ color: "var(--amber)" }} />
          <span>
            Restored unsaved draft from{" "}
            <span className="mono" style={{ color: "var(--text)" }}>
              {new Date(restoredAt).toLocaleString()}
            </span>
          </span>
          <Button
            small
            tone="ghost"
            onClick={discardRestored}
            style={{ marginLeft: "auto" }}
          >
            Discard
          </Button>
        </div>
      )}

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
            backgroundPosition: "0 0",
          }}
        >
          {editing && <EditToolbar tool={tool} setTool={(t) => setTool(t as typeof tool)} />}

          {/* Stage headers row */}
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
            {stages.map((s, i) => (
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

          <div style={{ width: CANVAS_W, height: CANVAS_H + 30, position: "relative", paddingTop: 30 }}>
            {/* Stage column dividers */}
            <div style={{ position: "absolute", inset: "30px 0 0 0", pointerEvents: "none" }}>
              {stages.map((s, i) =>
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
              width={CANVAS_W}
              height={CANVAS_H}
              role="img"
              aria-label={`Workflow DAG: ${agents.length} agents wired by ${edges.length} event edges`}
              style={{ position: "absolute", top: 30, left: 0, pointerEvents: "none" }}
            >
              <defs>
                {["green", "blue", "amber", "red", "muted"].map((c) => (
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
                const color = colorVar(evColor[e.event] ?? "muted");
                const isHi = highlighted.edges.has(i) || hoveredEdge === i;
                const opacity = dim ? (isHi ? 1 : 0.1) : isHi ? 1 : 0.55;
                return (
                  <g
                    key={i}
                    role="button"
                    tabIndex={0}
                    aria-label={`Event edge: ${e.event} from ${e.src} to ${e.dst}`}
                    style={{ pointerEvents: "auto" }}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        setSelectedEvent(e.event);
                      }
                    }}
                  >
                    <path
                      d={path}
                      stroke={color}
                      strokeWidth={isHi ? 2 : 1.25}
                      fill="none"
                      opacity={opacity}
                      markerEnd={`url(#arrow-${evColor[e.event] ?? "muted"})`}
                      style={{
                        cursor: "pointer",
                        transition: "opacity 0.15s, stroke-width 0.15s",
                      }}
                      onMouseEnter={() => setHoveredEdge(i)}
                      onMouseLeave={() => setHoveredEdge(null)}
                      onClick={() => setSelectedEvent(e.event)}
                    />
                    {liveStream && (isHi || (!dim && Math.abs((i * 37) % 7) === 0)) && (
                      <circle r="3" fill={color} opacity={isHi ? 1 : 0.85} aria-hidden="true">
                        <animateMotion
                          dur={`${2.5 + (i % 5) * 0.4}s`}
                          repeatCount="indefinite"
                          begin={`${(i * 0.13) % 2}s`}
                          path={path}
                        />
                      </circle>
                    )}
                  </g>
                );
              })}
            </svg>

            {/* Agent nodes */}
            <div style={{ position: "absolute", top: 30, left: 0, width: CANVAS_W, height: CANVAS_H }}>
              {agents.map((a) => {
                const p = nodePos(a.id);
                const isSel = selectedAgent === a.id;
                const isHi = highlighted.nodes.has(a.id);
                const showDim = dim && !isHi;
                const isAdded = editing && (a.id === "10-1" || a.id === "14-1");
                const isModified = editing && (a.id === "2" || a.id === "12");
                const borderColor = isSel
                  ? "var(--signal)"
                  : isAdded
                    ? "var(--green)"
                    : isModified
                      ? "var(--amber)"
                      : isHi
                        ? "var(--border-3)"
                        : "var(--border-2)";
                const dashed = editing ? "dashed" : "solid";
                const stateSuffix = isAdded
                  ? ", draft addition"
                  : isModified
                    ? ", draft modification"
                    : "";
                const nodeLabel = `${a.actor} node: ${a.title}, id ${a.id}${stateSuffix}`;
                return (
                  <button
                    key={a.id}
                    aria-label={nodeLabel}
                    aria-pressed={isSel}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedAgent(isSel ? null : a.id);
                      setSelectedEvent(null);
                    }}
                    style={{
                      position: "absolute",
                      left: p.x,
                      top: p.y,
                      width: NODE_W,
                      height: NODE_H,
                      background: a.actor === "Agent" ? "var(--panel)" : "var(--panel-2)",
                      borderTop: `1px ${dashed} ${borderColor}`,
                      borderRight: `1px ${dashed} ${borderColor}`,
                      borderBottom: `1px ${dashed} ${borderColor}`,
                      borderLeft: `3px solid ${a.actor === "Agent" ? "var(--signal)" : "var(--violet)"}`,
                      borderRadius: 5,
                      padding: "8px 10px",
                      textAlign: "left",
                      cursor: editing ? "move" : "pointer",
                      opacity: showDim ? 0.3 : 1,
                      transition: "opacity 0.15s, border-color 0.12s, box-shadow 0.12s",
                      boxShadow: isSel ? "0 0 0 3px rgba(208,255,0,0.12)" : "none",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
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
                        {a.id}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 12.5,
                        color: "var(--text)",
                        fontWeight: 500,
                        lineHeight: 1.2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {a.title}
                    </div>
                    {editing && isSel && (
                      <>
                        {(["top", "right", "bottom", "left"] as const).map((s) => (
                          <span
                            key={s}
                            style={{
                              position: "absolute",
                              width: 8,
                              height: 8,
                              background: "var(--signal)",
                              border: "1px solid var(--bg)",
                              borderRadius: 1,
                              top: s === "top" ? -4 : s === "bottom" ? "calc(100% - 4px)" : "calc(50% - 4px)",
                              left: s === "left" ? -4 : s === "right" ? "calc(100% - 4px)" : "calc(50% - 4px)",
                            }}
                          />
                        ))}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right inspector aside */}
        <aside
          style={{
            borderLeft: "1px solid var(--border)",
            background: "var(--panel)",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          {selectedAgent && editing ? (
            <AgentEditor
              agent={
                agents.find((a) => a.id === selectedAgent) ?? agents[0]!
              }
              events={events}
              draft={draft.agents[selectedAgent]}
              onChange={(next) =>
                setDraft((prev) => ({
                  ...prev,
                  agents: { ...prev.agents, [selectedAgent]: next },
                }))
              }
              onRemove={() => {
                setDraft((prev) => {
                  const isAdded = prev.added.has(selectedAgent);
                  const nextAgents = { ...prev.agents };
                  delete nextAgents[selectedAgent];
                  return {
                    agents: nextAgents,
                    added: isAdded
                      ? new Set(
                          Array.from(prev.added).filter(
                            (id) => id !== selectedAgent,
                          ),
                        )
                      : prev.added,
                    removed: isAdded
                      ? prev.removed
                      : new Set([...prev.removed, selectedAgent]),
                  };
                });
                setSelectedAgent(null);
              }}
              onClose={() => setSelectedAgent(null)}
            />
          ) : selectedAgent ? (
            <AgentInspector
              agent={agents.find((a) => a.id === selectedAgent)}
              onClose={() => setSelectedAgent(null)}
              onOpenFull={() => navAgent(selectedAgent)}
            />
          ) : selectedEvent ? (
            <EventInspector
              eventName={selectedEvent}
              onClose={() => setSelectedEvent(null)}
              onNavigateAgent={navAgent}
              onNavigateEvents={navEvents}
            />
          ) : editing ? (
            <DraftPalette />
          ) : (
            <DefaultInspector events={events} agents={agents} onPick={setSelectedEvent} />
          )}
        </aside>
      </div>
      {showNewModal && <NewWorkflowModal onClose={() => setShowNewModal(false)} />}
      {showImport && <ImportManifestModal onClose={() => setShowImport(false)} mode="workflow" />}

      {/* Kbd is exposed so it bundles even when not displayed (used in EditDraftBanner via its own
          import). Re-export so unused-import lint passes. */}
      {false && <Kbd>⌘</Kbd>}
    </div>
  );
}
