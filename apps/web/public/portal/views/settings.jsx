// Settings — workspace, members, credentials, integrations, models, quotas, audit, danger

const { useState: useStateS, useMemo: useMemoS } = React;

// ----- Mock data (settings-specific) -----
const SETTINGS_MEMBERS = [
  { id: "u1", name: "Liu Wei",       email: "liu.wei@agentic.local",        role: "Owner",    last: Date.now() - 2 * 60_000,    avatar: "LW", color: "#b594ff" },
  { id: "u2", name: "Chen Mengjie",  email: "chen.mj@agentic.local",        role: "Admin",    last: Date.now() - 19 * 60_000,   avatar: "CM", color: "#84a9ff" },
  { id: "u3", name: "Wu Hao",        email: "wu.hao@agentic.local",         role: "Operator", last: Date.now() - 6 * 60_000,    avatar: "WH", color: "#65e0a3" },
  { id: "u4", name: "Sun Yufei",     email: "sun.yufei@agentic.local",      role: "Operator", last: Date.now() - 3 * 3600_000,  avatar: "SY", color: "#ffb547" },
  { id: "u5", name: "Zhang Lina",    email: "zhang.lina@agentic.local",     role: "Viewer",   last: Date.now() - 8 * 3600_000,  avatar: "ZL", color: "#d0ff00" },
  { id: "u6", name: "Ops Pipeline",  email: "ops@agentic.local",            role: "Service",  last: Date.now() - 12 * 60_000,   avatar: "OP", color: "#6f7178" },
  { id: "u7", name: "Inngest Bridge",email: "svc-inngest@agentic.local",    role: "Service",  last: Date.now() - 4 * 60_000,    avatar: "IN", color: "#6f7178" },
];

const SETTINGS_KEYS = [
  { id: "k1", label: "raas-prod / runtime",       prefix: "sk_live_a7f2",    scopes: ["agents:run", "events:emit", "runs:read"], created: Date.now() - 38*86_400_000, lastUsed: Date.now() - 12_000,   author: "Liu Wei" },
  { id: "k2", label: "raas-prod / read-only",     prefix: "sk_live_b91c",    scopes: ["runs:read", "events:read"],                created: Date.now() - 14*86_400_000, lastUsed: Date.now() - 4*60_000, author: "Chen Mengjie" },
  { id: "k3", label: "ci-cd / deploy",            prefix: "sk_live_c44e",    scopes: ["deploy:write", "agents:read"],             created: Date.now() - 6*86_400_000,  lastUsed: Date.now() - 22*60_000,author: "Ops" },
  { id: "k4", label: "grafana / read-only",       prefix: "sk_live_d10a",    scopes: ["metrics:read"],                            created: Date.now() - 92*86_400_000, lastUsed: Date.now() - 53*60_000,author: "Liu Wei", expiring: 7 },
];

const SETTINGS_INTEGRATIONS = [
  { id: "anthropic", name: "Anthropic",  kind: "Model provider", status: "ok",    detail: "claude-sonnet-4-5 · claude-haiku-4-5",       monthly: "$1,824 / mo" },
  { id: "openai",    name: "OpenAI",     kind: "Model provider", status: "ok",    detail: "gpt-4.1-mini (fallback only)",                monthly: "$84 / mo" },
  { id: "openrouter",name: "OpenRouter", kind: "Model provider", status: "ok",    detail: "Multi-model gateway",                         monthly: "—" },
  { id: "inngest",   name: "Inngest",    kind: "Event runtime",  status: "ok",    detail: "raas-worker · 3 workers · 0 lag",             monthly: "—" },
  { id: "boss",      name: "BOSS Zhipin",kind: "Channel · helper", status: "ok",  detail: "Helper-page render only (no API)",            monthly: "—" },
  { id: "zhilian",   name: "Zhilian",    kind: "Channel · API",  status: "ok",    detail: "zhilian.api · OAuth refreshed 2h ago",        monthly: "—" },
  { id: "liepin",    name: "Liepin",     kind: "Channel · API",  status: "warn",  detail: "Quota: 18 of 20 posts used today",            monthly: "—" },
  { id: "wechat",    name: "WeChat Work",kind: "Notification",   status: "ok",    detail: "Bot · 12 routes",                             monthly: "—" },
  { id: "ses",       name: "AWS SES",    kind: "Email",          status: "ok",    detail: "noreply@raas.agentic.local",                  monthly: "$8 / mo" },
  { id: "tencent",   name: "Tencent ATS",kind: "Client portal",  status: "err",   detail: "TLS cert expired 04:11 — renew",              monthly: "—" },
  { id: "github",    name: "GitHub",     kind: "Source",         status: "ok",    detail: "agentic/raas-workflows · 4 branches tracked", monthly: "—" },
];

const SETTINGS_QUOTAS = [
  { tenant: "RAAS",        concurrency: { used: 47, cap: 80 },  tokens24h: { used: 4.21e6, cap: 8e6 },  spend30d: { used: 1924, cap: 4000 } },
  { tenant: "SupportFlow", concurrency: { used: 8,  cap: 24 },  tokens24h: { used: 0.62e6, cap: 2e6 },  spend30d: { used: 318,  cap: 1000 } },
  { tenant: "FinanceClose",concurrency: { used: 2,  cap: 12 },  tokens24h: { used: 0.11e6, cap: 1e6 },  spend30d: { used: 42,   cap: 500  } },
];

const SETTINGS_AUDIT = [
  { at: Date.now() - 5*60_000,    actor: "Liu Wei",     action: "deploy.live",   target: "raas@2026.05.16-a",          ip: "10.42.7.18" },
  { at: Date.now() - 22*60_000,   actor: "Liu Wei",     action: "deploy.rollback", target: "raas@2026.05.16",          ip: "10.42.7.18" },
  { at: Date.now() - 41*60_000,   actor: "Chen Mengjie",action: "task.approve",  target: "TASK-9011 → REQ-2041",       ip: "10.42.7.22" },
  { at: Date.now() - 2*3600_000,  actor: "Liu Wei",     action: "settings.update", target: "models.fallback_chain",    ip: "10.42.7.18" },
  { at: Date.now() - 4*3600_000,  actor: "Ops",         action: "key.rotate",    target: "sk_live_c44e",               ip: "10.42.9.4"  },
  { at: Date.now() - 6*3600_000,  actor: "Liu Wei",     action: "member.invite", target: "zhang.lina@agentic.local",   ip: "10.42.7.18" },
  { at: Date.now() - 22*3600_000, actor: "Chen Mengjie",action: "integration.connect", target: "github → agentic/raas-workflows", ip: "10.42.7.22" },
  { at: Date.now() - 2*86_400_000,actor: "Liu Wei",     action: "member.role",   target: "Wu Hao: Viewer → Operator",  ip: "10.42.7.18" },
];

const SETTINGS_SECTIONS = [
  { id: "general",       label: "General",          icon: "settings",  hint: "Workspace, locale, region" },
  { id: "members",       label: "Members & access", icon: "human",     hint: "RBAC, invites" },
  { id: "keys",          label: "API keys",         icon: "code",      hint: "Tokens & scopes" },
  { id: "integrations",  label: "Integrations",     icon: "external",  hint: "Models, channels, ATS" },
  { id: "models",        label: "Models",           icon: "spark",     hint: "Fleet & fallback chain" },
  { id: "usage",         label: "Usage & costs",    icon: "dashboard", hint: "LLM spend & token breakdown" },
  { id: "quotas",        label: "Quotas & limits",  icon: "filter",    hint: "Per-tenant concurrency, $" },
  { id: "audit",         label: "Audit log",        icon: "logs",      hint: "Recent admin actions" },
  { id: "danger",        label: "Danger zone",      icon: "alert",     hint: "Destructive actions" },
];

// =====================================================
// Top-level Settings view
// =====================================================
function Settings({ navigate, params, tweaks, setTweak, models, setModels }) {
  const initial = params?.section || "general";
  const [section, setSection] = useStateS(initial);

  const sec = SETTINGS_SECTIONS.find(s => s.id === section) || SETTINGS_SECTIONS[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ViewHeader
        title="Settings"
        subtitle={<>Workspace <span className="mono" style={{ color: "var(--text)" }}>agentic-operator</span> · region <span className="mono" style={{ color: "var(--text)" }}>cn-shenzhen-1</span> · operator <span style={{ color: "var(--text)" }}>Liu Wei</span> (Owner)</>}
        badge={<Badge tone="muted">v0.6.2</Badge>}
        action={[
          <Button key="docs" small icon="external" tone="ghost">Settings docs</Button>,
          <Button key="exp" small icon="upload">Export config</Button>,
        ]}
      />

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "232px 1fr", minHeight: 0 }}>
        {/* Section nav */}
        <aside style={{ borderRight: "1px solid var(--border)", overflow: "auto", padding: "14px 10px", background: "var(--bg-2)" }}>
          {SETTINGS_SECTIONS.map(s => (
            <SectionNavItem key={s.id} section={s} active={s.id === section} onClick={() => setSection(s.id)} />
          ))}
        </aside>

        {/* Section body */}
        <div style={{ overflow: "auto", minHeight: 0 }}>
          <div style={{ padding: 24, maxWidth: 1080 }}>
            <SectionHeader section={sec} />
            {section === "general"       && <GeneralSection tweaks={tweaks} setTweak={setTweak} />}
            {section === "members"       && <MembersSection />}
            {section === "keys"          && <KeysSection />}
            {section === "integrations"  && <IntegrationsSection />}
            {section === "models"        && <ModelsSection models={models} setModels={setModels} />}
            {section === "usage"         && <UsageSection />}
            {section === "quotas"        && <QuotasSection />}
            {section === "audit"         && <AuditSection />}
            {section === "danger"        && <DangerSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionNavItem({ section, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 10,
      width: "100%",
      padding: "8px 10px",
      marginBottom: 2,
      background: active ? "var(--panel-2)" : "transparent",
      borderLeft: `2px solid ${active ? "var(--signal)" : "transparent"}`,
      borderRadius: 4,
      textAlign: "left",
      cursor: "pointer",
      transition: "background 0.1s",
    }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = "var(--panel)"; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
    >
      <Icon name={section.icon} size={13} style={{ color: active ? "var(--text)" : "var(--text-3)" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: active ? "var(--text)" : "var(--text-2)", fontWeight: active ? 500 : 400 }}>{section.label}</div>
        <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{section.hint}</div>
      </div>
    </button>
  );
}

function SectionHeader({ section }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Icon name={section.icon} size={14} style={{ color: "var(--signal)" }} />
        <span style={{ fontSize: 11, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-3)" }}>Settings · {section.label}</span>
      </div>
      <h2 style={{ margin: 0, fontSize: 26, fontFamily: "var(--display)", fontWeight: 400, letterSpacing: "-0.01em", color: "var(--text)" }}>{section.label}</h2>
      <div style={{ marginTop: 4, fontSize: 12.5, color: "var(--text-2)" }}>{section.hint}</div>
    </div>
  );
}

// =====================================================
// Reusable form atoms (settings-local)
// =====================================================
function Field({ label, hint, children, locked, right }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 16, padding: "14px 0", borderBottom: "1px solid var(--border)" }}>
      <div style={{ paddingTop: 5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--text)" }}>
          {label}
          {locked && <Icon name="check" size={10} style={{ color: "var(--text-4)" }} />}
        </div>
        {hint && <div style={{ marginTop: 3, fontSize: 11, color: "var(--text-3)", lineHeight: 1.5 }}>{hint}</div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
        {right}
      </div>
    </div>
  );
}

function TextIn({ value, onChange, placeholder, mono, suffix, prefix }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--panel-2)", border: "1px solid var(--border-2)", borderRadius: 5, padding: "6px 9px" }}>
      {prefix && <span style={{ fontSize: 12, color: "var(--text-3)", fontFamily: "var(--mono)" }}>{prefix}</span>}
      <input
        value={value}
        onChange={e => onChange?.(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1,
          background: "transparent", border: "none", outline: "none",
          color: "var(--text)",
          fontFamily: mono ? "var(--mono)" : "var(--sans)",
          fontSize: mono ? 12 : 12.5,
          minWidth: 0,
        }}
      />
      {suffix && <span style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--mono)" }}>{suffix}</span>}
    </div>
  );
}

