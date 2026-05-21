// Import Manifest — multi-step modal for importing a workflow.json + actions.json
// bundle into the current tenant. End-to-end wired against the backend
// `POST /v1/tenants/:slug/manifest-import` (modes: validate | commit) and
// `POST /v1/tenants/:slug/manifest-import/fetch-url` per docs/design.
//
// Steps:
//   00 SOURCE   — upload / paste / url / repo (repo: coming soon)
//   01 VALIDATE — server returns ManifestImportPreview (or 423 if pending)
//   02 DIFF     — added / modified / removed groups
//   03 RESOLVE  — conflicts with accept/skip/override per-card
//   04 PREVIEW  — graph + actions JSON + raw manifest tabs
//   05 DEPLOY   — pick staging/production target + commit (handles 409 overwrite)
//
// SPA global-scope gotcha: every internal helper component name in this file
// is prefixed with "Import" so a colliding bare-named function in another
// view's babel scope can't shadow it. The bare-named export is the modal
// itself, `ImportManifestModal`, attached to window at the bottom.

const { useState: useStateIM, useMemo: useMemoIM, useRef: useRefIM, useEffect: useEffectIM, useCallback: useCallbackIM } = React;

const IM_STEPS = [
  { id: "source",   label: "Source",   hint: "Where the manifest comes from" },
  { id: "validate", label: "Validate", hint: "Parse + schema lint" },
  { id: "diff",     label: "Diff",     hint: "vs live workflow" },
  { id: "resolve",  label: "Resolve",  hint: "Conflicts & gaps" },
  { id: "preview",  label: "Preview",  hint: "Imported graph" },
  { id: "deploy",   label: "Deploy",   hint: "Staging / prod" },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function imSafeJsonParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : "Invalid JSON" };
  }
}

function imReadFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("read_failed"));
    reader.readAsText(file);
  });
}

function imParsePastedManifest(text) {
  const t = (text || "").trim();
  if (!t) return { error: "Paste a workflow.json (or a `{ workflow, actions }` bundle) first." };
  const parsed = imSafeJsonParse(t);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.value;
  // If the user pasted a bundle `{ workflow, actions }`, split it.
  if (v && typeof v === "object" && !Array.isArray(v) && "workflow" in v) {
    return { workflow: v.workflow, actions: Array.isArray(v.actions) ? v.actions : undefined };
  }
  // Otherwise treat the whole document as the manifest (v1 array or v2 wrapper)
  return { workflow: v };
}

function imAgentCountFromRaw(raw) {
  if (!raw) return 0;
  if (Array.isArray(raw)) return raw.length;
  if (Array.isArray(raw.agents)) return raw.agents.length;
  return 0;
}

function imBlockingUnresolvedCount(validation, resolutions) {
  if (!validation || !Array.isArray(validation.conflicts)) return 0;
  const byPath = new Map();
  resolutions.forEach((r) => byPath.set(r.path, r));
  let n = 0;
  validation.conflicts.forEach((c) => {
    if (c.severity !== "block") return;
    const r = byPath.get(c.path);
    if (!r || r.action === "skip") n += 1;
  });
  return n;
}

function imFormatTime(ms) {
  if (!ms || typeof ms !== "number") return "—";
  try {
    return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + "Z";
  } catch (_e) {
    return "—";
  }
}

// ── Top-level modal ────────────────────────────────────────────────────────

