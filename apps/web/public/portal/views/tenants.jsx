// Agentic Operator — Tenants management view (P5-TEN-01).
//
// Three responsibilities:
//   1. List every tenant the operator can see, with badges for archived
//      and per-row roll-up counts.
//   2. Create new tenants via a 4-step wizard (Identity → Template → Quotas
//      → Review). Bootstrap API token shown ONCE, never again.
//   3. Edit / archive / restore an existing tenant.
//
// Conventions (see CLAUDE.md):
//   - Top-level component is `Tenants` (bare name; visible to app.jsx).
//   - All internal components are prefixed `Tenants*` to avoid the global
//     scope collision that bit us with `TreeNode` between views.
//   - Inline CSS-in-JS to match the design 1:1; no Tailwind.

const TENANTS_TENANT_SLUG_REGEX = /^[a-z][a-z0-9-]{1,31}$/;
const TENANTS_RESERVED = new Set([
  "__system", "system", "admin", "root", "api", "v1", "v2",
  "health", "metrics", "inngest", "_meta", "static", "public",
  "internal", "platform", "tenants", "new", "edit", "create",
  "delete", "archive",
]);
const TENANTS_DEFAULT_COLORS = [
  "#d0ff00", "#7c9eff", "#f5c46b", "#65e0a3",
  "#b594ff", "#ff6470", "#5deeff", "#ffb547",
];

function tenantsApi(path, opts = {}) {
  const init = {
    method: opts.method || "GET",
    headers: { "content-type": "application/json", accept: "application/json" },
    cache: "no-store",
  };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  if (opts.idempotencyKey) init.headers["idempotency-key"] = opts.idempotencyKey;
  return fetch(path, init).then(async (res) => {
    let body = null;
    try { body = await res.json(); } catch (_) { /* ignore */ }
    if (!res.ok || (body && body.ok === false)) {
      const msg = (body && body.error && body.error.message) || `HTTP ${res.status}`;
      const code = (body && body.error && body.error.code) || "request_failed";
      const e = new Error(msg);
      e.code = code;
      e.status = res.status;
      throw e;
    }
    return body && body.data !== undefined ? body.data : body;
  });
}

