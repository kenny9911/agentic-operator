// Agentic Operator — main app shell

const { useState: useStateApp, useEffect: useEffectApp } = React;

// ----- Tweak defaults (persisted via __edit_mode_set_keys) -----
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "density": "default",
  "liveStream": true,
  "showDebug": false,
  "tenant": "raas",
  "accent": "#d0ff00"
}/*EDITMODE-END*/;

const ACCENT_DIMS = {
  "#d0ff00": "#5a6e00",
  "#5deeff": "#1a6770",
  "#ffb547": "#7a4f0d",
  "#b594ff": "#553e87",
};

function App() {
  const [tweaks, setTweak] = window.useTweaks(TWEAK_DEFAULTS);
  const [view, setView] = useStateApp("dashboard");
  const [params, setParams] = useStateApp({});

  // Apply tweaks to <html>
  useEffectApp(() => {
    document.documentElement.dataset.theme = tweaks.theme;
    document.documentElement.dataset.density = tweaks.density;
    document.documentElement.style.setProperty("--signal", tweaks.accent);
    document.documentElement.style.setProperty("--signal-dim", ACCENT_DIMS[tweaks.accent] || "#5a6e00");
  }, [tweaks]);

  const navigate = (newView, newParams = {}) => {
    setView(newView);
    setParams(newParams);
  };

  const tenant = window.TENANTS.find(t => t.id === tweaks.tenant) || window.TENANTS[0];

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "232px 1fr",
      height: "100%",
      background: "var(--bg)",
    }}>
      <Sidebar view={view} navigate={navigate} tenant={tenant} tweaks={tweaks} setTweak={setTweak} />
      <main style={{ display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        <TopBar view={view} params={params} navigate={navigate} liveStream={tweaks.liveStream} setTweak={setTweak} />
        <div style={{ flex: 1, overflow: "hidden", minHeight: 0, position: "relative" }}>
          {view === "dashboard" && <Dashboard navigate={navigate} liveStream={tweaks.liveStream} />}
          {view === "workflows" && <Workflows navigate={navigate} liveStream={tweaks.liveStream} />}
          {view === "agents" && <Agents navigate={navigate} params={params} />}
          {view === "runs" && <Runs navigate={navigate} params={params} />}
          {view === "events" && <Events navigate={navigate} params={params} liveStream={tweaks.liveStream} />}
          {view === "tasks" && <Tasks navigate={navigate} params={params} />}
          {view === "logs" && <Logs navigate={navigate} params={params} liveStream={tweaks.liveStream} />}
          {view === "deployments" && <Deployments navigate={navigate} />}
        </div>
      </main>

      {/* Tweaks panel */}
      {window.TweaksPanel && (
        <window.TweaksPanel title="Tweaks">
          <window.TweakRadio
            label="Theme"
            value={tweaks.theme}
            onChange={(v) => setTweak("theme", v)}
            options={["dark", "light"]}
          />
          <window.TweakRadio
            label="Density"
            value={tweaks.density}
            onChange={(v) => setTweak("density", v)}
            options={["compact", "default", "comfortable"]}
          />
          <window.TweakColor
            label="Accent"
            value={tweaks.accent}
            onChange={(v) => setTweak("accent", v)}
            options={["#d0ff00", "#5deeff", "#ffb547", "#b594ff"]}
          />
          <window.TweakToggle
            label="Live event stream"
            value={tweaks.liveStream}
            onChange={(v) => setTweak("liveStream", v)}
          />
          <window.TweakToggle
            label="Show debug panels"
            value={tweaks.showDebug}
            onChange={(v) => setTweak("showDebug", v)}
          />
          <window.TweakSelect
            label="Active tenant"
            value={tweaks.tenant}
            onChange={(v) => setTweak("tenant", v)}
            options={window.TENANTS.map(t => t.id)}
          />
        </window.TweaksPanel>
      )}
    </div>
  );
}

