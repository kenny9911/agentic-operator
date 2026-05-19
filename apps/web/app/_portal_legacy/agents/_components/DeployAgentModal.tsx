"use client";

import { useState } from "react";
import { ActorTag, Badge, Button, Icon } from "@/components";

const AGENT_TEMPLATES = [
  { id: "blank",    actor: "Agent" as const, name: "Blank agent",     desc: "Empty handler. Bring your own steps + prompt.",                                color: "var(--text-3)" },
  { id: "classify", actor: "Agent" as const, name: "Classifier",      desc: "Single LLM call, returns one of N labels. Cheap and fast.",                    color: "var(--blue)" },
  { id: "extract",  actor: "Agent" as const, name: "Extractor",       desc: "Pulls structured JSON from unstructured input. JSON schema enforced.",         color: "var(--blue)" },
  { id: "rag",      actor: "Agent" as const, name: "RAG retriever",   desc: "Embeds question, fetches top-k chunks, answers with citations.",               color: "var(--violet)" },
  { id: "loop",     actor: "Agent" as const, name: "Tool-loop agent", desc: "Iterates tool calls until done. Use for research, browsing, data lookups.",    color: "var(--signal)" },
  { id: "human",    actor: "Human" as const, name: "Human approval",  desc: "Pauses the workflow for an operator to approve, reject, or supplement.",       color: "var(--violet)" },
];

const COMMON_TOOLS = [
  { id: "db.query",      kind: "Data",        hint: "Read from the run-state DB" },
  { id: "db.upsert",     kind: "Data",        hint: "Write/update rows" },
  { id: "db.lock",       kind: "Data",        hint: "Acquire a distributed lock" },
  { id: "http.fetch",    kind: "Network",     hint: "HTTP GET/POST with retry" },
  { id: "llm.generate",  kind: "Model",       hint: "Direct LLM call (escape hatch)" },
  { id: "llm.evaluate",  kind: "Model",       hint: "LLM-as-judge rubric scoring" },
  { id: "ocr.parse",     kind: "Document",    hint: "PDF → text + structure" },
  { id: "nlp.extract",   kind: "Document",    hint: "Entity / field extraction" },
  { id: "pdf.compose",   kind: "Document",    hint: "Render markdown → PDF" },
  { id: "scoring.match", kind: "Domain",      hint: "Resume↔JD matcher (RAAS)" },
  { id: "email.send",    kind: "Notify",      hint: "Transactional email" },
  { id: "wechat.notify", kind: "Notify",      hint: "WeChat Work bot" },
  { id: "ats.adapter",   kind: "Integration", hint: "Client ATS submit" },
];

const RAAS_STAGES = [
  { id: 0, label: "Intake" },
  { id: 1, label: "Analyze" },
  { id: 2, label: "JD" },
  { id: 3, label: "Publish" },
  { id: 4, label: "Resume" },
  { id: 5, label: "Match & Interview" },
  { id: 6, label: "Package" },
  { id: 7, label: "Submit" },
];

const editSelectStyle: React.CSSProperties = {
  background: "var(--panel-2)",
  border: "1px solid var(--border-2)",
  borderRadius: 4,
  padding: "5px 8px",
  color: "var(--text)",
  fontFamily: "var(--mono)",
  fontSize: 12,
  outline: "none",
  width: "100%",
};

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
    <div
      style={{
        padding: "10px 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "var(--text)",
          marginBottom: 3,
          fontWeight: 500,
        }}
      >
        {label}
      </div>
      {hint && (
        <div
          style={{
            fontSize: 11,
            color: "var(--text-3)",
            marginBottom: 6,
            lineHeight: 1.5,
          }}
        >
          {hint}
        </div>
      )}
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
        <span
          style={{
            fontSize: 10.5,
            color: "var(--text-3)",
            fontFamily: "var(--mono)",
          }}
        >
          {suffix}
        </span>
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

