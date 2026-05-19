// Import Manifest — multi-step modal for importing a workflow.json + actions.json bundle.
// Shared by Workflows ("Import manifest" header button) and Agents ("Import manifest" header button).
//
// Steps:
//   01 Source   — drop / paste / URL
//   02 Validate — parse, run lint
//   03 Diff     — compare against the live workflow
//   04 Resolve  — handle ID conflicts, model availability
//   05 Preview  — graph + manifest summary
//   06 Deploy   — pick target (staging / prod) + confirm

const { useState: useStateIM, useMemo: useMemoIM, useRef: useRefIM } = React;

const IMPORT_STEPS = [
  { id: "source",   label: "Source",    icon: "upload",   hint: "Where the manifest comes from" },
  { id: "validate", label: "Validate",  icon: "check",    hint: "Parse + schema lint" },
  { id: "diff",     label: "Diff",      icon: "git",      hint: "vs live workflow" },
  { id: "resolve",  label: "Resolve",   icon: "alert",    hint: "Conflicts & gaps" },
  { id: "preview",  label: "Preview",   icon: "workflow", hint: "Imported graph" },
  { id: "deploy",   label: "Deploy",    icon: "deploy",   hint: "Stage / prod" },
];

// Mock data that simulates the result of parsing a "v2" manifest
function buildSampleParse() {
  return {
    workflow: {
      id: "raas",
      name: "RAAS",
      version: "raas@2026.05.18-v2",
      agent_count: 23,
      event_count: 33,
      stages: 8,
    },
    cycles: 0,
    orphans: 0,
    issues: [
      { level: "info",  msg: "23 agents discovered (was 22 live)" },
      { level: "info",  msg: "33 event types discovered (unchanged)" },
      { level: "warn",  msg: "Agent matchResume changed id: 10 → 10-2" },
      { level: "info",  msg: "Agent recallStockCandidates is new (10-1)" },
      { level: "warn",  msg: "1 agent references a model not in this workspace's fleet" },
    ],
    diff: {
      added: [
        { id: "10-1", name: "recallStockCandidates", reason: "Bytedance reactivation rule split out" },
      ],
      modified: [
        { id: "10-2", name: "matchResume", was: "10", changes: ["id renamed", "+ input_data", "+ ontology_instructions", "+ tool_use", "+ typescript_code"] },
        { id: "2",    name: "analyzeRequirement", changes: ["+ input_data", "+ ontology_instructions", "+ tool_use", "+ typescript_code"] },
        { id: "12",   name: "evaluateInterview",  changes: ["+ input_data", "+ ontology_instructions", "+ tool_use", "+ typescript_code"] },
        { id: "14-1", name: "generateRecommendationPackage", changes: ["+ tool_use", "+ ontology_instructions"] },
      ],
      removed: [],
      // For brevity, only 4 modifications shown; the others are sourced from window.RAAS_AGENTS below
    },
    eventDiff: {
      added:    [],
      modified: [],
      removed:  [],
    },
    conflicts: [
      { kind: "model", name: "gpt-4.1", agent: "loop-research-agent", note: "Not in workspace fleet · auto-fallback to claude-sonnet-4-5", resolved: "fallback" },
    ],
  };
}