function Tenants({ navigate, params }) {
  const [list, setList] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [includeArchived, setIncludeArchived] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(!!params?.openCreate);
  const [editTarget, setEditTarget] = React.useState(null);
  const [archiveTarget, setArchiveTarget] = React.useState(null);
  const [tokenReveal, setTokenReveal] = React.useState(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await tenantsApi(
        `/v1/tenants${includeArchived ? "?include_archived=1" : ""}`,
      );
      setList(data.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [includeArchived]);

  React.useEffect(() => { refresh(); }, [refresh]);

  // After a mutation (create/update/archive/restore), broadcast so the
  // sidebar TenantSwitcher refreshes too.
  const notify = (kind, payload) => {
    window.dispatchEvent(new CustomEvent("agentic-tenants-updated", { detail: { kind, payload } }));
  };

  const onCreated = (created) => {
    setCreateOpen(false);
    if (created && created.token && created.token.plaintext) {
      setTokenReveal({
        slug: created.tenant.slug,
        name: created.tenant.name,
        token: created.token.plaintext,
        scopes: created.token.scopes,
      });
    }
    refresh();
    notify("create", created);
  };

  const onUpdated = (updated) => {
    setEditTarget(null);
    refresh();
    notify("update", updated);
  };

  const onArchived = (slug) => {
    setArchiveTarget(null);
    refresh();
    notify("archive", { slug });
  };

  const onRestored = async (slug) => {
    try {
      await tenantsApi(`/v1/tenants/${slug}/restore`, { method: "POST", body: {} });
      refresh();
      notify("restore", { slug });
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div style={{ height: "100%", overflow: "auto", padding: "20px 24px" }}>
      <ViewHeader
        title="Tenants"
        subtitle="Workspace boundaries — each tenant is an isolated stack of agents, workflows, events, runs, budgets, and audit trail."
        badge={
          <Badge tone="muted" style={{ fontFamily: "var(--mono)" }}>
            {list.length} {list.length === 1 ? "TENANT" : "TENANTS"}
          </Badge>
        }
        action={
          <Button tone="primary" icon="plus" onClick={() => setCreateOpen(true)}>
            New tenant
          </Button>
        }
      />

      <div style={{
        display: "flex", alignItems: "center", gap: 12, marginBottom: 14,
        fontSize: 12, color: "var(--text-3)",
      }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Show archived
        </label>
        <button
          onClick={refresh}
          style={{
            padding: "3px 8px", border: "1px solid var(--border-2)", borderRadius: 4,
            color: "var(--text-2)", fontSize: 11,
          }}>
          Refresh
        </button>
      </div>

      {error && (
        <div style={{
          padding: "8px 12px", marginBottom: 12,
          background: "rgba(255,100,112,0.08)", border: "1px solid rgba(255,100,112,0.3)",
          borderRadius: 4, color: "var(--red)", fontSize: 12,
        }}>{error}</div>
      )}

      {loading && list.length === 0 ? (
        <Empty title="Loading tenants…" hint="One moment." />
      ) : list.length === 0 ? (
        <Empty title="No tenants yet" hint='Click "New tenant" to provision the first one.' />
      ) : (
        <TenantsTable
          list={list}
          onOpen={(slug) => navigate("settings", { tenantSlug: slug })}
          onEdit={(t) => setEditTarget(t)}
          onArchive={(t) => setArchiveTarget(t)}
          onRestore={(slug) => onRestored(slug)}
        />
      )}

      {createOpen && (
        <TenantsCreateModal
          onClose={() => setCreateOpen(false)}
          onCreated={onCreated}
          existingSlugs={new Set(list.map((t) => t.slug))}
          existingTenants={list}
        />
      )}
      {editTarget && (
        <TenantsEditModal
          target={editTarget}
          onClose={() => setEditTarget(null)}
          onUpdated={onUpdated}
        />
      )}
      {archiveTarget && (
        <TenantsArchiveModal
          target={archiveTarget}
          onClose={() => setArchiveTarget(null)}
          onArchived={onArchived}
        />
      )}
      {tokenReveal && (
        <TenantsTokenRevealModal
          payload={tokenReveal}
          onClose={() => setTokenReveal(null)}
        />
      )}
    </div>
  );
}

function TenantsTable({ list, onOpen, onEdit, onArchive, onRestore }) {
  return (
    <div style={{
      background: "var(--panel)", border: "1px solid var(--border)",
      borderRadius: 6, overflow: "hidden",
    }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: "32px 1.2fr 1.4fr 80px 80px 80px 1fr 160px",
        gap: 12, padding: "10px 14px",
        borderBottom: "1px solid var(--border)",
        fontSize: 10, fontFamily: "var(--mono)", color: "var(--text-3)",
        textTransform: "uppercase", letterSpacing: "0.1em",
      }}>
        <div></div>
        <div>Tenant</div>
        <div>Description</div>
        <div style={{ textAlign: "right" }}>Agents</div>
        <div style={{ textAlign: "right" }}>Runs/24h</div>
        <div style={{ textAlign: "right" }}>Open tasks</div>
        <div>Created</div>
        <div></div>
      </div>
      {list.map((t) => (
        <TenantsRow
          key={t.slug}
          tenant={t}
          onOpen={() => onOpen(t.slug)}
          onEdit={() => onEdit(t)}
          onArchive={() => onArchive(t)}
          onRestore={() => onRestore(t.slug)}
        />
      ))}
    </div>
  );
}

function TenantsRow({ tenant, onOpen, onEdit, onArchive, onRestore }) {
  const archived = !!tenant.archivedAt;
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "32px 1.2fr 1.4fr 80px 80px 80px 1fr 160px",
      gap: 12, padding: "12px 14px",
      borderBottom: "1px solid var(--border)",
      alignItems: "center",
      opacity: archived ? 0.55 : 1,
    }}>
      <div style={{
        width: 22, height: 22, borderRadius: 4,
        background: tenant.color || "#6f7178",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#000", fontFamily: "var(--mono)", fontSize: 11, fontWeight: 700,
      }}>{tenant.name?.[0] || "?"}</div>
      <div>
        <button onClick={onOpen} style={{ color: "var(--text)", fontSize: 13, fontWeight: 500 }}>
          {tenant.name}
        </button>
        <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--text-3)" }}>
          {tenant.slug}
          {archived && (
            <Badge tone="amber" style={{ marginLeft: 8, fontSize: 9 }}>ARCHIVED</Badge>
          )}
        </div>
      </div>
      <div style={{ color: "var(--text-2)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {tenant.subtitle || <span style={{ color: "var(--text-4)" }}>—</span>}
      </div>
      <div style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 12, color: "var(--text)" }}>
        {tenant.agentCount}
      </div>
      <div style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 12, color: "var(--text)" }}>
        {tenant.runs24h}
      </div>
      <div style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 12, color: tenant.openTasks > 0 ? "var(--amber)" : "var(--text)" }}>
        {tenant.openTasks}
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 11, fontFamily: "var(--mono)" }}>
        {window.fmtAgo ? window.fmtAgo(tenant.createdAt) : new Date(tenant.createdAt).toLocaleDateString()}
      </div>
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        {!archived ? (
          <>
            <button
              onClick={onEdit}
              style={{
                padding: "3px 8px", border: "1px solid var(--border-2)", borderRadius: 4,
                fontSize: 11, color: "var(--text-2)",
              }}>Edit</button>
            <button
              onClick={onArchive}
              style={{
                padding: "3px 8px", border: "1px solid rgba(255,100,112,0.3)", borderRadius: 4,
                fontSize: 11, color: "var(--red)",
              }}>Archive</button>
          </>
        ) : (
          <button
            onClick={onRestore}
            style={{
              padding: "3px 8px", border: "1px solid var(--border-2)", borderRadius: 4,
              fontSize: 11, color: "var(--text-2)",
            }}>Restore</button>
        )}
      </div>
    </div>
  );
}

