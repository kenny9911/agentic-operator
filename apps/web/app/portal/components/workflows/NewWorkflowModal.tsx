"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Icon,
  ModalOverlay,
} from "@/app/portal/components";
import { useTenants } from "@/lib/hooks/useTenants";

const WORKFLOW_TEMPLATES = [
  { id: "raas", name: "RAAS · Recruitment", desc: "22-agent pipeline: sync → JD → match → submit", agents: 22, events: 33, color: "#d0ff00" },
  { id: "support", name: "Tier-1 Ticket Triage", desc: "Classify → enrich → route → draft reply", agents: 11, events: 18, color: "#7c9eff" },
  { id: "finance", name: "Monthly Close", desc: "GL reconcile → variance review → sign-off", agents: 8, events: 12, color: "#f5c46b" },
  { id: "rag", name: "Doc Q&A · RAG", desc: "Ingest → chunk → embed → answer", agents: 5, events: 7, color: "#b594ff" },
  { id: "sales", name: "Outbound Sequence", desc: "Enrich lead → personalize → followups", agents: 9, events: 14, color: "#65e0a3" },
  { id: "compl", name: "Compliance Review", desc: "Detect PII → redact → audit → archive", agents: 6, events: 9, color: "#ff6470" },
];

export function NewWorkflowModal({ onClose }: { onClose: () => void }) {
  const tenantsQuery = useTenants();
  // Tenant switcher dropdown. Empty list while the query is in-flight or
  // when the api is unreachable — chrome.tsx surfaces the api-down banner
  // so we don't double-warn here.
  const tenants = (tenantsQuery.data?.items ?? []).filter(
    (t) => t.archivedAt == null,
  );
  const [path, setPath] = useState<"blank" | "template" | "import">("template");
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [tenant, setTenant] = useState("raas");
  const [template, setTemplate] = useState("raas");

  function slugify(s: string) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
  function suggestId(n: string) {
    const slug = slugify(n);
    if (!id || id === slugify(name)) setId(slug);
    setName(n);
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div
        style={{
          width: 780,
          maxHeight: "86vh",
          background: "var(--panel)",
          border: "1px solid var(--border-2)",
          borderRadius: 8,
          overflow: "hidden",
          boxShadow: "0 24px 60px -20px rgba(0,0,0,0.6)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <Icon name="workflow" size={14} style={{ color: "var(--signal)" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 500 }}>New workflow</div>
            <div style={{ fontSize: 11, color: "var(--text-3)" }}>
              Workflows are versioned per-tenant. You&apos;ll be able to deploy to staging before prod.
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close new workflow modal"
            style={{ color: "var(--text-3)" }}
          >
            <Icon name="x" size={13} />
          </button>
        </header>

        <div style={{ padding: 18, overflow: "auto", flex: 1 }}>
          <SectionLabel>Start from</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 20 }}>
            <PathCard active={path === "blank"} onClick={() => setPath("blank")} icon="plus" title="Blank canvas" sub="Start with one trigger agent and build out from there." />
            <PathCard active={path === "template"} onClick={() => setPath("template")} icon="workflow" title="From template" sub="Pre-built workflows for common patterns." />
            <PathCard active={path === "import"} onClick={() => setPath("import")} icon="upload" title="Import manifest" sub="Drop a workflow.json + actions.json." />
          </div>

          <SectionLabel>Identity</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
            <FieldInline label="Display name">
              <InlineText value={name} onChange={suggestId} />
            </FieldInline>
            <FieldInline label="Workflow id (slug)">
              <InlineText value={id} onChange={setId} mono />
            </FieldInline>
            <FieldInline label="Tenant">
              <select
                value={tenant}
                onChange={(e) => setTenant(e.target.value)}
                style={{
                  background: "var(--panel-2)",
                  border: "1px solid var(--border-2)",
                  borderRadius: 4,
                  padding: "5px 8px",
                  color: "var(--text)",
                  fontSize: 12,
                  outline: "none",
                }}
              >
                {tenants.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.name}
                  </option>
                ))}
              </select>
            </FieldInline>
            <FieldInline label="Default model">
              <select
                defaultValue="claude-sonnet-4-5"
                style={{
                  background: "var(--panel-2)",
                  border: "1px solid var(--border-2)",
                  borderRadius: 4,
                  padding: "5px 8px",
                  color: "var(--text)",
                  fontSize: 12,
                  fontFamily: "var(--mono)",
                  outline: "none",
                }}
              >
                <option>claude-sonnet-4-5</option>
                <option>claude-haiku-4-5</option>
                <option>gpt-4.1-mini</option>
              </select>
            </FieldInline>
          </div>

          {path === "blank" && (
            <div>
              <SectionLabel>Trigger</SectionLabel>
              <div
                style={{
                  padding: 14,
                  background: "var(--panel-2)",
                  border: "1px dashed var(--border-3)",
                  borderRadius: 6,
                }}
              >
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <FieldInline label="Trigger type">
                    <select
                      style={{
                        background: "var(--panel)",
                        border: "1px solid var(--border-2)",
                        borderRadius: 4,
                        padding: "5px 8px",
                        color: "var(--text)",
                        fontSize: 12,
                        outline: "none",
                      }}
                    >
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
                  We&apos;ll create a single agent stub. You&apos;ll add downstream agents and wire events on the canvas.
                </div>
              </div>
            </div>
          )}

          {path === "template" && (
            <div>
              <SectionLabel>Pick a template</SectionLabel>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
                {WORKFLOW_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTemplate(t.id)}
                    style={{
                      padding: "12px 14px",
                      background: template === t.id ? "var(--panel-3)" : "var(--panel-2)",
                      border: `1px solid ${template === t.id ? "var(--signal)" : "var(--border)"}`,
                      borderRadius: 5,
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <div style={{ width: 14, height: 14, background: t.color, borderRadius: 2 }} />
                      <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>{t.name}</span>
                      {template === t.id && (
                        <Icon name="check" size={11} style={{ color: "var(--signal)", marginLeft: "auto" }} />
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--text-2)", marginBottom: 6 }}>{t.desc}</div>
                    <div style={{ fontSize: 10.5, color: "var(--text-3)", fontFamily: "var(--mono)" }}>
                      {t.agents} agents · {t.events} events
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {path === "import" && (
            <div>
              <SectionLabel>Manifest</SectionLabel>
              <div
                style={{
                  padding: 28,
                  textAlign: "center",
                  background: "var(--bg-2)",
                  border: "1px dashed var(--border-3)",
                  borderRadius: 6,
                }}
              >
                <Icon name="upload" size={22} style={{ color: "var(--text-3)" }} />
                <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--text-2)" }}>
                  Drop <span className="mono">workflow.json</span> and <span className="mono">actions.json</span>
                </div>
                <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-3)" }}>
                  or <span style={{ color: "var(--signal)" }}>browse files</span>
                </div>
              </div>
              <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.55 }}>
                We accept the same schema as <span className="mono">RAAS</span>:{" "}
                <span className="mono">id, name, actor, trigger[], actions[], triggered_event[]</span>. We&apos;ll validate the graph and report any cycles or orphans before letting you save.
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
    </ModalOverlay>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </div>
  );
}

function PathCard({
  active,
  onClick,
  icon,
  title,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  icon: "plus" | "workflow" | "upload";
  title: string;
  sub: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "12px 14px",
        background: active ? "var(--panel-3)" : "var(--panel-2)",
        border: `1px solid ${active ? "var(--signal)" : "var(--border)"}`,
        borderRadius: 5,
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
        <Icon name={icon} size={12} style={{ color: active ? "var(--signal)" : "var(--text-2)" }} />
        <span style={{ fontSize: 12.5, color: "var(--text)", fontWeight: 500 }}>{title}</span>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.45 }}>{sub}</div>
    </button>
  );
}

function FieldInline({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontSize: 10.5,
          fontFamily: "var(--mono)",
          color: "var(--text-3)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function InlineText({
  value,
  onChange,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: "var(--panel-2)",
        border: "1px solid var(--border-2)",
        borderRadius: 4,
        padding: "5px 8px",
        color: "var(--text)",
        fontFamily: mono ? "var(--mono)" : "var(--sans)",
        fontSize: mono ? 11.5 : 12,
        outline: "none",
      }}
    />
  );
}

// Unused helper kept for parity / future extensibility.
export { Badge };