function ImportManifestModal({ onClose, mode = "workflow" }) {
  // mode = "workflow" | "agent" — controls copy + the "Deploy" final action
  const [step, setStep] = useStateIM(0);
  const [source, setSource] = useStateIM("file");        // file | paste | url | git
  const [files, setFiles] = useStateIM([]);              // {name, size, ok}
  const [pasted, setPasted] = useStateIM("");
  const [url, setUrl] = useStateIM("");
  const [validating, setValidating] = useStateIM(false);
  const [parsed, setParsed] = useStateIM(null);
  const [resolution, setResolution] = useStateIM({ model: "fallback" });
  const [deployTarget, setDeployTarget] = useStateIM({ staging: true, prod: false });
  const [autoRollback, setAutoRollback] = useStateIM(true);
  const dropRef = useRefIM(null);

  const canAdvance = useMemoIM(() => {
    if (step === 0) {
      if (source === "file") return files.length > 0;
      if (source === "paste") return pasted.trim().length > 0;
      if (source === "url") return /^https?:\/\//.test(url) || /^git@/.test(url);
      if (source === "git") return true; // pre-connected
    }
    if (step === 1) return !!parsed && parsed.cycles === 0;
    return true;
  }, [step, source, files, pasted, url, parsed]);

  // Move on to validation: simulate parse
  function startValidation() {
    setValidating(true);
    setStep(1);
    setTimeout(() => {
      setParsed(buildSampleParse());
      setValidating(false);
    }, 900);
  }

  function next() {
    if (step === 0) { startValidation(); return; }
    setStep(s => Math.min(IMPORT_STEPS.length - 1, s + 1));
  }
  function back() { setStep(s => Math.max(0, s - 1)); }

  function handleFiles(list) {
    const arr = Array.from(list).map(f => ({
      name: f.name,
      size: f.size,
      ok: /workflow.*\.json$/i.test(f.name) || /actions.*\.json$/i.test(f.name),
    }));
    setFiles(arr);
  }
  function onDragOver(e) { e.preventDefault(); dropRef.current && dropRef.current.classList.add("drop-hot"); }
  function onDragLeave() { dropRef.current && dropRef.current.classList.remove("drop-hot"); }
  function onDrop(e) {
    e.preventDefault();
    dropRef.current && dropRef.current.classList.remove("drop-hot");
    handleFiles(e.dataTransfer.files);
  }

  const title = mode === "agent" ? "Import agent manifest" : "Import workflow manifest";

  return (
    <ModalOverlayIM onClose={onClose}>
      <div style={{ width: 980, maxHeight: "90vh", background: "var(--panel)", border: "1px solid var(--border-2)", borderRadius: 8, overflow: "hidden", boxShadow: "0 24px 60px -20px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <Icon name="upload" size={14} style={{ color: "var(--signal)" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 500 }}>{title}</div>
            <div style={{ fontSize: 11, color: "var(--text-3)" }}>
              Accepts a v1 or v2 manifest pair: <span className="mono" style={{ color: "var(--text-2)" }}>workflow.json</span> + <span className="mono" style={{ color: "var(--text-2)" }}>actions.json</span>.
              {" "}Validates, diffs against the live workflow, then deploys to staging.
            </div>
          </div>
          <button onClick={onClose} style={{ color: "var(--text-3)" }}><Icon name="x" size={13} /></button>
        </header>

        {/* Stepper */}
        <div style={{ display: "flex", padding: "10px 18px", borderBottom: "1px solid var(--border)", background: "var(--bg-2)", gap: 4 }}>
          {IMPORT_STEPS.map((s, i) => (
            <ImportStepDot key={s.id} step={s} idx={i} active={step === i} done={i < step} />
          ))}
        </div>

        <div style={{ padding: 20, overflow: "auto", flex: 1, minHeight: 0 }}>
          {step === 0 && (
            <SourceStep
              source={source} setSource={setSource}
              files={files} handleFiles={handleFiles}
              pasted={pasted} setPasted={setPasted}
              url={url} setUrl={setUrl}
              dropRef={dropRef} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
            />
          )}
          {step === 1 && (
            validating
              ? <ValidatingState />
              : <ValidateStep parsed={parsed} />
          )}
          {step === 2 && parsed && <DiffStep parsed={parsed} />}
          {step === 3 && parsed && <ResolveStep parsed={parsed} resolution={resolution} setResolution={setResolution} />}
          {step === 4 && parsed && <PreviewStep parsed={parsed} />}
          {step === 5 && parsed && (
            <DeployStep
              parsed={parsed}
              target={deployTarget} setTarget={setDeployTarget}
              autoRollback={autoRollback} setAutoRollback={setAutoRollback}
              mode={mode}
            />
          )}
        </div>

        <footer style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 18px", borderTop: "1px solid var(--border)", background: "var(--panel-2)" }}>
          {step > 0 && <Button tone="ghost" icon="chevron-left" onClick={back}>Back</Button>}
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>Step {step + 1} of {IMPORT_STEPS.length}</span>
          {step === 2 && parsed && (
            <span style={{ marginLeft: 14, fontSize: 11, fontFamily: "var(--mono)", color: "var(--text-3)" }}>
              <span style={{ color: "var(--green)" }}>+{parsed.diff.added.length}</span>
              {" "}<span style={{ color: "var(--amber)" }}>~{parsed.diff.modified.length}</span>
              {" "}<span style={{ color: "var(--red)" }}>−{parsed.diff.removed.length}</span>
            </span>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <Button tone="ghost" onClick={onClose}>Cancel</Button>
            {step < IMPORT_STEPS.length - 1
              ? <Button tone="primary" icon="chevron-right" onClick={next} disabled={!canAdvance}>
                  {step === 0 ? "Validate" : "Continue"}
                </Button>
              : <Button tone="primary" icon="deploy" onClick={onClose}>Deploy to {deployTarget.prod ? "prod" : "staging"}</Button>
            }
          </div>
        </footer>
      </div>

      <style>{`
        .drop-hot {
          background: var(--panel-2) !important;
          border-color: var(--signal) !important;
        }
      `}</style>
    </ModalOverlayIM>
  );
}

function ImportStepDot({ step, idx, active, done }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "5px 12px",
      background: active ? "var(--panel)" : "transparent",
      border: `1px solid ${active ? "var(--signal)" : "transparent"}`,
      borderRadius: 4,
      opacity: active ? 1 : done ? 0.95 : 0.5,
    }}>
      <span style={{
        width: 18, height: 18,
        borderRadius: "50%",
        background: done ? "var(--signal)" : "transparent",
        border: `1px solid ${done || active ? "var(--signal)" : "var(--border-2)"}`,
        color: done ? "#000" : active ? "var(--signal)" : "var(--text-3)",
        fontSize: 10, fontFamily: "var(--mono)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>{done ? "✓" : idx + 1}</span>
      <div>
        <div style={{ fontSize: 11, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.06em", color: active ? "var(--text)" : "var(--text-3)", lineHeight: 1.1 }}>{step.label}</div>
        <div style={{ fontSize: 10, color: "var(--text-3)" }}>{step.hint}</div>
      </div>
    </div>
  );
}

// ----- Step 1: Source -----
function SourceStep({ source, setSource, files, handleFiles, pasted, setPasted, url, setUrl, dropRef, onDragOver, onDragLeave, onDrop }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontFamily: "var(--mono)", textTransform: "uppercase", color: "var(--text-3)", letterSpacing: "0.08em", marginBottom: 10 }}>Source</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 18 }}>
        <SourceCard active={source === "file"}  onClick={() => setSource("file")}  icon="upload"   title="Upload files" sub="Drop workflow.json + actions.json" />
        <SourceCard active={source === "paste"} onClick={() => setSource("paste")} icon="code"     title="Paste JSON"   sub="Paste a combined manifest" />
        <SourceCard active={source === "url"}   onClick={() => setSource("url")}   icon="external" title="From URL"     sub="HTTPS or git+ssh" />
        <SourceCard active={source === "git"}   onClick={() => setSource("git")}   icon="git"      title="From repo"    sub="agentic/raas-workflows" />
      </div>

      {source === "file" && (
        <div>
          <div
            ref={dropRef}
            onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
            style={{
              padding: 32, textAlign: "center",
              background: "var(--bg-2)",
              border: "1px dashed var(--border-3)",
              borderRadius: 6,
              transition: "background 0.12s, border-color 0.12s",
            }}>
            <Icon name="upload" size={22} style={{ color: "var(--text-3)" }} />
            <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-2)" }}>
              Drop <span className="mono" style={{ color: "var(--text)" }}>workflow.json</span> and <span className="mono" style={{ color: "var(--text)" }}>actions.json</span>
            </div>
            <div style={{ marginTop: 4, fontSize: 11.5, color: "var(--text-3)" }}>
              or <label style={{ color: "var(--signal)", cursor: "pointer" }}>
                browse files
                <input type="file" multiple accept=".json,application/json" style={{ display: "none" }} onChange={e => handleFiles(e.target.files)} />
              </label> · max 1 MB per file
            </div>
          </div>

          {files.length > 0 && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
              {files.map((f, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "7px 12px",
                  background: "var(--panel-2)",
                  border: `1px solid ${f.ok ? "var(--border)" : "rgba(255,181,71,0.30)"}`,
                  borderRadius: 4,
                }}>
                  <Icon name="code" size={12} style={{ color: f.ok ? "var(--green)" : "var(--amber)" }} />
                  <span className="mono" style={{ fontSize: 12, color: "var(--text)" }}>{f.name}</span>
                  <span style={{ marginLeft: "auto", fontSize: 11, fontFamily: "var(--mono)", color: "var(--text-3)" }}>{window.fmtBytes(f.size)}</span>
                  {f.ok
                    ? <Badge tone="green">DETECTED</Badge>
                    : <Badge tone="amber">UNKNOWN ROLE</Badge>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {source === "paste" && (
        <window.MonacoEditor
          value={pasted || ""}
          onChange={setPasted}
          language="json"
          height={320}
        />
      )}

      {source === "url" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ display: "block", fontSize: 11, color: "var(--text-2)", marginBottom: 4 }}>Manifest URL</label>
            <input
              value={url} onChange={e => setUrl(e.target.value)}
              placeholder="https://raw.githubusercontent.com/your-org/raas-workflows/main/dist/manifest.zip"
              style={{
                width: "100%", padding: "8px 12px",
                background: "var(--panel-2)", border: "1px solid var(--border-2)", borderRadius: 4,
                color: "var(--text)", fontFamily: "var(--mono)", fontSize: 12, outline: "none",
              }}
            />
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-3)" }}>
              We'll <span className="mono">GET</span> the URL and look for a <span className="mono">manifest.zip</span> or a JSON bundle. SSH git URLs are also supported if a deploy key is provisioned.
            </div>
          </div>
          <div style={{ padding: "10px 12px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <Icon name="alert" size={11} style={{ color: "var(--amber)" }} />
              <span style={{ fontSize: 12, color: "var(--text)" }}>Egress allow-list</span>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.55 }}>
              Outbound fetches go through the workspace egress proxy. <span className="mono">github.com</span> and <span className="mono">*.amazonaws.com</span> are pre-allowed. Add more in Settings → Integrations.
            </div>
          </div>
        </div>
      )}

      {source === "git" && (
        <div>
          <div style={{ marginBottom: 8, fontSize: 11, fontFamily: "var(--mono)", textTransform: "uppercase", color: "var(--text-3)", letterSpacing: "0.08em" }}>Connected repositories</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <RepoOption name="agentic/raas-workflows" branch="main"         path="dist/manifest.zip" connected lastBuilt="3 minutes ago" />
            <RepoOption name="agentic/raas-workflows" branch="v2-rewrite"   path="dist/manifest.zip" connected lastBuilt="11 hours ago · ✓ green" recommended />
            <RepoOption name="agentic/supportflow"    branch="main"         path="dist/manifest.zip" connected lastBuilt="2 days ago" />
            <button style={{
              padding: "8px 12px", textAlign: "left",
              background: "var(--panel-2)", border: "1px dashed var(--border-2)", borderRadius: 4,
              fontSize: 11.5, color: "var(--text-3)",
            }}>
              <Icon name="plus" size={11} style={{ marginRight: 6 }} />
              Connect another repo…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SourceCard({ active, onClick, icon, title, sub }) {
  return (
    <button onClick={onClick} style={{
      padding: "12px 14px",
      background: active ? "var(--panel-3)" : "var(--panel-2)",
      border: `1px solid ${active ? "var(--signal)" : "var(--border)"}`,
      borderRadius: 5,
      textAlign: "left", cursor: "pointer",
      transition: "background 0.12s, border-color 0.12s",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
        <Icon name={icon} size={12} style={{ color: active ? "var(--signal)" : "var(--text-2)" }} />
        <span style={{ fontSize: 12.5, color: "var(--text)", fontWeight: 500 }}>{title}</span>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.45 }}>{sub}</div>
    </button>
  );
}

function RepoOption({ name, branch, path, connected, lastBuilt, recommended }) {
  return (
    <label style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 12px",
      background: recommended ? "rgba(208,255,0,0.04)" : "var(--panel-2)",
      border: `1px solid ${recommended ? "rgba(208,255,0,0.30)" : "var(--border)"}`,
      borderRadius: 4,
      cursor: "pointer",
    }}>
      <input type="radio" name="repo" defaultChecked={recommended} style={{ accentColor: "var(--signal)" }} />
      <Icon name="git" size={12} style={{ color: "var(--text-3)" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="mono" style={{ fontSize: 12, color: "var(--text)" }}>{name}</span>
          <Badge tone="muted">{branch}</Badge>
          {recommended && <Badge tone="signal">RECOMMENDED</Badge>}
        </div>
        <div style={{ fontSize: 10.5, color: "var(--text-3)", fontFamily: "var(--mono)", marginTop: 2 }}>{path} · {lastBuilt}</div>
      </div>
      {connected && <span style={{ fontSize: 10, color: "var(--green)", fontFamily: "var(--mono)" }}>● CONNECTED</span>}
    </label>
  );
}

// ----- Step 2: Validating -----
function ValidatingState() {
  return (
    <div style={{ padding: "60px 20px", textAlign: "center" }}>
      <div style={{ display: "inline-block", width: 22, height: 22, border: "3px solid var(--border-2)", borderTopColor: "var(--signal)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <div style={{ marginTop: 16, fontSize: 13, color: "var(--text)" }}>Validating manifest…</div>
      <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--text-3)" }}>
        Parsing JSON · resolving event references · checking for cycles · type-checking handlers
      </div>
    </div>
  );
}

function ValidateStep({ parsed }) {
  if (!parsed) return null;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 0, border: "1px solid var(--border)", borderRadius: 6, marginBottom: 14, background: "var(--panel)" }}>
        <ValidateCell label="Workflow"  value={parsed.workflow.id} mono />
        <ValidateCell label="Version"   value={parsed.workflow.version} mono accent="var(--signal)" />
        <ValidateCell label="Agents"    value={parsed.workflow.agent_count} mono />
        <ValidateCell label="Events"    value={parsed.workflow.event_count} mono />
        <ValidateCell label="Cycles"    value={parsed.cycles} mono accent={parsed.cycles === 0 ? "var(--green)" : "var(--red)"} />
      </div>

      <Panel title="Validation results" padded={false}>
        {parsed.issues.map((iss, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "8px 14px",
            borderBottom: i < parsed.issues.length - 1 ? "1px solid var(--border)" : "none",
          }}>
            <Icon
              name={iss.level === "err" ? "alert" : iss.level === "warn" ? "alert" : "check"}
              size={11}
              style={{ color: iss.level === "err" ? "var(--red)" : iss.level === "warn" ? "var(--amber)" : "var(--green)" }}
            />
            <span style={{ fontSize: 12, color: "var(--text-2)" }}>{iss.msg}</span>
            <span style={{ marginLeft: "auto", fontSize: 10, fontFamily: "var(--mono)", textTransform: "uppercase", color: "var(--text-3)" }}>{iss.level}</span>
          </div>
        ))}
      </Panel>
    </div>
  );
}

