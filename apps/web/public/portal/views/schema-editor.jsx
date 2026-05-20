// Schema Editor — structured editor for workflow_v*.json manifests.
//
// Three panes:
//   - Tree (left)    agents → actions → fields navigation
//   - Form (center)  schema-driven inputs for the selected node
//   - JSON (right)   read-only Monaco view of the whole manifest
//
// Plus a collapsible Issues panel that lists validation problems found by
// the local linter. Issues that map to a Zod preprocess shim or a
// schema-default get a "Fix" button; rules 1-7 of the design doc are all
// covered, plus the missing-`description` default and the dangling-event
// warning (suggestion-only, no auto-fix).
//
// Save flow: POST manifest to PUT /v1/tenants/:slug/workflow. The endpoint
// Zod-parses, writes the next _vN file, and hot-reloads Inngest.

const {
  useState: useStateSE,
  useEffect: useEffectSE,
  useMemo: useMemoSE,
  useCallback: useCallbackSE,
  useRef: useRefSE,
} = React;

const STEP_TYPE_VALUES = ["tool", "logic", "manual", "condition", "delay", "subflow"];

// ─── Auto-fix rules ─────────────────────────────────────────────────────────
//
// Each rule has:
//   id      — stable identifier (shown in the Issues panel and audit)
//   level   — "error" | "warn"
//   detect  — function over (agent, actionIndex?) → message string | null
//   fix     — function (manifest, agentIndex, actionIndex?) → mutated manifest
//             — omitted for suggestion-only rules
//
// `actionIndex === undefined` means the rule fires at agent scope.

const AUTO_FIX_RULES = [
  {
    id: "tool_use_empty_string",
    level: "warn",
    scope: "agent",
    detect: (agent) => (agent.tool_use === "" ? "`tool_use` is the legacy empty-string placeholder — omit it." : null),
    fix: (m, i) => { delete m[i].tool_use; return m; },
  },
  {
    id: "tool_use_string_array",
    level: "warn",
    scope: "agent",
    detect: (agent) =>
      Array.isArray(agent.tool_use) && agent.tool_use.some((t) => typeof t === "string")
        ? "`tool_use` carries bare strings — canonical shape is `[{ name: \"...\" }]`."
        : null,
    fix: (m, i) => {
      m[i].tool_use = (m[i].tool_use || []).map((t) => (typeof t === "string" ? { name: t } : t));
      return m;
    },
  },
  {
    id: "ontology_empty",
    level: "warn",
    scope: "agent",
    detect: (agent) => (agent.ontology_instructions === "" ? "`ontology_instructions` is empty — omit the field." : null),
    fix: (m, i) => { delete m[i].ontology_instructions; return m; },
  },
  {
    id: "typescript_empty",
    level: "warn",
    scope: "agent",
    detect: (agent) => (agent.typescript_code === "" ? "`typescript_code` is empty — omit the field." : null),
    fix: (m, i) => { delete m[i].typescript_code; return m; },
  },
  {
    id: "model_empty",
    level: "warn",
    scope: "agent",
    detect: (agent) => (agent.model === "" ? "`model` is empty — omit to use the runtime default." : null),
    fix: (m, i) => { delete m[i].model; return m; },
  },
  {
    id: "cron_empty",
    level: "warn",
    scope: "agent",
    detect: (agent) => (agent.cron === "" ? "`cron` is empty — omit the field." : null),
    fix: (m, i) => { delete m[i].cron; return m; },
  },
  {
    id: "action_id_only",
    level: "warn",
    scope: "action",
    detect: (action) => (action.id && !action.order ? "Step has `id` but no `order` — runtime will derive `order` from `id`." : null),
    fix: (m, i, j) => { m[i].actions[j].order = String(m[i].actions[j].id); return m; },
  },
  {
    id: "action_missing_name",
    level: "warn",
    scope: "action",
    detect: (action) => (!action.name && (action.id || action.order) ? "Step missing `name` — will fall back to `id`/`order` at runtime." : null),
    fix: (m, i, j) => { m[i].actions[j].name = String(m[i].actions[j].id || m[i].actions[j].order); return m; },
  },
  {
    id: "action_missing_type",
    level: "warn",
    scope: "action",
    detect: (action) => (!action.type ? "Step missing `type` — runtime defaults to `logic`." : null),
    fix: (m, i, j) => { m[i].actions[j].type = "logic"; return m; },
  },
  {
    id: "action_missing_description",
    level: "warn",
    scope: "action",
    detect: (action) => (action.description === undefined ? "Step missing `description` — defaults to empty string." : null),
    fix: (m, i, j) => { m[i].actions[j].description = ""; return m; },
  },
  // Suggestion-only rule (no fix): dangling event reference.
  {
    id: "dangling_triggered_event",
    level: "warn",
    scope: "agent",
    detect: (agent, _idx, ctx) => {
      if (!ctx?.allTriggerEvents) return null;
      const dangling = (agent.triggered_event || []).filter(
        (e) => !ctx.allTriggerEvents.has(e),
      );
      return dangling.length > 0
        ? `Emits ${dangling.length} event(s) no other agent listens for: ${dangling.join(", ")}`
        : null;
    },
  },
  // Hard error: action type out of enum.
  {
    id: "action_invalid_type",
    level: "error",
    scope: "action",
    detect: (action) =>
      action.type && !STEP_TYPE_VALUES.includes(action.type)
        ? `Step type "${action.type}" is not one of ${STEP_TYPE_VALUES.join(" | ")}`
        : null,
  },
  // Hard error: agent missing required field.
  {
    id: "agent_missing_required",
    level: "error",
    scope: "agent",
    detect: (agent) => {
      const required = ["id", "name", "actor", "trigger", "actions", "triggered_event"];
      const missing = required.filter((k) => agent[k] === undefined || agent[k] === null);
      return missing.length > 0 ? `Missing required field(s): ${missing.join(", ")}` : null;
    },
  },
];