function ImportManifestModal({ onClose, mode = "workflow", tenantSlug }) {
  const slug = tenantSlug || (window.TENANTS && window.TENANTS[0] && window.TENANTS[0].id) || "raas";

  // Wizard state
  const [step, setStep] = useStateIM(0);
  const [sourceKind, setSourceKind] = useStateIM("upload"); // upload | paste | url | repo
  const [workflow, setWorkflow] = useStateIM(null);          // raw parsed manifest
  const [actions, setActions] = useStateIM(null);            // raw parsed actions
  const [pasteText, setPasteText] = useStateIM("");
  const [url, setUrl] = useStateIM("");
  const [pickedFiles, setPickedFiles] = useStateIM([]);      // {name, size, role}

  // Validate phase
  const [validation, setValidation] = useStateIM(null);       // ManifestImportPreview
  const [validating, setValidating] = useStateIM(false);
  const [validationError, setValidationError] = useStateIM(null);
  const [pendingLock, setPendingLock] = useStateIM(null);     // { locked_by, expires_at }

  // Resolve phase
  const [resolutions, setResolutions] = useStateIM([]);       // ConflictResolution[]

  // Preview phase
  const [previewTab, setPreviewTab] = useStateIM("graph");    // graph | actions | raw

  // Deploy phase
  const [target, setTarget] = useStateIM("production");
  const [note, setNote] = useStateIM("");
  const [committing, setCommitting] = useStateIM(false);
  const [commitError, setCommitError] = useStateIM(null);
  const [overwriteRequired, setOverwriteRequired] = useStateIM(null);

  const dropRef = useRefIM(null);

  // Tracks whether we've already auto-triggered a self-heal validate on the
  // current Deploy-step entry. Prevents an infinite loop if the server keeps
  // returning a 200 body without a deployment_id.
  const deployHealRef = useRefIM(false);

  const blockingUnresolved = useMemoIM(
    () => imBlockingUnresolvedCount(validation, resolutions),
    [validation, resolutions]
  );

  // Pre-populate resolutions whenever validation lands.
  useEffectIM(() => {
    if (!validation || !Array.isArray(validation.conflicts)) {
      setResolutions([]);
      return;
    }
    const next = validation.conflicts.map((c) => ({
      path: c.path,
      action: c.severity === "block" && c.auto_fix ? "accept_suggestion" : "skip",
    }));
    setResolutions(next);
  }, [validation]);

  // Self-heal: if we land on the Deploy step without a deployment_id but a
  // manifest is in memory, transparently re-run validate. The server's
  // one-pending-per-tenant policy reuses any existing pending row, so this is
  // idempotent. Gated by a ref so we attempt the heal at most once per
  // "broken session" — if it succeeds we reset; if it fails the operator
  // sees the actionable error UI inside ImportDeployStep.
  useEffectIM(() => {
    if (step !== 5 || (validation && validation.deployment_id)) {
      deployHealRef.current = false;
      return;
    }
    if (!workflow) return;
    if (validating) return;
    if (deployHealRef.current) return;
    deployHealRef.current = true;
    revalidateForDeploy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, workflow, validation, validating]);

  // ── Source-step handlers ─────────────────────────────────────────────────

  const handleFiles = useCallbackIM(async (list) => {
    const files = Array.from(list || []);
    if (files.length === 0) return;
    setValidationError(null);
    const meta = [];
    let nextWorkflow = null;
    let nextActions = null;
    for (const f of files) {
      const isActions = /actions.*\.json$/i.test(f.name);
      const isWorkflow = /workflow.*\.json$/i.test(f.name) || (!isActions && /\.json$/i.test(f.name));
      let role = "unknown";
      try {
        const text = await imReadFileAsText(f);
        const parsed = imSafeJsonParse(text);
        if (!parsed.ok) {
          meta.push({ name: f.name, size: f.size, role: "invalid", error: parsed.error });
          continue;
        }
        if (isActions || (Array.isArray(parsed.value) && !Array.isArray(parsed.value[0])
            && parsed.value.length && parsed.value[0] && parsed.value[0].kind === "action")) {
          nextActions = parsed.value;
          role = "actions";
        } else if (isWorkflow) {
          nextWorkflow = parsed.value;
          role = "workflow";
        } else {
          // Fallback: pick first array-or-object root as workflow
          nextWorkflow = parsed.value;
          role = "workflow";
        }
        meta.push({ name: f.name, size: f.size, role });
      } catch (e) {
        meta.push({ name: f.name, size: f.size, role: "unreadable", error: e.message });
      }
    }
    setPickedFiles(meta);
    setWorkflow(nextWorkflow);
    setActions(nextActions);
  }, []);

  function onDragOver(e) {
    e.preventDefault();
    if (dropRef.current) dropRef.current.classList.add("im-drop-hot");
  }
  function onDragLeave() {
    if (dropRef.current) dropRef.current.classList.remove("im-drop-hot");
  }
  async function onDrop(e) {
    e.preventDefault();
    if (dropRef.current) dropRef.current.classList.remove("im-drop-hot");
    await handleFiles(e.dataTransfer.files);
  }

  async function fetchFromUrl() {
    if (!url || !/^https?:\/\//i.test(url)) {
      setValidationError("Enter an https:// URL to a workflow.json or bundle.");
      return null;
    }
    try {
      const res = await fetch(`/v1/tenants/${encodeURIComponent(slug)}/manifest-import/fetch-url`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = body && body.error ? body.error : (body && body.message ? body.message : "fetch_failed");
        setValidationError(`URL fetch failed: ${code}`);
        return null;
      }
      return { workflow: body.workflow, actions: body.actions };
    } catch (e) {
      setValidationError(`URL fetch failed: ${e.message || "network"}`);
      return null;
    }
  }

  // Move from SOURCE to VALIDATE: gather manifest, then call validate.
  async function startValidation() {
    setValidationError(null);
    setPendingLock(null);
    setValidation(null);

    let nextWorkflow = workflow;
    let nextActions = actions;

    if (sourceKind === "paste") {
      const parsed = imParsePastedManifest(pasteText);
      if (parsed.error) {
        setValidationError(parsed.error);
        return;
      }
      nextWorkflow = parsed.workflow;
      nextActions = parsed.actions != null ? parsed.actions : null;
      setWorkflow(nextWorkflow);
      setActions(nextActions);
    } else if (sourceKind === "url") {
      const fetched = await fetchFromUrl();
      if (!fetched) return;
      nextWorkflow = fetched.workflow;
      nextActions = fetched.actions || null;
      setWorkflow(nextWorkflow);
      setActions(nextActions);
    } else if (sourceKind === "upload") {
      if (!nextWorkflow) {
        setValidationError("Drop a workflow.json (and optionally actions.json) first.");
        return;
      }
    } else if (sourceKind === "repo") {
      setValidationError("Repo source is coming soon — use upload, paste, or URL.");
      return;
    }

    if (!nextWorkflow) {
      setValidationError("No manifest gathered from this source.");
      return;
    }

    setStep(1);
    setValidating(true);
    try {
      const res = await fetch(`/v1/tenants/${encodeURIComponent(slug)}/manifest-import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "validate", workflow: nextWorkflow, actions: nextActions || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 423) {
        setPendingLock({
          locked_by: body && body.locked_by,
          expires_at: body && body.expires_at,
        });
        setValidating(false);
        return;
      }
      if (!res.ok) {
        const detail = body && (body.error || body.message);
        setValidationError(detail ? String(detail) : `Validation failed (HTTP ${res.status})`);
        setValidating(false);
        return;
      }
      setValidation(body);
      setValidating(false);
      if (body.ok) {
        // Auto-advance to Diff step on a clean validate.
        setStep(2);
      }
    } catch (e) {
      setValidationError(e.message || "Network error during validate");
      setValidating(false);
    }
  }

  async function cancelPendingLock() {
    if (!pendingLock || !pendingLock.locked_by) {
      setPendingLock(null);
      return;
    }
    try {
      await fetch(
        `/v1/tenants/${encodeURIComponent(slug)}/manifest-import/${encodeURIComponent(pendingLock.locked_by)}`,
        { method: "DELETE" }
      );
    } catch (_e) {
      // Best-effort: still clear local state.
    }
    setPendingLock(null);
    setStep(0);
  }

  function resetSource() {
    setWorkflow(null);
    setActions(null);
    setValidation(null);
    setValidationError(null);
    setResolutions([]);
    setPickedFiles([]);
    setPendingLock(null);
    setOverwriteRequired(null);
    setStep(0);
  }

  // ── Resolve helpers ──────────────────────────────────────────────────────

  function setResolution(path, patch) {
    setResolutions((prev) => {
      const found = prev.findIndex((r) => r.path === path);
      if (found === -1) return [...prev, { path, ...patch }];
      const next = prev.slice();
      next[found] = { ...next[found], ...patch };
      return next;
    });
  }

  // ── Commit ────────────────────────────────────────────────────────────────

  // Re-run validate using the in-memory manifest. Used by the Deploy-step
  // auto-heal effect and as a fallback path inside runCommit. Returns the
  // fresh validation body on success, or null on failure (the caller decides
  // how to surface that).
  async function revalidateForDeploy() {
    if (!workflow) return null;
    setValidating(true);
    try {
      const res = await fetch(`/v1/tenants/${encodeURIComponent(slug)}/manifest-import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "validate", workflow, actions: actions || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 423) {
        setPendingLock({
          locked_by: body && body.locked_by,
          expires_at: body && body.expires_at,
        });
        setValidating(false);
        return null;
      }
      if (!res.ok || !body || !body.deployment_id) {
        setValidating(false);
        return null;
      }
      setValidation(body);
      setValidating(false);
      return body;
    } catch (_e) {
      setValidating(false);
      return null;
    }
  }

  async function runCommit({ confirmOverwrite }) {
    let v = validation;
    if (!v || !v.deployment_id) {
      v = await revalidateForDeploy();
    }
    if (!v || !v.deployment_id) {
      setCommitError(
        workflow
          ? "Could not establish a deployment session — try Re-validate, or go back to Source and re-upload."
          : "No manifest in memory — go back to Source to re-upload before deploying."
      );
      return;
    }
    setCommitError(null);
    setCommitting(true);
    try {
      const res = await fetch(`/v1/tenants/${encodeURIComponent(slug)}/manifest-import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "commit",
          workflow,
          actions: actions || undefined,
          target,
          deployment_id: v.deployment_id,
          conflict_resolutions: resolutions,
          confirm_overwrite: !!confirmOverwrite,
          note: note ? note.slice(0, 500) : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body && body.requires_confirmation) {
        setOverwriteRequired(body);
        setCommitting(false);
        return;
      }
      if (!res.ok) {
        const detail = body && (body.error || body.message || (Array.isArray(body.issues) && body.issues.map((i) => i.message).join("; ")));
        setCommitError(detail ? String(detail) : `Deploy failed (HTTP ${res.status})`);
        setCommitting(false);
        return;
      }
      // Success
      setCommitting(false);
      setOverwriteRequired(null);
      const versionLabel = body.version || body.workflow_version_id;
      try {
        const toast = window.toast || window.notify;
        if (typeof toast === "function") {
          toast({
            tone: "success",
            title: "Workflow deployed",
            message: `${versionLabel} is live for ${slug}`,
          });
        }
      } catch (_e) {
        // best-effort
      }
      try {
        if (typeof window.refreshWorkflowsView === "function") window.refreshWorkflowsView();
      } catch (_e) {
        // best-effort
      }
      onClose();
    } catch (e) {
      setCommitError(e.message || "Network error during deploy");
      setCommitting(false);
    }
  }

  // ── Footer / step navigation ─────────────────────────────────────────────

  const canAdvance = useMemoIM(() => {
    if (step === 0) {
      if (sourceKind === "upload") return !!workflow;
      if (sourceKind === "paste") return pasteText.trim().length > 0;
      if (sourceKind === "url") return /^https?:\/\//i.test(url || "");
      if (sourceKind === "repo") return false;
      return false;
    }
    if (step === 1) return !!validation && validation.ok === true;
    if (step === 2) return !!validation;
    if (step === 3) return blockingUnresolved === 0;
    if (step === 4) return !!validation;
    return true;
  }, [step, sourceKind, workflow, pasteText, url, validation, blockingUnresolved]);

  function goBack() {
    setOverwriteRequired(null);
    setCommitError(null);
    setStep((s) => Math.max(0, s - 1));
  }

  function goNext() {
    if (step === 0) {
      startValidation();
      return;
    }
    setStep((s) => Math.min(IM_STEPS.length - 1, s + 1));
  }

  const title = mode === "agent" ? "Import agent manifest" : "Import workflow manifest";

  return (
    <ImportModalOverlay onClose={onClose}>
      <div
        style={{
          width: 1000, maxHeight: "92vh",
          background: "var(--panel)",
          border: "1px solid var(--border-2)",
          borderRadius: 8,
          overflow: "hidden",
          boxShadow: "0 24px 60px -20px rgba(0,0,0,0.6)",
          display: "flex", flexDirection: "column",
        }}
      >
        {/* Header */}
        <header style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 18px",
          borderBottom: "1px solid var(--border)",
        }}>
          <window.Icon name="upload" size={14} style={{ color: "var(--signal)" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 500 }}>{title}</div>
            <div style={{ fontSize: 11, color: "var(--text-3)" }}>
              Accepts a v1 or v2 manifest pair: <span className="mono" style={{ color: "var(--text-2)" }}>workflow.json</span>
              {" "}+ <span className="mono" style={{ color: "var(--text-2)" }}>actions.json</span>.
              {" "}Validates, diffs against the live workflow, then deploys to{" "}
              <span className="mono" style={{ color: "var(--text-2)" }}>{slug}</span>.
            </div>
          </div>
          <button onClick={onClose} style={{ color: "var(--text-3)" }}>
            <window.Icon name="x" size={13} />
          </button>
        </header>

        {/* Stepper */}
        <div style={{
          display: "flex",
          padding: "10px 18px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-2)",
          gap: 4,
        }}>
          {IM_STEPS.map((s, i) => (
            <ImportStepDot key={s.id} step={s} idx={i} active={step === i} done={i < step} />
          ))}
        </div>

        {/* Step body */}
        <div style={{ padding: 20, overflow: "auto", flex: 1, minHeight: 0 }}>
          {step === 0 && (
            <ImportSourceStep
              sourceKind={sourceKind} setSourceKind={setSourceKind}
              pickedFiles={pickedFiles}
              workflow={workflow}
              actions={actions}
              handleFiles={handleFiles}
              pasteText={pasteText} setPasteText={setPasteText}
              url={url} setUrl={setUrl}
              dropRef={dropRef} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
              validationError={validationError}
            />
          )}
          {step === 1 && (
            <ImportValidateStep
              validating={validating}
              validation={validation}
              validationError={validationError}
              pendingLock={pendingLock}
              onResetSource={resetSource}
              onCancelLock={cancelPendingLock}
            />
          )}
          {step === 2 && validation && (
            <ImportDiffStep validation={validation} />
          )}
          {step === 3 && validation && (
            <ImportResolveStep
              validation={validation}
              resolutions={resolutions}
              setResolution={setResolution}
            />
          )}
          {step === 4 && validation && (
            <ImportPreviewStep
              workflow={workflow}
              actions={actions}
              validation={validation}
              tab={previewTab} setTab={setPreviewTab}
            />
          )}
          {step === 5 && validation && (
            <ImportDeployStep
              validation={validation}
              target={target} setTarget={setTarget}
              note={note} setNote={setNote}
              committing={committing}
              commitError={commitError}
              slug={slug}
              validating={validating}
              onRevalidate={() => {
                deployHealRef.current = false;
                setCommitError(null);
                revalidateForDeploy();
              }}
              onBackToSource={resetSource}
            />
          )}
        </div>

        {/* Footer */}
        <footer style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "12px 18px",
          borderTop: "1px solid var(--border)",
          background: "var(--panel-2)",
        }}>
          {step > 0 && <window.Button tone="ghost" icon="chevron-left" onClick={goBack}>Back</window.Button>}
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
            Step {step + 1} of {IM_STEPS.length}
          </span>
          {step === 2 && validation && validation.diff && (
            <span style={{ marginLeft: 14, fontSize: 11, fontFamily: "var(--mono)", color: "var(--text-3)" }}>
              <span style={{ color: "var(--green)" }}>+{(validation.diff.added || []).length}</span>{" "}
              <span style={{ color: "var(--amber)" }}>~{(validation.diff.modified || []).length}</span>{" "}
              <span style={{ color: "var(--red)" }}>−{(validation.diff.removed || []).length}</span>
            </span>
          )}
          {step === 3 && blockingUnresolved > 0 && (
            <span style={{
              marginLeft: 14, fontSize: 11, fontFamily: "var(--mono)",
              color: "var(--red)",
            }} title="Resolve blocking conflicts first">
              {blockingUnresolved} blocking conflict{blockingUnresolved === 1 ? "" : "s"}
            </span>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <window.Button tone="ghost" onClick={onClose}>Cancel</window.Button>
            {step < IM_STEPS.length - 1 ? (
              <window.Button
                tone="primary"
                icon="chevron-right"
                onClick={canAdvance ? goNext : undefined}
                style={canAdvance ? undefined : { opacity: 0.4, cursor: "not-allowed" }}
                title={
                  step === 3 && blockingUnresolved > 0
                    ? "Resolve blocking conflicts first"
                    : undefined
                }
              >
                {step === 0 ? "Validate" : "Continue"}
              </window.Button>
            ) : (
              <window.Button
                tone="primary"
                icon="deploy"
                onClick={committing ? undefined : () => runCommit({ confirmOverwrite: false })}
                style={committing ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
              >
                {committing ? "Deploying…" : `Deploy to ${target}`}
              </window.Button>
            )}
          </div>
        </footer>
      </div>

      <style>{`
        .im-drop-hot {
          background: var(--panel-2) !important;
          border-color: var(--signal) !important;
        }
      `}</style>

      {overwriteRequired && window.OverwriteConfirmModal && (
        <window.OverwriteConfirmModal
          data={overwriteRequired}
          committing={committing}
          onCancel={() => setOverwriteRequired(null)}
          onConfirm={() => runCommit({ confirmOverwrite: true })}
        />
      )}
    </ImportModalOverlay>
  );
}

// ── Step dot ───────────────────────────────────────────────────────────────

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
        <div style={{
          fontSize: 11, fontFamily: "var(--mono)",
          textTransform: "uppercase", letterSpacing: "0.06em",
          color: active ? "var(--text)" : "var(--text-3)",
          lineHeight: 1.1,
        }}>{step.label}</div>
        <div style={{ fontSize: 10, color: "var(--text-3)" }}>{step.hint}</div>
      </div>
    </div>
  );
}

// ── Step 0 · SOURCE ────────────────────────────────────────────────────────

function ImportSourceStep({
  sourceKind, setSourceKind,
  pickedFiles, workflow, actions,
  handleFiles,
  pasteText, setPasteText,
  url, setUrl,
  dropRef, onDragOver, onDragLeave, onDrop,
  validationError,
}) {
  return (
    <div>
      <div style={{
        fontSize: 11, fontFamily: "var(--mono)",
        textTransform: "uppercase", color: "var(--text-3)",
        letterSpacing: "0.08em", marginBottom: 10,
      }}>Source</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 18 }}>
        <ImportSourceCard
          active={sourceKind === "upload"} onClick={() => setSourceKind("upload")}
          icon="upload" title="Upload files"
          sub="Drop workflow.json + actions.json"
        />
        <ImportSourceCard
          active={sourceKind === "paste"} onClick={() => setSourceKind("paste")}
          icon="code" title="Paste JSON"
          sub="Paste a workflow or { workflow, actions } bundle"
        />
        <ImportSourceCard
          active={sourceKind === "url"} onClick={() => setSourceKind("url")}
          icon="external" title="From URL"
          sub="HTTPS only · 5 MB cap, SSRF-guarded"
        />
        <ImportSourceCard
          active={sourceKind === "repo"} onClick={() => setSourceKind("repo")}
          icon="git" title="From repo"
          sub="Coming soon"
          disabled
        />
      </div>

      {sourceKind === "upload" && (
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
            }}
          >
            <window.Icon name="upload" size={22} style={{ color: "var(--text-3)" }} />
            <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-2)" }}>
              Drop <span className="mono" style={{ color: "var(--text)" }}>workflow.json</span>
              {" "}and (optionally) <span className="mono" style={{ color: "var(--text)" }}>actions.json</span>
            </div>
            <div style={{ marginTop: 4, fontSize: 11.5, color: "var(--text-3)" }}>
              or{" "}
              <label style={{ color: "var(--signal)", cursor: "pointer" }}>
                browse files
                <input
                  type="file" multiple accept=".json,application/json"
                  style={{ display: "none" }}
                  onChange={(e) => handleFiles(e.target.files)}
                />
              </label>
              {" "}· server validates after upload
            </div>
          </div>

          {pickedFiles.length > 0 && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
              {pickedFiles.map((f, i) => {
                const okRole = f.role === "workflow" || f.role === "actions";
                return (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "7px 12px",
                    background: "var(--panel-2)",
                    border: `1px solid ${okRole ? "var(--border)" : "rgba(255,181,71,0.30)"}`,
                    borderRadius: 4,
                  }}>
                    <window.Icon name="code" size={12} style={{ color: okRole ? "var(--green)" : "var(--amber)" }} />
                    <span className="mono" style={{ fontSize: 12, color: "var(--text)" }}>{f.name}</span>
                    <span style={{ marginLeft: "auto", fontSize: 11, fontFamily: "var(--mono)", color: "var(--text-3)" }}>
                      {window.fmtBytes ? window.fmtBytes(f.size) : f.size + " B"}
                    </span>
                    {f.role === "workflow" && <window.Badge tone="green">WORKFLOW</window.Badge>}
                    {f.role === "actions" && <window.Badge tone="blue">ACTIONS</window.Badge>}
                    {!okRole && <window.Badge tone="amber">{(f.role || "unknown").toUpperCase()}</window.Badge>}
                  </div>
                );
              })}
              <div style={{
                fontSize: 10.5, fontFamily: "var(--mono)",
                color: "var(--text-3)", marginTop: 4,
              }}>
                {workflow ? `${imAgentCountFromRaw(workflow)} agents discovered` : "No workflow detected"}
                {actions ? ` · ${Array.isArray(actions) ? actions.length : "?"} actions` : ""}
              </div>
            </div>
          )}
        </div>
      )}

      {sourceKind === "paste" && (
        <div>
          {window.MonacoEditor ? (
            <window.MonacoEditor
              value={pasteText || ""}
              onChange={setPasteText}
              language="json"
              height={360}
            />
          ) : (
            <textarea
              value={pasteText} onChange={(e) => setPasteText(e.target.value)}
              spellCheck={false}
              style={{
                width: "100%", height: 360,
                background: "var(--bg-2)", border: "1px solid var(--border-2)",
                borderRadius: 4, padding: 12,
                color: "var(--text)", fontFamily: "var(--mono)", fontSize: 12,
                outline: "none", resize: "vertical",
              }}
            />
          )}
          <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-3)" }}>
            Paste a raw workflow.json (v1 array or v2 wrapper). To include actions,
            paste a bundle:{" "}
            <span className="mono">{`{ "workflow": ..., "actions": [...] }`}</span>
          </div>
        </div>
      )}

      {sourceKind === "url" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ display: "block", fontSize: 11, color: "var(--text-2)", marginBottom: 4 }}>
              Manifest URL
            </label>
            <input
              value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/workflow.json"
              style={{
                width: "100%", padding: "8px 12px",
                background: "var(--panel-2)", border: "1px solid var(--border-2)",
                borderRadius: 4,
                color: "var(--text)", fontFamily: "var(--mono)", fontSize: 12, outline: "none",
              }}
            />
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-3)" }}>
              Server-side fetch with SSRF guards: HTTPS only, private/loopback/link-local IPs rejected,
              cloud metadata IPs blocked, 5 MB body cap, 5 s timeout.
            </div>
          </div>
          <div style={{
            padding: "10px 12px",
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            borderRadius: 4,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <window.Icon name="alert" size={11} style={{ color: "var(--amber)" }} />
              <span style={{ fontSize: 12, color: "var(--text)" }}>Allowed responses</span>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.55 }}>
              The endpoint expects JSON: either the workflow document itself, or{" "}
              <span className="mono">{`{ workflow, actions? }`}</span>. Anything else returns a 400.
            </div>
          </div>
        </div>
      )}

      {sourceKind === "repo" && (
        <div style={{
          padding: "16px 18px",
          background: "var(--panel-2)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          fontSize: 12.5, color: "var(--text-2)",
          lineHeight: 1.55,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <window.Icon name="git" size={12} style={{ color: "var(--text-3)" }} />
            <span style={{ color: "var(--text)", fontWeight: 500 }}>Repo source — coming soon</span>
          </div>
          The server endpoint{" "}
          <span className="mono" style={{ color: "var(--text-3)" }}>/manifest-import/fetch-repo</span>
          {" "}is stubbed in v1. Use Upload, Paste, or URL.
        </div>
      )}

      {validationError && (
        <div style={{
          marginTop: 14,
          padding: "10px 12px",
          background: "rgba(255,100,112,0.08)",
          border: "1px solid rgba(255,100,112,0.32)",
          borderRadius: 4,
          fontSize: 12, color: "var(--red)",
        }}>
          {validationError}
        </div>
      )}
    </div>
  );
}

function ImportSourceCard({ active, onClick, icon, title, sub, disabled }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={!!disabled}
      style={{
        padding: "12px 14px",
        background: active ? "var(--panel-3)" : "var(--panel-2)",
        border: `1px solid ${active ? "var(--signal)" : "var(--border)"}`,
        borderRadius: 5,
        textAlign: "left",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        transition: "background 0.12s, border-color 0.12s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
        <window.Icon name={icon} size={12} style={{ color: active ? "var(--signal)" : "var(--text-2)" }} />
        <span style={{ fontSize: 12.5, color: "var(--text)", fontWeight: 500 }}>{title}</span>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.45 }}>{sub}</div>
    </button>
  );
}

// ── Step 1 · VALIDATE ──────────────────────────────────────────────────────

function ImportValidatingState() {
  return (
    <div style={{ padding: "60px 20px", textAlign: "center" }}>
      <div style={{
        display: "inline-block",
        width: 22, height: 22,
        border: "3px solid var(--border-2)",
        borderTopColor: "var(--signal)",
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
      }} />
      <div style={{ marginTop: 16, fontSize: 13, color: "var(--text)" }}>
        Validating manifest…
      </div>
      <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--text-3)" }}>
        Migrating · parsing · cross-referencing · diffing against live workflow
      </div>
    </div>
  );
}

function ImportValidateStep({ validating, validation, validationError, pendingLock, onResetSource, onCancelLock }) {
  if (validating) return <ImportValidatingState />;

  if (pendingLock) {
    return (
      <div>
        <window.Panel
          title="Import already in progress"
          subtitle="Another wizard session is holding the import lock for this tenant"
          padded
        >
          <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6 }}>
            A pending import is locked under{" "}
            <span className="mono" style={{ color: "var(--text)" }}>{pendingLock.locked_by || "(unknown)"}</span>.
            {pendingLock.expires_at && (
              <>
                {" "}It auto-expires at{" "}
                <span className="mono" style={{ color: "var(--text)" }}>{imFormatTime(pendingLock.expires_at)}</span>.
              </>
            )}
            {" "}You can either wait for it to expire, cancel the pending lock, or come back later.
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
            <window.Button tone="ghost" onClick={onResetSource}>Back to source</window.Button>
            <window.Button tone="default" icon="x" onClick={onCancelLock}>Cancel pending</window.Button>
          </div>
        </window.Panel>
      </div>
    );
  }

  if (validationError) {
    return (
      <div>
        <window.Panel title="Validation error" padded>
          <div style={{
            padding: "10px 12px",
            background: "rgba(255,100,112,0.08)",
            border: "1px solid rgba(255,100,112,0.32)",
            borderRadius: 4,
            fontSize: 12, color: "var(--red)",
            marginBottom: 10,
          }}>{validationError}</div>
          <window.Button tone="ghost" icon="chevron-left" onClick={onResetSource}>Back to source</window.Button>
        </window.Panel>
      </div>
    );
  }

  if (!validation) return null;

  const issues = validation.issues || [];
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const infos = issues.filter((i) => i.severity === "info");
  const parsed = validation.parsed || { agents: 0, events: 0, actions: 0 };
  const prior = validation.prior || {};

  return (
    <div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        gap: 0,
        border: "1px solid var(--border)",
        borderRadius: 6,
        marginBottom: 14,
        background: "var(--panel)",
      }}>
        <ImportValidateCell label="Schema" value={`v${validation.schema_version || "?"}`} mono accent="var(--signal)" />
        <ImportValidateCell label="Agents" value={parsed.agents} mono />
        <ImportValidateCell label="Events" value={parsed.events} mono />
        <ImportValidateCell label="Actions" value={parsed.actions} mono />
        <ImportValidateCell
          label="Prior version"
          value={prior.version_label || "—"}
          mono accent={prior.version_label ? "var(--text)" : "var(--text-3)"}
          last
        />
      </div>

      {prior.deployed_at && (
        <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 14 }}>
          Live workflow was deployed at{" "}
          <span className="mono" style={{ color: "var(--text-2)" }}>{imFormatTime(prior.deployed_at)}</span>
          {typeof prior.agents === "number" ? <> · {prior.agents} agents</> : null}
        </div>
      )}

      {validation.ok === false && (
        <div style={{
          marginBottom: 14,
          padding: "10px 12px",
          background: "rgba(255,100,112,0.08)",
          border: "1px solid rgba(255,100,112,0.32)",
          borderRadius: 4,
          fontSize: 12, color: "var(--red)",
        }}>
          Manifest did not validate — fix the issues below and try again.
        </div>
      )}

      <window.Panel title="Validation results" padded={false}>
        {issues.length === 0 ? (
          <div style={{ padding: "12px 14px", fontSize: 12, color: "var(--text-3)" }}>
            No issues. Move on to Diff.
          </div>
        ) : (
          issues.map((iss, i) => {
            const dotColor =
              iss.severity === "error" ? "var(--red)"
              : iss.severity === "warning" ? "var(--amber)"
              : "var(--text-3)";
            return (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 14px",
                borderBottom: i < issues.length - 1 ? "1px solid var(--border)" : "none",
              }}>
                <span style={{
                  display: "inline-block",
                  width: 8, height: 8, borderRadius: "50%",
                  background: dotColor, flexShrink: 0,
                }} />
                <span style={{ fontSize: 12, color: "var(--text-2)" }}>{iss.message}</span>
                {iss.path && (
                  <span className="mono" style={{ marginLeft: 8, fontSize: 11, color: "var(--text-3)" }}>{iss.path}</span>
                )}
                <span style={{
                  marginLeft: "auto",
                  fontSize: 10, fontFamily: "var(--mono)",
                  textTransform: "uppercase", color: dotColor,
                }}>{iss.severity}</span>
              </div>
            );
          })
        )}
      </window.Panel>

      {errors.length === 0 && (
        <div style={{
          marginTop: 12,
          fontSize: 11.5, color: "var(--text-3)",
        }}>
          {warnings.length > 0
            ? `${warnings.length} warning${warnings.length === 1 ? "" : "s"} won't block deploy.`
            : infos.length > 0
              ? "Informational issues only — continue to Diff."
              : "Clean validate — continue to Diff."}
        </div>
      )}

      {validation.ok === false && (
        <div style={{ marginTop: 12 }}>
          <window.Button tone="ghost" icon="chevron-left" onClick={onResetSource}>Back to source</window.Button>
        </div>
      )}
    </div>
  );
}