function ValidateCell({ label, value, mono, accent }) {
  return (
    <div style={{ padding: "10px 14px", borderRight: "1px solid var(--border)" }}>
      <div style={{ fontSize: 10, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-3)" }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 16, fontFamily: mono ? "var(--mono)" : "var(--sans)", color: accent || "var(--text)" }}>{value}</div>
    </div>
  );
}

// ----- Step 3: Diff -----
function DiffStep({ parsed }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Panel
        title="Agent diff vs live"
        subtitle={`live: raas@2026.05.16-a → imported: ${parsed.workflow.version}`}
        padded={false}
      >
        <DiffGroup
          label="Added"
          tone="green"
          items={parsed.diff.added.map(a => ({ key: a.id, name: a.name, sub: a.reason }))}
        />
        <DiffGroup
          label="Modified"
          tone="amber"
          items={parsed.diff.modified.map(a => ({
            key: a.id,
            name: a.name,
            sub: (a.was ? `id ${a.was} → ${a.id} · ` : "") + a.changes.join(", "),
          }))}
        />
        <DiffGroup
          label="Removed"
          tone="red"
          items={parsed.diff.removed.map(a => ({ key: a.id, name: a.name, sub: "" }))}
        />
      </Panel>

      <Panel title="Schema diff · new properties on existing agents" padded>
        <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.6, marginBottom: 10 }}>
          The v2 manifest adds four properties on every agent. Existing agents will be augmented in place;
          their event signatures and stages are unchanged.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
          {["input_data", "ontology_instructions", "tool_use", "typescript_code"].map(p => (
            <div key={p} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 12px",
              background: "var(--panel-2)",
              border: "1px solid rgba(208,255,0,0.20)",
              borderRadius: 4,
            }}>
              <Icon name="plus" size={11} style={{ color: "var(--signal)" }} />
              <span className="mono" style={{ fontSize: 12, color: "var(--text)" }}>{p}</span>
              <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--text-3)" }}>+ on 22 agents</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function DiffGroup({ label, tone, items }) {
  const sigil = label === "Added" ? "+" : label === "Removed" ? "−" : "~";
  const toneVar = tone === "green" ? "var(--green)" : tone === "amber" ? "var(--amber)" : "var(--red)";
  if (items.length === 0) {
    return (
      <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", fontSize: 11.5, color: "var(--text-3)" }}>
        <span style={{ color: toneVar, fontFamily: "var(--mono)", marginRight: 8 }}>{sigil}</span>{label}: none
      </div>
    );
  }
  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      <div style={{ padding: "8px 14px", display: "flex", alignItems: "center", gap: 8, background: "var(--panel-2)" }}>
        <span style={{ color: toneVar, fontFamily: "var(--mono)", fontSize: 13, fontWeight: 700, width: 12, textAlign: "center" }}>{sigil}</span>
        <span style={{ fontSize: 11, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-2)" }}>{label} · {items.length}</span>
      </div>
      {items.map(it => (
        <div key={it.key} style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "8px 14px 8px 36px",
          borderTop: "1px solid var(--border)",
        }}>
          <Badge tone="muted">{it.key}</Badge>
          <span className="mono" style={{ fontSize: 12, color: "var(--text)" }}>{it.name}</span>
          <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 480 }}>{it.sub}</span>
        </div>
      ))}
    </div>
  );
}

