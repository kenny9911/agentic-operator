"use client";

import type { ReactNode } from "react";
import {
  ActorTag,
  Badge,
  Button,
  Icon,
  eventTone,
} from "@/app/portal/components";
import { fmtAgo } from "@/lib/format";
import { useRaasData } from "@/lib/hooks/data-context";
import type {
  RaasAgent,
  RaasEvent,
  RaasStreamItem,
} from "@/lib/hooks/data-context";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
      <div
        style={{
          fontSize: 10.5,
          fontFamily: "var(--mono)",
          textTransform: "uppercase",
          color: "var(--text-3)",
          letterSpacing: "0.08em",
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function LegendRow({ color, label, sub }: { color: string; label: string; sub: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 10, height: 10, background: color, borderRadius: 2 }} />
      <span style={{ color: "var(--text)" }}>{label}</span>
      <span style={{ marginLeft: "auto", color: "var(--text-3)", fontSize: 11, fontFamily: "var(--mono)" }}>{sub}</span>
    </div>
  );
}

export function DefaultInspector({
  events,
  agents,
  onPick,
}: {
  events: RaasEvent[];
  agents: RaasAgent[];
  onPick: (name: string) => void;
}) {
  const grouped: Record<string, RaasEvent[]> = {
    agent: [],
    human: [],
    data: [],
    external: [],
    alert: [],
    system: [],
  };
  events.forEach((e) => {
    const bucket = grouped[e.category];
    if (bucket) bucket.push(e);
  });
  const labels: Record<string, string> = {
    agent: "From agents",
    human: "From humans",
    data: "Data",
    external: "External",
    alert: "Alerts",
    system: "System",
  };

  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 11, fontFamily: "var(--mono)", textTransform: "uppercase", color: "var(--text-3)", letterSpacing: "0.08em" }}>Legend</div>
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
          <LegendRow color="var(--signal)" label="Agent node" sub={`${agents.filter((a) => a.actor === "Agent").length} in workflow`} />
          <LegendRow color="var(--violet)" label="Human node" sub={`${agents.filter((a) => a.actor === "Human").length} in workflow`} />
        </div>
      </div>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
        <div
          style={{
            fontSize: 11,
            fontFamily: "var(--mono)",
            textTransform: "uppercase",
            color: "var(--text-3)",
            letterSpacing: "0.08em",
            marginBottom: 8,
          }}
        >
          Events · click to trace
        </div>
        {Object.entries(grouped).map(([cat, items]) =>
          items.length > 0 ? (
            <div key={cat} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--text-3)", marginBottom: 5 }}>{labels[cat]}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {items.map((e) => (
                  <button key={e.name} onClick={() => onPick(e.name)} style={{ display: "inline-block" }}>
                    <Badge tone={eventTone(e.color)} style={{ fontSize: 9.5, cursor: "pointer" }}>{e.name}</Badge>
                  </button>
                ))}
              </div>
            </div>
          ) : null,
        )}
      </div>
      <div style={{ padding: "14px 16px", fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.55 }}>
        <strong style={{ color: "var(--text-2)", fontWeight: 500 }}>Tip</strong>
        <span> · Click any node to see what triggers and emits from it. Click any event to highlight every edge carrying it.</span>
      </div>
    </div>
  );
}

export function AgentInspector({
  agent,
  onClose,
  onOpenFull,
}: {
  agent: RaasAgent | null | undefined;
  onClose: () => void;
  onOpenFull: () => void;
}) {
  if (!agent) return null;
  return (
    <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
      <header
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
        }}
      >
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
      {agent.steps && agent.steps.length > 0 && (
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
          {agent.triggers.length > 0 ? (
            agent.triggers.map((t) => (
              <Badge key={t} tone="blue">{t}</Badge>
            ))
          ) : (
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>None (manual)</span>
          )}
        </div>
      </Section>
      <Section title="Emits">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {agent.emits.map((e) => (
            <Badge key={e} tone="green">{e}</Badge>
          ))}
        </div>
      </Section>
      {agent.tools && agent.tools.length > 0 && (
        <Section title="Tools">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {agent.tools.map((t) => (
              <Badge key={t} tone="muted">{t}</Badge>
            ))}
          </div>
        </Section>
      )}
      {agent.model && (
        <Section title="Model">
          <span className="mono" style={{ fontSize: 12, color: "var(--text)" }}>{agent.model}</span>
        </Section>
      )}
      <div
        style={{
          padding: 14,
          marginTop: "auto",
          display: "flex",
          gap: 8,
          borderTop: "1px solid var(--border)",
        }}
      >
        <Button icon="external" onClick={onOpenFull} style={{ flex: 1 }}>
          Open agent
        </Button>
        <Button icon="run" tone="primary">
          Test run
        </Button>
      </div>
    </div>
  );
}