function findIssues(manifest) {
  if (!Array.isArray(manifest)) return [];
  const allTriggerEvents = new Set();
  for (const agent of manifest) {
    for (const e of agent.trigger || []) allTriggerEvents.add(e);
  }
  const ctx = { allTriggerEvents };
  const out = [];
  manifest.forEach((agent, i) => {
    for (const rule of AUTO_FIX_RULES.filter((r) => r.scope === "agent")) {
      const msg = rule.detect(agent, i, ctx);
      if (msg) {
        out.push({
          rule: rule.id,
          level: rule.level,
          agentIndex: i,
          agentId: agent.id,
          path: agent.id || `agent[${i}]`,
          message: msg,
          fixable: Boolean(rule.fix),
        });
      }
    }
    (agent.actions || []).forEach((action, j) => {
      for (const rule of AUTO_FIX_RULES.filter((r) => r.scope === "action")) {
        const msg = rule.detect(action, j);
        if (msg) {
          out.push({
            rule: rule.id,
            level: rule.level,
            agentIndex: i,
            actionIndex: j,
            agentId: agent.id,
            path: `${agent.id || `agent[${i}]`}.actions[${j}]`,
            message: msg,
            fixable: Boolean(rule.fix),
          });
        }
      }
    });
  });
  return out;
}

function applyFix(manifest, issue) {
  const rule = AUTO_FIX_RULES.find((r) => r.id === issue.rule);
  if (!rule || !rule.fix) return manifest;
  const cloned = JSON.parse(JSON.stringify(manifest));
  return rule.fix(cloned, issue.agentIndex, issue.actionIndex);
}

function applyAllSafeFixes(manifest) {
  let current = manifest;
  let applied = 0;
  let issues = findIssues(current);
  // Loop until no more fixable issues remain. Each fix may unlock another
  // (eg fixing tool_use_empty_string for one agent doesn't affect others).
  // Cap iterations defensively in case a fix introduces another error.
  for (let pass = 0; pass < 8; pass++) {
    const fixable = issues.filter((i) => i.fixable && i.level !== "error");
    if (fixable.length === 0) break;
    for (const issue of fixable) {
      current = applyFix(current, issue);
      applied++;
    }
    issues = findIssues(current);
  }
  return { manifest: current, applied };
}

// ─── Form pane ──────────────────────────────────────────────────────────────

function StringField({ label, value, onChange, multiline, placeholder, mono }) {
  const Comp = multiline ? "textarea" : "input";
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
      <span style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--mono)", letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</span>
      <Comp
        value={value ?? ""}
        placeholder={placeholder ?? ""}
        onChange={(e) => onChange(e.target.value)}
        rows={multiline ? 4 : undefined}
        style={{
          padding: "6px 9px",
          fontSize: 12.5,
          fontFamily: mono ? "var(--mono)" : "var(--sans)",
          background: "var(--panel)",
          color: "var(--text)",
          border: "1px solid var(--border-2)",
          borderRadius: 4,
          resize: multiline ? "vertical" : undefined,
        }}
      />
    </label>
  );
}

function NumberField({ label, value, onChange }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
      <span style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--mono)", letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</span>
      <input
        type="number"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        style={{ padding: "6px 9px", fontSize: 12.5, fontFamily: "var(--mono)", background: "var(--panel)", color: "var(--text)", border: "1px solid var(--border-2)", borderRadius: 4 }}
      />
    </label>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
      <span style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--mono)", letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        style={{ padding: "6px 9px", fontSize: 12.5, fontFamily: "var(--mono)", background: "var(--panel)", color: "var(--text)", border: "1px solid var(--border-2)", borderRadius: 4 }}
      >
        <option value="">—</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function StringArrayField({ label, value, onChange, suggestions }) {
  const items = Array.isArray(value) ? value : [];
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--mono)", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map((item, i) => (
          <div key={i} style={{ display: "flex", gap: 4 }}>
            <input
              value={item}
              list={suggestions ? `${label}-suggestions` : undefined}
              onChange={(e) => {
                const next = items.slice();
                next[i] = e.target.value;
                onChange(next);
              }}
              style={{ flex: 1, padding: "5px 9px", fontSize: 12, fontFamily: "var(--mono)", background: "var(--panel)", color: "var(--text)", border: "1px solid var(--border-2)", borderRadius: 4 }}
            />
            <button
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              style={{ padding: "0 8px", fontSize: 11, color: "var(--text-3)", background: "transparent", border: "1px solid var(--border-2)", borderRadius: 4, cursor: "pointer" }}
              title="Remove"
            >×</button>
          </div>
        ))}
        <button
          onClick={() => onChange([...items, ""])}
          style={{ padding: "4px 9px", fontSize: 11, fontFamily: "var(--mono)", color: "var(--text-2)", background: "transparent", border: "1px dashed var(--border-2)", borderRadius: 4, cursor: "pointer", textAlign: "left" }}
        >+ add</button>
        {suggestions && (
          <datalist id={`${label}-suggestions`}>
            {suggestions.map((s) => <option key={s} value={s} />)}
          </datalist>
        )}
      </div>
    </div>
  );
}