// ─── Create modal (4-step wizard) ───────────────────────────────────────────

function TenantsCreateModal({ onClose, onCreated, existingSlugs, existingTenants }) {
  const [step, setStep] = React.useState(1);
  const [submitting, setSubmitting] = React.useState(false);
  const [err, setErr] = React.useState(null);

  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugDirty, setSlugDirty] = React.useState(false);
  const [subtitle, setSubtitle] = React.useState("");
  const [color, setColor] = React.useState(TENANTS_DEFAULT_COLORS[0]);

  const [starter, setStarter] = React.useState("hello");
  const [copyFromSlug, setCopyFromSlug] = React.useState("");

  const [tokenCap, setTokenCap] = React.useState("");
  const [usdCap, setUsdCap] = React.useState("");
  const [mintToken, setMintToken] = React.useState(true);

  // Auto-derive slug from name until the user edits the slug field.
  React.useEffect(() => {
    if (slugDirty) return;
    const derived = name.toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/^[^a-z]/, "t");
    setSlug(derived.slice(0, 32));
  }, [name, slugDirty]);

  const slugIssues = (() => {
    const issues = [];
    if (!slug) issues.push("required");
    else {
      if (!TENANTS_TENANT_SLUG_REGEX.test(slug)) {
        issues.push("must start with a lowercase letter and contain only [a-z0-9-]");
      }
      if (TENANTS_RESERVED.has(slug)) issues.push("reserved");
      if (slug.startsWith("_") || slug.startsWith("-") || slug.endsWith("-")) {
        issues.push("cannot start/end with - or _");
      }
      if (existingSlugs.has(slug)) issues.push("already taken");
    }
    return issues;
  })();

  const canNextFrom1 = name.trim().length > 0 && slugIssues.length === 0;
  const canNextFrom2 = starter !== "" && (starter !== "copy-from" || !!copyFromSlug);
  const canNextFrom3 = true;

  async function submit() {
    setSubmitting(true);
    setErr(null);
    const body = {
      slug,
      name: name.trim(),
      subtitle: subtitle.trim() || undefined,
      color,
      starter: starter === "copy-from" ? `copy-from:${copyFromSlug}` : starter,
      mintToken,
      budget: {
        monthlyTokenCap: tokenCap === "" ? null : Number(tokenCap),
        monthlyUsdCap: usdCap === "" ? null : Number(usdCap) * 100,
      },
    };
    try {
      const idemKey = `ten-${slug}-${Date.now().toString(36)}`;
      const created = await tenantsApi("/v1/tenants", {
        method: "POST", body, idempotencyKey: idemKey,
      });
      onCreated(created);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <TenantsModalShell
      title={`New tenant · Step ${step} of 4`}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>
            {step === 1 && "Identity"}
            {step === 2 && "Template"}
            {step === 3 && "Quotas & budget"}
            {step === 4 && "Review & create"}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {step > 1 && (
              <button onClick={() => setStep(step - 1)}
                style={{ padding: "6px 12px", border: "1px solid var(--border-2)", borderRadius: 4, fontSize: 12, color: "var(--text-2)" }}>
                Back
              </button>
            )}
            {step < 4 && (
              <Button
                tone="primary"
                disabled={
                  (step === 1 && !canNextFrom1) ||
                  (step === 2 && !canNextFrom2) ||
                  (step === 3 && !canNextFrom3)
                }
                onClick={() => setStep(step + 1)}
              >Next</Button>
            )}
            {step === 4 && (
              <Button tone="primary" onClick={submit} disabled={submitting}>
                {submitting ? "Provisioning…" : "Create tenant"}
              </Button>
            )}
          </div>
        </div>
      }
    >
      {err && (
        <div style={{
          padding: "8px 12px", marginBottom: 12,
          background: "rgba(255,100,112,0.08)", border: "1px solid rgba(255,100,112,0.3)",
          borderRadius: 4, color: "var(--red)", fontSize: 12,
        }}>{err}</div>
      )}

      {step === 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <TenantsField label="Display name" hint="Shown in the sidebar switcher and tenant lists.">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Recruiting"
              style={tenantsInputStyle()}
            />
          </TenantsField>
          <TenantsField
            label="Slug"
            hint="Immutable. Used in URLs, log paths, and Inngest function IDs. [a-z][a-z0-9-]{1,31}"
            error={slugDirty && slugIssues.length > 0 ? slugIssues.join("; ") : null}
          >
            <input
              value={slug}
              onChange={(e) => { setSlug(e.target.value.toLowerCase()); setSlugDirty(true); }}
              placeholder="acme"
              style={{ ...tenantsInputStyle(), fontFamily: "var(--mono)" }}
            />
          </TenantsField>
          <TenantsField label="Subtitle" hint="Optional short description shown under the name.">
            <input
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="Recruitment-as-a-Service · Asia-Pac"
              style={tenantsInputStyle()}
            />
          </TenantsField>
          <TenantsField label="Accent color" hint="Used for the tenant avatar and accent strokes.">
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {TENANTS_DEFAULT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  style={{
                    width: 26, height: 26, borderRadius: 5,
                    background: c,
                    border: color === c ? "2px solid var(--text)" : "1px solid var(--border-2)",
                    cursor: "pointer",
                  }}
                  title={c}
                />
              ))}
              <input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                style={{ ...tenantsInputStyle(), width: 110, fontFamily: "var(--mono)", fontSize: 11 }}
              />
            </div>
          </TenantsField>
        </div>
      )}

      {step === 2 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <TenantsField label="Starter content" hint="Seed the new tenant with sample events / a cloned manifest, or start empty.">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <TenantsRadioRow
                checked={starter === "empty"}
                onChange={() => setStarter("empty")}
                title="Empty"
                body="Just the tenant row and a default budget. You'll deploy a workflow later via PUT /v1/tenants/:slug/workflow."
              />
              <TenantsRadioRow
                checked={starter === "hello"}
                onChange={() => setStarter("hello")}
                title="Hello (recommended)"
                body="Seeds TENANT_BOOTSTRAPPED + HELLO_WORLD event types so the dashboard isn't blank."
              />
              <TenantsRadioRow
                checked={starter === "copy-from"}
                onChange={() => setStarter("copy-from")}
                title="Copy from existing tenant"
                body="Clone the live manifest, event types, and entity types from another tenant."
              />
            </div>
            {starter === "copy-from" && (
              <select
                value={copyFromSlug}
                onChange={(e) => setCopyFromSlug(e.target.value)}
                style={{ ...tenantsInputStyle(), marginTop: 10 }}
              >
                <option value="">— pick a source tenant —</option>
                {existingTenants.filter((t) => !t.archivedAt).map((t) => (
                  <option key={t.slug} value={t.slug}>{t.name} ({t.slug})</option>
                ))}
              </select>
            )}
          </TenantsField>
        </div>
      )}

      {step === 3 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <TenantsField label="Monthly token cap" hint="Hard limit on input+output tokens charged through the LLM gateway. Empty = unlimited.">
            <input
              value={tokenCap}
              type="number" min="0"
              onChange={(e) => setTokenCap(e.target.value)}
              placeholder="e.g. 50000000"
              style={{ ...tenantsInputStyle(), fontFamily: "var(--mono)" }}
            />
          </TenantsField>
          <TenantsField label="Monthly USD cap" hint="Stored as integer cents. Empty = unlimited.">
            <input
              value={usdCap}
              type="number" min="0" step="0.01"
              onChange={(e) => setUsdCap(e.target.value)}
              placeholder="e.g. 500.00"
              style={{ ...tenantsInputStyle(), fontFamily: "var(--mono)" }}
            />
          </TenantsField>
          <TenantsField label="API token" hint="Issue a bootstrap token in the response. You can revoke it later from Settings → API keys.">
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-2)" }}>
              <input type="checkbox" checked={mintToken} onChange={(e) => setMintToken(e.target.checked)} />
              Mint a bootstrap token now (shown ONCE)
            </label>
          </TenantsField>
        </div>
      )}

      {step === 4 && (
        <div>
          <div style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--text-3)", marginBottom: 8 }}>REVIEW</div>
          <div style={{
            background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5,
            padding: 14, fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-2)",
            display: "flex", flexDirection: "column", gap: 6,
          }}>
            <TenantsKv k="name" v={name} />
            <TenantsKv k="slug" v={slug} />
            <TenantsKv k="subtitle" v={subtitle || "(none)"} />
            <TenantsKv k="color" v={color} />
            <TenantsKv k="starter" v={starter === "copy-from" ? `copy-from:${copyFromSlug}` : starter} />
            <TenantsKv k="monthly_token_cap" v={tokenCap === "" ? "unlimited" : tokenCap} />
            <TenantsKv k="monthly_usd_cap" v={usdCap === "" ? "unlimited" : `$${usdCap}`} />
            <TenantsKv k="mint_bootstrap_token" v={mintToken ? "yes" : "no"} />
          </div>
          <div style={{ marginTop: 14, fontSize: 11.5, color: "var(--text-3)" }}>
            Provisioning runs in a single DB transaction. On success you'll receive the bootstrap token
            (if requested) and the new tenant will appear in the sidebar.
          </div>
        </div>
      )}
    </TenantsModalShell>
  );
}