function Sidebar({ view, navigate, tenant, tweaks, setTweak }) {
  return (
    <aside style={{
      background: "var(--bg-2)",
      borderRight: "1px solid var(--border)",
      display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Logo */}
      <div style={{ padding: "16px 18px 14px 18px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--border)" }}>
        <Logo />
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15, minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 600, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Agentic Operator</span>
          <span style={{ fontSize: 10, color: "var(--text-3)", fontFamily: "var(--mono)", letterSpacing: "0.06em", marginTop: 2 }}>v0.6.2</span>
        </div>
      </div>

      {/* Tenant switcher */}
      <TenantSwitcher tenant={tenant} setTweak={setTweak} />

      {/* Nav */}
      <nav style={{ padding: "10px 8px", flex: 1, overflow: "auto" }}>
        <NavGroup label="Run">
          <NavItem id="dashboard" view={view} navigate={navigate} icon="dashboard" label="Dashboard" />
          <NavItem id="workflows" view={view} navigate={navigate} icon="workflow" label="Workflows" />
          <NavItem id="agents" view={view} navigate={navigate} icon="agent" label="Agents" count={window.RAAS_AGENTS.length} />
          <NavItem id="runs" view={view} navigate={navigate} icon="run" label="Runs" liveCount={window.RAAS_RUNS.filter(r => r.status === "running").length} />
        </NavGroup>

        <NavGroup label="Observe">
          <NavItem id="events" view={view} navigate={navigate} icon="event" label="Events" />
          <NavItem id="tasks" view={view} navigate={navigate} icon="task" label="Human tasks" count={window.RAAS_TASKS.length} highlight />
          <NavItem id="logs" view={view} navigate={navigate} icon="logs" label="Logs" />
        </NavGroup>

        <NavGroup label="Manage">
          <NavItem id="deployments" view={view} navigate={navigate} icon="deploy" label="Deployments" />
          <NavItem id="settings" view={view} navigate={navigate} icon="settings" label="Settings" disabled />
        </NavGroup>
      </nav>

      {/* Footer */}
      <footer style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, minWidth: 0 }}>
          <StatusDot status="ok" size={6} />
          <span style={{ color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 }}>Inngest</span>
          <span style={{ color: "var(--text-3)", fontFamily: "var(--mono)", whiteSpace: "nowrap", fontSize: 10 }}>3w · 0 lag</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, minWidth: 0 }}>
          <StatusDot status="ok" size={6} />
          <span style={{ color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 }}>SQLite</span>
          <span style={{ color: "var(--text-3)", fontFamily: "var(--mono)", whiteSpace: "nowrap", fontSize: 10 }}>8.4 MB</span>
        </div>
      </footer>
    </aside>
  );
}

function Logo() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24">
      <rect x="2" y="2" width="20" height="20" rx="5" fill="var(--signal)" />
      <g transform="translate(5,5)">
        <circle cx="3" cy="3" r="1.5" fill="#000" />
        <circle cx="11" cy="3" r="1.5" fill="#000" />
        <circle cx="3" cy="11" r="1.5" fill="#000" />
        <circle cx="11" cy="11" r="1.5" fill="#000" />
        <path d="M3 3 L11 3 M3 3 L3 11 M11 3 L11 11 M3 11 L11 11 M3 3 L11 11" stroke="#000" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}

function TenantSwitcher({ tenant, setTweak }) {
  const [open, setOpen] = useStateApp(false);
  return (
    <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", position: "relative" }}>
      <button onClick={() => setOpen(!open)} style={{
        display: "flex", alignItems: "center", gap: 10,
        width: "100%",
        padding: "8px 10px",
        background: "var(--panel)",
        border: "1px solid var(--border-2)",
        borderRadius: 5,
        textAlign: "left",
      }}>
        <div style={{ width: 22, height: 22, background: tenant.color, borderRadius: 3, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontFamily: "var(--mono)", color: "#000", fontWeight: 700 }}>
          {tenant.name[0]}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "var(--text)", fontWeight: 500 }}>{tenant.name}</div>
          <div style={{ fontSize: 10.5, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tenant.subtitle}</div>
        </div>
        <Icon name="chevron-down" size={11} style={{ color: "var(--text-3)" }} />
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 12, right: 12, zIndex: 50,
          marginTop: 4,
          background: "var(--panel)",
          border: "1px solid var(--border-2)",
          borderRadius: 5,
          boxShadow: "0 8px 20px rgba(0,0,0,0.4)",
          overflow: "hidden",
        }}>
          {window.TENANTS.map(t => (
            <button key={t.id}
              onClick={() => { setTweak("tenant", t.id); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                width: "100%", padding: "8px 10px",
                background: tenant.id === t.id ? "var(--panel-2)" : "transparent",
                textAlign: "left", fontSize: 12,
                borderBottom: "1px solid var(--border)",
              }}>
              <div style={{ width: 18, height: 18, background: t.color, borderRadius: 3, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ color: "var(--text)" }}>{t.name}</div>
                <div style={{ fontSize: 10, color: "var(--text-3)" }}>{t.agentCount} agents · {t.runs24h} runs/24h</div>
              </div>
              {tenant.id === t.id && <Icon name="check" size={12} style={{ color: "var(--signal)" }} />}
            </button>
          ))}
          <button style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", fontSize: 12, color: "var(--text-2)" }}>
            <Icon name="plus" size={11} /> New tenant
          </button>
        </div>
      )}
    </div>
  );
}

function NavGroup({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ padding: "6px 10px 4px 10px", fontSize: 10, fontFamily: "var(--mono)", textTransform: "uppercase", color: "var(--text-3)", letterSpacing: "0.12em" }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>{children}</div>
    </div>
  );
}