function ImportValidateCell({ label, value, mono, accent, last }) {
  return (
    <div style={{
      padding: "10px 14px",
      borderRight: last ? "none" : "1px solid var(--border)",
      minWidth: 0,
    }}>
      <div style={{
        fontSize: 10, fontFamily: "var(--mono)",
        textTransform: "uppercase", letterSpacing: "0.08em",
        color: "var(--text-3)",
      }}>{label}</div>
      <div style={{
        marginTop: 4,
        fontSize: 14,
        fontFamily: mono ? "var(--mono)" : "var(--sans)",
        color: accent || "var(--text)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{value}</div>
    </div>
  );
}

// ── Step 2 · DIFF ──────────────────────────────────────────────────────────

function ImportDiffStep({ validation }) {
  const diff = validation.diff || { added: [], modified: [], removed: [], prior_version: null };
  const added = diff.added || [];
  const modified = diff.modified || [];
  const removed = diff.removed || [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "10px 14px",
        background: "var(--panel-2)",
        border: "1px solid var(--border)",
        borderRadius: 4,
        fontSize: 12, fontFamily: "var(--mono)",
        color: "var(--text-2)",
      }}>
        <span><span style={{ color: "var(--green)" }}>+{added.length}</span> additions</span>
        <span><span style={{ color: "var(--amber)" }}>~{modified.length}</span> modifications</span>
        <span><span style={{ color: "var(--red)" }}>−{removed.length}</span> removals</span>
        {diff.prior_version && (
          <span style={{ marginLeft: "auto", color: "var(--text-3)" }}>
            vs <span style={{ color: "var(--text-2)" }}>{diff.prior_version}</span>
          </span>
        )}
      </div>

      <window.Panel title="Agent diff vs live" subtitle={diff.prior_version ? `prior: ${diff.prior_version}` : "no prior version"} padded={false}>
        <ImportDiffGroup label="Added" tone="green" ids={added} sigil="+" />
        <ImportDiffGroup label="Modified" tone="amber" ids={modified} sigil="~" />
        <ImportDiffGroup label="Removed" tone="red" ids={removed} sigil="−" last />
      </window.Panel>
    </div>
  );
}