// ─── Edit modal ─────────────────────────────────────────────────────────────

function TenantsEditModal({ target, onClose, onUpdated }) {
  const [name, setName] = React.useState(target.name || "");
  const [subtitle, setSubtitle] = React.useState(target.subtitle || "");
  const [color, setColor] = React.useState(target.color || TENANTS_DEFAULT_COLORS[0]);
  const [submitting, setSubmitting] = React.useState(false);
  const [err, setErr] = React.useState(null);

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      const out = await tenantsApi(`/v1/tenants/${target.slug}`, {
        method: "PUT",
        body: { name, subtitle: subtitle || null, color },
      });
      onUpdated(out);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <TenantsModalShell
      title={`Edit tenant · ${target.slug}`}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "6px 12px", border: "1px solid var(--border-2)", borderRadius: 4, fontSize: 12, color: "var(--text-2)" }}>Cancel</button>
          <Button tone="primary" onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      {err && (
        <div style={{ padding: "8px 12px", marginBottom: 10, background: "rgba(255,100,112,0.08)", border: "1px solid rgba(255,100,112,0.3)", borderRadius: 4, color: "var(--red)", fontSize: 12 }}>{err}</div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <TenantsField label="Display name">
          <input value={name} onChange={(e) => setName(e.target.value)} style={tenantsInputStyle()} />
        </TenantsField>
        <TenantsField label="Subtitle">
          <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} style={tenantsInputStyle()} />
        </TenantsField>
        <TenantsField label="Accent color">
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {TENANTS_DEFAULT_COLORS.map((c) => (
              <button key={c} onClick={() => setColor(c)}
                style={{
                  width: 26, height: 26, borderRadius: 5, background: c,
                  border: color === c ? "2px solid var(--text)" : "1px solid var(--border-2)",
                }} title={c} />
            ))}
            <input value={color} onChange={(e) => setColor(e.target.value)}
              style={{ ...tenantsInputStyle(), width: 110, fontFamily: "var(--mono)", fontSize: 11 }} />
          </div>
        </TenantsField>
        <div style={{ fontSize: 11, color: "var(--text-3)" }}>
          Slug is immutable. To rename a tenant you must archive and recreate.
        </div>
      </div>
    </TenantsModalShell>
  );
}