// ----- Step 4: Resolve -----
function ResolveStep({ parsed, resolution, setResolution }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Panel
        title={`Conflicts to resolve · ${parsed.conflicts.length}`}
        subtitle="The manifest references things this workspace doesn't have. Pick how to handle each."
        padded={false}
      >
        {parsed.conflicts.map((c, i) => (
          <div key={i} style={{
            padding: "12px 14px",
            borderBottom: i < parsed.conflicts.length - 1 ? "1px solid var(--border)" : "none",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Badge tone="amber">{c.kind}</Badge>
              <span className="mono" style={{ fontSize: 12, color: "var(--text)" }}>{c.name}</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3)" }}>referenced by <span className="mono">{c.agent}</span></span>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-2)", marginBottom: 10 }}>{c.note}</div>
            <div style={{ display: "flex", gap: 0, border: "1px solid var(--border-2)", borderRadius: 4, overflow: "hidden", width: "fit-content" }}>
              <ResolveOption value="fallback" current={resolution.model} setCurrent={v => setResolution({ ...resolution, model: v })} label="Use fallback" hint="claude-sonnet-4-5" />
              <ResolveOption value="connect"  current={resolution.model} setCurrent={v => setResolution({ ...resolution, model: v })} label="Connect OpenAI" hint="adds gpt-4.1" />
              <ResolveOption value="skip"     current={resolution.model} setCurrent={v => setResolution({ ...resolution, model: v })} label="Skip agent"   hint="don't import" />
            </div>
          </div>
        ))}
      </Panel>

      <Panel title="ID conflicts" padded>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <ResolveLine
            ok
            label="matchResume"
            hint="id changes 10 → 10-2 · auto-rewires triggers/emits"
          />
          <ResolveLine
            ok
            label="recallStockCandidates"
            hint="new id 10-1 · no conflict"
          />
          <ResolveLine
            ok
            label="all event names match"
            hint="33 events checked against live registry"
          />
        </div>
      </Panel>
    </div>
  );
}