function InputDataField({ value, onChange }) {
  const entries = useMemoSE(() => Object.entries(value || {}), [value]);
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--mono)", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 4 }}>input_data</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {entries.map(([k, v], i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 4 }}>
            <input
              value={k}
              onChange={(e) => {
                const next = { ...value };
                delete next[k];
                next[e.target.value] = v;
                onChange(next);
              }}
              placeholder="key"
              style={{ padding: "5px 9px", fontSize: 12, fontFamily: "var(--mono)", background: "var(--panel)", color: "var(--text)", border: "1px solid var(--border-2)", borderRadius: 4 }}
            />
            <input
              value={String(v ?? "")}
              onChange={(e) => onChange({ ...value, [k]: e.target.value })}
              placeholder="description"
              style={{ padding: "5px 9px", fontSize: 12, background: "var(--panel)", color: "var(--text)", border: "1px solid var(--border-2)", borderRadius: 4 }}
            />
            <button
              onClick={() => { const next = { ...value }; delete next[k]; onChange(next); }}
              style={{ padding: "0 8px", fontSize: 11, color: "var(--text-3)", background: "transparent", border: "1px solid var(--border-2)", borderRadius: 4, cursor: "pointer" }}
              title="Remove"
            >×</button>
          </div>
        ))}
        <button
          onClick={() => onChange({ ...(value || {}), "": "" })}
          style={{ padding: "4px 9px", fontSize: 11, fontFamily: "var(--mono)", color: "var(--text-2)", background: "transparent", border: "1px dashed var(--border-2)", borderRadius: 4, cursor: "pointer", textAlign: "left" }}
        >+ add slot</button>
      </div>
    </div>
  );
}

function ConcurrencyField({ value, onChange }) {
  const v = value || {};
  return (
    <fieldset style={{ marginBottom: 12, padding: 10, border: "1px solid var(--border)", borderRadius: 4 }}>
      <legend style={{ padding: "0 6px", fontSize: 11, color: "var(--text-3)", fontFamily: "var(--mono)", letterSpacing: "0.04em", textTransform: "uppercase" }}>concurrency</legend>
      <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, fontSize: 12 }}>
        <input
          type="checkbox"
          checked={Boolean(v.enabled)}
          onChange={(e) => onChange({ ...v, enabled: e.target.checked, queue_strategy: v.queue_strategy ?? "FIFO", max_concurrent_executions: v.max_concurrent_executions ?? 1 })}
        />
        <span>Enabled</span>
      </label>
      {v.enabled && (
        <>
          <NumberField label="max_concurrent_executions" value={v.max_concurrent_executions} onChange={(n) => onChange({ ...v, max_concurrent_executions: n })} />
          <SelectField label="queue_strategy" value={v.queue_strategy} onChange={(s) => onChange({ ...v, queue_strategy: s })} options={["FIFO", "LIFO", "PRIORITY"]} />
        </>
      )}
    </fieldset>
  );
}

function ToolUseField({ value, onChange }) {
  // Canonical shape: array of { name, description?, input_schema? }.
  // Legacy shapes flagged by issues panel; editor always writes canonical.
  const items = Array.isArray(value)
    ? value.map((v) => (typeof v === "string" ? { name: v } : v))
    : [];
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--mono)", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 4 }}>tool_use</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((t, i) => (
          <div key={i} style={{ display: "flex", gap: 4 }}>
            <input
              value={t.name ?? ""}
              placeholder="tool name (eg tools.httpRequest)"
              onChange={(e) => {
                const next = items.slice();
                next[i] = { ...next[i], name: e.target.value };
                onChange(next);
              }}
              style={{ flex: 1, padding: "5px 9px", fontSize: 12, fontFamily: "var(--mono)", background: "var(--panel)", color: "var(--text)", border: "1px solid var(--border-2)", borderRadius: 4 }}
            />
            <button
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              style={{ padding: "0 8px", fontSize: 11, color: "var(--text-3)", background: "transparent", border: "1px solid var(--border-2)", borderRadius: 4, cursor: "pointer" }}
              title="Remove"
            >×</button>
          </div>
        ))}
        <button
          onClick={() => onChange([...items, { name: "" }])}
          style={{ padding: "4px 9px", fontSize: 11, fontFamily: "var(--mono)", color: "var(--text-2)", background: "transparent", border: "1px dashed var(--border-2)", borderRadius: 4, cursor: "pointer", textAlign: "left" }}
        >+ add tool</button>
      </div>
    </div>
  );
}

function AgentForm({ agent, onChange, allEventNames }) {
  const upd = (key, val) => onChange({ ...agent, [key]: val });
  return (
    <div>
      <StringField label="id" value={agent.id} onChange={(v) => upd("id", v)} mono />
      <StringField label="name" value={agent.name} onChange={(v) => upd("name", v)} mono />
      <StringField label="title" value={agent.title} onChange={(v) => upd("title", v)} />
      <StringField label="description" value={agent.description} onChange={(v) => upd("description", v)} multiline />
      <StringArrayField label="actor" value={agent.actor} onChange={(v) => upd("actor", v)} suggestions={["Agent", "Human"]} />
      <StringArrayField label="trigger" value={agent.trigger} onChange={(v) => upd("trigger", v)} suggestions={allEventNames} />
      <StringArrayField label="triggered_event" value={agent.triggered_event} onChange={(v) => upd("triggered_event", v)} suggestions={allEventNames} />
      <InputDataField value={agent.input_data} onChange={(v) => upd("input_data", v)} />
      <StringField label="ontology_instructions" value={agent.ontology_instructions} onChange={(v) => upd("ontology_instructions", v)} multiline />
      <ToolUseField value={agent.tool_use} onChange={(v) => upd("tool_use", v)} />
      <StringField label="typescript_code" value={agent.typescript_code} onChange={(v) => upd("typescript_code", v)} mono multiline />
      <NumberField label="retries" value={agent.retries} onChange={(v) => upd("retries", v)} />
      <NumberField label="timeout_s" value={agent.timeout_s} onChange={(v) => upd("timeout_s", v)} />
      <StringField label="model" value={agent.model} onChange={(v) => upd("model", v)} mono />
      <ConcurrencyField value={agent.concurrency} onChange={(v) => upd("concurrency", v)} />
      <StringField label="cron" value={agent.cron} onChange={(v) => upd("cron", v)} mono />
      <StringField label="cron_timezone" value={agent.cron_timezone} onChange={(v) => upd("cron_timezone", v)} mono />
    </div>
  );
}