export function EventInspector({
  eventName,
  onClose,
  onNavigateAgent,
  onNavigateEvents,
}: {
  eventName: string;
  onClose: () => void;
  onNavigateAgent: (id: string) => void;
  onNavigateEvents: (eventName: string) => void;
}) {
  const { events, agents, eventStream } = useRaasData();
  const ev = events.find((e) => e.name === eventName);
  const emitters = agents.filter((a) => a.emits.includes(eventName));
  const listeners = agents.filter((a) => a.triggers.includes(eventName));
  const recentInStream: RaasStreamItem[] = eventStream
    .filter((e: RaasStreamItem) => (e as { name?: string }).name === eventName)
    .slice(0, 4);

  return (
    <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
      <header
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
        }}
      >
        <div>
          <Badge tone={eventTone(ev?.color ?? "")} style={{ marginBottom: 8 }}>{eventName}</Badge>
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>category · {ev?.category}</div>
        </div>
        <Button small icon="x" tone="ghost" onClick={onClose} />
      </header>
      <Section title={`Emitted by · ${emitters.length}`}>
        <NodeList agents={emitters} onPick={onNavigateAgent} />
      </Section>
      <Section title={`Listened by · ${listeners.length}`}>
        <NodeList agents={listeners} onPick={onNavigateAgent} />
      </Section>
      <Section title={`Recent · ${recentInStream.length}`}>
        {recentInStream.map((e) => {
          const item = e as { id: string; at?: number | null };
          return (
            <div key={item.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 11.5 }}>
              <span className="mono" style={{ color: "var(--text-2)" }}>{item.id}</span>
              <span style={{ color: "var(--text-3)" }}>{item.at != null ? fmtAgo(item.at) : "—"}</span>
            </div>
          );
        })}
      </Section>
      <div style={{ padding: 14, marginTop: "auto", borderTop: "1px solid var(--border)" }}>
        <Button icon="external" onClick={() => onNavigateEvents(eventName)} style={{ width: "100%" }}>
          View in event stream
        </Button>
      </div>
    </div>
  );
}

function NodeList({ agents, onPick }: { agents: RaasAgent[]; onPick: (id: string) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {agents.map((a) => (
        <button
          key={a.id}
          onClick={() => onPick(a.id)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 8px",
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            textAlign: "left",
            fontSize: 12,
            color: "var(--text)",
          }}
        >
          <ActorTag actor={a.actor} />
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {a.title}
          </span>
        </button>
      ))}
    </div>
  );
}

export function EditDraftBanner() {
  return (
    <div
      style={{
        padding: "10px 24px",
        background: "rgba(255,181,71,0.06)",
        borderBottom: "1px solid rgba(255,181,71,0.25)",
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexShrink: 0,
      }}
    >
      <Icon name="alert" size={12} style={{ color: "var(--amber)" }} />
      <div style={{ fontSize: 12, color: "var(--text)" }}>
        <span
          style={{
            color: "var(--amber)",
            fontFamily: "var(--mono)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontSize: 10.5,
          }}
        >
          EDITING DRAFT
        </span>
        <span style={{ marginLeft: 12, color: "var(--text-2)" }}>2 nodes added · 2 modified · 0 removed</span>
        <span style={{ marginLeft: 12, color: "var(--text-3)", fontFamily: "var(--mono)" }}>auto-saved 12s ago</span>
      </div>
      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          gap: 8,
          alignItems: "center",
          fontSize: 11,
          fontFamily: "var(--mono)",
          color: "var(--text-3)",
        }}
      >
        <KbdHint k="⌘" k2="Z" hint="undo" />
        <KbdHint k="V" hint="select" />
        <KbdHint k="C" hint="connect" />
        <KbdHint k="N" hint="add node" />
      </div>
    </div>
  );
}

function KbdHint({ k, k2, hint }: { k: string; k2?: string; hint: string }) {
  return (
    <span>
      <KKey>{k}</KKey>
      {k2 && (
        <>
          {" "}
          <KKey>{k2}</KKey>
        </>
      )}{" "}
      {hint}
    </span>
  );
}

function KKey({ children }: { children: ReactNode }) {
  return (
    <kbd
      style={{
        display: "inline-block",
        padding: "1px 5px",
        fontSize: 10,
        fontFamily: "var(--mono)",
        color: "var(--text-2)",
        background: "var(--panel-2)",
        border: "1px solid var(--border-2)",
        borderBottom: "2px solid var(--border-2)",
        borderRadius: 3,
        lineHeight: 1.2,
      }}
    >
      {children}
    </kbd>
  );
}

