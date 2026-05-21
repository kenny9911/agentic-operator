// OverwriteConfirmModal — second-level confirmation for the Import Manifest
// wizard's Deploy step.
//
// Rendered when the commit endpoint returns 409 with
// { requires_confirmation: true, reason, diff, conflicts, prior }.
// Clicking "Overwrite and deploy" re-submits the commit with
// confirm_overwrite=true.
//
// Lives in its own babel file (per review M4) so components.jsx doesn't
// continue to bloat. SPA global-scope gotcha: every helper component name in
// this file is prefixed with "Ocm" so it cannot collide with another view's
// top-level helpers.

const { useMemo: useMemoOcm } = React;

function ocmHumanTime(ms) {
  if (!ms || typeof ms !== "number") return "—";
  try {
    const diff = Date.now() - ms;
    if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s ago`;
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return new Date(ms).toISOString().slice(0, 10);
  } catch (_e) {
    return "—";
  }
}

function OcmReasonChip({ reason }) {
  const text =
    reason === "removes_agents"
      ? "Removes one or more agents"
      : reason === "modifies_threshold"
        ? "Modifies a large fraction of the live workflow"
        : "Significant change";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "2px 7px",
      fontSize: 10.5, fontFamily: "var(--mono)",
      fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase",
      color: "var(--red)",
      background: "rgba(255,100,112,0.10)",
      border: "1px solid rgba(255,100,112,0.32)",
      borderRadius: 3,
      lineHeight: 1.4,
      whiteSpace: "nowrap",
    }}>
      {text}
    </span>
  );
}

function OcmIdList({ ids, tone }) {
  if (!ids || ids.length === 0) return null;
  const color =
    tone === "red" ? "var(--red)"
    : tone === "amber" ? "var(--amber)"
    : tone === "green" ? "var(--green)"
    : "var(--text-3)";
  return (
    <ul style={{ margin: 0, padding: "0 0 0 4px", listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
      {ids.map((id, i) => (
        <li key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          <span style={{
            display: "inline-block",
            width: 6, height: 6,
            borderRadius: "50%",
            background: color,
            flexShrink: 0,
          }} />
          <span className="mono" style={{ color: "var(--text)" }}>{String(id)}</span>
        </li>
      ))}
    </ul>
  );
}

function OverwriteConfirmModal({ data, onConfirm, onCancel, committing }) {
  const diff = (data && data.diff) || { added: [], removed: [], modified: [] };
  const prior = (data && data.prior) || {};
  const conflicts = (data && data.conflicts) || [];
  const reason = data && data.reason;

  const counts = useMemoOcm(() => ({
    added: (diff.added || []).length,
    removed: (diff.removed || []).length,
    modified: (diff.modified || []).length,
  }), [diff]);

  return (
    <div
      onClick={committing ? undefined : onCancel}
      style={{
        position: "fixed", inset: 0, zIndex: 110,
        background: "rgba(0,0,0,0.62)",
        display: "flex", justifyContent: "center", alignItems: "center",
        backdropFilter: "blur(2px)",
        animation: "fadein 0.14s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560, maxHeight: "82vh",
          background: "var(--panel)",
          border: "1px solid rgba(255,100,112,0.45)",
          borderRadius: 8,
          overflow: "hidden",
          display: "flex", flexDirection: "column",
          boxShadow: "0 24px 60px -20px rgba(0,0,0,0.7)",
        }}
      >
        <header
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            background: "rgba(255,100,112,0.06)",
          }}
        >
          <window.Icon name="alert" size={14} style={{ color: "var(--red)" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 500 }}>Replace live workflow?</div>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
              {prior.version_label ? (
                <>
                  Replacing live workflow{" "}
                  <span className="mono" style={{ color: "var(--text-2)" }}>{prior.version_label}</span>
                  {" "}(deployed {ocmHumanTime(prior.deployed_at)})
                </>
              ) : (
                <>Replacing the current live workflow.</>
              )}
            </div>
          </div>
          <button onClick={committing ? undefined : onCancel} disabled={committing} style={{ color: "var(--text-3)" }}>
            <window.Icon name="x" size={13} />
          </button>
        </header>

        <div style={{ padding: "16px 18px", overflow: "auto", flex: 1, minHeight: 0 }}>
          {reason && (
            <div style={{ marginBottom: 12 }}>
              <OcmReasonChip reason={reason} />
            </div>
          )}

          <div style={{
            display: "flex", flexWrap: "wrap", gap: 14,
            padding: "10px 12px",
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            borderRadius: 5,
            fontSize: 12,
            fontFamily: "var(--mono)",
            color: "var(--text-2)",
            marginBottom: 14,
          }}>
            <span>
              Will add <span style={{ color: "var(--green)" }}>{counts.added}</span>
            </span>
            <span style={{ color: "var(--text-4)" }}>·</span>
            <span>
              remove <span style={{ color: "var(--red)" }}>{counts.removed}</span>
            </span>
            <span style={{ color: "var(--text-4)" }}>·</span>
            <span>
              modify <span style={{ color: "var(--amber)" }}>{counts.modified}</span>
            </span>
            {typeof prior.agents === "number" && (
              <>
                <span style={{ color: "var(--text-4)" }}>·</span>
                <span style={{ color: "var(--text-3)" }}>prior had {prior.agents} agents</span>
              </>
            )}
          </div>

          {counts.removed > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{
                fontSize: 10.5, fontFamily: "var(--mono)",
                textTransform: "uppercase", letterSpacing: "0.08em",
                color: "var(--red)", marginBottom: 6,
              }}>Removed · {counts.removed}</div>
              <OcmIdList ids={diff.removed} tone="red" />
            </div>
          )}

          {counts.modified > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{
                fontSize: 10.5, fontFamily: "var(--mono)",
                textTransform: "uppercase", letterSpacing: "0.08em",
                color: "var(--amber)", marginBottom: 6,
              }}>Modified · {counts.modified}</div>
              <OcmIdList ids={diff.modified} tone="amber" />
            </div>
          )}

          {counts.added > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{
                fontSize: 10.5, fontFamily: "var(--mono)",
                textTransform: "uppercase", letterSpacing: "0.08em",
                color: "var(--green)", marginBottom: 6,
              }}>Added · {counts.added}</div>
              <OcmIdList ids={diff.added} tone="green" />
            </div>
          )}

          {conflicts && conflicts.length > 0 && (
            <div style={{
              marginTop: 10,
              padding: "10px 12px",
              background: "var(--panel-2)",
              border: "1px solid var(--border)",
              borderRadius: 5,
            }}>
              <div style={{
                fontSize: 10.5, fontFamily: "var(--mono)",
                textTransform: "uppercase", letterSpacing: "0.08em",
                color: "var(--text-3)", marginBottom: 8,
              }}>Conflicts · {conflicts.length}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {conflicts.map((c, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 11.5 }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      padding: "1px 6px",
                      fontSize: 9.5, fontFamily: "var(--mono)",
                      letterSpacing: "0.04em", textTransform: "uppercase",
                      color: c.severity === "block" ? "var(--red)" : "var(--amber)",
                      background: c.severity === "block"
                        ? "rgba(255,100,112,0.10)"
                        : "rgba(255,181,71,0.10)",
                      border: `1px solid ${c.severity === "block"
                        ? "rgba(255,100,112,0.32)"
                        : "rgba(255,181,71,0.32)"}`,
                      borderRadius: 3,
                      flexShrink: 0,
                    }}>{c.severity || "warn"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: "var(--text)" }}>{c.detail || c.type}</div>
                      {c.path && (
                        <div style={{ fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--text-3)", marginTop: 2 }}>
                          {c.path}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{
            marginTop: 14,
            padding: "10px 12px",
            background: "rgba(255,100,112,0.04)",
            border: "1px solid rgba(255,100,112,0.20)",
            borderRadius: 4,
            fontSize: 11.5,
            color: "var(--text-2)",
            lineHeight: 1.5,
          }}>
            The previous version will be demoted to <span className="mono" style={{ color: "var(--text)" }}>rolled_back</span>{" "}
            and remains in the deployments history. New runs will use the new manifest immediately.
          </div>
        </div>

        <footer style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "12px 18px",
          borderTop: "1px solid var(--border)",
          background: "var(--panel-2)",
        }}>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <window.Button tone="ghost" onClick={committing ? undefined : onCancel}>Cancel</window.Button>
            <button
              onClick={committing ? undefined : onConfirm}
              disabled={!!committing}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "5px 11px",
                fontSize: 12, fontFamily: "var(--sans)", fontWeight: 500,
                color: "#fff",
                background: committing ? "rgba(255,100,112,0.5)" : "var(--red)",
                border: `1px solid ${committing ? "rgba(255,100,112,0.5)" : "var(--red)"}`,
                borderRadius: 5,
                cursor: committing ? "not-allowed" : "pointer",
                opacity: committing ? 0.8 : 1,
                transition: "background 0.12s",
              }}
            >
              <window.Icon name="alert" size={11} />
              {committing ? "Deploying…" : "Overwrite and deploy"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

window.OverwriteConfirmModal = OverwriteConfirmModal;