function ImportDiffGroup({ label, tone, ids, sigil, last }) {
  const toneVar = tone === "green" ? "var(--green)" : tone === "amber" ? "var(--amber)" : "var(--red)";
  if (!ids || ids.length === 0) {
    return (
      <div style={{
        padding: "8px 14px",
        borderBottom: last ? "none" : "1px solid var(--border)",
        fontSize: 11.5, color: "var(--text-3)",
      }}>
        <span style={{
          color: toneVar, fontFamily: "var(--mono)",
          marginRight: 8, fontWeight: 700,
        }}>{sigil}</span>
        {label}: none
      </div>
    );
  }
  return (
    <div style={{ borderBottom: last ? "none" : "1px solid var(--border)" }}>
      <div style={{
        padding: "8px 14px",
        display: "flex", alignItems: "center", gap: 8,
        background: "var(--panel-2)",
      }}>
        <span style={{
          color: toneVar, fontFamily: "var(--mono)",
          fontSize: 13, fontWeight: 700, width: 12, textAlign: "center",
        }}>{sigil}</span>
        <span style={{
          fontSize: 11, fontFamily: "var(--mono)",
          textTransform: "uppercase", letterSpacing: "0.08em",
          color: "var(--text-2)",
        }}>{label} · {ids.length}</span>
      </div>
      <div style={{
        padding: "8px 14px",
        display: "flex", flexWrap: "wrap", gap: 6,
      }}>
        {ids.map((id, i) => (
          <window.Badge key={i} tone="muted">{String(id)}</window.Badge>
        ))}
      </div>
    </div>
  );
}