function SelectIn({ value, onChange, options }) {
  return (
    <select value={value} onChange={e => onChange?.(e.target.value)} style={{
      background: "var(--panel-2)", border: "1px solid var(--border-2)", borderRadius: 5,
      padding: "6px 9px", color: "var(--text)", fontSize: 12.5, fontFamily: "var(--sans)",
      outline: "none", cursor: "pointer", appearance: "none",
      backgroundImage: "linear-gradient(45deg, transparent 50%, var(--text-3) 50%), linear-gradient(135deg, var(--text-3) 50%, transparent 50%)",
      backgroundPosition: "calc(100% - 14px) 50%, calc(100% - 10px) 50%",
      backgroundSize: "4px 4px, 4px 4px",
      backgroundRepeat: "no-repeat",
      paddingRight: 26,
    }}>
      {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
    </select>
  );
}

function Toggle({ value, onChange }) {
  return (
    <button onClick={() => onChange?.(!value)} style={{
      width: 36, height: 20,
      borderRadius: 10,
      background: value ? "var(--signal)" : "var(--panel-3)",
      border: `1px solid ${value ? "var(--signal)" : "var(--border-2)"}`,
      position: "relative", cursor: "pointer",
      transition: "background 0.12s",
    }}>
      <span style={{
        position: "absolute", top: 1, left: value ? 17 : 1,
        width: 16, height: 16, borderRadius: "50%",
        background: value ? "#000" : "var(--text-3)",
        transition: "left 0.12s",
      }} />
    </button>
  );
}

function CardRow({ children, style }) {
  return (
    <div style={{
      display: "grid", alignItems: "center", gap: 14,
      padding: "12px 14px",
      borderBottom: "1px solid var(--border)",
      ...style,
    }}>{children}</div>
  );
}

function StatusPill({ status }) {
  const map = {
    ok:   { tone: "green", label: "CONNECTED" },
    warn: { tone: "amber", label: "DEGRADED" },
    err:  { tone: "red",   label: "ERROR" },
    off:  { tone: "muted", label: "DISCONNECTED" },
  };
  const t = map[status] || map.off;
  return <Badge tone={t.tone}><StatusDot status={status === "ok" ? "ok" : status === "warn" ? "waiting" : status === "err" ? "failed" : "idle"} size={5} /> {t.label}</Badge>;
}

function RoleBadge({ role }) {
  const map = {
    Owner:    { tone: "signal" },
    Admin:    { tone: "violet" },
    Operator: { tone: "blue" },
    Viewer:   { tone: "muted" },
    Service:  { tone: "amber" },
  };
  return <Badge tone={(map[role] || map.Viewer).tone}>{role}</Badge>;
}

// =====================================================
// 1. General
// =====================================================
function GeneralSection({ tweaks, setTweak }) {
  const [name, setName] = useStateS("agentic-operator");
  const [display, setDisplay] = useStateS("Agentic Operator · RAAS");
  const [region, setRegion] = useStateS("cn-shenzhen-1");
  const [tz, setTz] = useStateS("Asia/Shanghai (UTC+08:00)");
  const [retention, setRetention] = useStateS("30");
  const [piiMask, setPiiMask] = useStateS(true);
  const [strict, setStrict] = useStateS(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Panel title="Workspace" padded>
        <Field label="Workspace ID" hint="Used in URLs and API endpoints. Cannot be changed once set." locked>
          <TextIn value={name} mono onChange={setName} />
        </Field>
        <Field label="Display name" hint="Shown in the sidebar and audit log.">
          <TextIn value={display} onChange={setDisplay} />
        </Field>
        <Field label="Region" hint="Workers and event storage run in this region. Moving regions requires re-deploy.">
          <SelectIn value={region} onChange={setRegion} options={[
            "cn-shenzhen-1", "cn-shanghai-2", "cn-beijing-3", "ap-singapore-1", "us-east-1",
          ]} />
        </Field>
        <Field label="Timezone" hint="Used for dashboards, audit log, and scheduled triggers.">
          <SelectIn value={tz} onChange={setTz} options={[
            "Asia/Shanghai (UTC+08:00)", "Asia/Singapore (UTC+08:00)", "America/Los_Angeles (UTC-07:00)", "UTC",
          ]} />
        </Field>
        <Field label="Default tenant" hint="Where new sessions land. Members can override per-browser.">
          <SelectIn value={tweaks?.tenant || "raas"} onChange={v => setTweak?.("tenant", v)} options={window.TENANTS.map(t => ({ value: t.id, label: t.name }))} />
        </Field>
      </Panel>

      <Panel title="Data retention & privacy" padded>
        <Field label="Run & event retention" hint="How long full payloads are kept. Metrics are kept forever.">
          <div style={{ display: "flex", gap: 8 }}>
            <TextIn value={retention} mono suffix="days" onChange={setRetention} />
          </div>
        </Field>
        <Field label="Mask PII in logs" hint="Email, phone and ID-card numbers are redacted in stored log lines.">
          <Toggle value={piiMask} onChange={setPiiMask} />
        </Field>
        <Field label="Strict schema validation" hint="Reject events whose payload doesn't match the agent's declared schema (recommended in prod).">
          <Toggle value={strict} onChange={setStrict} />
        </Field>
      </Panel>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Button tone="ghost">Discard</Button>
        <Button tone="primary" icon="check">Save changes</Button>
      </div>
    </div>
  );
}

// =====================================================
// 2. Members & access
// =====================================================
function MembersSection() {
  const [q, setQ] = useStateS("");
  const [filter, setFilter] = useStateS("all");
  const rows = SETTINGS_MEMBERS.filter(m =>
    (filter === "all" || (filter === "service" ? m.role === "Service" : m.role !== "Service"))
    && (!q || m.name.toLowerCase().includes(q.toLowerCase()) || m.email.toLowerCase().includes(q.toLowerCase()))
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Role legend */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 1, background: "var(--border)", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
        {[
          { role: "Owner",    perms: "Everything · billing · destroy" },
          { role: "Admin",    perms: "Deploy · members · keys" },
          { role: "Operator", perms: "Run · approve tasks · view" },
          { role: "Viewer",   perms: "Read-only across workspace" },
          { role: "Service",  perms: "Machine accounts (CI, bots)" },
        ].map(r => (
          <div key={r.role} style={{ padding: "10px 12px", background: "var(--panel)" }}>
            <div style={{ marginBottom: 5 }}><RoleBadge role={r.role} /></div>
            <div style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.45 }}>{r.perms}</div>
          </div>
        ))}
      </div>

      <Panel
        title={`Members · ${rows.length}`}
        padded={false}
        action={<div style={{ display: "flex", gap: 6 }}>
          <Button small icon="upload" tone="ghost">Import CSV</Button>
          <Button small icon="plus" tone="primary">Invite</Button>
        </div>}
      >
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "center" }}>
          <SearchInput value={q} onChange={setQ} placeholder="name or email…" />
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>All</FilterChip>
          <FilterChip active={filter === "human"} onClick={() => setFilter("human")}>People</FilterChip>
          <FilterChip active={filter === "service"} onClick={() => setFilter("service")}>Service</FilterChip>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <Th>Member</Th>
              <Th>Role</Th>
              <Th>Last active</Th>
              <Th>2FA</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(m => (
              <tr key={m.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <Td>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 26, height: 26, borderRadius: "50%", background: m.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 600, color: "#000" }}>{m.avatar}</div>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ color: "var(--text)" }}>{m.name}</span>
                      <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>{m.email}</span>
                    </div>
                  </div>
                </Td>
                <Td><RoleBadge role={m.role} /></Td>
                <Td><span style={{ color: "var(--text-3)" }}>{window.fmtAgo(m.last)}</span></Td>
                <Td>
                  {m.role === "Service" ? <span style={{ fontSize: 11, color: "var(--text-4)" }}>n/a</span> :
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: m.role === "Viewer" ? "var(--amber)" : "var(--green)" }}>
                      <Icon name={m.role === "Viewer" ? "alert" : "check"} size={10} />
                      {m.role === "Viewer" ? "Required" : "Enabled"}
                    </span>}
                </Td>
                <Td style={{ textAlign: "right" }}>
                  <div style={{ display: "inline-flex", gap: 4 }}>
                    <Button small tone="ghost">Change role</Button>
                    <Button small tone="ghost">Revoke</Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="SSO & domain" padded>
        <Field label="SSO provider" hint="All non-service members must sign in via SSO.">
          <SelectIn value="Okta SAML 2.0" options={["Okta SAML 2.0", "Google Workspace", "Azure AD", "None (password)"]} />
        </Field>
        <Field label="Allowed email domains" hint="Members outside these domains can't be invited."
          right={<Button small icon="plus" tone="ghost">Add</Button>}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["agentic.local", "tencent-raas.com"].map(d => (
              <span key={d} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 8px", background: "var(--panel-2)", border: "1px solid var(--border-2)", borderRadius: 3, fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-2)" }}>
                {d}
                <Icon name="x" size={9} style={{ color: "var(--text-3)", cursor: "pointer" }} />
              </span>
            ))}
          </div>
        </Field>
        <Field label="Session timeout" hint="Sign out inactive sessions automatically.">
          <SelectIn value="8 hours" options={["1 hour", "4 hours", "8 hours", "24 hours", "Never"]} />
        </Field>
      </Panel>
    </div>
  );
}

// =====================================================
// 3. API keys
// =====================================================
function KeysSection() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Panel
        title="Workspace API keys"
        subtitle="Use these to call the runtime from CI, scripts, or downstream services."
        padded={false}
        action={<Button small icon="plus" tone="primary">New key</Button>}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <Th>Label</Th>
              <Th>Key prefix</Th>
              <Th>Scopes</Th>
              <Th>Created</Th>
              <Th>Last used</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {SETTINGS_KEYS.map(k => (
              <tr key={k.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <Td>
                  <div style={{ color: "var(--text)" }}>{k.label}</div>
                  <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>by {k.author}</div>
                </Td>
                <Td>
                  <span className="mono" style={{ fontSize: 12, color: "var(--text-2)" }}>{k.prefix}<span style={{ color: "var(--text-4)" }}>•••••••••••••</span></span>
                </Td>
                <Td>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {k.scopes.map(s => <Badge key={s} tone="muted">{s}</Badge>)}
                  </div>
                </Td>
                <Td><span style={{ color: "var(--text-3)" }}>{window.fmtAgo(k.created)}</span></Td>
                <Td>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ color: "var(--text-2)" }}>{window.fmtAgo(k.lastUsed)}</span>
                    {k.expiring && <span style={{ fontSize: 10.5, color: "var(--amber)" }}>Expires in {k.expiring}d</span>}
                  </div>
                </Td>
                <Td style={{ textAlign: "right" }}>
                  <div style={{ display: "inline-flex", gap: 4 }}>
                    <Button small tone="ghost">Rotate</Button>
                    <Button small tone="ghost">Revoke</Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="CLI authentication" padded>
        <div style={{ fontSize: 12.5, color: "var(--text-2)", marginBottom: 10, lineHeight: 1.55 }}>
          Authenticate the <span className="mono">agentic</span> CLI for shell deploys and tail logs.
        </div>
        <CodeBlock>{`$ agentic login \\
    --workspace agentic-operator \\
    --region cn-shenzhen-1

→ Open this URL in your browser:
  https://agentic.local/auth/cli?code=GTCN-7K2P-49AX

✓ Authenticated as Liu Wei
✓ Token saved to ~/.agentic/credentials (mode 0600)`}</CodeBlock>
      </Panel>

      <Panel title="IP allow-list" padded
        action={<Button small icon="plus" tone="ghost">Add range</Button>}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { cidr: "10.42.0.0/16",  note: "Office VPN — Shenzhen" },
            { cidr: "203.0.113.0/24",note: "Tencent ATS callback range" },
            { cidr: "0.0.0.0/0",     note: "Public — disabled in prod", off: true },
          ].map(r => (
            <div key={r.cidr} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 4 }}>
              <Icon name="dot" size={8} style={{ color: r.off ? "var(--text-4)" : "var(--green)" }} />
              <span className="mono" style={{ fontSize: 12, color: r.off ? "var(--text-4)" : "var(--text)" }}>{r.cidr}</span>
              <span style={{ flex: 1, fontSize: 11.5, color: "var(--text-3)" }}>{r.note}</span>
              {r.off && <Badge tone="muted">disabled</Badge>}
              <Icon name="x" size={11} style={{ color: "var(--text-3)", cursor: "pointer" }} />
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

// =====================================================
// 4. Integrations
// =====================================================
function IntegrationsSection() {
  const grouped = useMemoS(() => {
    const g = {};
    SETTINGS_INTEGRATIONS.forEach(i => { (g[i.kind] = g[i.kind] || []).push(i); });
    return g;
  }, []);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {Object.entries(grouped).map(([kind, items]) => (
        <Panel key={kind} title={kind} padded={false}
          action={<Button small icon="plus" tone="ghost">Connect</Button>}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 1, background: "var(--border)" }}>
            {items.map(i => (
              <div key={i.id} style={{ padding: "14px 16px", background: "var(--panel)", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IntegrationGlyph id={i.id} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, color: "var(--text)", fontWeight: 500 }}>{i.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.detail}</div>
                  </div>
                  <StatusPill status={i.status} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 4, borderTop: "1px dashed var(--border)" }}>
                  <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--text-3)" }}>{i.monthly}</span>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                    <Button small tone="ghost">Configure</Button>
                    {i.status === "err" && <Button small tone="primary">Renew</Button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ))}
    </div>
  );
}

