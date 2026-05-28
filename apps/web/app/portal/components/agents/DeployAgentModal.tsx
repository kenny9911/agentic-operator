"use client";

/**
 * DeployAgentModal — 6-step wizard for adding a new agent to the workflow.
 *
 * Live data via canonical TanStack hooks (useEvents for event-name
 * autocomplete + useDag for the workflow stage list). Models are passed
 * in from the page (audit 01 D-11).
 */

import { useMemo, useState } from "react";
import {
  ActorTag,
  Badge,
  Button,
  CodeBlock,
  Icon,
  ModalOverlay,
  Panel,
} from "@/app/portal/components";
import { useDag } from "@/lib/hooks/useAgents";
import { useEvents } from "@/lib/hooks/useEvents";
import {
  AGENT_SAMPLE_TOOL_USE,
  AGENT_SAMPLE_TS_CODE,
  type ToolUseSchema,
} from "@/app/portal/components/agent-code/samples";
import {
  AgentCodeEditPanel,
  AgentToolUseEditPanel,
} from "@/app/portal/components/agent-code/EditPanels";

// Static workflow ontology labels — mirrors the dashboard funnel.
const STAGE_LABELS: Record<number, string> = {
  0: "Intake",
  1: "Analyze",
  2: "JD",
  3: "Publish",
  4: "Resume",
  5: "Match & Interview",
  6: "Package",
  7: "Submit",
};

interface ModelInfo {
  id: string;
  name: string;
}

const AGENT_TEMPLATES = [
  { id: "blank", actor: "Agent" as const, name: "Blank agent", desc: "Empty handler. Bring your own steps + prompt.", color: "var(--text-3)" },
  { id: "classify", actor: "Agent" as const, name: "Classifier", desc: "Single LLM call, returns one of N labels. Cheap and fast.", color: "var(--blue)" },
  { id: "extract", actor: "Agent" as const, name: "Extractor", desc: "Pulls structured JSON from unstructured input. JSON schema enforced.", color: "var(--blue)" },
  { id: "rag", actor: "Agent" as const, name: "RAG retriever", desc: "Embeds question, fetches top-k chunks, answers with citations.", color: "var(--violet)" },
  { id: "loop", actor: "Agent" as const, name: "Tool-loop agent", desc: "Iterates tool calls until done. Use for research, browsing, data lookups.", color: "var(--signal)" },
  { id: "human", actor: "Human" as const, name: "Human approval", desc: "Pauses the workflow for an operator to approve, reject, or supplement.", color: "var(--violet)" },
];

const COMMON_TOOLS = [
  { id: "db.query", kind: "Data", hint: "Read from the run-state DB" },
  { id: "db.upsert", kind: "Data", hint: "Write/update rows" },
  { id: "db.lock", kind: "Data", hint: "Acquire a distributed lock" },
  { id: "http.fetch", kind: "Network", hint: "HTTP GET/POST with retry" },
  { id: "llm.generate", kind: "Model", hint: "Direct LLM call (escape hatch)" },
  { id: "llm.evaluate", kind: "Model", hint: "LLM-as-judge rubric scoring" },
  { id: "ocr.parse", kind: "Document", hint: "PDF → text + structure" },
  { id: "nlp.extract", kind: "Document", hint: "Entity / field extraction" },
  { id: "pdf.compose", kind: "Document", hint: "Render markdown → PDF" },
  { id: "scoring.match", kind: "Domain", hint: "Resume↔JD matcher (RAAS)" },
  { id: "email.send", kind: "Notify", hint: "Transactional email" },
  { id: "wechat.notify", kind: "Notify", hint: "WeChat Work bot" },
  { id: "ats.adapter", kind: "Integration", hint: "Client ATS submit" },
];

type Template = (typeof AGENT_TEMPLATES)[number];