// ── Step 3 · RESOLVE ───────────────────────────────────────────────────────

function ImportResolveStep({ validation, resolutions, setResolution }) {
  const conflicts = validation.conflicts || [];
  if (conflicts.length === 0) {
    return (
      <window.Panel title="Conflicts" padded>
        <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>
          No conflicts detected. Continue to Preview.
        </div>
      </window.Panel>
    );
  }

  // Group by type
  const byType = {};
  conflicts.forEach((c) => {
    (byType[c.type] = byType[c.type] || []).push(c);
  });

  const resByPath = new Map();
  resolutions.forEach((r) => resByPath.set(r.path, r));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {Object.entries(byType).map(([type, list]) => (
        <window.Panel
          key={type}
          title={type.replace(/_/g, " ")}
          subtitle={`${list.length} conflict${list.length === 1 ? "" : "s"}`}
          padded={false}
        >
          {list.map((c, i) => (
            <ImportConflictCard
              key={c.path + ":" + i}
              conflict={c}
              resolution={resByPath.get(c.path)}
              onChange={(patch) => setResolution(c.path, patch)}
              last={i === list.length - 1}
            />
          ))}
        </window.Panel>
      ))}
    </div>
  );
}

function ImportConflictCard({ conflict, resolution, onChange, last }) {
  const sev = conflict.severity || "warn";
  const action = (resolution && resolution.action) || "skip";
  const overrideValue = resolution && resolution.override_value;

  function onPickAction(next) {
    if (next === "override") {
      onChange({
        action: "override",
        override_value: overrideValue != null ? overrideValue : "",
      });
    } else {
      onChange({ action: next, override_value: undefined });
    }
  }

  return (
    <div style={{
      padding: "12px 14px",
      borderBottom: last ? "none" : "1px solid var(--border)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "1px 6px",
          fontSize: 9.5, fontFamily: "var(--mono)",
          letterSpacing: "0.04em", textTransform: "uppercase",
          color: sev === "block" ? "var(--red)" : "var(--amber)",
          background: sev === "block" ? "rgba(255,100,112,0.10)" : "rgba(255,181,71,0.10)",
          border: `1px solid ${sev === "block" ? "rgba(255,100,112,0.32)" : "rgba(255,181,71,0.32)"}`,
          borderRadius: 3,
        }}>{sev}</span>
        <span className="mono" style={{ fontSize: 11.5, color: "var(--text)" }}>{conflict.path}</span>
        <span style={{
          marginLeft: "auto",
          fontSize: 10, fontFamily: "var(--mono)",
          color: "var(--text-3)",
        }}>{conflict.type}</span>
      </div>

      <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8, lineHeight: 1.5 }}>
        {conflict.detail || "—"}
      </div>

      {conflict.suggestion && (
        <div style={{
          fontSize: 11.5, color: "var(--text-3)",
          marginBottom: 10, lineHeight: 1.5,
          padding: "6px 10px",
          background: "var(--panel-2)",
          border: "1px solid var(--border)",
          borderRadius: 4,
        }}>
          <span style={{ color: "var(--text-2)", fontWeight: 500 }}>Suggestion:</span> {conflict.suggestion}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {conflict.auto_fix && (
          <ImportConflictOption
            label="Accept suggestion"
            value="accept_suggestion"
            current={action}
            onPick={onPickAction}
          />
        )}
        <ImportConflictOption
          label="Skip"
          value="skip"
          current={action}
          onPick={onPickAction}
        />
        <ImportConflictOption
          label="Override"
          value="override"
          current={action}
          onPick={onPickAction}
        />
        {action === "override" && (
          <input
            value={overrideValue != null ? String(overrideValue) : ""}
            onChange={(e) => onChange({ action: "override", override_value: e.target.value })}
            placeholder="override value (string or JSON)"
            style={{
              flex: 1, minWidth: 200,
              padding: "5px 8px",
              background: "var(--panel-2)",
              border: "1px solid var(--border-2)",
              borderRadius: 4,
              color: "var(--text)", fontFamily: "var(--mono)", fontSize: 11.5,
              outline: "none",
            }}
          />
        )}
      </div>
    </div>
  );
}