function IntegrationGlyph({ id }) {
  const colors = { anthropic: "#d97757", openai: "#10a37f", inngest: "#52525b", boss: "#3ed5a5", zhilian: "#1b75ff", liepin: "#ff6432", wechat: "#07c160", ses: "#ff9900", tencent: "#0052d9", github: "#6e7681" };
  const letter = id[0].toUpperCase();
  return (
    <div style={{ width: 30, height: 30, borderRadius: 6, background: colors[id] || "var(--panel-3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0, fontFamily: "var(--mono)" }}>
      {letter}
    </div>
  );
}

// =====================================================
// 5. Models
// =====================================================

const PROVIDERS = [
  {
    id: "anthropic", name: "Anthropic", color: "#d97757",
    endpoint: "https://api.anthropic.com",
    keyPrefix: "sk-ant-api03-",
    keyMasked: "sk-ant-api03-PfV4...8nQz",
    keyLast4: "8nQz",
    setBy: "Liu Wei",
    setAt: Date.now() - 14 * 86_400_000,
    lastUsed: Date.now() - 9_000,
    headerName: "x-api-key",
    docs: "https://console.anthropic.com/settings/keys",
    healthy: true,
    monthlySpend: 1824,
  },
  {
    id: "openai", name: "OpenAI", color: "#10a37f",
    endpoint: "https://api.openai.com/v1",
    keyPrefix: "sk-proj-",
    keyMasked: "sk-proj-1xK9...rT2A",
    keyLast4: "rT2A",
    setBy: "Ops",
    setAt: Date.now() - 38 * 86_400_000,
    lastUsed: Date.now() - 53 * 60_000,
    headerName: "Authorization: Bearer",
    docs: "https://platform.openai.com/api-keys",
    healthy: true,
    monthlySpend: 84,
  },
  {
    id: "openrouter", name: "OpenRouter", color: "#6366f1",
    endpoint: "https://openrouter.ai/api/v1",
    keyPrefix: "sk-or-",
    keyMasked: "sk-or-v1-…",
    keyLast4: "—",
    setBy: "—",
    setAt: null,
    lastUsed: null,
    headerName: "Authorization: Bearer",
    docs: "https://openrouter.ai/keys",
    healthy: true,
    monthlySpend: 0,
  },
];

const MODEL_DEFAULTS = {
  "claude-sonnet-4-5": { contextWindow: 200_000, maxOut: 8192, inPrice: 3.0, outPrice: 15.0 },
  "claude-haiku-4-5":  { contextWindow: 200_000, maxOut: 8192, inPrice: 0.8, outPrice: 4.0 },
  "gpt-4.1-mini":      { contextWindow: 128_000, maxOut: 16_384, inPrice: 0.4, outPrice: 1.6 },
  "anthropic/claude-3.5-sonnet": { contextWindow: 200_000, maxOut: 8192,  inPrice: 3.0,  outPrice: 15.0 },
  "openai/gpt-4o-mini":          { contextWindow: 128_000, maxOut: 16_384, inPrice: 0.15, outPrice: 0.60 },
  "meta-llama/llama-3.1-70b":    { contextWindow: 128_000, maxOut: 8192,  inPrice: 0.52, outPrice: 0.75 },
};

function ModelsSection({ models, setModels }) {
  const [configureId, setConfigureId] = useStateS(null);
  const [providerEditId, setProviderEditId] = useStateS(null);
  const [addProviderOpen, setAddProviderOpen] = useStateS(false);
  const [addModelOpen, setAddModelOpen] = useStateS(false);

  const configuringModel = models.find(m => m.id === configureId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* PROVIDER CREDENTIALS — required to talk to any model */}
      <Panel
        title="Provider credentials"
        subtitle="API keys for upstream model vendors. Stored encrypted at rest (AES-256, keyring-rotated weekly)."
        padded={false}
        action={<Button small icon="plus" tone="ghost" onClick={() => setAddProviderOpen(true)}>Add provider</Button>}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 1, background: "var(--border)" }}>
          {PROVIDERS.map(p => (
            <ProviderCredentialCard key={p.id} provider={p} onEdit={() => setProviderEditId(p.id)} />
          ))}
        </div>
      </Panel>

      {/* MODEL FLEET */}
      <Panel title="Model fleet" subtitle="Models exposed to agents. Each pulls credentials from its provider above." padded={false}
        action={<Button small icon="plus" tone="ghost" onClick={() => setAddModelOpen(true)}>Add model</Button>}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <Th>Model</Th>
              <Th>Provider</Th>
              <Th>Used by</Th>
              <Th>Role</Th>
              <Th>Daily cap</Th>
              <Th>Spent today</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {models.map(m => {
              const capNum = parseFloat(m.cap.replace(/[$\/day]/g, "")) || 1;
              const pct = Math.min(100, (m.spent / capNum) * 100);
              const isOpen = configureId === m.id;
              return (
                <tr key={m.id} style={{ borderBottom: "1px solid var(--border)", background: isOpen ? "var(--panel-2)" : "transparent" }}>
                  <Td><span className="mono" style={{ color: "var(--text)" }}>{m.name}</span></Td>
                  <Td><span style={{ color: "var(--text-2)" }}>{m.provider}</span></Td>
                  <Td><span style={{ color: "var(--text-2)" }}>{m.usedBy} agents</span></Td>
                  <Td>{m.status === "primary" ? <Badge tone="signal">PRIMARY</Badge> : <Badge tone="muted">FALLBACK</Badge>}</Td>
                  <Td><span className="mono" style={{ color: "var(--text-2)" }}>{m.cap}</span></Td>
                  <Td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 120 }}>
                      <span className="mono" style={{ fontSize: 11.5, color: "var(--text-2)" }}>${m.spent.toFixed(2)}</span>
                      <div style={{ height: 4, background: "var(--bg-2)", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: pct > 80 ? "var(--amber)" : "var(--signal)" }} />
                      </div>
                    </div>
                  </Td>
                  <Td style={{ textAlign: "right" }}>
                    <Button small tone={isOpen ? "primary" : "ghost"} onClick={() => setConfigureId(isOpen ? null : m.id)}>{isOpen ? "Editing…" : "Configure"}</Button>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      <Panel title="Fallback chain" subtitle="If a model times out or rate-limits, fall through to the next." padded>
        <div style={{ display: "flex", alignItems: "center", gap: 0, overflow: "auto", padding: "4px 2px" }}>
          {["claude-sonnet-4-5", "claude-haiku-4-5", "gpt-4.1-mini"].map((m, i, arr) => (
            <React.Fragment key={m}>
              <div style={{ padding: "10px 14px", background: "var(--panel-2)", border: "1px solid var(--border-2)", borderRadius: 5, display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
                <Icon name="spark" size={11} style={{ color: i === 0 ? "var(--signal)" : "var(--text-3)" }} />
                <span className="mono" style={{ fontSize: 12, color: "var(--text)" }}>{m}</span>
                {i === 0 && <Badge tone="signal">PRIMARY</Badge>}
              </div>
              {i < arr.length - 1 && (
                <div style={{ padding: "0 10px", display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontFamily: "var(--mono)", color: "var(--text-3)" }}>
                  <span>on 429 / timeout</span>
                  <Icon name="chevron-right" size={11} />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <Stat label="Fallbacks · 24h" value="42" mono />
          <Stat label="Avg latency" value="2.1s" mono accent="var(--green)" />
          <Stat label="Spend · 30d" value="$1,914" mono />
        </div>
      </Panel>

      <Panel title="Defaults" padded>
        <Field label="Default model" hint="Used when an agent doesn't pin one explicitly.">
          <SelectIn value="claude-sonnet-4-5" options={["claude-sonnet-4-5", "claude-haiku-4-5", "gpt-4.1-mini"]} />
        </Field>
        <Field label="Max tokens (output)" hint="Hard cap per agent step. Agents may request less.">
          <TextIn value="2048" mono suffix="tokens" />
        </Field>
        <Field label="Temperature" hint="Default sampling temperature for non-deterministic agents.">
          <TextIn value="0.2" mono />
        </Field>
        <Field label="Retry on 5xx" hint="Auto-retry transient model errors with exponential backoff (max 3).">
          <Toggle value={true} />
        </Field>
      </Panel>

      {/* Configure model drawer */}
      {configuringModel && (
        <ConfigureModelDrawer
          model={configuringModel}
          provider={PROVIDERS.find(p => p.name === configuringModel.provider)}
          onClose={() => setConfigureId(null)}
          onEditProvider={() => { const p = PROVIDERS.find(p => p.name === configuringModel.provider); setProviderEditId(p.id); }}
          onUpdate={(patch) => {
            setModels(models.map(m => m.id === configuringModel.id ? { ...m, ...patch } : m));
            if (patch.id && patch.id !== configuringModel.id) setConfigureId(patch.id);
          }}
        />
      )}

      {/* Provider key editor modal */}
      {providerEditId && (
        <ProviderKeyModal
          provider={PROVIDERS.find(p => p.id === providerEditId)}
          onClose={() => setProviderEditId(null)}
        />
      )}

      {/* Add provider modal */}
      {addProviderOpen && <AddProviderModal onClose={() => setAddProviderOpen(false)} />}

      {/* Add model modal */}
      {addModelOpen && <AddModelModal onClose={() => setAddModelOpen(false)} onAdd={(m) => { setModels([...models, m]); setAddModelOpen(false); }} />}
    </div>
  );
}

// ----- Provider credential card (shown in fleet section above the table) -----
function ProviderCredentialCard({ provider, onEdit }) {
  return (
    <div style={{ padding: "14px 16px", background: "var(--panel)", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <IntegrationGlyph id={provider.id} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, color: "var(--text)", fontWeight: 500 }}>{provider.name}</div>
          <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{provider.endpoint}</div>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--green)", fontFamily: "var(--mono)" }}>
          <StatusDot status="ok" size={5} /> AUTHED
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 4 }}>
        <Icon name="code" size={11} style={{ color: "var(--text-3)" }} />
        <span className="mono" style={{ flex: 1, fontSize: 11.5, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{provider.keyMasked}</span>
        <button title="Copy key reference" style={{ color: "var(--text-3)", padding: 2 }}><Icon name="code" size={10} /></button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, fontSize: 10.5, fontFamily: "var(--mono)" }}>
        <div>
          <div style={{ color: "var(--text-4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Set by</div>
          <div style={{ color: "var(--text-2)", marginTop: 2 }}>{provider.setBy}</div>
        </div>
        <div>
          <div style={{ color: "var(--text-4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Last used</div>
          <div style={{ color: "var(--text-2)", marginTop: 2 }}>{window.fmtAgo(provider.lastUsed)}</div>
        </div>
        <div>
          <div style={{ color: "var(--text-4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Spend · 30d</div>
          <div style={{ color: "var(--text-2)", marginTop: 2 }}>${provider.monthlySpend.toLocaleString()}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, paddingTop: 4, borderTop: "1px dashed var(--border)" }}>
        <Button small tone="ghost" icon="check">Test</Button>
        <Button small tone="ghost" icon="external">Docs</Button>
        <Button small tone="primary" onClick={onEdit} style={{ marginLeft: "auto" }}>Update key</Button>
      </div>
    </div>
  );
}

// ----- Masked secret input with show/copy/paste actions -----
function SecretInput({ value, onChange, placeholder, prefix }) {
  const [show, setShow] = useStateS(false);
  const [pasted, setPasted] = useStateS(false);
  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 0, background: "var(--bg-2)", border: "1px solid var(--border-2)", borderRadius: 5, overflow: "hidden" }}>
      {prefix && <span className="mono" style={{ padding: "8px 4px 8px 10px", fontSize: 12, color: "var(--text-4)" }}>{prefix}</span>}
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={e => { onChange?.(e.target.value); setPasted(false); }}
        onPaste={() => setPasted(true)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        style={{
          flex: 1, background: "transparent", border: "none", outline: "none",
          color: "var(--text)", fontFamily: "var(--mono)", fontSize: 12,
          padding: prefix ? "8px 4px" : "8px 10px",
          letterSpacing: show ? 0 : "0.08em",
          minWidth: 0,
        }}
      />
      {pasted && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "0 8px", fontSize: 10, fontFamily: "var(--mono)", color: "var(--green)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          <Icon name="check" size={9} /> pasted
        </span>
      )}
      <button onClick={() => setShow(s => !s)} title={show ? "Hide" : "Show"} style={{ padding: "0 10px", borderLeft: "1px solid var(--border-2)", color: "var(--text-3)", fontFamily: "var(--mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}

// ----- Provider key editor (modal) -----
function ProviderKeyModal({ provider, onClose }) {
  const [val, setVal] = useStateS("");
  const [scope, setScope] = useStateS("workspace");
  const [testState, setTestState] = useStateS(null); // null | "running" | "ok" | "err"

  function runTest() {
    if (!val.trim()) return;
    setTestState("running");
    setTimeout(() => setTestState(val.length >= 20 ? "ok" : "err"), 900);
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ width: 560, background: "var(--panel)", border: "1px solid var(--border-2)", borderRadius: 8, overflow: "hidden", boxShadow: "0 24px 60px -20px rgba(0,0,0,0.6)" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <IntegrationGlyph id={provider.id} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 500 }}>{provider.name} · API key</div>
            <div style={{ fontSize: 11, color: "var(--text-3)" }}>Replaces the current key. Active agents finish on the old key; new runs use the new one.</div>
          </div>
          <button onClick={onClose} style={{ color: "var(--text-3)" }}><Icon name="x" size={13} /></button>
        </header>

        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Current state */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "10px 12px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 5, fontSize: 11, fontFamily: "var(--mono)" }}>
            <div>
              <div style={{ color: "var(--text-4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Current key</div>
              <div style={{ color: "var(--text-2)", marginTop: 2 }}>{provider.keyMasked}</div>
            </div>
            <div>
              <div style={{ color: "var(--text-4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Set</div>
              <div style={{ color: "var(--text-2)", marginTop: 2 }}>{window.fmtAgo(provider.setAt)} by {provider.setBy}</div>
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: 12, color: "var(--text-2)", marginBottom: 6 }}>New API key</label>
            <SecretInput value={val} onChange={setVal} placeholder={`Paste your ${provider.name} key`} prefix={provider.keyPrefix} />
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-3)", lineHeight: 1.5 }}>
              Sent to <span className="mono" style={{ color: "var(--text-2)" }}>{provider.endpoint}</span> as <span className="mono" style={{ color: "var(--text-2)" }}>{provider.headerName}</span>. Encrypted at rest. Never logged. {" "}
              <a href={provider.docs} target="_blank" rel="noopener noreferrer" style={{ color: "var(--signal)" }}>Get a key →</a>
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: 12, color: "var(--text-2)", marginBottom: 6 }}>Scope</label>
            <div style={{ display: "flex", gap: 0, border: "1px solid var(--border-2)", borderRadius: 5, overflow: "hidden", width: "fit-content" }}>
              {[
                { id: "workspace", label: "Workspace-wide", hint: "All tenants" },
                { id: "tenant",    label: "Active tenant only", hint: "RAAS" },
              ].map(s => (
                <button key={s.id} onClick={() => setScope(s.id)} style={{
                  padding: "6px 12px",
                  background: scope === s.id ? "var(--panel-3)" : "var(--panel-2)",
                  color: scope === s.id ? "var(--text)" : "var(--text-3)",
                  fontSize: 12, borderRight: "1px solid var(--border-2)",
                  display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1,
                  borderBottom: scope === s.id ? "2px solid var(--signal)" : "2px solid transparent",
                }}>
                  <span>{s.label}</span>
                  <span style={{ fontSize: 10, fontFamily: "var(--mono)", color: "var(--text-3)" }}>{s.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Test result row */}
          {testState && (
            <div style={{
              padding: "10px 12px", borderRadius: 5, fontSize: 12, lineHeight: 1.5,
              border: `1px solid ${testState === "ok" ? "rgba(101,224,163,0.3)" : testState === "err" ? "rgba(255,100,112,0.35)" : "var(--border)"}`,
              background: testState === "ok" ? "rgba(101,224,163,0.06)" : testState === "err" ? "rgba(255,100,112,0.06)" : "var(--panel-2)",
              color: testState === "ok" ? "var(--green)" : testState === "err" ? "var(--red)" : "var(--text-2)",
            }}>
              {testState === "running" && <span><Icon name="spark" size={11} style={{ marginRight: 6 }} /> Probing {provider.endpoint}/v1/models …</span>}
              {testState === "ok" && <span><Icon name="check" size={11} style={{ marginRight: 6 }} /> 200 OK · 187 ms · returned 14 models · billing reachable</span>}
              {testState === "err" && <span><Icon name="alert" size={11} style={{ marginRight: 6 }} /> 401 Unauthorized — key format looks invalid</span>}
            </div>
          )}
        </div>

        <footer style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 18px", borderTop: "1px solid var(--border)", background: "var(--panel-2)" }}>
          <Button tone="ghost" icon="check" onClick={runTest}>Test connection</Button>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <Button tone="ghost" onClick={onClose}>Cancel</Button>
            <Button tone="primary" icon="check">Save & rotate</Button>
          </div>
        </footer>
      </div>
    </ModalOverlay>
  );
}

// ----- Configure model drawer (slides over from the right) -----
function ConfigureModelDrawer({ model, provider, onClose, onEditProvider, onUpdate }) {
  const d = MODEL_DEFAULTS[model.name] || { contextWindow: 200_000, maxOut: 8192, inPrice: 3, outPrice: 15 };
  const [name, setName] = useStateS(model.name);
  const [idStr, setIdStr] = useStateS(model.id);
  const [role, setRole] = useStateS(model.status);
  const [dailyCap, setDailyCap] = useStateS(parseFloat(model.cap.replace(/[$\/day]/g, "")) || 60);
  const [maxOut, setMaxOut] = useStateS(2048);
  const [temp, setTemp] = useStateS(0.2);
  const [topP, setTopP] = useStateS(0.95);
  const [timeout, setTimeoutVal] = useStateS(60);
  const [concurrency, setConcurrency] = useStateS(24);
  const [reasoning, setReasoning] = useStateS("auto");
  const [streaming, setStreaming] = useStateS(true);
  const [enabled, setEnabled] = useStateS(true);
  const [alertAt, setAlertAt] = useStateS(80);

  const dirty = name !== model.name || idStr !== model.id || role !== model.status;
  function handleSave() {
    if (!onUpdate) return onClose();
    const trimmedName = (name || "").trim() || model.name;
    const trimmedId = (idStr || "").trim() || model.id;
    onUpdate({ name: trimmedName, id: trimmedId, status: role });
    onClose();
  }

  return (
    <ModalOverlay onClose={onClose} side="right">
      <div style={{ width: 540, height: "100%", background: "var(--panel)", borderLeft: "1px solid var(--border-2)", display: "flex", flexDirection: "column", boxShadow: "-16px 0 40px -20px rgba(0,0,0,0.6)" }}>
        <header style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <Badge tone="signal">Configure model</Badge>
            <button onClick={onClose} style={{ marginLeft: "auto", color: "var(--text-3)" }}><Icon name="x" size={13} /></button>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: 22, fontFamily: "var(--display)", fontWeight: 400, color: "var(--text)" }}>{name}</h3>
            <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>{model.provider}</span>
            <span className="mono" style={{ fontSize: 11, color: "var(--text-4)" }}>· {idStr}</span>
          </div>
          {/* Provider link */}
          <div style={{ marginTop: 10, padding: "8px 10px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 4, display: "flex", alignItems: "center", gap: 10 }}>
            <IntegrationGlyph id={provider?.id || "anthropic"} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, color: "var(--text-2)" }}>Using {provider?.name} key <span className="mono" style={{ color: "var(--text)" }}>{provider?.keyMasked}</span></div>
              <div style={{ fontSize: 10.5, color: "var(--text-3)", fontFamily: "var(--mono)" }}>Set {window.fmtAgo(provider?.setAt || Date.now())} by {provider?.setBy}</div>
            </div>
            <Button small tone="ghost" onClick={onEditProvider}>Update key</Button>
          </div>

          {/* Spec strip */}
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, fontSize: 10.5, fontFamily: "var(--mono)" }}>
            <SpecCell label="Context" value={`${(d.contextWindow/1000).toFixed(0)}k`} />
            <SpecCell label="Max out" value={`${(d.maxOut/1000).toFixed(0)}k`} />
            <SpecCell label="$ / 1M in" value={`$${d.inPrice}`} />
            <SpecCell label="$ / 1M out" value={`$${d.outPrice}`} />
          </div>
        </header>

        <div style={{ flex: 1, overflow: "auto", padding: "8px 20px 20px 20px" }}>
          {/* Identity */}
          <DrawerSection title="Identity" hint="The model name is sent to the provider API; the id is the local handle used in events and logs.">
            <Field label="Model name" hint="Provider-side slug, e.g. claude-sonnet-4-5 or anthropic/claude-3.5-sonnet.">
              <TextIn value={name} mono onChange={setName} />
            </Field>
            <Field label="Model id" hint="Local identifier. Must be unique within this workspace.">
              <TextIn value={idStr} mono onChange={setIdStr} />
            </Field>
          </DrawerSection>

          {/* Routing */}
          <DrawerSection title="Routing">
            <Field label="Status" hint="Disable to take this model out of rotation immediately.">
              <Toggle value={enabled} onChange={setEnabled} />
            </Field>
            <Field label="Role" hint="Primary models receive traffic first; fallbacks are tried on 429 / timeout.">
              <div style={{ display: "flex", gap: 0, border: "1px solid var(--border-2)", borderRadius: 5, overflow: "hidden", width: "fit-content" }}>
                {["primary", "fallback", "shadow"].map(r => (
                  <button key={r} onClick={() => setRole(r)} style={{
                    padding: "5px 12px",
                    background: role === r ? "var(--panel-3)" : "var(--panel-2)",
                    color: role === r ? "var(--text)" : "var(--text-3)",
                    fontSize: 11.5, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.06em",
                    borderRight: "1px solid var(--border-2)",
                    borderBottom: role === r ? "2px solid var(--signal)" : "2px solid transparent",
                  }}>{r}</button>
                ))}
              </div>
            </Field>
            <Field label="Concurrency" hint="Max simultaneous in-flight requests across all agents.">
              <TextIn value={String(concurrency)} mono suffix="requests" onChange={v => setConcurrency(parseInt(v) || 0)} />
            </Field>
            <Field label="Request timeout" hint="After this, fall through to the next model in the chain.">
              <TextIn value={String(timeout)} mono suffix="seconds" onChange={v => setTimeoutVal(parseInt(v) || 0)} />
            </Field>
          </DrawerSection>

          {/* Sampling */}
          <DrawerSection title="Sampling defaults" hint="Agents may override these per-request.">
            <Field label="Max output tokens">
              <TextIn value={String(maxOut)} mono suffix="tokens" onChange={v => setMaxOut(parseInt(v) || 0)} />
            </Field>
            <Field label="Temperature" hint="0.0 — deterministic. 1.0 — creative.">
              <SliderRow value={temp} onChange={setTemp} min={0} max={1} step={0.05} />
            </Field>
            <Field label="Top-p">
              <SliderRow value={topP} onChange={setTopP} min={0} max={1} step={0.05} />
            </Field>
            {model.provider === "Anthropic" && (
              <Field label="Extended thinking" hint="Sonnet/Haiku 4.5 supports server-side reasoning. Auto = use when problem complexity warrants it.">
                <SelectIn value={reasoning} onChange={setReasoning} options={[
                  { value: "off",  label: "Off" },
                  { value: "auto", label: "Auto (recommended)" },
                  { value: "on",   label: "Always on" },
                ]} />
              </Field>
            )}
            <Field label="Stream tokens" hint="Stream incremental tokens to the run viewer.">
              <Toggle value={streaming} onChange={setStreaming} />
            </Field>
          </DrawerSection>

          {/* Spend */}
          <DrawerSection title="Spend control">
            <Field label="Daily cap" hint="Hard cap. Once exceeded, this model returns 429 to agents and they fall through.">
              <TextIn value={String(dailyCap)} mono prefix="$" suffix="/ day" onChange={v => setDailyCap(parseFloat(v) || 0)} />
            </Field>
            <Field label="Alert threshold" hint="Page #ops-models when daily spend crosses this percent of the cap.">
              <SliderRow value={alertAt} onChange={setAlertAt} min={50} max={100} step={5} format={v => `${v}%`} />
            </Field>

            <div style={{ marginTop: 10, padding: "12px 14px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-3)" }}>Spend today</span>
                <span style={{ marginLeft: "auto", fontSize: 12, fontFamily: "var(--mono)", color: "var(--text)" }}>${model.spent.toFixed(2)} / ${dailyCap}</span>
              </div>
              <div style={{ height: 6, background: "var(--bg-2)", borderRadius: 3, overflow: "hidden", position: "relative" }}>
                <div style={{ width: `${Math.min(100, (model.spent / dailyCap) * 100)}%`, height: "100%", background: "var(--signal)" }} />
                <div style={{ position: "absolute", top: -2, left: `${alertAt}%`, height: 10, width: 1, background: "var(--amber)" }} />
              </div>
              <div style={{ marginTop: 6, fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--text-3)" }}>
                ~ ${(model.spent * 24 / Math.max(1, new Date().getHours() || 1)).toFixed(2)} projected · alert at <span style={{ color: "var(--amber)" }}>${(dailyCap * alertAt / 100).toFixed(2)}</span>
              </div>
            </div>
          </DrawerSection>

          {/* Used by */}
          <DrawerSection title="Used by" hint={`${model.usedBy} agents currently pin this model.`}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {window.RAAS_AGENTS.filter(a => a.model === model.name).slice(0, 12).map(a => (
                <Badge key={a.id} tone="muted">{a.name}</Badge>
              ))}
              {window.RAAS_AGENTS.filter(a => a.model === model.name).length === 0 && (
                <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>No agents pinned — used via fallback chain only.</span>
              )}
            </div>
          </DrawerSection>
        </div>

        <footer style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 20px", borderTop: "1px solid var(--border)", background: "var(--panel-2)" }}>
          <Button tone="ghost" icon="replay">Reset to defaults</Button>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <Button tone="ghost" onClick={onClose}>Cancel</Button>
            <Button tone="primary" icon="check" onClick={handleSave}>Save changes</Button>
          </div>
        </footer>
      </div>
    </ModalOverlay>
  );
}

function SpecCell({ label, value }) {
  return (
    <div style={{ padding: "6px 8px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 3 }}>
      <div style={{ color: "var(--text-4)", textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 9.5 }}>{label}</div>
      <div style={{ color: "var(--text)", marginTop: 1, fontSize: 12 }}>{value}</div>
    </div>
  );
}

function DrawerSection({ title, hint, children }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ marginBottom: 4, fontSize: 11, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--signal)" }}>{title}</div>
      {hint && <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 8 }}>{hint}</div>}
      <div style={{ borderTop: "1px solid var(--border)" }}>{children}</div>
    </div>
  );
}

function SliderRow({ value, onChange, min = 0, max = 1, step = 0.01, format }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ flex: 1, position: "relative", height: 18, display: "flex", alignItems: "center" }}>
        <div style={{ width: "100%", height: 3, background: "var(--bg-2)", borderRadius: 2, position: "relative" }}>
          <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${pct}%`, background: "var(--signal)" }} />
        </div>
        <input
          type="range" min={min} max={max} step={step}
          value={value}
          onChange={e => onChange?.(parseFloat(e.target.value))}
          style={{ position: "absolute", left: 0, right: 0, top: 0, height: "100%", opacity: 0, cursor: "pointer" }}
        />
        <div style={{ position: "absolute", left: `calc(${pct}% - 6px)`, top: 3, width: 12, height: 12, borderRadius: "50%", background: "var(--signal)", border: "2px solid var(--bg)", pointerEvents: "none" }} />
      </div>
      <span className="mono" style={{ fontSize: 12, color: "var(--text)", minWidth: 44, textAlign: "right" }}>
        {format ? format(value) : value.toFixed(2)}
      </span>
    </div>
  );
}

function ModalOverlay({ onClose, side, children }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        justifyContent: side === "right" ? "flex-end" : "center",
        alignItems: side === "right" ? "stretch" : "center",
        backdropFilter: "blur(2px)",
        animation: "fadein 0.14s ease",
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{ display: "flex" }}>
        {children}
      </div>
    </div>
  );
}

// =====================================================
// 6. Quotas
// =====================================================
function QuotasSection() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Panel title="Per-tenant quotas" subtitle="Hard caps. Runs over the limit are queued and surface as a Quota event." padded={false}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <Th>Tenant</Th>
              <Th>Concurrent runs</Th>
              <Th>Tokens · 24h</Th>
              <Th>Spend · 30d</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {SETTINGS_QUOTAS.map(q => (
              <tr key={q.tenant} style={{ borderBottom: "1px solid var(--border)" }}>
                <Td>
                  <span style={{ color: "var(--text)", fontWeight: 500 }}>{q.tenant}</span>
                </Td>
                <Td><QuotaBar used={q.concurrency.used} cap={q.concurrency.cap} format={v => v.toString()} /></Td>
                <Td><QuotaBar used={q.tokens24h.used} cap={q.tokens24h.cap} format={v => `${(v/1e6).toFixed(2)}M`} /></Td>
                <Td><QuotaBar used={q.spend30d.used} cap={q.spend30d.cap} format={v => `$${v}`} /></Td>
                <Td style={{ textAlign: "right" }}>
                  <Button small tone="ghost">Adjust</Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Rate limits (HTTP API)" padded>
        <Field label="Anonymous reads" hint="Public dashboards & webhooks.">
          <TextIn value="60" mono suffix="req / min / IP" />
        </Field>
        <Field label="Authenticated reads" hint="API-key-scoped read operations.">
          <TextIn value="600" mono suffix="req / min / key" />
        </Field>
        <Field label="Writes (deploy, emit, mutate)" hint="Stricter cap on state-changing endpoints.">
          <TextIn value="60" mono suffix="req / min / key" />
        </Field>
        <Field label="Burst window" hint="How long the bucket fills before rejecting.">
          <TextIn value="10" mono suffix="seconds" />
        </Field>
      </Panel>

      <Panel title="Failure budgets" subtitle="When an agent crosses the budget, it auto-pauses and pages the on-call rotation." padded>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0, border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden" }}>
          <BudgetCell label="Agent error rate" value="2%" sub="rolling 5 min · over 50 runs" />
          <BudgetCell label="Step P99 latency" value="30s" sub="auto-pause if breached for 3 min" />
          <BudgetCell label="Tool timeouts" value="10%" sub="rolling 10 min · over 100 calls" />
        </div>
      </Panel>
    </div>
  );
}

function QuotaBar({ used, cap, format }) {
  const pct = Math.min(100, (used / cap) * 100);
  const color = pct > 85 ? "var(--red)" : pct > 65 ? "var(--amber)" : "var(--signal)";
  return (
    <div style={{ minWidth: 180, display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "var(--mono)" }}>
        <span style={{ color: "var(--text-2)" }}>{format(used)}</span>
        <span style={{ color: "var(--text-3)" }}>/ {format(cap)}</span>
      </div>
      <div style={{ height: 4, background: "var(--bg-2)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color }} />
      </div>
    </div>
  );
}

function BudgetCell({ label, value, sub }) {
  return (
    <div style={{ padding: "12px 14px", borderRight: "1px solid var(--border)", background: "var(--panel)" }}>
      <div style={{ fontSize: 10.5, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-3)" }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 22, fontFamily: "var(--mono)", color: "var(--text)" }}>{value}</div>
      <div style={{ marginTop: 2, fontSize: 11, color: "var(--text-3)" }}>{sub}</div>
    </div>
  );
}

// =====================================================
// 7. Audit log
// =====================================================
function AuditSection() {
  const [q, setQ] = useStateS("");
  const rows = SETTINGS_AUDIT.filter(a => !q || a.actor.toLowerCase().includes(q.toLowerCase()) || a.action.includes(q.toLowerCase()) || a.target.toLowerCase().includes(q.toLowerCase()));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Panel
        title={`Recent admin actions · ${rows.length}`}
        subtitle="Workspace-scoped. Append-only. 365-day retention."
        padded={false}
        action={<div style={{ display: "flex", gap: 6 }}>
          <Button small icon="filter" tone="ghost">Filter</Button>
          <Button small icon="upload" tone="ghost">Export</Button>
        </div>}
      >
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
          <SearchInput value={q} onChange={setQ} placeholder="actor, action, or target…" />
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <Th>When</Th>
              <Th>Actor</Th>
              <Th>Action</Th>
              <Th>Target</Th>
              <Th>From</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a, i) => (
              <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                <Td>
                  <span style={{ color: "var(--text-2)" }}>{window.fmtAgo(a.at)}</span>
                  <div style={{ fontSize: 10.5, color: "var(--text-3)", fontFamily: "var(--mono)" }}>{new Date(a.at).toISOString().slice(11, 19)}</div>
                </Td>
                <Td><span style={{ color: "var(--text)" }}>{a.actor}</span></Td>
                <Td><span className="mono" style={{ fontSize: 11.5, color: actionColor(a.action) }}>{a.action}</span></Td>
                <Td><span className="mono" style={{ fontSize: 11.5, color: "var(--text-2)" }}>{a.target}</span></Td>
                <Td><span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{a.ip}</span></Td>
                <Td style={{ textAlign: "right" }}>
                  <Button small tone="ghost" icon="external">JSON</Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function actionColor(action) {
  if (action.startsWith("deploy.rollback") || action.startsWith("key.")) return "var(--amber)";
  if (action.startsWith("deploy.")) return "var(--signal)";
  if (action.startsWith("member.")) return "var(--violet)";
  if (action.startsWith("integration.")) return "var(--blue)";
  return "var(--text-2)";
}

// =====================================================
// 8. Danger zone
// =====================================================
function DangerSection() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <DangerCard
        title="Pause all agents"
        body="Halts incoming events workspace-wide. In-flight runs complete; new triggers are queued. Resume any time."
        cta="Pause workspace"
        tone="amber"
      />
      <DangerCard
        title="Rebuild event index"
        body="Re-derives the events table from raw runs. Read-only views are unaffected; observability lags up to 2 minutes."
        cta="Rebuild index"
        tone="amber"
      />
      <DangerCard
        title="Rotate all API keys"
        body="Invalidates every key in this workspace and issues replacements. CI/CD will need new values before next deploy."
        cta="Rotate everything"
        tone="amber"
      />
      <DangerCard
        title="Transfer ownership"
        body="Hand the Owner role to another Admin. You'll be downgraded to Admin and lose billing access."
        cta="Transfer…"
        tone="amber"
      />
      <DangerCard
        title="Delete workspace"
        body={<>Permanently deletes <span className="mono">agentic-operator</span> and all tenants, agents, runs, events and audit logs. <strong style={{ color: "var(--red)" }}>This cannot be undone.</strong></>}
        cta="Delete workspace"
        tone="red"
        confirm
      />
    </div>
  );
}

function DangerCard({ title, body, cta, tone, confirm }) {
  const border = tone === "red" ? "rgba(255,100,112,0.35)" : "rgba(255,181,71,0.30)";
  const accent = tone === "red" ? "var(--red)" : "var(--amber)";
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "center",
      padding: "16px 18px",
      background: "var(--panel)",
      border: `1px solid ${border}`,
      borderLeft: `3px solid ${accent}`,
      borderRadius: 6,
    }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <Icon name="alert" size={12} style={{ color: accent }} />
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{title}</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.55, maxWidth: 640 }}>{body}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {confirm && <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>Type workspace name to confirm</span>}
        <Button tone="danger" icon="alert">{cta}</Button>
      </div>
    </div>
  );
}

// =====================================================
// Add Provider modal (new vendor)
// =====================================================
const PROVIDER_PRESETS = [
  { id: "anthropic",  name: "Anthropic",       endpoint: "https://api.anthropic.com",        keyPrefix: "sk-ant-api03-",   header: "x-api-key",            docs: "https://console.anthropic.com/settings/keys",        installed: true,  color: "#d97757" },
  { id: "openai",     name: "OpenAI",          endpoint: "https://api.openai.com/v1",        keyPrefix: "sk-proj-",        header: "Authorization: Bearer", docs: "https://platform.openai.com/api-keys",               installed: true,  color: "#10a37f" },
  { id: "openrouter", name: "OpenRouter",      endpoint: "https://openrouter.ai/api/v1",     keyPrefix: "sk-or-",          header: "Authorization: Bearer", docs: "https://openrouter.ai/keys",                          installed: true,  color: "#6366f1" },
  { id: "gemini",     name: "Google Gemini",   endpoint: "https://generativelanguage.googleapis.com/v1beta", keyPrefix: "AIza", header: "x-goog-api-key",    docs: "https://aistudio.google.com/app/apikey",             installed: false, color: "#4285f4" },
  { id: "mistral",    name: "Mistral",         endpoint: "https://api.mistral.ai/v1",        keyPrefix: "",                 header: "Authorization: Bearer", docs: "https://console.mistral.ai/api-keys/",               installed: false, color: "#ff7000" },
  { id: "groq",       name: "Groq",            endpoint: "https://api.groq.com/openai/v1",   keyPrefix: "gsk_",             header: "Authorization: Bearer", docs: "https://console.groq.com/keys",                       installed: false, color: "#f55036" },
  { id: "together",   name: "Together AI",     endpoint: "https://api.together.xyz/v1",      keyPrefix: "",                 header: "Authorization: Bearer", docs: "https://api.together.ai/settings/api-keys",          installed: false, color: "#0f6fff" },
  { id: "bedrock",    name: "AWS Bedrock",     endpoint: "bedrock-runtime.<region>.amazonaws.com", keyPrefix: "AKIA",       header: "AWS Sigv4",             docs: "https://docs.aws.amazon.com/bedrock/",               installed: false, color: "#ff9900" },
  { id: "vertex",     name: "Google Vertex",   endpoint: "<region>-aiplatform.googleapis.com", keyPrefix: "",                header: "Bearer (Google ADC)",   docs: "https://cloud.google.com/vertex-ai/docs/start/client-libraries", installed: false, color: "#34a853" },
  { id: "azure",      name: "Azure OpenAI",    endpoint: "https://<resource>.openai.azure.com", keyPrefix: "",               header: "api-key",               docs: "https://learn.microsoft.com/azure/ai-services/openai/", installed: false, color: "#0078d4" },
  { id: "deepseek",   name: "DeepSeek",        endpoint: "https://api.deepseek.com/v1",      keyPrefix: "sk-",              header: "Authorization: Bearer", docs: "https://platform.deepseek.com/api_keys",             installed: false, color: "#4d6bfe" },
  { id: "qwen",       name: "Qwen · DashScope", endpoint: "https://dashscope.aliyuncs.com/api/v1", keyPrefix: "sk-",          header: "Authorization: Bearer", docs: "https://dashscope.console.aliyun.com/apiKey",        installed: false, color: "#615ced" },
  { id: "custom",     name: "Custom (OpenAI-compatible)", endpoint: "",                       keyPrefix: "",                 header: "Authorization: Bearer", docs: null,                                                  installed: false, color: "#6f7178" },
];

function AddProviderModal({ onClose }) {
  const [step, setStep] = useStateS("pick");                 // pick | configure | done
  const [picked, setPicked] = useStateS(null);
  const [endpoint, setEndpoint] = useStateS("");
  const [apiKey, setApiKey] = useStateS("");
  const [region, setRegion] = useStateS("");
  const [orgId, setOrgId] = useStateS("");
  const [customName, setCustomName] = useStateS("");
  const [testState, setTestState] = useStateS(null);

  function pick(p) {
    if (p.installed) return;
    setPicked(p);
    setEndpoint(p.endpoint);
    setStep("configure");
  }

  function runTest() {
    if (!apiKey.trim()) return;
    setTestState("running");
    setTimeout(() => setTestState(apiKey.length >= 12 ? "ok" : "err"), 900);
  }

  function save() { setStep("done"); }

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ width: 680, maxHeight: "86vh", background: "var(--panel)", border: "1px solid var(--border-2)", borderRadius: 8, overflow: "hidden", boxShadow: "0 24px 60px -20px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <Icon name="plus" size={14} style={{ color: "var(--signal)" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 500 }}>
              {step === "pick" && "Add a model provider"}
              {step === "configure" && `Configure ${picked?.name}`}
              {step === "done" && `${picked?.name} connected`}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-3)" }}>
              {step === "pick" && "Pick a vendor. We'll provision an encrypted credential and surface its models in the fleet."}
              {step === "configure" && `Credentials stay in the workspace keyring. ${picked?.name} models won't appear until the key tests green.`}
              {step === "done" && "Models from this provider are now selectable when adding agents."}
            </div>
          </div>

          {/* Stepper */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontFamily: "var(--mono)", color: "var(--text-3)" }}>
            <StepDot label="01 PICK"      active={step === "pick"}      done={step !== "pick"} />
            <span style={{ color: "var(--text-4)" }}>—</span>
            <StepDot label="02 KEY"       active={step === "configure"} done={step === "done"} />
            <span style={{ color: "var(--text-4)" }}>—</span>
            <StepDot label="03 DONE"      active={step === "done"} />
          </div>

          <button onClick={onClose} style={{ color: "var(--text-3)", marginLeft: 6 }}><Icon name="x" size={13} /></button>
        </header>

        <div style={{ padding: 18, overflow: "auto", flex: 1 }}>
          {step === "pick" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {PROVIDER_PRESETS.map(p => (
                <button key={p.id} disabled={p.installed} onClick={() => pick(p)} style={{
                  textAlign: "left",
                  padding: "12px 12px",
                  background: p.installed ? "var(--bg-2)" : "var(--panel-2)",
                  border: "1px solid var(--border-2)",
                  borderRadius: 5,
                  cursor: p.installed ? "not-allowed" : "pointer",
                  opacity: p.installed ? 0.55 : 1,
                  transition: "background 0.12s, border-color 0.12s",
                }}
                  onMouseEnter={e => { if (!p.installed) { e.currentTarget.style.background = "var(--panel-3)"; e.currentTarget.style.borderColor = "var(--signal)"; }}}
                  onMouseLeave={e => { if (!p.installed) { e.currentTarget.style.background = "var(--panel-2)"; e.currentTarget.style.borderColor = "var(--border-2)"; }}}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <div style={{ width: 22, height: 22, borderRadius: 4, background: p.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff", fontFamily: "var(--mono)" }}>{p.name[0]}</div>
                    <span style={{ fontSize: 12.5, color: "var(--text)", fontWeight: 500 }}>{p.name}</span>
                    {p.installed && <Badge tone="muted" style={{ marginLeft: "auto" }}>connected</Badge>}
                  </div>
                  <div className="mono" style={{ fontSize: 10, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.endpoint || "—"}</div>
                </button>
              ))}
            </div>
          )}

          {step === "configure" && picked && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {picked.id === "custom" && (
                <Field label="Provider name" hint="Shown in the fleet & in agent model pickers.">
                  <TextIn value={customName} onChange={setCustomName} placeholder="e.g. internal-llm-proxy" />
                </Field>
              )}
              <Field label="Endpoint" hint="Base URL. We append /v1/messages, /v1/chat/completions, etc.">
                <TextIn value={endpoint} onChange={setEndpoint} mono />
              </Field>
              {(picked.id === "bedrock" || picked.id === "vertex" || picked.id === "azure") && (
                <Field label="Region" hint={picked.id === "azure" ? "Azure resource region (e.g. eastus)" : "AWS / GCP region (e.g. us-east-1)"}>
                  <TextIn value={region} onChange={setRegion} mono placeholder="us-east-1" />
                </Field>
              )}
              {picked.id === "openai" && (
                <Field label="Organization ID" hint="Optional. Restricts billing to one OpenAI org.">
                  <TextIn value={orgId} onChange={setOrgId} mono placeholder="org-…" />
                </Field>
              )}
              <Field label="API key" hint={<>Sent as <span className="mono" style={{ color: "var(--text-2)" }}>{picked.header}</span>. Encrypted at rest, never logged. {picked.docs && <a href={picked.docs} target="_blank" rel="noopener noreferrer" style={{ color: "var(--signal)" }}>Get a key →</a>}</>}>
                <SecretInput value={apiKey} onChange={setApiKey} prefix={picked.keyPrefix} placeholder={`Paste your ${picked.name} key`} />
              </Field>

              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Button tone="ghost" icon="check" onClick={runTest}>Test connection</Button>
                  {testState === "running" && <span style={{ fontSize: 11.5, color: "var(--text-3)", fontFamily: "var(--mono)" }}>Probing {endpoint}/v1/models …</span>}
                  {testState === "ok" && <span style={{ fontSize: 11.5, color: "var(--green)", fontFamily: "var(--mono)" }}><Icon name="check" size={10} /> 200 OK · returned 14 models</span>}
                  {testState === "err" && <span style={{ fontSize: 11.5, color: "var(--red)", fontFamily: "var(--mono)" }}><Icon name="alert" size={10} /> 401 — key invalid</span>}
                </div>
              </div>

              {/* Preview models we'll surface */}
              {testState === "ok" && (
                <div style={{ padding: "10px 12px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 5 }}>
                  <div style={{ fontSize: 11, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-3)", marginBottom: 6 }}>Models discovered · 14</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {(picked.id === "anthropic" ? ["claude-opus-4", "claude-sonnet-4-5", "claude-haiku-4-5"]
                      : picked.id === "openai" ? ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "o1-pro"]
                      : picked.id === "gemini" ? ["gemini-2.0-pro", "gemini-2.0-flash", "gemini-1.5-pro"]
                      : ["model-a", "model-b", "model-c"]).map(m => <Badge key={m} tone="muted">{m}</Badge>)}
                    <Badge tone="muted">+ 11 more</Badge>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === "done" && picked && (
            <div style={{ textAlign: "center", padding: "32px 20px" }}>
              <div style={{ width: 56, height: 56, borderRadius: "50%", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(208,255,0,0.10)", border: "1px solid var(--signal)" }}>
                <Icon name="check" size={22} style={{ color: "var(--signal)" }} />
              </div>
              <div style={{ marginTop: 14, fontSize: 18, color: "var(--text)" }}>{picked.name} connected</div>
              <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--text-3)", maxWidth: 380, margin: "6px auto 0" }}>
                14 models available. Add them to the fleet to expose them to agents.
              </div>
              <div style={{ marginTop: 18, display: "flex", justifyContent: "center", gap: 8 }}>
                <Button tone="ghost" onClick={onClose}>Close</Button>
                <Button tone="primary" icon="plus">Add models from {picked.name}</Button>
              </div>
            </div>
          )}
        </div>

        {step !== "done" && (
          <footer style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 18px", borderTop: "1px solid var(--border)", background: "var(--panel-2)" }}>
            {step === "configure" && <Button tone="ghost" icon="chevron-left" onClick={() => { setStep("pick"); setTestState(null); }}>Back</Button>}
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <Button tone="ghost" onClick={onClose}>Cancel</Button>
              {step === "configure" && <Button tone="primary" icon="check" onClick={save}>{testState === "ok" ? "Save provider" : "Save anyway"}</Button>}
            </div>
          </footer>
        )}
      </div>
    </ModalOverlay>
  );
}

function StepDot({ label, active, done }) {
  return (
    <span style={{
      padding: "3px 6px",
      borderRadius: 3,
      background: active ? "var(--signal)" : done ? "rgba(208,255,0,0.10)" : "transparent",
      border: `1px solid ${active ? "var(--signal)" : done ? "rgba(208,255,0,0.30)" : "var(--border-2)"}`,
      color: active ? "#000" : done ? "var(--signal)" : "var(--text-3)",
    }}>{label}</span>
  );
}

// =====================================================
// Add Model modal (expose an upstream model to agents)
// =====================================================
const PROVIDER_MODEL_CATALOG = {
  Anthropic: [
    { name: "claude-opus-4",        ctx: 200_000, out: 8192,  inP: 15,  outP: 75,  vision: true,  tools: true,  reasoning: true },
    { name: "claude-sonnet-4-5",    ctx: 200_000, out: 8192,  inP: 3,   outP: 15,  vision: true,  tools: true,  reasoning: true,  added: true },
    { name: "claude-haiku-4-5",     ctx: 200_000, out: 8192,  inP: 0.8, outP: 4,   vision: true,  tools: true,  reasoning: false, added: true },
  ],
  OpenAI: [
    { name: "gpt-4.1",              ctx: 1_000_000, out: 32_000, inP: 5,  outP: 20,  vision: true,  tools: true,  reasoning: false },
    { name: "gpt-4.1-mini",         ctx: 128_000,   out: 16_384, inP: 0.4,outP: 1.6, vision: true,  tools: true,  reasoning: false, added: true },
    { name: "gpt-4o",               ctx: 128_000,   out: 16_384, inP: 2.5,outP: 10,  vision: true,  tools: true,  reasoning: false },
    { name: "o1-pro",               ctx: 200_000,   out: 100_000,inP: 150,outP: 600, vision: false, tools: false, reasoning: true },
  ],
  OpenRouter: [
    { name: "anthropic/claude-3.5-sonnet", ctx: 200_000, out: 8192,  inP: 3.0,  outP: 15.0, vision: true,  tools: true,  reasoning: true },
    { name: "anthropic/claude-3.5-haiku",  ctx: 200_000, out: 8192,  inP: 0.8,  outP: 4.0,  vision: true,  tools: true,  reasoning: false },
    { name: "openai/gpt-4o",               ctx: 128_000, out: 16_384, inP: 2.5,  outP: 10.0, vision: true,  tools: true,  reasoning: false },
    { name: "openai/gpt-4o-mini",          ctx: 128_000, out: 16_384, inP: 0.15, outP: 0.60, vision: true,  tools: true,  reasoning: false },
    { name: "google/gemini-2.5-pro",       ctx: 1_000_000, out: 65_536, inP: 1.25, outP: 5.0, vision: true,  tools: true,  reasoning: true },
    { name: "meta-llama/llama-3.1-70b",    ctx: 128_000, out: 8192,  inP: 0.52, outP: 0.75, vision: false, tools: true,  reasoning: false },
  ],
};

function AddModelModal({ onClose, onAdd }) {
  const [provider, setProvider] = useStateS("Anthropic");
  const [selected, setSelected] = useStateS(null);
  const [role, setRole] = useStateS("primary");
  const [cap, setCap] = useStateS(30);
  const [maxOut, setMaxOut] = useStateS(2048);
  const [temp, setTemp] = useStateS(0.2);
  const [pinAlias, setPinAlias] = useStateS("");

  const list = PROVIDER_MODEL_CATALOG[provider] || [];
  const sel = list.find(m => m.name === selected);

  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ width: 960, maxHeight: "86vh", background: "var(--panel)", border: "1px solid var(--border-2)", borderRadius: 8, overflow: "hidden", boxShadow: "0 24px 60px -20px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <Icon name="plus" size={14} style={{ color: "var(--signal)" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 500 }}>Add model to fleet</div>
            <div style={{ fontSize: 11, color: "var(--text-3)" }}>Pick from a connected provider's catalog. Agents can then pin or fall through to it.</div>
          </div>
          <button onClick={onClose} style={{ color: "var(--text-3)" }}><Icon name="x" size={13} /></button>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 280px", flex: 1, minHeight: 0 }}>
          {/* Provider rail */}
          <div style={{ borderRight: "1px solid var(--border)", overflow: "auto", padding: "10px 0", background: "var(--bg-2)" }}>
            <div style={{ padding: "0 14px 6px 14px", fontSize: 10, fontFamily: "var(--mono)", textTransform: "uppercase", color: "var(--text-3)", letterSpacing: "0.08em" }}>Providers</div>
            {Object.keys(PROVIDER_MODEL_CATALOG).map(p => (
              <button key={p} onClick={() => { setProvider(p); setSelected(null); }} style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%",
                padding: "8px 14px",
                background: provider === p ? "var(--panel-2)" : "transparent",
                borderLeft: `2px solid ${provider === p ? "var(--signal)" : "transparent"}`,
                textAlign: "left",
                fontSize: 12.5, color: provider === p ? "var(--text)" : "var(--text-2)",
              }}>
                <IntegrationGlyph id={p.toLowerCase()} />
                <div style={{ flex: 1 }}>
                  <div>{p}</div>
                  <div style={{ fontSize: 10, fontFamily: "var(--mono)", color: "var(--text-3)" }}>{PROVIDER_MODEL_CATALOG[p].length} models</div>
                </div>
              </button>
            ))}
            <button onClick={() => {}} style={{
              display: "flex", alignItems: "center", gap: 8, width: "100%",
              padding: "8px 14px",
              fontSize: 12, color: "var(--text-3)",
              borderTop: "1px solid var(--border)", marginTop: 6,
            }}>
              <Icon name="plus" size={11} /> Connect another
            </button>
          </div>

          {/* Catalog */}
          <div style={{ overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--panel-2)" }}>
                  <Th>Model</Th>
                  <Th>Context</Th>
                  <Th>$ / 1M in</Th>
                  <Th>$ / 1M out</Th>
                  <Th>Caps</Th>
                </tr>
              </thead>
              <tbody>
                {list.map(m => {
                  const isSel = selected === m.name;
                  return (
                    <tr key={m.name}
                      onClick={() => !m.added && setSelected(m.name)}
                      style={{
                        borderBottom: "1px solid var(--border)",
                        background: isSel ? "var(--panel-2)" : "transparent",
                        opacity: m.added ? 0.5 : 1,
                        cursor: m.added ? "not-allowed" : "pointer",
                      }}>
                      <Td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <input type="radio" readOnly checked={isSel} disabled={m.added} style={{ accentColor: "var(--signal)" }} />
                          <div>
                            <div className="mono" style={{ color: "var(--text)" }}>{m.name}</div>
                            {m.added && <div style={{ fontSize: 10, color: "var(--text-3)" }}>already in fleet</div>}
                          </div>
                        </div>
                      </Td>
                      <Td><span className="mono" style={{ color: "var(--text-2)" }}>{(m.ctx/1000).toFixed(0)}k</span></Td>
                      <Td><span className="mono" style={{ color: "var(--text-2)" }}>${m.inP}</span></Td>
                      <Td><span className="mono" style={{ color: "var(--text-2)" }}>${m.outP}</span></Td>
                      <Td>
                        <div style={{ display: "flex", gap: 3 }}>
                          {m.vision && <Badge tone="muted">vision</Badge>}
                          {m.tools && <Badge tone="muted">tools</Badge>}
                          {m.reasoning && <Badge tone="signal">reasoning</Badge>}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Detail / config */}
          <div style={{ borderLeft: "1px solid var(--border)", background: "var(--bg-2)", overflow: "auto" }}>
            {sel ? (
              <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, fontFamily: "var(--mono)", textTransform: "uppercase", color: "var(--text-3)", letterSpacing: "0.08em" }}>Adding</div>
                  <div className="mono" style={{ fontSize: 14, color: "var(--text)", marginTop: 2 }}>{sel.name}</div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 11, fontFamily: "var(--mono)" }}>
                  <SpecCell label="Context" value={`${(sel.ctx/1000).toFixed(0)}k`} />
                  <SpecCell label="Max out" value={`${(sel.out/1000).toFixed(0)}k`} />
                  <SpecCell label="$ / 1M in" value={`$${sel.inP}`} />
                  <SpecCell label="$ / 1M out" value={`$${sel.outP}`} />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 11.5, color: "var(--text-2)", marginBottom: 5 }}>Role</label>
                  <div style={{ display: "flex", gap: 0, border: "1px solid var(--border-2)", borderRadius: 5, overflow: "hidden" }}>
                    {["primary", "fallback", "shadow"].map(r => (
                      <button key={r} onClick={() => setRole(r)} style={{
                        flex: 1, padding: "5px 0",
                        background: role === r ? "var(--panel-3)" : "var(--panel-2)",
                        color: role === r ? "var(--text)" : "var(--text-3)",
                        fontSize: 10.5, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.06em",
                        borderRight: "1px solid var(--border-2)",
                        borderBottom: role === r ? "2px solid var(--signal)" : "2px solid transparent",
                      }}>{r}</button>
                    ))}
                  </div>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 11.5, color: "var(--text-2)", marginBottom: 5 }}>Internal alias <span style={{ color: "var(--text-4)" }}>(optional)</span></label>
                  <TextIn value={pinAlias} onChange={setPinAlias} mono placeholder={sel.name.replace(/.*-/, "fast-")} />
                  <div style={{ marginTop: 4, fontSize: 10.5, color: "var(--text-3)" }}>Agents pin alias names; you can swap the underlying model later.</div>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 11.5, color: "var(--text-2)", marginBottom: 5 }}>Daily cap</label>
                  <TextIn value={String(cap)} onChange={v => setCap(parseFloat(v) || 0)} mono prefix="$" suffix="/ day" />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 11.5, color: "var(--text-2)", marginBottom: 5 }}>Max output tokens</label>
                  <TextIn value={String(maxOut)} onChange={v => setMaxOut(parseInt(v) || 0)} mono suffix="tokens" />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 11.5, color: "var(--text-2)", marginBottom: 5 }}>Temperature</label>
                  <SliderRow value={temp} onChange={setTemp} min={0} max={1} step={0.05} />
                </div>
              </div>
            ) : (
              <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
                <Icon name="spark" size={20} style={{ color: "var(--text-4)" }} />
                <div style={{ marginTop: 8 }}>Pick a model from the catalog</div>
              </div>
            )}
          </div>
        </div>

        <footer style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 18px", borderTop: "1px solid var(--border)", background: "var(--panel-2)" }}>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
            {sel ? <>Will appear as <span className="mono" style={{ color: "var(--text-2)" }}>{pinAlias || sel.name}</span> in the model fleet.</> : "Nothing selected."}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <Button tone="ghost" onClick={onClose}>Cancel</Button>
            <Button
              tone="primary"
              icon="check"
              onClick={() => {
                if (!sel) return onClose();
                if (onAdd) {
                  onAdd({
                    id: `m_${Date.now().toString(36)}`,
                    name: pinAlias || sel.name,
                    provider,
                    usedBy: 0,
                    cap: `$${cap}/day`,
                    spent: 0,
                    status: role === "fallback" ? "fallback" : "primary",
                  });
                } else {
                  onClose();
                }
              }}
            >Add to fleet</Button>
          </div>
        </footer>
      </div>
    </ModalOverlay>
  );
}