export function DeployAgentModal({
  onClose,
  models,
}: {
  onClose: () => void;
  models: ModelInfo[];
}) {
  const { data: dag } = useDag();
  const { data: liveEvents = [] } = useEvents({ limit: 100 });
  // Derive stages from the live DAG (set of stage indices in use).
  const stages = useMemo(() => {
    const used = new Set<number>();
    for (const a of dag?.agents ?? []) used.add(a.stage);
    return Array.from(used)
      .sort((a, b) => a - b)
      .map((id) => ({ id, label: STAGE_LABELS[id] ?? `Stage ${id}` }));
  }, [dag]);
  // Event-name catalog combines names seen on the live stream + every name
  // declared by an agent in the DAG.
  const events = useMemo(() => {
    const set = new Set<string>();
    for (const e of liveEvents) set.add(e.name);
    for (const a of dag?.agents ?? []) {
      for (const n of a.triggers) set.add(n);
      for (const n of a.emits) set.add(n);
    }
    return Array.from(set).sort().map((name) => ({ name }));
  }, [liveEvents, dag]);
  const [step, setStep] = useState(0);
  const [template, setTemplate] = useState<Template | null>(null);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [stage, setStage] = useState(5);
  const [model, setModel] = useState(models[0]?.name ?? "");
  const [tools, setTools] = useState<string[]>([]);
  const [triggers, setTriggers] = useState<string[]>([]);
  const [emits, setEmits] = useState<string[]>([]);
  const [retries, setRetries] = useState(3);
  const [timeout, setTimeoutVal] = useState(120);
  const [concurrency, setConcurrency] = useState(8);
  const [implTab, setImplTab] = useState<"prompt" | "code" | "tools" | "bind">("prompt");
  const [tsCode, setTsCode] = useState(AGENT_SAMPLE_TS_CODE);
  const [toolUse, setToolUse] = useState<ToolUseSchema[]>(AGENT_SAMPLE_TOOL_USE);

  const steps = ["Template", "Identity", "Events", "Implementation", "Behavior", "Review"];

  function pickTemplate(t: Template) {
    setTemplate(t);
    if (t.id === "classify") setTools(["llm.generate"]);
    if (t.id === "extract") setTools(["llm.generate", "db.upsert"]);
    if (t.id === "rag") setTools(["http.fetch", "llm.generate"]);
    if (t.id === "loop") setTools(["http.fetch", "db.query", "llm.generate"]);
    setStep(1);
  }
  function next() {
    setStep((s) => Math.min(steps.length - 1, s + 1));
  }
  function back() {
    setStep((s) => Math.max(0, s - 1));
  }
  function toggleTool(id: string) {
    setTools((ts) => (ts.includes(id) ? ts.filter((t) => t !== id) : [...ts, id]));
  }
  function addEvent(set: React.Dispatch<React.SetStateAction<string[]>>, val: string) {
    const v = val.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    if (v) set((arr) => (arr.includes(v) ? arr : [...arr, v]));
  }
  function removeEvent(set: React.Dispatch<React.SetStateAction<string[]>>, v: string) {
    set((arr) => arr.filter((x) => x !== v));
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div
        style={{
          width: 1080,
          maxHeight: "88vh",
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
          <Icon name="agent" size={14} style={{ color: "var(--signal)" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 500 }}>Deploy new agent</div>
            <div style={{ fontSize: 11, color: "var(--text-3)" }}>
              Added as a draft to workflow <span className="mono">raas</span>. Connect it to events on the workflow canvas after deploy.
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close deploy agent modal"
            style={{ color: "var(--text-3)" }}
          >
            <Icon name="x" size={13} />
          </button>
        </header>

        <div
          style={{
            display: "flex",
            gap: 6,
            padding: "10px 18px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-2)",
          }}
        >
          {steps.map((s, i) => (
            <div
              key={s}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                opacity: i === step ? 1 : i < step ? 0.85 : 0.45,
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: i < step ? "var(--signal)" : "transparent",
                  border: `1px solid ${i <= step ? "var(--signal)" : "var(--border-2)"}`,
                  color: i < step ? "#000" : i === step ? "var(--signal)" : "var(--text-3)",
                  fontSize: 10,
                  fontFamily: "var(--mono)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {i < step ? "✓" : i + 1}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontFamily: "var(--mono)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: i === step ? "var(--text)" : "var(--text-3)",
                }}
              >
                {s}
              </span>
              {i < steps.length - 1 && (
                <span style={{ width: 14, height: 1, background: "var(--border)", marginLeft: 4 }} />
              )}
            </div>
          ))}
        </div>

        <div style={{ padding: 20, overflow: "auto", flex: 1, minHeight: 0 }}>
          {step === 0 && (
            <div>
              <SectionLabel>Pick a template</SectionLabel>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                {AGENT_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => pickTemplate(t)}
                    style={{
                      padding: "12px 14px",
                      background: "var(--panel-2)",
                      border: "1px solid var(--border)",
                      borderLeft: `3px solid ${t.color}`,
                      borderRadius: 5,
                      textAlign: "left",
                      cursor: "pointer",
                      transition: "background 0.12s, border-color 0.12s",
                    }}
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
                <select
                  value={stage}
                  onChange={(e) => setStage(parseInt(e.target.value, 10))}
                  style={editSelectStyle}
                >
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {String(s.id).padStart(2, "0")} · {s.label}
                    </option>
                  ))}
                </select>
              </EditField>
              <EditField label="Actor" hint={template.actor === "Human" ? "Pauses for operator input" : "Runs automatically"}>
                <Seg
                  value={template.actor}
                  onChange={() => {}}
                  options={[
                    { value: "Agent", label: "Agent" },
                    { value: "Human", label: "Human task" },
                  ]}
                />
              </EditField>
            </div>
          )}

          {step === 2 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, maxWidth: 760 }}>
              <EditField label="Listens to (triggers)" hint="Pick existing events from the workflow, or type new EVENT_NAMEs.">
                <EventPicker
                  selected={triggers}
                  onAdd={(v) => addEvent(setTriggers, v)}
                  onRemove={(v) => removeEvent(setTriggers, v)}
                  tone="blue"
                  all={events.map((e) => e.name)}
                />
              </EditField>
              <EditField label="Emits (outbound)" hint="The events this agent publishes. Downstream agents listen to these.">
                <EventPicker
                  selected={emits}
                  onAdd={(v) => addEvent(setEmits, v)}
                  onRemove={(v) => removeEvent(setEmits, v)}
                  tone="green"
                  all={events.map((e) => e.name)}
                />
              </EditField>
            </div>
          )}

          {step === 3 && (
            <div>
              <div
                style={{
                  display: "flex",
                  gap: 0,
                  borderBottom: "1px solid var(--border)",
                  marginBottom: 14,
                }}
              >
                {([
                  { id: "prompt", label: "System prompt", icon: "logs" as const },
                  { id: "code", label: "TypeScript code", icon: "code" as const },
                  { id: "tools", label: "tool_use", icon: "spark" as const },
                  { id: "bind", label: "Tool bindings", icon: "git" as const },
                ] as const).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setImplTab(t.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "8px 14px",
                      fontSize: 11.5,
                      fontFamily: "var(--mono)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: implTab === t.id ? "var(--text)" : "var(--text-3)",
                      borderBottom: `2px solid ${implTab === t.id ? "var(--signal)" : "transparent"}`,
                      marginBottom: -1,
                    }}
                  >
                    <Icon name={t.icon} size={11} />
                    {t.label}
                    {t.id === "tools" && (
                      <span
                        style={{
                          marginLeft: 4,
                          padding: "0 5px",
                          background: "var(--panel-2)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          fontSize: 9.5,
                          color: "var(--text-3)",
                        }}
                      >
                        {toolUse.length}
                      </span>
                    )}
                    {t.id === "bind" && (
                      <span
                        style={{
                          marginLeft: 4,
                          padding: "0 5px",
                          background: "var(--panel-2)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          fontSize: 9.5,
                          color: "var(--text-3)",
                        }}
                      >
                        {tools.length}
                      </span>
                    )}
                  </button>
                ))}
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                  <span style={{ fontSize: 11, color: "var(--text-3)" }}>Model</span>
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    style={{
                      background: "var(--panel-2)",
                      border: "1px solid var(--border-2)",
                      borderRadius: 4,
                      padding: "4px 8px",
                      color: "var(--text)",
                      fontFamily: "var(--mono)",
                      fontSize: 11.5,
                      outline: "none",
                    }}
                  >
                    {models.length === 0 ? (
                      <option value="">No models configured</option>
                    ) : (
                      models.map((m) => (
                        <option key={m.id} value={m.name}>{m.name}</option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              {implTab === "prompt" && (
                <EditField
                  label="System prompt"
                  hint="Prepended to every request. Use {{vars}} to interpolate run context."
                >
                  <EditTextarea
                    value={`You are an automated agent named ${name || "<name>"} in the RAAS workflow.\nGoal: ${title || "<title>"}.\n\nFollow these rules:\n- Emit one structured progress event per step.\n- Never block on human input — emit a HUMAN_TASK event if needed.\n- Be conservative; if uncertain, fall through to manual review.`}
                    onChange={() => {}}
                    rows={14}
                    mono
                  />
                </EditField>
              )}

              {implTab === "code" && (
                <AgentCodeEditPanel value={tsCode} onChange={setTsCode} height={480} />
              )}
              {implTab === "tools" && (
                <AgentToolUseEditPanel tools={toolUse} onChange={setToolUse} />
              )}

              {implTab === "bind" && (
                <EditField
                  label={`Tool bindings · ${tools.length} selected`}
                  hint="Workspace tools this agent's code may invoke at runtime."
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 4,
                      maxHeight: 420,
                      overflow: "auto",
                      padding: 2,
                    }}
                  >
                    {COMMON_TOOLS.map((t) => {
                      const on = tools.includes(t.id);
                      return (
                        <button
                          key={t.id}
                          onClick={() => toggleTool(t.id)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "7px 9px",
                            background: on ? "rgba(208,255,0,0.06)" : "var(--panel-2)",
                            border: `1px solid ${on ? "var(--signal)" : "var(--border)"}`,
                            borderRadius: 4,
                            textAlign: "left",
                          }}
                        >
                          <span
                            style={{
                              width: 12,
                              height: 12,
                              borderRadius: 2,
                              background: on ? "var(--signal)" : "transparent",
                              border: `1px solid ${on ? "var(--signal)" : "var(--border-3)"}`,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
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
                <EditText
                  value={String(retries)}
                  onChange={(v) => setRetries(parseInt(v, 10) || 0)}
                  mono
                  suffix="attempts"
                />
              </EditField>
              <EditField label="Per-run timeout">
                <EditText
                  value={String(timeout)}
                  onChange={(v) => setTimeoutVal(parseInt(v, 10) || 0)}
                  mono
                  suffix="seconds"
                />
              </EditField>
              <EditField label="Concurrency" hint="Max simultaneous runs.">
                <EditText
                  value={String(concurrency)}
                  onChange={(v) => setConcurrency(parseInt(v, 10) || 0)}
                  mono
                  suffix="runs"
                />
              </EditField>
              <EditField label="Concurrency key" hint="Partition by a payload field — one run per key at a time.">
                <EditText value="${event.payload.candidate_id}" mono onChange={() => {}} />
              </EditField>
              <div style={{ gridColumn: "1 / -1" }}>
                <EditField label="Dead-letter queue" hint="Where failed runs go after retries are exhausted.">
                  <Seg
                    value="audit"
                    onChange={() => {}}
                    options={[
                      { value: "audit", label: "Audit log (default)" },
                      { value: "queue", label: "DLQ for replay" },
                      { value: "human", label: "Page human · #ops-alerts" },
                    ]}
                  />
                </EditField>
              </div>
            </div>
          )}

          {step === 5 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Panel title="Manifest" padded={false}>
                <CodeBlock>
                  {JSON.stringify(
                    {
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
                      typescript_code:
                        template?.actor === "Human"
                          ? null
                          : `<inline · ${tsCode.split("\n").length} lines>`,
                      tool_use:
                        template?.actor === "Human"
                          ? []
                          : toolUse.map((t) => ({
                              name: t.name,
                              description: t.description,
                              params: Object.keys(
                                (t.input_schema && t.input_schema.properties) || {},
                              ),
                            })),
                    },
                    null,
                    2,
                  )}
                </CodeBlock>
              </Panel>
              <div>
                <Panel title="Pre-flight" padded>
                  <ValidationLine ok={!!name} warn={!name} label="Identity valid" hint={name ? "✓" : "name required"} />
                  <ValidationLine ok={triggers.length > 0} warn={triggers.length === 0} label={`${triggers.length} trigger event(s)`} />
                  <ValidationLine ok={emits.length > 0} warn={emits.length === 0} label={`${emits.length} emit event(s)`} />
                  <ValidationLine ok label={`${tools.length} tool bindings`} />
                  {template?.actor !== "Human" && (
                    <ValidationLine ok label={`typescript_code · ${tsCode.split("\n").length} lines`} hint="compiles" />
                  )}
                  {template?.actor !== "Human" && (
                    <ValidationLine
                      ok={toolUse.length > 0}
                      warn={toolUse.length === 0}
                      label={`tool_use · ${toolUse.length} defined`}
                      hint="schemas valid"
                    />
                  )}
                  <ValidationLine ok label="Model accessible" hint={model} />
                </Panel>
                <Panel title="Deploy target" padded style={{ marginTop: 12 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <DeployTargetRow on label="Staging · raas-stage" sub="Smoke test before prod" />
                    <DeployTargetRow label="Production · raas" sub="Live event stream" warn />
                  </div>
                  <div
                    style={{
                      marginTop: 10,
                      padding: "8px 10px",
                      background: "var(--bg-2)",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      fontSize: 11,
                      color: "var(--text-3)",
                      lineHeight: 1.55,
                    }}
                  >
                    Will save as <span className="mono" style={{ color: "var(--text-2)" }}>raas@2026.05.18-draft</span>. Roll forward to prod from the Deployments page.
                  </div>
                </Panel>
              </div>
            </div>
          )}
        </div>

        <footer
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 18px",
            borderTop: "1px solid var(--border)",
            background: "var(--panel-2)",
          }}
        >
          {step > 0 && (
            <Button tone="ghost" icon="chevron-left" onClick={back}>
              Back
            </Button>
          )}
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
            Step {step + 1} of {steps.length}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <Button tone="ghost" onClick={onClose}>Cancel</Button>
            {step < steps.length - 1 ? (
              <Button tone="primary" onClick={next}>
                Continue
              </Button>
            ) : (
              <Button tone="primary" icon="deploy" onClick={onClose}>
                Deploy to staging
              </Button>
            )}
          </div>
        </footer>
      </div>
    </ModalOverlay>
  );
}

// ---- small atoms (settings-local pattern) ----

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontFamily: "var(--mono)",
        textTransform: "uppercase",
        color: "var(--text-3)",
        letterSpacing: "0.08em",
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );
}

function EditField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
      <div style={{ fontSize: 11, color: "var(--text)", marginBottom: 3, fontWeight: 500 }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 6, lineHeight: 1.5 }}>{hint}</div>}
      {children}
    </div>
  );
}