// ─── Archive modal (with confirm-by-typing-slug) ────────────────────────────

function TenantsArchiveModal({ target, onClose, onArchived }) {
  const [confirm, setConfirm] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [err, setErr] = React.useState(null);

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      await tenantsApi(`/v1/tenants/${target.slug}`, {
        method: "DELETE", body: { confirm, reason: reason || undefined },
      });
      onArchived(target.slug);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <TenantsModalShell
      title={`Archive tenant · ${target.slug}`}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose}
            style={{ padding: "6px 12px", border: "1px solid var(--border-2)", borderRadius: 4, fontSize: 12, color: "var(--text-2)" }}>Cancel</button>
          <Button tone="danger" onClick={submit} disabled={submitting || confirm !== target.slug}>
            {submitting ? "Archiving…" : "Archive"}
          </Button>
        </div>
      }
    >
      {err && (
        <div style={{ padding: "8px 12px", marginBottom: 10, background: "rgba(255,100,112,0.08)", border: "1px solid rgba(255,100,112,0.3)", borderRadius: 4, color: "var(--red)", fontSize: 12 }}>{err}</div>
      )}
      <div style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 12, lineHeight: 1.5 }}>
        Archiving "{target.name}" hides it from the switcher and disables its API tokens, but
        preserves all rows for audit. You can restore later. Active runs and open tasks must be
        resolved first.
      </div>
      <TenantsField label={`Type "${target.slug}" to confirm`}>
        <input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={target.slug}
          style={{ ...tenantsInputStyle(), fontFamily: "var(--mono)" }}
          autoFocus
        />
      </TenantsField>
      <TenantsField label="Reason (optional)">
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          style={{ ...tenantsInputStyle(), resize: "vertical", minHeight: 60 }}
        />
      </TenantsField>
    </TenantsModalShell>
  );
}