function ActionForm({ action, onChange }) {
  const upd = (key, val) => onChange({ ...action, [key]: val });
  return (
    <div>
      <StringField label="id" value={action.id} onChange={(v) => upd("id", v)} mono />
      <StringField label="order" value={action.order} onChange={(v) => upd("order", v)} mono />
      <StringField label="name" value={action.name} onChange={(v) => upd("name", v)} mono />
      <SelectField label="type" value={action.type} onChange={(v) => upd("type", v)} options={STEP_TYPE_VALUES} />
      <StringField label="description" value={action.description} onChange={(v) => upd("description", v)} multiline />
      <StringField label="condition" value={action.condition} onChange={(v) => upd("condition", v)} mono />
      <NumberField label="retries" value={action.retries} onChange={(v) => upd("retries", v)} />
      <NumberField label="timeout_s" value={action.timeout_s} onChange={(v) => upd("timeout_s", v)} />
      <NumberField label="task_timeout_s" value={action.task_timeout_s} onChange={(v) => upd("task_timeout_s", v)} />
      <StringField label="task_type" value={action.task_type} onChange={(v) => upd("task_type", v)} mono />
      <NumberField label="delay_ms" value={action.delay_ms} onChange={(v) => upd("delay_ms", v)} />
      <StringField label="subflow" value={action.subflow} onChange={(v) => upd("subflow", v)} mono />
    </div>
  );
}

// ─── Tree pane ──────────────────────────────────────────────────────────────

function SchemaTreeNode({ label, depth, selected, hasIssue, onClick, badge }) {
  const [hov, setHov] = useStateSE(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        width: "100%", padding: `4px 10px 4px ${10 + depth * 14}px`,
        background: selected ? "var(--panel-2)" : hov ? "var(--panel)" : "transparent",
        borderLeft: selected ? "2px solid var(--signal)" : "2px solid transparent",
        color: selected ? "var(--text)" : "var(--text-2)",
        fontSize: depth === 0 ? 12.5 : 11.5,
        fontFamily: depth === 0 ? "var(--sans)" : "var(--mono)",
        textAlign: "left", cursor: "pointer",
      }}
    >
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {hasIssue && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--amber)" }} title="has issues" />}
      {badge && <span style={{ fontSize: 10, color: "var(--text-3)", fontFamily: "var(--mono)" }}>{badge}</span>}
    </button>
  );
}