// =====================================================
// 6. Usage & costs — LLM spend breakdown
// =====================================================

// Mock 30-day spend time series (deterministic)
const USAGE_DAILY = (function () {
  const out = [];
  let s = 11;
  for (let i = 29; i >= 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const r = s / 233280;
    const day = Date.now() - i * 86_400_000;
    // upward trend with some weekend dip
    const dow = new Date(day).getDay();
    const dip = (dow === 0 || dow === 6) ? 0.55 : 1;
    const base = 35 + (29 - i) * 1.6;
    out.push({ day, spend: +(base * dip * (0.78 + r * 0.5)).toFixed(2), tokens: Math.floor((180_000 + (29 - i) * 8500) * dip * (0.8 + r * 0.4)) });
  }
  return out;
})();

const USAGE_BY_TENANT = [
  { id: "raas",    name: "RAAS",         calls: 18420, tokensIn: 4.21e6, tokensOut: 0.62e6, spend: 1684.20, delta: 0.12 },
  { id: "support", name: "SupportFlow",  calls: 3120,  tokensIn: 0.62e6, tokensOut: 0.11e6, spend: 184.40,  delta: -0.04 },
  { id: "finance", name: "FinanceClose", calls: 470,   tokensIn: 0.11e6, tokensOut: 0.02e6, spend: 45.10,   delta: 0.31 },
];