// ─── Bootstrap token reveal modal ──────────────────────────────────────────

function TenantsTokenRevealModal({ payload, onClose }) {
  const [acked, setAcked] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  function copy() {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(payload.token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <TenantsModalShell
      title={`Bootstrap token · ${payload.name}`}
      onClose={() => { if (acked) onClose(); }}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-2)" }}>
            <input type="checkbox" checked={acked} onChange={(e) => setAcked(e.target.checked)} />
            I have stored this token securely
          </label>
          <Button tone="primary" disabled={!acked} onClick={onClose}>Dismiss</Button>
        </div>
      }
    >
      <div style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 12, lineHeight: 1.5 }}>
        This is the only time you'll see this token. Save it now. The hash is stored on the server;
        we cannot show the plaintext again.
      </div>
      <div style={{
        padding: 14, background: "var(--bg)", border: "1px solid var(--border-2)",
        borderRadius: 5, marginBottom: 10,
        fontFamily: "var(--mono)", fontSize: 12, wordBreak: "break-all",
        position: "relative",
      }}>
        {payload.token}
        <button
          onClick={copy}
          style={{
            position: "absolute", top: 8, right: 8,
            padding: "3px 8px", background: copied ? "var(--signal)" : "var(--panel-2)",
            color: copied ? "#000" : "var(--text-2)",
            border: "1px solid var(--border-2)", borderRadius: 4,
            fontSize: 10, fontFamily: "var(--mono)",
          }}
        >{copied ? "COPIED" : "COPY"}</button>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>
        Scopes: {(payload.scopes || []).join(", ")}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 14 }}>
        Use it as:
        <pre style={{ background: "var(--bg)", padding: 8, marginTop: 4, fontSize: 10.5, color: "var(--text-2)", overflow: "auto", borderRadius: 4 }}>
{`curl -H "Authorization: Bearer ${payload.token}" \\
  http://localhost:3501/v1/agents`}
        </pre>
      </div>
    </TenantsModalShell>
  );
}