function ResolveOption({ value, current, setCurrent, label, hint }) {
  const active = current === value;
  return (
    <button onClick={() => setCurrent(value)} style={{
      padding: "6px 12px",
      background: active ? "var(--panel-3)" : "var(--panel-2)",
      color: active ? "var(--text)" : "var(--text-3)",
      fontSize: 11.5,
      borderRight: "1px solid var(--border-2)",
      borderBottom: active ? "2px solid var(--signal)" : "2px solid transparent",
      display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1,
    }}>
      <span>{label}</span>
      <span style={{ fontSize: 10, fontFamily: "var(--mono)", color: "var(--text-3)" }}>{hint}</span>
    </button>
  );
}

function ResolveLine({ ok, label, hint }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12 }}>
      <Icon name={ok ? "check" : "alert"} size={11} style={{ color: ok ? "var(--green)" : "var(--amber)" }} />
      <span className="mono" style={{ color: "var(--text-2)" }}>{label}</span>
      <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3)" }}>{hint}</span>
    </div>
  );
}

// ----- Step 5: Preview -----
function PreviewStep({ parsed }) {
  const stages = window.RAAS_STAGES;
  const agents = window.RAAS_AGENTS;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Panel
        title="Imported workflow"
        subtitle={parsed.workflow.version}
        padded
      >
        <PreviewMiniGraph stages={stages} agents={agents} />
        <div style={{ display: "flex", gap: 14, marginTop: 14, fontSize: 11.5, color: "var(--text-3)" }}>
          <span><span style={{ display: "inline-block", width: 8, height: 8, background: "var(--signal)", marginRight: 5, borderRadius: 1 }} />Existing agent</span>
          <span><span style={{ display: "inline-block", width: 8, height: 8, background: "var(--green)", marginRight: 5, borderRadius: 1 }} />Added (1)</span>
          <span><span style={{ display: "inline-block", width: 8, height: 8, background: "var(--amber)", marginRight: 5, borderRadius: 1 }} />Modified (22)</span>
          <span><span style={{ display: "inline-block", width: 8, height: 8, background: "var(--violet)", marginRight: 5, borderRadius: 1 }} />Human task</span>
        </div>
      </Panel>

      <Panel title="Summary" padded>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <Stat label="Net agents" value={`+${parsed.diff.added.length - parsed.diff.removed.length}`} mono accent="var(--signal)" />
          <Stat label="Modified" value={parsed.diff.modified.length} mono accent="var(--amber)" />
          <Stat label="New properties" value="4" mono sub="× 23 agents = 92 fields" />
          <Stat label="Estimated rollout" value="~ 4 s" mono />
        </div>
      </Panel>
    </div>
  );
}