const USAGE_BY_AGENT = [
  { id: "10-2",   name: "matchResume",                tenant: "RAAS",    calls: 4180, spend: 412.30, model: "claude-sonnet-4-5", avgLat: 2.1, errRate: 0.018 },
  { id: "12",   name: "evaluateInterview",          tenant: "RAAS",    calls: 1840, spend: 318.80, model: "claude-sonnet-4-5", avgLat: 4.4, errRate: 0.022 },
  { id: "2",    name: "analyzeRequirement",         tenant: "RAAS",    calls: 920,  spend: 246.50, model: "claude-sonnet-4-5", avgLat: 3.0, errRate: 0.011 },
  { id: "14-1", name: "generateRecommendationPackage", tenant: "RAAS", calls: 1640, spend: 198.20, model: "claude-sonnet-4-5", avgLat: 1.8, errRate: 0.008 },
  { id: "9-1",  name: "processResume",              tenant: "RAAS",    calls: 5210, spend: 162.10, model: "claude-sonnet-4-5", avgLat: 1.2, errRate: 0.014 },
  { id: "4",    name: "createJD",                   tenant: "RAAS",    calls: 410,  spend: 152.40, model: "claude-sonnet-4-5", avgLat: 5.2, errRate: 0.005 },
  { id: "13",   name: "refineResume",               tenant: "RAAS",    calls: 1480, spend: 98.10,  model: "claude-sonnet-4-5", avgLat: 2.5, errRate: 0.003 },
  { id: "3",    name: "clarifyRequirement",         tenant: "RAAS",    calls: 880,  spend: 38.40,  model: "claude-haiku-4-5",  avgLat: 1.1, errRate: 0.002 },
  { id: "6",    name: "assignRecruitTasks",         tenant: "RAAS",    calls: 740,  spend: 18.20,  model: "claude-haiku-4-5",  avgLat: 0.9, errRate: 0.001 },
  { id: "11-1", name: "inviteInternalInterview",    tenant: "RAAS",    calls: 920,  spend: 12.40,  model: "claude-haiku-4-5",  avgLat: 0.8, errRate: 0.000 },
];