// ─── Layout primitives (modal shell, field, radio row, kv) ──────────────────

function TenantsModalShell({ title, children, footer, onClose }) {
  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 200,
      animation: "fadein 0.12s ease-out",
    }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560, maxWidth: "92vw", maxHeight: "85vh",
          display: "flex", flexDirection: "column",
          background: "var(--panel)", border: "1px solid var(--border-2)",
          borderRadius: 6, boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
        }}>
        <div style={{
          padding: "14px 18px", borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>{title}</div>
          <button onClick={onClose} style={{ color: "var(--text-3)", padding: 4 }}>
            <Icon name="close" size={12} />
          </button>
        </div>
        <div style={{ padding: "16px 18px", overflowY: "auto", flex: 1 }}>{children}</div>
        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)" }}>{footer}</div>
      </div>
    </div>
  );
}

function TenantsField({ label, hint, error, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
      {children}
      {error && <div style={{ fontSize: 11, color: "var(--red)" }}>{error}</div>}
      {hint && !error && <div style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

function TenantsRadioRow({ checked, onChange, title, body }) {
  return (
    <button onClick={onChange} style={{
      display: "flex", gap: 10, alignItems: "flex-start",
      padding: 10, textAlign: "left", width: "100%",
      background: checked ? "var(--panel-2)" : "transparent",
      border: `1px solid ${checked ? "var(--signal)" : "var(--border-2)"}`,
      borderRadius: 5,
    }}>
      <div style={{
        width: 14, height: 14, borderRadius: "50%",
        border: `2px solid ${checked ? "var(--signal)" : "var(--border-3)"}`,
        background: checked ? "var(--signal)" : "transparent",
        flexShrink: 0, marginTop: 2,
      }} />
      <div>
        <div style={{ fontSize: 13, color: "var(--text)" }}>{title}</div>
        <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2, lineHeight: 1.45 }}>{body}</div>
      </div>
    </button>
  );
}

function TenantsKv({ k, v }) {
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <div style={{ color: "var(--text-3)", width: 180, flexShrink: 0 }}>{k}</div>
      <div style={{ color: "var(--text)" }}>{String(v)}</div>
    </div>
  );
}

function tenantsInputStyle() {
  return {
    padding: "7px 10px",
    background: "var(--bg)",
    border: "1px solid var(--border-2)",
    borderRadius: 4,
    color: "var(--text)",
    fontSize: 13,
    fontFamily: "var(--sans)",
    width: "100%",
  };
}