function SchemaTree({ manifest, selection, onSelect, issues, query }) {
  const issueByAgent = useMemoSE(() => {
    const m = new Map();
    for (const it of issues) m.set(it.agentIndex, (m.get(it.agentIndex) || 0) + 1);
    return m;
  }, [issues]);
  const filtered = useMemoSE(() => {
    if (!query) return manifest.map((_, i) => i);
    const q = query.toLowerCase();
    return manifest
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => (a.id || "").toLowerCase().includes(q) || (a.name || "").toLowerCase().includes(q) || (a.title || "").toLowerCase().includes(q))
      .map(({ i }) => i);
  }, [manifest, query]);
  return (
    <div style={{ display: "flex", flexDirection: "column", padding: "8px 0", gap: 1 }}>
      {filtered.map((i) => {
        const a = manifest[i];
        const isAgentSelected = selection.agentIndex === i && selection.actionIndex === undefined;
        const isExpanded = selection.agentIndex === i;
        return (
          <React.Fragment key={i}>
            <SchemaTreeNode
              label={`${a.id || `#${i}`} · ${a.name || "(unnamed)"}`}
              depth={0}
              selected={isAgentSelected}
              hasIssue={issueByAgent.has(i)}
              badge={(a.actions || []).length ? String((a.actions || []).length) : null}
              onClick={() => onSelect({ agentIndex: i })}
            />
            {isExpanded && (a.actions || []).map((action, j) => (
              <SchemaTreeNode
                key={j}
                label={`${action.id || action.order || `step-${j + 1}`} · ${action.name || "(unnamed)"}`}
                depth={1}
                selected={selection.agentIndex === i && selection.actionIndex === j}
                hasIssue={issues.some((x) => x.agentIndex === i && x.actionIndex === j)}
                badge={action.type}
                onClick={() => onSelect({ agentIndex: i, actionIndex: j })}
              />
            ))}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Issues panel ────────────────────────────────────────────────────────────

function IssuesPanel({ issues, onFix, onSelectIssue, onFixAll }) {
  const errors = issues.filter((i) => i.level === "error");
  const warns = issues.filter((i) => i.level === "warn");
  const fixableCount = issues.filter((i) => i.fixable).length;
  return (
    <div style={{ borderTop: "1px solid var(--border)", maxHeight: "30vh", overflow: "auto", background: "var(--bg-2)" }}>
      <div style={{ padding: "8px 14px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "var(--bg-2)", zIndex: 1 }}>
        <span style={{ fontSize: 11, fontFamily: "var(--mono)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-3)" }}>Issues</span>
        {errors.length > 0 && <span style={{ fontSize: 11, color: "var(--red)" }}>{errors.length} error{errors.length === 1 ? "" : "s"}</span>}
        {warns.length > 0 && <span style={{ fontSize: 11, color: "var(--amber)" }}>{warns.length} warning{warns.length === 1 ? "" : "s"}</span>}
        {issues.length === 0 && <span style={{ fontSize: 11, color: "var(--text-3)" }}>No issues found</span>}
        <div style={{ marginLeft: "auto" }}>
          {fixableCount > 0 && (
            <Button small icon="check" onClick={onFixAll}>Fix all safe ({fixableCount})</Button>
          )}
        </div>
      </div>
      {issues.length === 0 ? null : (
        <div>
          {issues.map((it, idx) => (
            <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", borderBottom: "1px solid var(--border)" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: it.level === "error" ? "var(--red)" : "var(--amber)", flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--text-3)", flexShrink: 0 }}>{it.rule}</span>
              <button onClick={() => onSelectIssue(it)} style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--blue)", background: "transparent", border: "none", cursor: "pointer", flexShrink: 0 }}>{it.path}</button>
              <span style={{ fontSize: 11.5, color: "var(--text-2)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.message}</span>
              {it.fixable && <Button small icon="check" onClick={() => onFix(it)}>Fix</Button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Diff ────────────────────────────────────────────────────────────────────
//
// Compute a structured diff between the loaded manifest (server truth) and
// the current in-memory edits. Agents are matched by `id`; actions within
// an agent are matched by `id || order` (since either may carry the step
// identifier). Field-level deltas distinguish add/remove/change. The diff
// is the basis for the right-pane Diff tab AND the change-count badges on
// the save buttons.

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) if (!deepEqual(a[k], b[k])) return false;
  return true;
}

function diffFields(before, after) {
  const out = [];
  const beforeKeys = new Set(before ? Object.keys(before) : []);
  const afterKeys = new Set(after ? Object.keys(after) : []);
  const allKeys = new Set([...beforeKeys, ...afterKeys]);
  for (const k of allKeys) {
    const inA = beforeKeys.has(k);
    const inB = afterKeys.has(k);
    if (inA && !inB) out.push({ key: k, kind: "removed", before: before[k] });
    else if (!inA && inB) out.push({ key: k, kind: "added", after: after[k] });
    else if (!deepEqual(before[k], after[k])) {
      out.push({ key: k, kind: "changed", before: before[k], after: after[k] });
    }
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

function actionKey(action) {
  // Match priority mirrors the runtime preprocess: id > order > index.
  return String(action.id ?? action.order ?? "");
}

function diffManifests(before, after) {
  const beforeArr = Array.isArray(before) ? before : [];
  const afterArr = Array.isArray(after) ? after : [];
  const beforeById = new Map(beforeArr.map((a) => [a.id, a]));
  const afterById = new Map(afterArr.map((a) => [a.id, a]));
  const agentsAdded = [];
  const agentsRemoved = [];
  const agentsChanged = [];
  let total = 0;

  for (const [id, after] of afterById) {
    if (!beforeById.has(id)) {
      agentsAdded.push({ id, after });
      total++;
      continue;
    }
    const before = beforeById.get(id);
    // Compute agent-level field diff (excluding `actions` — handled separately).
    const before_ = { ...before };
    const after_ = { ...after };
    delete before_.actions;
    delete after_.actions;
    const fieldChanges = diffFields(before_, after_);

    // Per-action diff.
    const beforeActions = before.actions || [];
    const afterActions = after.actions || [];
    const beforeActionMap = new Map(beforeActions.map((a) => [actionKey(a), a]));
    const afterActionMap = new Map(afterActions.map((a) => [actionKey(a), a]));
    const actionsAdded = [];
    const actionsRemoved = [];
    const actionsChanged = [];
    for (const [key, a] of afterActionMap) {
      if (!beforeActionMap.has(key)) actionsAdded.push({ key, after: a });
    }
    for (const [key, a] of beforeActionMap) {
      if (!afterActionMap.has(key)) actionsRemoved.push({ key, before: a });
    }
    for (const [key, b] of beforeActionMap) {
      const a = afterActionMap.get(key);
      if (!a) continue;
      const fc = diffFields(b, a);
      if (fc.length > 0) actionsChanged.push({ key, fieldChanges: fc });
    }

    if (fieldChanges.length > 0 || actionsAdded.length > 0 || actionsRemoved.length > 0 || actionsChanged.length > 0) {
      agentsChanged.push({ id, fieldChanges, actionsAdded, actionsRemoved, actionsChanged });
      total += fieldChanges.length + actionsAdded.length + actionsRemoved.length + actionsChanged.length;
    }
  }
  for (const [id, before] of beforeById) {
    if (!afterById.has(id)) {
      agentsRemoved.push({ id, before });
      total++;
    }
  }
  return { agentsAdded, agentsRemoved, agentsChanged, total };
}

function fmtDiffValue(v) {
  if (v === undefined) return "—";
  if (typeof v === "string") {
    if (v.length > 80) return JSON.stringify(v.slice(0, 80) + "…");
    return JSON.stringify(v);
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function FieldChangeRow({ change }) {
  const color =
    change.kind === "added" ? "var(--green)" :
    change.kind === "removed" ? "var(--red)" :
    "var(--amber)";
  const sign = change.kind === "added" ? "+" : change.kind === "removed" ? "−" : "Δ";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "12px 110px 1fr", gap: 6, padding: "2px 0", alignItems: "baseline", fontSize: 11, fontFamily: "var(--mono)" }}>
      <span style={{ color, fontWeight: 700 }}>{sign}</span>
      <span style={{ color: "var(--text-2)" }}>{change.key}</span>
      <span style={{ color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {change.kind === "added" && fmtDiffValue(change.after)}
        {change.kind === "removed" && fmtDiffValue(change.before)}
        {change.kind === "changed" && `${fmtDiffValue(change.before)} → ${fmtDiffValue(change.after)}`}
      </span>
    </div>
  );
}

function DiffView({ diff, onJump }) {
  if (diff.total === 0) {
    return (
      <div style={{ padding: 24, color: "var(--text-3)", fontSize: 12.5 }}>
        No changes vs saved file. The in-memory manifest matches what's on disk.
      </div>
    );
  }
  return (
    <div style={{ padding: "10px 14px", fontSize: 12 }}>
      <div style={{ marginBottom: 10, color: "var(--text-2)" }}>
        {diff.total} change{diff.total === 1 ? "" : "s"} ·{" "}
        {diff.agentsAdded.length > 0 && <span style={{ color: "var(--green)" }}>+{diff.agentsAdded.length} agents </span>}
        {diff.agentsRemoved.length > 0 && <span style={{ color: "var(--red)" }}>−{diff.agentsRemoved.length} agents </span>}
        {diff.agentsChanged.length > 0 && <span style={{ color: "var(--amber)" }}>Δ{diff.agentsChanged.length} agents</span>}
      </div>

      {diff.agentsAdded.map((g) => (
        <div key={`add-${g.id}`} style={{ marginBottom: 10, paddingLeft: 8, borderLeft: "2px solid var(--green)" }}>
          <button onClick={() => onJump(g.id)} style={{ fontSize: 11.5, fontFamily: "var(--mono)", color: "var(--green)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>+ {g.id} (new agent)</button>
        </div>
      ))}
      {diff.agentsRemoved.map((g) => (
        <div key={`rm-${g.id}`} style={{ marginBottom: 10, paddingLeft: 8, borderLeft: "2px solid var(--red)" }}>
          <div style={{ fontSize: 11.5, fontFamily: "var(--mono)", color: "var(--red)" }}>− {g.id} (removed)</div>
        </div>
      ))}
      {diff.agentsChanged.map((g) => (
        <div key={`ch-${g.id}`} style={{ marginBottom: 12, paddingLeft: 8, borderLeft: "2px solid var(--amber)" }}>
          <button onClick={() => onJump(g.id)} style={{ fontSize: 11.5, fontFamily: "var(--mono)", color: "var(--amber)", background: "transparent", border: "none", cursor: "pointer", padding: 0, marginBottom: 4 }}>
            Δ {g.id}
          </button>
          {g.fieldChanges.map((c, i) => <FieldChangeRow key={i} change={c} />)}
          {g.actionsAdded.map((a) => (
            <div key={`actadd-${a.key}`} style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--green)", marginLeft: 10 }}>+ action {a.key}</div>
          ))}
          {g.actionsRemoved.map((a) => (
            <div key={`actrm-${a.key}`} style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--red)", marginLeft: 10 }}>− action {a.key}</div>
          ))}
          {g.actionsChanged.map((a) => (
            <div key={`actch-${a.key}`} style={{ marginLeft: 10, marginTop: 4 }}>
              <div style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--amber)" }}>Δ action {a.key}</div>
              {a.fieldChanges.map((c, i) => <FieldChangeRow key={i} change={c} />)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Monaco (CDN-loaded) ────────────────────────────────────────────────────

function MonacoView({ value }) {
  const ref = useRefSE(null);
  const editorRef = useRefSE(null);
  useEffectSE(() => {
    let cancelled = false;
    const ensureLoader = () =>
      new Promise((resolve, reject) => {
        if (window.monaco) return resolve();
        if (window.__monacoLoading) {
          window.__monacoLoading.then(resolve, reject);
          return;
        }
        window.__monacoLoading = new Promise((res, rej) => {
          const s = document.createElement("script");
          s.src = "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs/loader.js";
          s.onload = () => {
            window.require.config({ paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs" } });
            window.require(["vs/editor/editor.main"], () => res());
          };
          s.onerror = rej;
          document.head.appendChild(s);
        });
        window.__monacoLoading.then(resolve, reject);
      });
    ensureLoader().then(() => {
      if (cancelled || !ref.current) return;
      if (!editorRef.current) {
        editorRef.current = window.monaco.editor.create(ref.current, {
          value,
          language: "json",
          theme: document.documentElement.dataset.theme === "light" ? "vs" : "vs-dark",
          readOnly: true,
          fontSize: 12,
          fontFamily: "IBM Plex Mono, ui-monospace, Menlo, monospace",
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
        });
      } else {
        editorRef.current.setValue(value);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffectSE(() => {
    if (editorRef.current && editorRef.current.getValue() !== value) {
      editorRef.current.setValue(value);
    }
  }, [value]);
  useEffectSE(() => () => {
    if (editorRef.current) editorRef.current.dispose();
  }, []);
  return <div ref={ref} style={{ width: "100%", height: "100%", minHeight: 0 }} />;
}

// ─── Save flow ───────────────────────────────────────────────────────────────

async function saveManifestToApi(slug, manifest, opts) {
  // opts = { mode: "overwrite" | "new_version", target_file?: string, comment?: string }
  const body = {
    manifest,
    comment: opts?.comment || "",
    mode: opts?.mode || "new_version",
  };
  if (body.mode === "overwrite") {
    body.target_file = opts?.target_file;
  }
  const res = await fetch(`/v1/tenants/${encodeURIComponent(slug)}/workflow`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });
  const resp = await res.json().catch(() => ({}));
  if (!res.ok || resp.ok === false) {
    const msg = resp?.error?.message || `save failed (${res.status})`;
    const hint = resp?.error?.hint ? ` — ${resp.error.hint}` : "";
    throw new Error(msg + hint);
  }
  return resp.data;
}

async function loadManifestFromApi(slug) {
  const res = await fetch(`/v1/tenants/${encodeURIComponent(slug)}/workflow`, {
    credentials: "include",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    throw new Error(body?.error?.message || `load failed (${res.status})`);
  }
  return body.data;
}

// ─── Main view ──────────────────────────────────────────────────────────────

function SchemaEditor({ navigate, params }) {
  const tenant = params.tenant || (window.TENANTS && window.TENANTS[0]?.id) || "raas";
  const [manifest, setManifest] = useStateSE(null);
  // `originalManifest` mirrors what's on disk — used by the Diff tab and the
  // change-count badges. Updated on load and on successful save.
  const [originalManifest, setOriginalManifest] = useStateSE(null);
  const [serverState, setServerState] = useStateSE({ folder: "", file: "", file_version: 0, schema_version: 0 });
  const [rightPaneTab, setRightPaneTab] = useStateSE("json"); // "json" | "diff"
  const [selection, setSelection] = useStateSE(() => {
    if (params.agentId) return { agentIdRequested: params.agentId };
    return { agentIndex: 0 };
  });
  const [query, setQuery] = useStateSE("");
  const [loading, setLoading] = useStateSE(true);
  const [loadError, setLoadError] = useStateSE(null);
  const [saving, setSaving] = useStateSE(false);
  const [saveStatus, setSaveStatus] = useStateSE(null);
  const [dirty, setDirty] = useStateSE(false);
  const [comment, setComment] = useStateSE("");

  useEffectSE(() => {
    let cancelled = false;
    setLoading(true);
    loadManifestFromApi(tenant)
      .then((data) => {
        if (cancelled) return;
        setManifest(data.manifest);
        // Deep clone so future mutations of `manifest` don't leak into `originalManifest`.
        setOriginalManifest(JSON.parse(JSON.stringify(data.manifest)));
        setServerState({
          folder: data.folder,
          file: data.file,
          file_version: data.file_version || 0,
          schema_version: data.schema_version,
        });
        setLoading(false);
        // Resolve agentIdRequested if it came in via params.
        if (selection.agentIdRequested) {
          const idx = data.manifest.findIndex((a) => a.id === selection.agentIdRequested);
          if (idx >= 0) setSelection({ agentIndex: idx });
          else setSelection({ agentIndex: 0 });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err.message || String(err));
        setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);

  // Re-select when the route's agentId param changes after mount (eg user
  // clicks a node in the workflows DAG while the editor is already open).
  useEffectSE(() => {
    if (!manifest || !params.agentId) return;
    const idx = manifest.findIndex((a) => a.id === params.agentId);
    if (idx >= 0 && (selection.agentIndex !== idx || selection.actionIndex !== undefined)) {
      setSelection({ agentIndex: idx });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.agentId, manifest]);

  const issues = useMemoSE(() => (manifest ? findIssues(manifest) : []), [manifest]);
  const hardErrors = issues.filter((i) => i.level === "error");

  const allEventNames = useMemoSE(() => {
    if (!manifest) return [];
    const set = new Set();
    for (const a of manifest) {
      for (const e of a.trigger || []) set.add(e);
      for (const e of a.triggered_event || []) set.add(e);
    }
    return [...set].sort();
  }, [manifest]);

  const jsonText = useMemoSE(() => (manifest ? JSON.stringify(manifest, null, 2) : ""), [manifest]);
  const diff = useMemoSE(
    () => (manifest && originalManifest ? diffManifests(originalManifest, manifest) : { agentsAdded: [], agentsRemoved: [], agentsChanged: [], total: 0 }),
    [manifest, originalManifest],
  );

  const updateAgent = useCallbackSE((agentIndex, next) => {
    setManifest((m) => {
      const cloned = m.slice();
      cloned[agentIndex] = next;
      return cloned;
    });
    setDirty(true);
  }, []);
  const updateAction = useCallbackSE((agentIndex, actionIndex, next) => {
    setManifest((m) => {
      const cloned = m.slice();
      const agent = { ...cloned[agentIndex] };
      const actions = (agent.actions || []).slice();
      actions[actionIndex] = next;
      agent.actions = actions;
      cloned[agentIndex] = agent;
      return cloned;
    });
    setDirty(true);
  }, []);

  const handleFix = useCallbackSE((issue) => {
    setManifest((m) => applyFix(m, issue));
    setDirty(true);
  }, []);
  const handleFixAll = useCallbackSE(() => {
    setManifest((m) => {
      const { manifest: next, applied } = applyAllSafeFixes(m);
      setSaveStatus({ kind: "info", msg: `Applied ${applied} safe fix${applied === 1 ? "" : "es"}` });
      return next;
    });
    setDirty(true);
  }, []);

  const handleSaveBoth = useCallbackSE(async (mode) => {
    if (hardErrors.length > 0) {
      setSaveStatus({ kind: "error", msg: `Fix ${hardErrors.length} blocking error${hardErrors.length === 1 ? "" : "s"} before saving.` });
      return;
    }
    setSaving(true);
    setSaveStatus(null);
    try {
      const opts = { mode, comment };
      if (mode === "overwrite") opts.target_file = serverState.file;
      const res = await saveManifestToApi(tenant, manifest, opts);
      const label = mode === "overwrite" ? "Overwrote" : "Saved";
      setSaveStatus({
        kind: "ok",
        msg: `${label} ${res.file} (v${res.file_version}) · ${res.inngest_fns} fns live`,
      });
      setServerState((s) => ({ ...s, file: res.file, file_version: res.file_version }));
      // After a successful save, the on-disk file matches the in-memory manifest.
      // Reset `originalManifest` so the diff goes back to zero.
      setOriginalManifest(JSON.parse(JSON.stringify(manifest)));
      setDirty(false);
      setComment("");
    } catch (err) {
      setSaveStatus({ kind: "error", msg: err.message || String(err) });
    } finally {
      setSaving(false);
    }
  }, [manifest, tenant, comment, hardErrors.length, serverState.file]);
  const handleSaveOverwrite = useCallbackSE(() => handleSaveBoth("overwrite"), [handleSaveBoth]);
  const handleSaveAsNew = useCallbackSE(() => handleSaveBoth("new_version"), [handleSaveBoth]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: 40, color: "var(--text-2)", fontSize: 13 }}>
        Loading workflow manifest…
      </div>
    );
  }
  if (loadError) {
    return (
      <div style={{ padding: 40 }}>
        <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 8 }}>Failed to load: {loadError}</div>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }

  const selectedAgent = manifest[selection.agentIndex];
  const selectedAction = selection.actionIndex !== undefined ? selectedAgent?.actions?.[selection.actionIndex] : null;
  const selectedTitle = selectedAction
    ? `${selectedAgent.id} → ${selectedAction.name || selectedAction.id || selectedAction.order}`
    : selectedAgent
      ? `${selectedAgent.id} · ${selectedAgent.name}`
      : "—";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ViewHeader
        title="Schema editor"
        subtitle={`${serverState.folder} · ${serverState.file} · schema v${serverState.schema_version}${dirty ? " · unsaved changes" : ""}`}
        action={[
          <input
            key="comment"
            placeholder="Save comment (optional)…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            style={{ width: 240, padding: "5px 9px", fontSize: 11.5, background: "var(--panel)", color: "var(--text)", border: "1px solid var(--border-2)", borderRadius: 5 }}
          />,
          <Button
            key="save"
            tone="primary"
            icon="check"
            small
            onClick={handleSaveOverwrite}
            title={
              hardErrors.length > 0
                ? "Fix blocking errors first"
                : diff.total > 0
                  ? `Overwrite ${serverState.file} — ${diff.total} change${diff.total === 1 ? "" : "s"}`
                  : `Overwrite ${serverState.file} (no changes)`
            }
          >
            {saving ? "Saving…" : `Save (${serverState.file || "—"})${diff.total > 0 ? ` · ${diff.total}` : ""}`}
          </Button>,
          <Button
            key="save-as"
            icon="plus"
            small
            onClick={handleSaveAsNew}
            title={hardErrors.length > 0 ? "Fix blocking errors first" : `Write workflow_v${(serverState.file_version || 1) + 1}.json`}
          >
            {saving ? "…" : `Save as v${(serverState.file_version || 1) + 1}`}
          </Button>,
        ]}
      />

      {saveStatus && (
        <div style={{
          padding: "6px 24px", fontSize: 11.5, fontFamily: "var(--mono)",
          background: saveStatus.kind === "error" ? "rgba(255,100,112,0.08)" : saveStatus.kind === "ok" ? "rgba(101,224,163,0.08)" : "var(--panel-2)",
          color: saveStatus.kind === "error" ? "var(--red)" : saveStatus.kind === "ok" ? "var(--green)" : "var(--text-2)",
          borderBottom: "1px solid var(--border)",
        }}>{saveStatus.msg}</div>
      )}

      <div style={{ flex: 1, display: "flex", flexDirection: "row", minHeight: 0 }}>
        {/* Tree pane */}
        <aside style={{ width: 280, flexShrink: 0, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter agents…"
              style={{ width: "100%", padding: "5px 9px", fontSize: 12, background: "var(--panel)", color: "var(--text)", border: "1px solid var(--border-2)", borderRadius: 4 }}
            />
          </div>
          <div style={{ flex: 1, overflow: "auto" }}>
            <SchemaTree manifest={manifest} selection={selection} onSelect={setSelection} issues={issues} query={query} />
          </div>
          <div style={{ padding: "8px 14px", borderTop: "1px solid var(--border)", fontSize: 11, fontFamily: "var(--mono)", color: "var(--text-3)" }}>
            {manifest.length} agents · {manifest.reduce((s, a) => s + (a.actions || []).length, 0)} steps
          </div>
        </aside>

        {/* Form pane */}
        <main style={{ flex: 1, overflow: "auto", padding: "16px 22px", minWidth: 0 }}>
          <div style={{ fontSize: 11, fontFamily: "var(--mono)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 6 }}>
            {selectedAction ? "STEP" : "AGENT"}
          </div>
          <div style={{ fontSize: 16, color: "var(--text)", marginBottom: 18, fontFamily: "var(--mono)" }}>{selectedTitle}</div>
          {selectedAction ? (
            <ActionForm
              action={selectedAction}
              onChange={(next) => updateAction(selection.agentIndex, selection.actionIndex, next)}
            />
          ) : (
            <AgentForm
              agent={selectedAgent}
              onChange={(next) => updateAgent(selection.agentIndex, next)}
              allEventNames={allEventNames}
            />
          )}
        </main>

        {/* Right pane: tabbed JSON / Diff */}
        <section style={{ width: 480, flexShrink: 0, borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 4, background: "var(--bg-2)" }}>
            <button
              onClick={() => setRightPaneTab("json")}
              style={{
                padding: "4px 10px", fontSize: 11, fontFamily: "var(--mono)",
                letterSpacing: "0.05em", textTransform: "uppercase",
                background: rightPaneTab === "json" ? "var(--panel)" : "transparent",
                color: rightPaneTab === "json" ? "var(--text)" : "var(--text-3)",
                border: rightPaneTab === "json" ? "1px solid var(--border-2)" : "1px solid transparent",
                borderRadius: 4, cursor: "pointer",
              }}
            >JSON</button>
            <button
              onClick={() => setRightPaneTab("diff")}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "4px 10px", fontSize: 11, fontFamily: "var(--mono)",
                letterSpacing: "0.05em", textTransform: "uppercase",
                background: rightPaneTab === "diff" ? "var(--panel)" : "transparent",
                color: rightPaneTab === "diff" ? "var(--text)" : "var(--text-3)",
                border: rightPaneTab === "diff" ? "1px solid var(--border-2)" : "1px solid transparent",
                borderRadius: 4, cursor: "pointer",
              }}
            >
              Diff
              {diff.total > 0 && (
                <span style={{
                  fontSize: 10, padding: "0 5px", borderRadius: 8,
                  background: "var(--amber)", color: "#000", fontWeight: 600,
                }}>{diff.total}</span>
              )}
            </button>
            <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--text-3)", fontFamily: "var(--mono)" }}>
              {rightPaneTab === "json" ? `${jsonText.length.toLocaleString()} chars` : `vs ${serverState.file || "—"}`}
            </span>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: rightPaneTab === "diff" ? "auto" : "hidden" }}>
            {rightPaneTab === "json" && <MonacoView value={jsonText} />}
            {rightPaneTab === "diff" && (
              <DiffView
                diff={diff}
                onJump={(agentId) => {
                  const idx = manifest.findIndex((a) => a.id === agentId);
                  if (idx >= 0) setSelection({ agentIndex: idx });
                }}
              />
            )}
          </div>
        </section>
      </div>

      <IssuesPanel
        issues={issues}
        onFix={handleFix}
        onFixAll={handleFixAll}
        onSelectIssue={(it) => setSelection({ agentIndex: it.agentIndex, actionIndex: it.actionIndex })}
      />
    </div>
  );
}

window.SchemaEditor = SchemaEditor;