const USAGE_BY_USER = [
  { id: "u1", name: "Liu Wei",       role: "Owner",    calls: 12_840, spend: 1320.40, lastActive: Date.now() - 2*60_000,    color: "#b594ff", initials: "LW" },
  { id: "u2", name: "Chen Mengjie",  role: "Admin",    calls: 4_120,  spend: 462.10,  lastActive: Date.now() - 19*60_000,   color: "#84a9ff", initials: "CM" },
  { id: "svc-inngest", name: "Inngest Bridge", role: "Service", calls: 3_984, spend: 84.20, lastActive: Date.now() - 4*60_000, color: "#6f7178", initials: "IN" },
  { id: "u3", name: "Wu Hao",        role: "Operator", calls: 580,    spend: 28.30,   lastActive: Date.now() - 6*60_000,    color: "#65e0a3", initials: "WH" },
  { id: "u4", name: "Sun Yufei",     role: "Operator", calls: 312,    spend: 14.80,   lastActive: Date.now() - 3*3600_000,  color: "#ffb547", initials: "SY" },
  { id: "svc-ops", name: "Ops Pipeline", role: "Service", calls: 174, spend: 3.90,    lastActive: Date.now() - 12*60_000,   color: "#6f7178", initials: "OP" },
];

const USAGE_BY_PROVIDER = [
  { id: "anthropic", name: "Anthropic", spend: 1824.00, share: 0.95, calls: 21420, tokensIn: 4.62e6, tokensOut: 0.71e6 },
  { id: "openai",    name: "OpenAI",    spend: 89.70,   share: 0.05, calls: 590,   tokensIn: 0.32e6, tokensOut: 0.04e6 },
];