function Seg<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
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
            background:
              value === o.value ? "var(--panel-3)" : "var(--panel-2)",
            color: value === o.value ? "var(--text)" : "var(--text-3)",
            borderRight: "1px solid var(--border-2)",
            borderBottom:
              value === o.value
                ? "2px solid var(--signal)"
                : "2px solid transparent",
            cursor: "pointer",
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
}: {
  selected: string[];
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  tone: "blue" | "green";
}) {
  const [input, setInput] = useState("");
  const colorMap = {
    blue: {
      fg: "var(--blue)",
      bg: "rgba(132,169,255,0.10)",
      bd: "rgba(132,169,255,0.32)",
    },
    green: {
      fg: "var(--green)",
      bg: "rgba(101,224,163,0.08)",
      bd: "rgba(101,224,163,0.30)",
    },
  };
  const c = colorMap[tone];
  return (
    <div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
          marginBottom: 6,
          minHeight: 22,
        }}
      >
        {selected.length === 0 && (
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
            None yet — type a name below to add.
          </span>
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
              style={{
                color: "currentColor",
                opacity: 0.6,
                padding: 1,
                background: "transparent",
                border: "none",
                cursor: "pointer",
              }}
            >
              <Icon name="x" size={8} />
            </button>
          </span>
        ))}
      </div>
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
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 0",
        fontSize: 11.5,
      }}
    >
      <Icon
        name={ok ? "check" : warn ? "alert" : "x"}
        size={11}
        style={{
          color: ok
            ? "var(--green)"
            : warn
              ? "var(--amber)"
              : "var(--red)",
        }}
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
      <input
        type="checkbox"
        defaultChecked={on}
        style={{ accentColor: "var(--signal)" }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: "var(--text)" }}>{label}</div>
        <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{sub}</div>
      </div>
      {warn && <Badge tone="amber">requires approval</Badge>}
    </label>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre
      style={{
        margin: 0,
        padding: 12,
        background: "var(--bg-2)",
        border: "1px solid var(--border)",
        borderRadius: 4,
        fontFamily: "var(--mono)",
        fontSize: 11.5,
        lineHeight: 1.6,
        color: "var(--text-2)",
        whiteSpace: "pre",
        overflow: "auto",
        maxHeight: 360,
      }}
    >
      {children}
    </pre>
  );
}

function MiniPanel({
  title,
  subtitle,
  action,
  padded = true,
  style,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  padded?: boolean;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span
            style={{
              fontSize: 11,
              fontFamily: "var(--mono)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--text-2)",
            }}
          >
            {title}
          </span>
          {subtitle && (
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>
              {subtitle}
            </span>
          )}
        </div>
        {action}
      </header>
      <div style={{ padding: padded ? 14 : 0 }}>{children}</div>
    </section>
  );
}