function ImportConflictOption({ label, value, current, onPick }) {
  const active = current === value;
  return (
    <button
      onClick={() => onPick(value)}
      style={{
        padding: "5px 10px",
        background: active ? "var(--panel-3)" : "var(--panel-2)",
        border: `1px solid ${active ? "var(--signal)" : "var(--border-2)"}`,
        borderRadius: 4,
        fontSize: 11.5,
        color: active ? "var(--text)" : "var(--text-2)",
      }}
    >
      {label}
    </button>
  );
}

// ── Step 4 · PREVIEW ───────────────────────────────────────────────────────

function ImportPreviewStep({ workflow, actions, validation, tab, setTab }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <ImportPreviewTabButton id="graph" current={tab} setTab={setTab} label="Graph" />
        <ImportPreviewTabButton id="actions" current={tab} setTab={setTab} label="Actions JSON" />
        <ImportPreviewTabButton id="raw" current={tab} setTab={setTab} label="Raw manifest" />
      </div>

      {tab === "graph" && (
        window.ImportPreviewGraph
          ? <window.ImportPreviewGraph manifest={workflow} diff={validation.diff} />
          : (
            <div style={{
              padding: 24,
              background: "var(--bg-2)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontSize: 12, color: "var(--text-3)",
              textAlign: "center",
            }}>
              Graph component not loaded.
            </div>
          )
      )}

      {tab === "actions" && (
        window.MonacoEditor ? (
          <window.MonacoEditor
            value={JSON.stringify(actions || [], null, 2)}
            language="json"
            readOnly
            height="60vh"
          />
        ) : (
          <pre style={{
            padding: 12,
            background: "var(--bg-2)",
            border: "1px solid var(--border-2)",
            borderRadius: 4,
            color: "var(--text-2)",
            fontFamily: "var(--mono)", fontSize: 12,
            maxHeight: "60vh", overflow: "auto",
          }}>{JSON.stringify(actions || [], null, 2)}</pre>
        )
      )}

      {tab === "raw" && (
        window.MonacoEditor ? (
          <window.MonacoEditor
            value={JSON.stringify(workflow || {}, null, 2)}
            language="json"
            readOnly
            height="60vh"
          />
        ) : (
          <pre style={{
            padding: 12,
            background: "var(--bg-2)",
            border: "1px solid var(--border-2)",
            borderRadius: 4,
            color: "var(--text-2)",
            fontFamily: "var(--mono)", fontSize: 12,
            maxHeight: "60vh", overflow: "auto",
          }}>{JSON.stringify(workflow || {}, null, 2)}</pre>
        )
      )}
    </div>
  );
}