const USAGE_BY_MODEL = [
  { name: "claude-sonnet-4-5", provider: "Anthropic", spend: 1648.30, calls: 14_220, tokensIn: 3.42e6, tokensOut: 0.51e6, avgIn: 240, avgOut: 36, avgLat: 2.3 },
  { name: "claude-haiku-4-5",  provider: "Anthropic", spend: 175.70,  calls: 7_200,  tokensIn: 1.20e6, tokensOut: 0.20e6, avgIn: 167, avgOut: 28, avgLat: 0.9 },
  { name: "gpt-4.1-mini",      provider: "OpenAI",    spend: 89.70,   calls: 590,    tokensIn: 0.32e6, tokensOut: 0.04e6, avgIn: 542, avgOut: 68, avgLat: 1.6 },
];

function UsageSection() {
  const [period, setPeriod] = useStateS("30d");
  const [tab, setTab] = useStateS("tenant");
  const [groupBy, setGroupBy] = useStateS("day");

  const totalSpend = USAGE_DAILY.reduce((s, d) => s + d.spend, 0);
  const totalTokens = USAGE_DAILY.reduce((s, d) => s + d.tokens, 0);
  const totalCalls = USAGE_BY_TENANT.reduce((s, t) => s + t.calls, 0);
  const avgCost = totalSpend / Math.max(1, totalCalls);
  const projected = (totalSpend / 30) * 30 * 1.08; // simple forecast

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Top filter strip */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <SegPicker
          value={period}
          onChange={setPeriod}
          options={[
            { value: "24h", label: "24h" },
            { value: "7d",  label: "7d" },
            { value: "30d", label: "30d" },
            { value: "90d", label: "90d" },
            { value: "custom", label: "Custom" },
          ]}
        />
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <Button small icon="filter" tone="ghost">Filter</Button>
          <Button small icon="upload" tone="ghost">Export CSV</Button>
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0, border: "1px solid var(--border)", borderRadius: 6, background: "var(--panel)", overflow: "hidden" }}>
        <UsageKpi label="Total spend" value={`$${totalSpend.toFixed(2)}`} delta="+8.2% vs prev 30d" deltaUp />
        <UsageKpi label="Tokens" value={`${(totalTokens/1e6).toFixed(2)}M`} delta="+11.4%" deltaUp />
        <UsageKpi label="Avg cost / call" value={`$${avgCost.toFixed(4)}`} delta="−3.1%" />
        <UsageKpi label="Projected · this month" value={`$${projected.toFixed(0)}`} delta={`pace under $2.5k cap`} />
      </div>

      {/* Daily spend chart */}
      <Panel
        title={`Daily spend · last ${period}`}
        subtitle="Stacked by provider"
        padded
        action={<SegPicker small value={groupBy} onChange={setGroupBy} options={[
          { value: "day", label: "Day" },
          { value: "week", label: "Week" },
        ]} />}
      >
        <UsageChart series={USAGE_DAILY} />
      </Panel>

      {/* Breakdown tabs */}
      <Panel
        title="Breakdown"
        padded={false}
        action={<div style={{ display: "flex", gap: 0, border: "1px solid var(--border-2)", borderRadius: 4, overflow: "hidden" }}>
          {[
            { id: "tenant",   label: "By tenant" },
            { id: "agent",    label: "By agent" },
            { id: "user",     label: "By user" },
            { id: "provider", label: "By provider" },
            { id: "model",    label: "By model" },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "5px 12px",
              fontSize: 11, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.06em",
              background: tab === t.id ? "var(--panel-3)" : "var(--panel-2)",
              color: tab === t.id ? "var(--text)" : "var(--text-3)",
              borderRight: "1px solid var(--border-2)",
              borderBottom: tab === t.id ? "2px solid var(--signal)" : "2px solid transparent",
            }}>{t.label}</button>
          ))}
        </div>}
      >
        {tab === "tenant"   && <BreakdownByTenant />}
        {tab === "agent"    && <BreakdownByAgent />}
        {tab === "user"     && <BreakdownByUser />}
        {tab === "provider" && <BreakdownByProvider />}
        {tab === "model"    && <BreakdownByModel />}
      </Panel>

      {/* Forecast & alerts */}
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 14 }}>
        <Panel title="Forecast" subtitle="Next 30 days, based on rolling 14-day trend." padded>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
            <Stat label="P50 forecast" value={`$${(projected).toFixed(0)}`} mono accent="var(--signal)" />
            <Stat label="P90 forecast" value={`$${(projected * 1.18).toFixed(0)}`} mono accent="var(--amber)" />
            <Stat label="Budget cap" value="$2,500" mono />
          </div>
          <div style={{ marginTop: 14, padding: "10px 12px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 5, fontSize: 12, color: "var(--text-2)", lineHeight: 1.55 }}>
            <Icon name="spark" size={11} style={{ color: "var(--signal)", marginRight: 6 }} />
            At the current pace, <span style={{ color: "var(--text)" }}>matchResume</span> will exceed its $400/mo soft target around <span className="mono" style={{ color: "var(--amber)" }}>day 22</span>. Consider routing low-priority candidates through <span className="mono">claude-haiku-4-5</span>.
          </div>
        </Panel>

        <Panel title="Budget alerts" padded={false}>
          {[
            { kind: "tenant", name: "RAAS",        cap: 2000, used: 1684.20 },
            { kind: "agent",  name: "evaluateInterview", cap: 400, used: 318.80 },
            { kind: "model",  name: "claude-sonnet-4-5", cap: 1800, used: 1648.30 },
          ].map(b => {
            const pct = (b.used / b.cap) * 100;
            const tone = pct > 90 ? "var(--red)" : pct > 75 ? "var(--amber)" : "var(--signal)";
            return (
              <div key={b.name} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <Badge tone="muted">{b.kind}</Badge>
                  <span className="mono" style={{ fontSize: 12, color: "var(--text)" }}>{b.name}</span>
                  <span style={{ marginLeft: "auto", fontSize: 11.5, fontFamily: "var(--mono)", color: tone }}>{pct.toFixed(0)}%</span>
                </div>
                <div style={{ height: 4, background: "var(--bg-2)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: tone }} />
                </div>
                <div style={{ marginTop: 4, fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--text-3)" }}>${b.used.toFixed(2)} / ${b.cap.toLocaleString()}</div>
              </div>
            );
          })}
        </Panel>
      </div>
    </div>
  );
}

function UsageKpi({ label, value, delta, deltaUp }) {
  return (
    <div style={{ padding: "14px 18px", borderRight: "1px solid var(--border)" }}>
      <div style={{ fontSize: 10.5, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-3)" }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 22, fontFamily: "var(--mono)", color: "var(--text)" }}>{value}</div>
      <div style={{ marginTop: 2, fontSize: 11, color: deltaUp ? "var(--green)" : "var(--text-3)" }}>{delta}</div>
    </div>
  );
}

function SegPicker({ value, onChange, options, small }) {
  return (
    <div style={{ display: "inline-flex", border: "1px solid var(--border-2)", borderRadius: 4, overflow: "hidden" }}>
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)} style={{
          padding: small ? "3px 9px" : "5px 11px",
          fontSize: small ? 10.5 : 11.5, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.06em",
          background: value === o.value ? "var(--panel-3)" : "var(--panel-2)",
          color: value === o.value ? "var(--text)" : "var(--text-3)",
          borderRight: "1px solid var(--border-2)",
        }}>{o.label}</button>
      ))}
    </div>
  );
}