export function DeployAgentModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [template, setTemplate] = useState<
    (typeof AGENT_TEMPLATES)[number] | null
  >(null);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [stage, setStage] = useState(5);
  const [model, setModel] = useState("claude-sonnet-4-5");
  const [tools, setTools] = useState<string[]>([]);
  const [triggers, setTriggers] = useState<string[]>([]);
  const [emits, setEmits] = useState<string[]>([]);
  const [retries, setRetries] = useState(3);
  const [timeoutVal, setTimeoutVal] = useState(120);
  const [concurrency, setConcurrency] = useState(8);

  const steps = [
    "Template",
    "Identity",
    "Events",
    "Implementation",
    "Behavior",
    "Review",
  ];

  function pickTemplate(t: (typeof AGENT_TEMPLATES)[number]) {
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
    setTools((ts) =>
      ts.includes(id) ? ts.filter((t) => t !== id) : [...ts, id],
    );
  }

  function addEvent(set: (fn: (arr: string[]) => string[]) => void, val: string) {
    const v = val
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, "_");
    if (v) set((arr) => (arr.includes(v) ? arr : [...arr, v]));
  }

  function removeEvent(
    set: (fn: (arr: string[]) => string[]) => void,
    v: string,
  ) {
    set((arr) => arr.filter((x) => x !== v));
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        backdropFilter: "blur(2px)",
        animation: "fadein 0.14s ease",
      }}
    >
      <div onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            width: 900,
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
          {/* Header */}
          <header
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "14px 18px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <Icon name="agent" size={14} style={{ color: "var(--signal)" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 14,
                  color: "var(--text)",
                  fontWeight: 500,
                }}
              >
                Deploy new agent
              </div>
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                Added as a draft to workflow{" "}
                <span className="mono">raas</span>. Connect it to events on
                the workflow canvas after deploy.
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                color: "var(--text-3)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
              }}
            >
              <Icon name="x" size={13} />
            </button>
          </header>

          {/* Stepper */}
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
                    background:
                      i < step ? "var(--signal)" : "transparent",
                    border: `1px solid ${i <= step ? "var(--signal)" : "var(--border-2)"}`,
                    color:
                      i < step
                        ? "#000"
                        : i === step
                          ? "var(--signal)"
                          : "var(--text-3)",
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
                  <span
                    style={{
                      width: 14,
                      height: 1,
                      background: "var(--border)",
                      marginLeft: 4,
                    }}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Body */}
          <div
            style={{
              padding: 20,
              overflow: "auto",
              flex: 1,
              minHeight: 0,
            }}
          >
            {step === 0 && (
              <div>
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
                  Pick a template
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 10,
                  }}
                >
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
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background =
                          "var(--panel-3)";
                        e.currentTarget.style.borderColor = "var(--signal)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background =
                          "var(--panel-2)";
                        e.currentTarget.style.borderColor = "var(--border)";
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          marginBottom: 6,
                        }}
                      >
                        <ActorTag actor={t.actor} />
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          color: "var(--text)",
                          fontWeight: 500,
                          marginBottom: 3,
                        }}
                      >
                        {t.name}
                      </div>
                      <div
                        style={{
                          fontSize: 11.5,
                          color: "var(--text-2)",
                          lineHeight: 1.5,
                        }}
                      >
                        {t.desc}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === 1 && template && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                  maxWidth: 760,
                }}
              >
                <EditField
                  label="Name (id)"
                  hint="lowercase camelCase, used in events & logs"
                >
                  <EditText value={name} onChange={setName} mono />
                </EditField>
                <EditField label="Title" hint="Shown in the operator UI">
                  <EditText value={title} onChange={setTitle} />
                </EditField>
                <div style={{ gridColumn: "1 / -1" }}>
                  <EditField
                    label="Description"
                    hint="One paragraph. Shown in the workflow graph inspector."
                  >
                    <EditTextarea value={desc} onChange={setDesc} rows={3} />
                  </EditField>
                </div>
                <EditField
                  label="Workflow stage"
                  hint="Column on the workflow canvas."
                >
                  <select
                    value={stage}
                    onChange={(e) => setStage(parseInt(e.target.value))}
                    style={editSelectStyle}
                  >
                    {RAAS_STAGES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {String(s.id).padStart(2, "0")} · {s.label}
                      </option>
                    ))}
                  </select>
                </EditField>
                <EditField
                  label="Actor"
                  hint={
                    template.actor === "Human"
                      ? "Pauses for operator input"
                      : "Runs automatically"
                  }
                >
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
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                  maxWidth: 760,
                }}
              >
                <EditField
                  label="Listens to (triggers)"
                  hint="Pick existing events from the workflow, or type new EVENT_NAMEs."
                >
                  <EventPicker
                    selected={triggers}
                    onAdd={(v) => addEvent(setTriggers, v)}
                    onRemove={(v) => removeEvent(setTriggers, v)}
                    tone="blue"
                  />
                </EditField>
                <EditField
                  label="Emits (outbound)"
                  hint="The events this agent publishes. Downstream agents listen to these."
                >
                  <EventPicker
                    selected={emits}
                    onAdd={(v) => addEvent(setEmits, v)}
                    onRemove={(v) => removeEvent(setEmits, v)}
                    tone="green"
                  />
                </EditField>
              </div>
            )}

            {step === 3 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                }}
              >
                <div>
                  <EditField
                    label="Model"
                    hint="Pick from the fleet, or rely on the workflow default."
                  >
                    <select
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      style={editSelectStyle}
                    >
                      <option>claude-sonnet-4-5</option>
                      <option>claude-haiku-4-5</option>
                      <option>gpt-4.1-mini</option>
                    </select>
                  </EditField>
                  <EditField
                    label="System prompt"
                    hint="Use {{vars}} to interpolate run context."
                  >
                    <EditTextarea
                      value={`You are an automated agent named ${name || "<name>"} in the RAAS workflow.\nGoal: ${title || "<title>"}.\n\nFollow these rules:\n- Emit one structured progress event per step.\n- Never block on human input — emit a HUMAN_TASK event if needed.\n- Be conservative; if uncertain, fall through to manual review.`}
                      onChange={() => {}}
                      rows={9}
                      mono
                    />
                  </EditField>
                </div>
                <div>
                  <EditField
                    label={`Tools · ${tools.length} selected`}
                    hint="Tool bindings this agent may call. Add more from the workspace catalog."
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                        maxHeight: 360,
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
                              background: on
                                ? "rgba(208,255,0,0.06)"
                                : "var(--panel-2)",
                              border: `1px solid ${on ? "var(--signal)" : "var(--border)"}`,
                              borderRadius: 4,
                              textAlign: "left",
                              cursor: "pointer",
                            }}
                          >
                            <span
                              style={{
                                width: 12,
                                height: 12,
                                borderRadius: 2,
                                background: on
                                  ? "var(--signal)"
                                  : "transparent",
                                border: `1px solid ${on ? "var(--signal)" : "var(--border-3)"}`,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              {on && (
                                <Icon
                                  name="check"
                                  size={9}
                                  style={{ color: "#000" }}
                                />
                              )}
                            </span>
                            <span
                              className="mono"
                              style={{ fontSize: 11.5, color: "var(--text)" }}
                            >
                              {t.id}
                            </span>
                            <Badge
                              tone="muted"
                              style={{ marginLeft: "auto" }}
                            >
                              {t.kind}
                            </Badge>
                          </button>
                        );
                      })}
                    </div>
                  </EditField>
                </div>
              </div>
            )}

            {step === 4 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                  maxWidth: 760,
                }}
              >
                <EditField
                  label="Retries"
                  hint="On tool/model errors. Exponential backoff."
                >
                  <EditText
                    value={String(retries)}
                    onChange={(v) => setRetries(parseInt(v) || 0)}
                    mono
                    suffix="attempts"
                  />
                </EditField>
                <EditField label="Per-run timeout">
                  <EditText
                    value={String(timeoutVal)}
                    onChange={(v) => setTimeoutVal(parseInt(v) || 0)}
                    mono
                    suffix="seconds"
                  />
                </EditField>
                <EditField
                  label="Concurrency"
                  hint="Max simultaneous runs."
                >
                  <EditText
                    value={String(concurrency)}
                    onChange={(v) => setConcurrency(parseInt(v) || 0)}
                    mono
                    suffix="runs"
                  />
                </EditField>
                <EditField
                  label="Concurrency key"
                  hint="Partition by a payload field — one run per key at a time."
                >
                  <EditText
                    value="${event.payload.candidate_id}"
                    mono
                    onChange={() => {}}
                  />
                </EditField>
                <div style={{ gridColumn: "1 / -1" }}>
                  <EditField
                    label="Dead-letter queue"
                    hint="Where failed runs go after retries are exhausted."
                  >
                    <Seg<"audit" | "queue" | "human">
                      value="audit"
                      onChange={() => {}}
                      options={[
                        { value: "audit", label: "Audit log (default)" },
                        { value: "queue", label: "DLQ for replay" },
                        {
                          value: "human",
                          label: "Page human · #ops-alerts",
                        },
                      ]}
                    />
                  </EditField>
                </div>
              </div>
            )}

            {step === 5 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                }}
              >
                <MiniPanel title="Manifest" padded={false}>
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
                        concurrency: {
                          limit: concurrency,
                          key: "${event.payload.candidate_id}",
                        },
                        timeout_s: timeoutVal,
                      },
                      null,
                      2,
                    )}
                  </CodeBlock>
                </MiniPanel>
                <div>
                  <MiniPanel title="Pre-flight" padded>
                    <ValidationLine
                      ok
                      label="Identity valid"
                      hint={name ? "✓" : "name required"}
                      warn={!name}
                    />
                    <ValidationLine
                      ok
                      label={`${triggers.length} trigger event(s)`}
                      warn={triggers.length === 0}
                    />
                    <ValidationLine
                      ok
                      label={`${emits.length} emit event(s)`}
                      warn={emits.length === 0}
                    />
                    <ValidationLine
                      ok
                      label={`${tools.length} tools wired`}
                    />
                    <ValidationLine
                      ok
                      label="Model accessible"
                      hint={model}
                    />
                  </MiniPanel>
                  <MiniPanel
                    title="Deploy target"
                    padded
                    style={{ marginTop: 12 }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      <DeployTargetRow
                        on
                        label="Staging · raas-stage"
                        sub="Smoke test before prod"
                      />
                      <DeployTargetRow
                        label="Production · raas"
                        sub="Live event stream"
                        warn
                      />
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
                      Will save as{" "}
                      <span
                        className="mono"
                        style={{ color: "var(--text-2)" }}
                      >
                        raas@2026.05.18-draft
                      </span>
                      . Roll forward to prod from the Deployments page.
                    </div>
                  </MiniPanel>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
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
            <div
              style={{ marginLeft: "auto", display: "flex", gap: 6 }}
            >
              <Button tone="ghost" onClick={onClose}>
                Cancel
              </Button>
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
      </div>
    </div>
  );
}