function EditText({
  value,
  onChange,
  mono,
  suffix,
}: {
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  suffix?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "var(--panel-2)",
        border: "1px solid var(--border-2)",
        borderRadius: 4,
        padding: "5px 8px",
      }}
    >
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          flex: 1,
          background: "transparent",
          border: "none",
          outline: "none",
          color: "var(--text)",
          fontFamily: mono ? "var(--mono)" : "var(--sans)",
          fontSize: mono ? 11.5 : 12,
        }}
      />
      {suffix && (
        <span style={{ fontSize: 10.5, color: "var(--text-3)", fontFamily: "var(--mono)" }}>{suffix}</span>
      )}
    </div>
  );
}

function EditTextarea({
  value,
  onChange,
  rows = 3,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  mono?: boolean;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      style={{
        width: "100%",
        background: "var(--panel-2)",
        border: "1px solid var(--border-2)",
        borderRadius: 4,
        padding: "6px 8px",
        color: "var(--text)",
        fontFamily: mono ? "var(--mono)" : "var(--sans)",
        fontSize: mono ? 11.5 : 12,
        outline: "none",
        resize: "vertical",
        lineHeight: 1.55,
      }}
    />
  );
}

function Seg({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        border: "1px solid var(--border-2)",
        borderRadius: 4,
        overflow: "hidden",
      }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          style={{
            padding: "5px 12px",
            fontSize: 11.5,
            background: value === o.value ? "var(--panel-3)" : "var(--panel-2)",
            color: value === o.value ? "var(--text)" : "var(--text-3)",
            borderRight: "1px solid var(--border-2)",
            borderBottom: value === o.value ? "2px solid var(--signal)" : "2px solid transparent",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function EventPicker({
  selected,
  onAdd,
  onRemove,
  tone,
  all,
}: {
  selected: string[];
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  tone: "blue" | "green";
  all: string[];
}) {
  const [input, setInput] = useState("");
  const colorMap = {
    blue: { fg: "var(--blue)", bg: "rgba(132,169,255,0.10)", bd: "rgba(132,169,255,0.32)" },
    green: { fg: "var(--green)", bg: "rgba(101,224,163,0.08)", bd: "rgba(101,224,163,0.30)" },
  } as const;
  const c = colorMap[tone] ?? colorMap.blue;
  const suggestions = input
    ? all.filter((e) => e.toLowerCase().includes(input.toLowerCase()) && !selected.includes(e)).slice(0, 6)
    : [];

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6, minHeight: 22 }}>
        {selected.length === 0 && (
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>None yet — type a name below to add.</span>
        )}
        {selected.map((t) => (
          <span
            key={t}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 4px 2px 7px",
              fontSize: 10.5,
              fontFamily: "var(--mono)",
              textTransform: "uppercase",
              color: c.fg,
              background: c.bg,
              border: `1px solid ${c.bd}`,
              borderRadius: 3,
            }}
          >
            {t}
            <button
              onClick={() => onRemove(t)}
              aria-label={`Remove ${t}`}
              style={{ color: "currentColor", opacity: 0.6, padding: 1 }}
            >
              <Icon name="x" size={8} />
            </button>
          </span>
        ))}
      </div>
      <div style={{ position: "relative" }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && input.trim()) {
              onAdd(input);
              setInput("");
            }
          }}
          placeholder="Type EVENT_NAME, press enter…"
          style={{
            width: "100%",
            background: "var(--panel-2)",
            border: "1px solid var(--border-2)",
            borderRadius: 4,
            padding: "5px 8px",
            color: "var(--text)",
            fontFamily: "var(--mono)",
            fontSize: 11.5,
            outline: "none",
          }}
        />
        {suggestions.length > 0 && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              marginTop: 2,
              background: "var(--panel)",
              border: "1px solid var(--border-2)",
              borderRadius: 4,
              boxShadow: "0 8px 20px rgba(0,0,0,0.4)",
              zIndex: "var(--z-overlay)" as unknown as number,
              maxHeight: 180,
              overflow: "auto",
            }}
          >
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => {
                  onAdd(s);
                  setInput("");
                }}
                style={{
                  display: "flex",
                  width: "100%",
                  padding: "5px 8px",
                  fontSize: 11.5,
                  fontFamily: "var(--mono)",
                  color: "var(--text-2)",
                  textAlign: "left",
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ValidationLine({
  ok,
  warn,
  label,
  hint,
}: {
  ok?: boolean;
  warn?: boolean;
  label: string;
  hint?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 11.5 }}>
      <Icon
        name={ok ? "check" : warn ? "alert" : "x"}
        size={11}
        style={{ color: ok ? "var(--green)" : warn ? "var(--amber)" : "var(--red)" }}
      />
      <span style={{ color: "var(--text-2)" }}>{label}</span>
      {hint && (
        <span
          style={{
            marginLeft: "auto",
            color: "var(--text-3)",
            fontFamily: "var(--mono)",
            fontSize: 10.5,
          }}
        >
          {hint}
        </span>
      )}
    </div>
  );
}

function DeployTargetRow({
  label,
  sub,
  on,
  warn,
}: {
  label: string;
  sub: string;
  on?: boolean;
  warn?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        background: "var(--panel-2)",
        border: "1px solid var(--border)",
        borderRadius: 4,
        cursor: "pointer",
      }}
    >
      <input type="checkbox" defaultChecked={on} style={{ accentColor: "var(--signal)" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: "var(--text)" }}>{label}</div>
        <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{sub}</div>
      </div>
      {warn && <Badge tone="amber">requires approval</Badge>}
    </label>
  );
}

const editSelectStyle = {
  background: "var(--panel-2)",
  border: "1px solid var(--border-2)",
  borderRadius: 4,
  padding: "5px 8px",
  color: "var(--text)",
  fontFamily: "var(--mono)",
  fontSize: 12,
  outline: "none",
  width: "100%",
} as const;