// ----- Daily chart (stacked bars: Anthropic + OpenAI) -----
function UsageChart({ series }) {
  const w = 980;
  const h = 180;
  const pad = { l: 38, r: 8, t: 12, b: 22 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const max = Math.max(...series.map(d => d.spend));
  const yMax = Math.ceil(max / 20) * 20;
  const barW = innerW / series.length - 2;

  const ticks = [0, yMax * 0.25, yMax * 0.5, yMax * 0.75, yMax];

  return (
    <div style={{ overflow: "auto" }}>
      <svg width={w} height={h} style={{ display: "block" }}>
        {/* y-grid */}
        {ticks.map((t, i) => {
          const y = pad.t + innerH * (1 - t / yMax);
          return (
            <g key={i}>
              <line x1={pad.l} x2={w - pad.r} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} strokeDasharray={i === 0 ? "" : "2 4"} />
              <text x={pad.l - 6} y={y + 3} fill="var(--text-3)" fontSize="9" fontFamily="var(--mono)" textAnchor="end">${t.toFixed(0)}</text>
            </g>
          );
        })}

        {/* bars (stacked anthropic on top of openai-ish, ~95/5 split) */}
        {series.map((d, i) => {
          const x = pad.l + i * (barW + 2) + 1;
          const totalH = (d.spend / yMax) * innerH;
          const openaiH = totalH * 0.05;
          const anthropicH = totalH - openaiH;
          const yTop = pad.t + innerH - totalH;
          return (
            <g key={i}>
              <rect x={x} y={yTop} width={barW} height={anthropicH} fill="var(--signal)" opacity={0.85} />
              <rect x={x} y={yTop + anthropicH} width={barW} height={openaiH} fill="var(--blue)" opacity={0.85} />
              {/* hover tooltip backing */}
              <rect x={x - 1} y={pad.t} width={barW + 2} height={innerH} fill="transparent" pointerEvents="all">
                <title>{new Date(d.day).toDateString()} · ${d.spend.toFixed(2)} · {(d.tokens/1000).toFixed(0)}k tokens</title>
              </rect>
            </g>
          );
        })}

        {/* x-axis labels (every 5 days) */}
        {series.map((d, i) => {
          if (i % 5 !== 0 && i !== series.length - 1) return null;
          const x = pad.l + i * (barW + 2) + barW / 2 + 1;
          const label = new Date(d.day).toLocaleDateString([], { month: "short", day: "numeric" });
          return <text key={i} x={x} y={h - 6} fill="var(--text-3)" fontSize="9" fontFamily="var(--mono)" textAnchor="middle">{label}</text>;
        })}
      </svg>

      <div style={{ display: "flex", gap: 14, marginTop: 8, paddingLeft: pad.l, fontSize: 11, fontFamily: "var(--mono)", color: "var(--text-3)" }}>
        <span><span style={{ display: "inline-block", width: 8, height: 8, background: "var(--signal)", marginRight: 5 }} />Anthropic</span>
        <span><span style={{ display: "inline-block", width: 8, height: 8, background: "var(--blue)", marginRight: 5 }} />OpenAI</span>
      </div>
    </div>
  );
}

// ----- Breakdown tables -----
function BreakdownByTenant() {
  const total = USAGE_BY_TENANT.reduce((s, t) => s + t.spend, 0);
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
      <thead>
        <tr style={{ borderBottom: "1px solid var(--border)" }}>
          <Th>Tenant</Th>
          <Th>Share</Th>
          <Th>Calls</Th>
          <Th>Tokens in / out</Th>
          <Th>Spend · 30d</Th>
          <Th>Δ vs prev</Th>
        </tr>
      </thead>
      <tbody>
        {USAGE_BY_TENANT.map(t => {
          const share = (t.spend / total) * 100;
          const tenant = window.TENANTS.find(x => x.id === t.id);
          return (
            <tr key={t.id} style={{ borderBottom: "1px solid var(--border)" }}>
              <Td>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 16, height: 16, background: tenant?.color || "var(--text-4)", borderRadius: 3 }} />
                  <span style={{ color: "var(--text)" }}>{t.name}</span>
                </div>
              </Td>
              <Td>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 140 }}>
                  <div style={{ flex: 1, height: 4, background: "var(--bg-2)", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${share}%`, height: "100%", background: tenant?.color || "var(--signal)" }} />
                  </div>
                  <span className="mono" style={{ fontSize: 11, color: "var(--text-3)", minWidth: 38, textAlign: "right" }}>{share.toFixed(0)}%</span>
                </div>
              </Td>
              <Td><span className="mono" style={{ color: "var(--text-2)" }}>{t.calls.toLocaleString()}</span></Td>
              <Td><span className="mono" style={{ color: "var(--text-2)" }}>{(t.tokensIn/1e6).toFixed(2)}M / {(t.tokensOut/1e6).toFixed(2)}M</span></Td>
              <Td><span className="mono" style={{ color: "var(--text)" }}>${t.spend.toFixed(2)}</span></Td>
              <Td>
                <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: t.delta >= 0 ? "var(--green)" : "var(--red)" }}>
                  {t.delta >= 0 ? "+" : ""}{(t.delta * 100).toFixed(0)}%
                </span>
              </Td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function BreakdownByAgent() {
  const max = Math.max(...USAGE_BY_AGENT.map(a => a.spend));
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
      <thead>
        <tr style={{ borderBottom: "1px solid var(--border)" }}>
          <Th>Agent</Th>
          <Th>Tenant</Th>
          <Th>Model</Th>
          <Th>Calls</Th>
          <Th>Avg latency</Th>
          <Th>Err</Th>
          <Th>Spend · 30d</Th>
        </tr>
      </thead>
      <tbody>
        {USAGE_BY_AGENT.map(a => (
          <tr key={a.id} style={{ borderBottom: "1px solid var(--border)" }}>
            <Td>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Badge tone="muted">{a.id}</Badge>
                <span className="mono" style={{ color: "var(--text)" }}>{a.name}</span>
              </div>
            </Td>
            <Td><span style={{ color: "var(--text-2)" }}>{a.tenant}</span></Td>
            <Td><span className="mono" style={{ fontSize: 11.5, color: "var(--text-2)" }}>{a.model}</span></Td>
            <Td><span className="mono" style={{ color: "var(--text-2)" }}>{a.calls.toLocaleString()}</span></Td>
            <Td><span className="mono" style={{ color: "var(--text-2)" }}>{a.avgLat.toFixed(1)}s</span></Td>
            <Td><span className="mono" style={{ color: a.errRate > 0.015 ? "var(--amber)" : "var(--text-3)" }}>{(a.errRate * 100).toFixed(1)}%</span></Td>
            <Td>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 150 }}>
                <div style={{ flex: 1, height: 4, background: "var(--bg-2)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ width: `${(a.spend / max) * 100}%`, height: "100%", background: "var(--signal)" }} />
                </div>
                <span className="mono" style={{ fontSize: 11.5, color: "var(--text)", minWidth: 56, textAlign: "right" }}>${a.spend.toFixed(2)}</span>
              </div>
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BreakdownByUser() {
  const max = Math.max(...USAGE_BY_USER.map(u => u.spend));
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
      <thead>
        <tr style={{ borderBottom: "1px solid var(--border)" }}>
          <Th>User</Th>
          <Th>Role</Th>
          <Th>Last active</Th>
          <Th>Calls · 30d</Th>
          <Th>Spend · 30d</Th>
        </tr>
      </thead>
      <tbody>
        {USAGE_BY_USER.map(u => (
          <tr key={u.id} style={{ borderBottom: "1px solid var(--border)" }}>
            <Td>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 26, height: 26, borderRadius: "50%", background: u.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 600, color: "#000" }}>{u.initials}</div>
                <span style={{ color: "var(--text)" }}>{u.name}</span>
              </div>
            </Td>
            <Td><RoleBadge role={u.role} /></Td>
            <Td><span style={{ color: "var(--text-3)" }}>{window.fmtAgo(u.lastActive)}</span></Td>
            <Td><span className="mono" style={{ color: "var(--text-2)" }}>{u.calls.toLocaleString()}</span></Td>
            <Td>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 150 }}>
                <div style={{ flex: 1, height: 4, background: "var(--bg-2)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ width: `${(u.spend / max) * 100}%`, height: "100%", background: u.color }} />
                </div>
                <span className="mono" style={{ fontSize: 11.5, color: "var(--text)", minWidth: 64, textAlign: "right" }}>${u.spend.toFixed(2)}</span>
              </div>
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BreakdownByProvider() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 1, background: "var(--border)" }}>
      {USAGE_BY_PROVIDER.map(p => (
        <div key={p.id} style={{ padding: "16px 18px", background: "var(--panel)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <IntegrationGlyph id={p.id} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 500 }}>{p.name}</div>
              <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{p.calls.toLocaleString()} calls · 30d</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 18, fontFamily: "var(--mono)", color: "var(--text)" }}>${p.spend.toFixed(2)}</div>
              <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{(p.share * 100).toFixed(0)}% of total</div>
            </div>
          </div>
          <div style={{ height: 5, background: "var(--bg-2)", borderRadius: 2, overflow: "hidden", marginBottom: 10 }}>
            <div style={{ width: `${p.share * 100}%`, height: "100%", background: p.id === "anthropic" ? "#d97757" : "#10a37f" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 11, fontFamily: "var(--mono)" }}>
            <div>
              <div style={{ color: "var(--text-3)" }}>Tokens in</div>
              <div style={{ color: "var(--text)", marginTop: 2 }}>{(p.tokensIn/1e6).toFixed(2)}M</div>
            </div>
            <div>
              <div style={{ color: "var(--text-3)" }}>Tokens out</div>
              <div style={{ color: "var(--text)", marginTop: 2 }}>{(p.tokensOut/1e6).toFixed(2)}M</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function BreakdownByModel() {
  const max = Math.max(...USAGE_BY_MODEL.map(m => m.spend));
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
      <thead>
        <tr style={{ borderBottom: "1px solid var(--border)" }}>
          <Th>Model</Th>
          <Th>Provider</Th>
          <Th>Calls</Th>
          <Th>Avg tokens (in / out)</Th>
          <Th>Avg latency</Th>
          <Th>Spend · 30d</Th>
        </tr>
      </thead>
      <tbody>
        {USAGE_BY_MODEL.map(m => (
          <tr key={m.name} style={{ borderBottom: "1px solid var(--border)" }}>
            <Td><span className="mono" style={{ color: "var(--text)" }}>{m.name}</span></Td>
            <Td><span style={{ color: "var(--text-2)" }}>{m.provider}</span></Td>
            <Td><span className="mono" style={{ color: "var(--text-2)" }}>{m.calls.toLocaleString()}</span></Td>
            <Td><span className="mono" style={{ color: "var(--text-2)" }}>{m.avgIn} / {m.avgOut}</span></Td>
            <Td><span className="mono" style={{ color: "var(--text-2)" }}>{m.avgLat.toFixed(1)}s</span></Td>
            <Td>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 160 }}>
                <div style={{ flex: 1, height: 4, background: "var(--bg-2)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ width: `${(m.spend / max) * 100}%`, height: "100%", background: m.provider === "Anthropic" ? "#d97757" : "#10a37f" }} />
                </div>
                <span className="mono" style={{ fontSize: 11.5, color: "var(--text)", minWidth: 70, textAlign: "right" }}>${m.spend.toFixed(2)}</span>
              </div>
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

window.Settings = Settings;