export function EditToolbar({ tool, setTool }: { tool: string; setTool: (t: string) => void }) {
  const tools = [
    { id: "select", icon: "filter" as const, label: "Select" },
    { id: "connect", icon: "git" as const, label: "Connect" },
    { id: "add", icon: "plus" as const, label: "Add" },
  ];
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        zIndex: "var(--z-overlay)" as unknown as number,
        display: "flex",
        gap: 1,
        background: "var(--panel)",
        border: "1px solid var(--border-2)",
        borderRadius: 6,
        padding: 2,
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      }}
    >
      {tools.map((t) => (
        <button
          key={t.id}
          onClick={() => setTool(t.id)}
          title={t.label}
          aria-label={t.label}
          aria-pressed={tool === t.id}
          style={{
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: tool === t.id ? "var(--signal)" : "transparent",
            color: tool === t.id ? "#000" : "var(--text-2)",
            borderRadius: 4,
          }}
        >
          <Icon name={t.icon} size={13} />
        </button>
      ))}
      <div style={{ width: 1, background: "var(--border)", margin: "4px 4px" }} />
      <button
        title="Auto-layout"
        aria-label="Auto-layout"
        style={{
          width: 32,
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-2)",
        }}
      >
        <Icon name="dashboard" size={13} />
      </button>
      <button
        title="Zoom to fit"
        aria-label="Zoom to fit"
        style={{
          width: 32,
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-2)",
        }}
      >
        <Icon name="external" size={13} />
      </button>
    </div>
  );
}

export function DraftPalette() {
  const presets = [
    { kind: "Agent", title: "New agent node", sub: "Code-backed step", color: "var(--signal)" },
    { kind: "Human", title: "Human task", sub: "Pause for approval", color: "var(--violet)" },
    { kind: "Agent", title: "From template…", sub: "matchResume, etc.", color: "var(--text-3)" },
  ];
  return (
    <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
        <div
          style={{
            fontSize: 11,
            fontFamily: "var(--mono)",
            textTransform: "uppercase",
            color: "var(--text-3)",
            letterSpacing: "0.08em",
            marginBottom: 4,
          }}
        >
          Editing
        </div>
        <div style={{ fontSize: 14, color: "var(--text)" }}>
          raas <span style={{ color: "var(--amber)", fontFamily: "var(--mono)", fontSize: 11 }}>· DRAFT</span>
        </div>
      </div>

      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
        <div
          style={{
            fontSize: 11,
            fontFamily: "var(--mono)",
            textTransform: "uppercase",
            color: "var(--text-3)",
            letterSpacing: "0.08em",
            marginBottom: 8,
          }}
        >
          Drag onto canvas
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {presets.map((p, i) => (
            <div
              key={i}
              draggable
              style={{
                padding: "8px 10px",
                background: "var(--panel-2)",
                border: "1px dashed var(--border-2)",
                borderLeft: `3px solid ${p.color}`,
                borderRadius: 4,
                cursor: "grab",
              }}
            >
              <div style={{ fontSize: 12, color: "var(--text)" }}>{p.title}</div>
              <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{p.sub}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
        <div
          style={{
            fontSize: 11,
            fontFamily: "var(--mono)",
            textTransform: "uppercase",
            color: "var(--text-3)",
            letterSpacing: "0.08em",
            marginBottom: 8,
          }}
        >
          Pending changes
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
          <DiffRow kind="mod" name="matchResume" hint="Bonus weights for WXG" />
          <DiffRow kind="mod" name="analyzeRequirement" hint="Added market.lookup tool" />
          <DiffRow kind="add" name="enrichCandidateLinkedIn" hint="New agent · stage 4" />
          <DiffRow kind="add" name="generateRecommendationPackage" hint="Wired to evaluateInterview" />
        </div>
      </div>

      <div
        style={{
          padding: "14px 16px",
          marginTop: "auto",
          borderTop: "1px solid var(--border)",
          fontSize: 11.5,
          color: "var(--text-3)",
          lineHeight: 1.55,
        }}
      >
        <Icon name="check" size={11} style={{ color: "var(--green)" }} /> Graph valid · 0 cycles · 0 orphans
      </div>
    </div>
  );
}

function DiffRow({ kind, name, hint }: { kind: "add" | "del" | "mod"; name: string; hint: string }) {
  const tone = kind === "add" ? "var(--green)" : kind === "del" ? "var(--red)" : "var(--amber)";
  const sigil = kind === "add" ? "+" : kind === "del" ? "−" : "~";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 8px",
        background: "var(--bg-2)",
        border: "1px solid var(--border)",
        borderRadius: 3,
      }}
    >
      <span className="mono" style={{ color: tone, width: 12, fontWeight: 700 }}>{sigil}</span>
      <span className="mono" style={{ color: "var(--text-2)", fontSize: 11.5 }}>{name}</span>
      <span style={{ marginLeft: "auto", color: "var(--text-3)", fontSize: 10.5 }}>{hint}</span>
    </div>
  );
}