function ImportPreviewTabButton({ id, current, setTab, label }) {
  const active = current === id;
  return (
    <button
      onClick={() => setTab(id)}
      style={{
        padding: "5px 12px",
        background: active ? "var(--panel-3)" : "var(--panel-2)",
        border: `1px solid ${active ? "var(--signal)" : "var(--border-2)"}`,
        borderRadius: 4,
        fontSize: 12,
        color: active ? "var(--text)" : "var(--text-2)",
      }}
    >
      {label}
    </button>
  );
}

// ── Step 5 · DEPLOY ────────────────────────────────────────────────────────

function ImportDeployStep({
  validation, target, setTarget, note, setNote, committing, commitError, slug,
  validating, onRevalidate, onBackToSource,
}) {
  const parsed = validation.parsed || { agents: 0, events: 0, actions: 0 };
  const diff = validation.diff || { added: [], removed: [], modified: [] };
  const sessionMissing = !validation.deployment_id;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 14 }}>
      {sessionMissing && validating && (
        <div style={{
          gridColumn: "1 / -1",
          padding: "10px 12px",
          background: "rgba(120, 200, 255, 0.06)",
          border: "1px solid rgba(120, 200, 255, 0.28)",
          borderRadius: 4,
          fontSize: 12, color: "var(--text-2)",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <window.Icon name="refresh" size={12} style={{ color: "var(--signal)" }} />
          Re-establishing deployment session…
        </div>
      )}
      {sessionMissing && !validating && (
        <div style={{
          gridColumn: "1 / -1",
          padding: "12px 14px",
          background: "rgba(255, 180, 70, 0.06)",
          border: "1px solid rgba(255, 180, 70, 0.3)",
          borderRadius: 4,
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          <div style={{ fontSize: 12, color: "var(--amber)", lineHeight: 1.5 }}>
            Deployment session is missing. The wizard tried to re-establish it automatically and failed.
            Re-validate from the in-memory manifest, or go back to Source to re-upload.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <window.Button tone="primary" icon="refresh" onClick={onRevalidate}>
              Re-validate
            </window.Button>
            <window.Button tone="ghost" icon="chevron-left" onClick={onBackToSource}>
              Back to Source
            </window.Button>
          </div>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <window.Panel title="Target" padded>
          <ImportDeployTarget
            value="production"
            current={target}
            setCurrent={setTarget}
            label="Production"
            sub={`Live event stream for ${slug}. New runs use the new version immediately.`}
            tone="signal"
          />
          <ImportDeployTarget
            value="staging"
            current={target}
            setCurrent={setTarget}
            label="Staging"
            sub="v1: cosmetic only · same code path as production. Future: shadow runtime."
            tone="muted"
            hint="v1: cosmetic, future: shadow runtime"
          />
        </window.Panel>

        <window.Panel title="Note" subtitle="Optional · stored on deployment row" padded>
          <textarea
            value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))}
            placeholder={`e.g. "v2 rewrite — adds 3 retry agents, removes dead-letter hook"`}
            rows={4}
            style={{
              width: "100%",
              background: "var(--panel-2)",
              border: "1px solid var(--border-2)",
              borderRadius: 4,
              padding: "8px 10px",
              color: "var(--text)", fontFamily: "var(--sans)", fontSize: 12,
              outline: "none", resize: "vertical",
            }}
          />
          <div style={{
            marginTop: 4, fontSize: 10.5, fontFamily: "var(--mono)",
            color: "var(--text-3)", textAlign: "right",
          }}>{note.length}/500</div>
        </window.Panel>

        {commitError && (
          <div style={{
            padding: "10px 12px",
            background: "rgba(255,100,112,0.08)",
            border: "1px solid rgba(255,100,112,0.32)",
            borderRadius: 4,
            fontSize: 12, color: "var(--red)",
          }}>{commitError}</div>
        )}
      </div>

      <window.Panel title="Summary" padded>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <window.Stat label="Agents" value={parsed.agents} mono />
          <window.Stat label="Actions" value={parsed.actions} mono />
          <window.Stat
            label="Added"
            value={`+${(diff.added || []).length}`}
            mono accent="var(--green)"
          />
          <window.Stat
            label="Modified"
            value={`~${(diff.modified || []).length}`}
            mono accent="var(--amber)"
          />
          <window.Stat
            label="Removed"
            value={`−${(diff.removed || []).length}`}
            mono accent="var(--red)"
          />
          <window.Stat
            label="Tenant"
            value={slug}
            mono
          />
        </div>

        <div style={{
          marginTop: 14,
          padding: "10px 12px",
          background: "var(--panel-2)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.5,
        }}>
          Clicking <span style={{ color: "var(--text-2)" }}>Deploy</span> writes a new{" "}
          <span className="mono" style={{ color: "var(--text-2)" }}>workflow_versions</span>
          {" "}row, demotes the prior live deployment, persists the manifest to disk,
          and hot-swaps the Inngest function set for{" "}
          <span className="mono" style={{ color: "var(--text-2)" }}>{slug}</span>{" "}— no api restart needed.
        </div>

        {validation.deployment_id && (
          <div style={{
            marginTop: 10, fontSize: 10.5, fontFamily: "var(--mono)",
            color: "var(--text-3)",
          }}>
            session: {validation.deployment_id}
          </div>
        )}
      </window.Panel>
    </div>
  );
}

function ImportDeployTarget({ value, current, setCurrent, label, sub, tone, hint }) {
  const active = current === value;
  const accent = tone === "muted" ? "var(--border-3)" : "var(--signal)";
  return (
    <label
      title={hint}
      style={{
        display: "flex", alignItems: "flex-start", gap: 10,
        padding: "10px 12px",
        background: active ? "var(--panel-2)" : "transparent",
        border: `1px solid ${active ? accent : "var(--border)"}`,
        borderRadius: 4,
        cursor: "pointer",
        marginBottom: 6,
      }}
    >
      <input
        type="radio"
        name="im-target"
        checked={active}
        onChange={() => setCurrent(value)}
        style={{ accentColor: "var(--signal)", marginTop: 3 }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12.5, color: "var(--text)" }}>{label}</span>
          {tone === "muted" && hint && (
            <window.Badge tone="muted">{hint}</window.Badge>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{sub}</div>
      </div>
    </label>
  );
}

// ── Modal overlay ─────────────────────────────────────────────────────────

function ImportModalOverlay({ onClose, children }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.5)",
        display: "flex", justifyContent: "center", alignItems: "center",
        backdropFilter: "blur(2px)",
        animation: "fadein 0.14s ease",
      }}
    >
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

window.ImportManifestModal = ImportManifestModal;