function NavItem({ id, view, navigate, icon, label, count, liveCount, highlight, disabled }) {
  const active = view === id;
  return (
    <button
      onClick={() => !disabled && navigate(id)}
      disabled={disabled}
      style={{
        display: "flex", alignItems: "center", gap: 9,
        padding: "6px 10px",
        background: active ? "var(--panel-2)" : "transparent",
        borderLeft: active ? "2px solid var(--signal)" : "2px solid transparent",
        color: disabled ? "var(--text-4)" : active ? "var(--text)" : "var(--text-2)",
        fontSize: 12.5,
        textAlign: "left",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 0.1s",
      }}
      onMouseEnter={(e) => { if (!active && !disabled) e.currentTarget.style.background = "var(--panel)"; }}
      onMouseLeave={(e) => { if (!active && !disabled) e.currentTarget.style.background = "transparent"; }}
    >
      <Icon name={icon} size={13} style={{ color: active ? "var(--text)" : "var(--text-3)" }} />
      <span style={{ flex: 1 }}>{label}</span>
      {liveCount != null && liveCount > 0 && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--signal)" }}>
          <span className="live-dot" style={{ width: 5, height: 5 }} />
          {liveCount}
        </span>
      )}
      {count != null && (
        <span style={{
          fontSize: 10, fontFamily: "var(--mono)",
          padding: "1px 6px",
          background: highlight ? "rgba(255,181,71,0.12)" : "var(--panel-2)",
          color: highlight ? "var(--amber)" : "var(--text-3)",
          borderRadius: 8,
          border: highlight ? "1px solid rgba(255,181,71,0.3)" : "1px solid var(--border)",
        }}>{count}</span>
      )}
    </button>
  );
}

function TopBar({ view, params, navigate, liveStream, setTweak }) {
  const crumb = (() => {
    if (view === "runs" && params.runId) return [{ label: "Runs", id: "runs" }, { label: params.runId }];
    if (view === "agents" && params.agentId) {
      const a = window.RAAS_AGENTS.find(x => x.id === params.agentId);
      return [{ label: "Agents", id: "agents", clear: true }, { label: a?.title || params.agentId }];
    }
    if (view === "events" && params.eventName) return [{ label: "Events", id: "events", clear: true }, { label: params.eventName }];
    if (view === "tasks" && params.taskId) return [{ label: "Tasks", id: "tasks" }, { label: params.taskId }];
    return null;
  })();

  return (
    <div style={{
      height: 44,
      borderBottom: "1px solid var(--border)",
      display: "flex", alignItems: "center",
      padding: "0 18px",
      gap: 14,
      background: "var(--bg)",
      flexShrink: 0,
    }}>
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-3)" }}>
        {crumb ? (
          <>
            {crumb.map((c, i) => i === crumb.length - 1 ? (
              <span key={i} style={{ color: "var(--text)" }} className={c.label.match(/^(run|TASK|REQ|CAN|evt)-/) ? "mono" : ""}>{c.label}</span>
            ) : (
              <React.Fragment key={i}>
                <button onClick={() => navigate(c.id, c.clear ? {} : {})} style={{ color: "var(--text-2)" }}>{c.label}</button>
                <Icon name="chevron-right" size={10} style={{ color: "var(--text-4)" }} />
              </React.Fragment>
            ))}
          </>
        ) : (
          <span style={{ color: "var(--text-2)", textTransform: "capitalize" }}>{view}</span>
        )}
      </div>

      {/* Cmd-K-ish search */}
      <button style={{
        marginLeft: "auto",
        display: "flex", alignItems: "center", gap: 8,
        padding: "5px 9px",
        background: "var(--panel)",
        border: "1px solid var(--border-2)",
        borderRadius: 5,
        fontSize: 11.5,
        color: "var(--text-3)",
        minWidth: 240,
      }}>
        <Icon name="search" size={11} />
        <span>Jump to agent, event, run…</span>
        <span style={{ marginLeft: "auto" }}><Kbd>⌘</Kbd> <Kbd>K</Kbd></span>
      </button>

      {/* Live toggle */}
      <button
        onClick={() => setTweak("liveStream", !liveStream)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "5px 10px",
          background: liveStream ? "rgba(208,255,0,0.08)" : "transparent",
          border: `1px solid ${liveStream ? "rgba(208,255,0,0.3)" : "var(--border-2)"}`,
          borderRadius: 5,
          fontSize: 11.5,
          fontFamily: "var(--mono)",
          letterSpacing: "0.04em",
          color: liveStream ? "var(--signal)" : "var(--text-3)",
        }}
      >
        <Icon name={liveStream ? "pause" : "play"} size={10} />
        {liveStream ? "LIVE" : "PAUSED"}
      </button>

      {/* User chip */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--violet)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#000", fontWeight: 600 }}>LW</div>
        <div style={{ fontSize: 11.5, color: "var(--text-2)" }}>Liu Wei</div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