function PreviewMiniGraph({ stages, agents }) {
  const COL = 100;
  const NODE_H = 22;
  const NODE_W = 90;
  const ROW_GAP = 28;
  const PAD = 16;
  // Group agents by stage
  const byStage = {};
  agents.forEach(a => { (byStage[a.stage] = byStage[a.stage] || []).push(a); });
  // Append the new agent (10-1) marker if not already present
  const maxLanes = Math.max(...stages.map(s => (byStage[s.id] || []).length));
  const W = PAD * 2 + stages.length * COL;
  const H = PAD * 2 + maxLanes * ROW_GAP;

  return (
    <svg width={W} height={H} style={{ display: "block", width: "100%", maxWidth: "100%" }} viewBox={`0 0 ${W} ${H}`}>
      {/* stage column dividers */}
      {stages.map((s, i) => (
        <line key={i} x1={PAD + i * COL} x2={PAD + i * COL} y1={4} y2={H - 4} stroke="var(--border)" opacity="0.6" />
      ))}
      {stages.map((s, i) => (
        <text key={"l" + i} x={PAD + i * COL + 4} y={12} fill="var(--text-3)" fontSize="8" fontFamily="var(--mono)">
          {String(i).padStart(2, "0")} {s.label.toUpperCase()}
        </text>
      ))}
      {/* Nodes */}
      {stages.map((s, i) => {
        const list = byStage[s.id] || [];
        return list.map((a, lane) => {
          const x = PAD + i * COL + 4;
          const y = PAD + lane * ROW_GAP;
          const isNew = a.id === "10-1";
          const isModified = a.id === "10-2" || a.id === "2" || a.id === "12" || a.id === "14-1";
          const color = a.actor === "Human" ? "var(--violet)" : isNew ? "var(--green)" : isModified ? "var(--amber)" : "var(--signal)";
          return (
            <g key={a.id}>
              <rect x={x} y={y} width={NODE_W} height={NODE_H} rx={2}
                fill={isNew ? "rgba(101,224,163,0.10)" : "var(--panel-2)"}
                stroke={color}
                strokeWidth={isNew ? 1.5 : 1}
                strokeDasharray={isModified && !isNew ? "3 2" : "0"} />
              <text x={x + 5} y={y + 13} fill="var(--text)" fontSize="9" fontFamily="var(--mono)">{a.id}</text>
              <text x={x + 5} y={y + 13 + 8} fill="var(--text-3)" fontSize="7.5" fontFamily="var(--mono)">
                {a.name.length > 16 ? a.name.slice(0, 14) + "…" : a.name}
              </text>
            </g>
          );
        });
      })}
    </svg>
  );
}

// ----- Step 6: Deploy -----
function DeployStep({ parsed, target, setTarget, autoRollback, setAutoRollback, mode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Panel title="Deploy target" padded>
          <DeployTargetIM
            on={target.staging}
            onToggle={() => setTarget({ ...target, staging: !target.staging })}
            label="Staging · raas-stage"
            sub="Replays last 10 events through the new graph as a smoke test"
            recommended
          />
          <DeployTargetIM
            on={target.prod}
            onToggle={() => setTarget({ ...target, prod: !target.prod })}
            label="Production · raas"
            sub="Live event stream. New runs use the new version immediately."
            warn
          />
        </Panel>

        <Panel title="Safety" padded>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", cursor: "pointer" }}>
            <input type="checkbox" checked={autoRollback} onChange={e => setAutoRollback(e.target.checked)} style={{ accentColor: "var(--signal)", marginTop: 3 }} />
            <div>
              <div style={{ fontSize: 12.5, color: "var(--text)" }}>Auto-rollback on error spike</div>
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>If error rate exceeds 5% over 5 minutes post-deploy, restore the previous version.</div>
            </div>
          </label>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", cursor: "pointer" }}>
            <input type="checkbox" defaultChecked style={{ accentColor: "var(--signal)", marginTop: 3 }} />
            <div>
              <div style={{ fontSize: 12.5, color: "var(--text)" }}>Drain in-flight runs on rollback</div>
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>Let active runs finish on the old version; only new triggers route to the new one.</div>
            </div>
          </label>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", cursor: "pointer" }}>
            <input type="checkbox" style={{ accentColor: "var(--signal)", marginTop: 3 }} />
            <div>
              <div style={{ fontSize: 12.5, color: "var(--text)" }}>Require code review</div>
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>Block deploy until another Admin approves on the Deployments page.</div>
            </div>
          </label>
        </Panel>
      </div>

      <Panel title="Final manifest" subtitle="Read-only · what will be written to /var/agentic/deploys/" padded={false}>
        <CodeBlock>{JSON.stringify({
          workflow: parsed.workflow,
          source: "imported",
          deploy_target: target.prod ? "prod" : "staging",
          summary: {
            added: parsed.diff.added.length,
            modified: parsed.diff.modified.length,
            removed: parsed.diff.removed.length,
            new_properties: ["input_data", "ontology_instructions", "tool_use", "typescript_code"],
          },
          auto_rollback: autoRollback,
          tenant: "raas",
          tag: "imported-via-ui",
        }, null, 2)}</CodeBlock>
      </Panel>
    </div>
  );
}

function DeployTargetIM({ on, onToggle, label, sub, recommended, warn }) {
  return (
    <label style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 12px",
      background: on ? "var(--panel-2)" : "transparent",
      border: `1px solid ${on ? "var(--signal)" : "var(--border)"}`,
      borderRadius: 4,
      cursor: "pointer",
      marginBottom: 6,
    }}>
      <input type="checkbox" checked={on} onChange={onToggle} style={{ accentColor: "var(--signal)" }} />
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12.5, color: "var(--text)" }}>{label}</span>
          {recommended && <Badge tone="signal">RECOMMENDED</Badge>}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-3)" }}>{sub}</div>
      </div>
      {warn && <Badge tone="amber">requires approval</Badge>}
    </label>
  );
}

function ModalOverlayIM({ onClose, children }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.5)",
      display: "flex", justifyContent: "center", alignItems: "center",
      backdropFilter: "blur(2px)",
      animation: "fadein 0.14s ease",
    }}>
      <div onClick={e => e.stopPropagation()}>{children}</div>
    </div>
  );
}

window.ImportManifestModal = ImportManifestModal;
