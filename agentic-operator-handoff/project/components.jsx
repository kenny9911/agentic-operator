// Shared UI components for Agentic Operator portal

const { useState, useEffect, useRef, useMemo, useCallback, createContext, useContext } = React;

// ------------- Icons (minimal monoline; 16px or 14px) -------------
function Icon({ name, size = 14, color, style }) {
  const s = { width: size, height: size, color: color || "currentColor", display: "inline-block", verticalAlign: "middle", ...style };
  const stroke = "currentColor";
  const sw = 1.5;
  const common = { fill: "none", stroke, strokeWidth: sw, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    case "dashboard":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><rect x="2" y="2" width="5" height="5"/><rect x="9" y="2" width="5" height="5"/><rect x="2" y="9" width="5" height="5"/><rect x="9" y="9" width="5" height="5"/></g></svg>);
    case "agent":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><circle cx="8" cy="6" r="2.4"/><path d="M3 13.5c.7-2 2.7-3.3 5-3.3s4.3 1.3 5 3.3"/></g></svg>);
    case "workflow":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><circle cx="3" cy="4" r="1.5"/><circle cx="3" cy="12" r="1.5"/><circle cx="13" cy="8" r="1.5"/><path d="M4.5 4 H8 a2 2 0 0 1 2 2 v1 M4.5 12 H8 a2 2 0 0 0 2 -2 V9"/></g></svg>);
    case "run":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><path d="M5 3.5v9l7-4.5z" fill="currentColor"/></g></svg>);
    case "event":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><path d="M9 2 L4 9 H7 L6 14 L12 7 H9 Z" fill="currentColor"/></g></svg>);
    case "task":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><rect x="3" y="3" width="10" height="10" rx="1"/><path d="M5.5 8 l1.5 1.5 L10.5 6"/></g></svg>);
    case "logs":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><path d="M3 3 H13 M3 6.5 H13 M3 10 H10 M3 13.5 H8"/></g></svg>);
    case "deploy":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><path d="M8 2 L13 5 V11 L8 14 L3 11 V5 Z"/><path d="M8 8 L13 5 M8 8 L3 5 M8 8 V14"/></g></svg>);
    case "settings":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><circle cx="8" cy="8" r="2"/><path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4"/></g></svg>);
    case "search":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><circle cx="7" cy="7" r="4"/><path d="M10 10 l3.5 3.5"/></g></svg>);
    case "plus":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><path d="M8 3.5v9M3.5 8h9"/></g></svg>);
    case "chevron-down":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><path d="M4 6 L8 10 L12 6"/></g></svg>);
    case "chevron-right":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><path d="M6 4 L10 8 L6 12"/></g></svg>);
    case "chevron-left":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><path d="M10 4 L6 8 L10 12"/></g></svg>);
    case "external":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><path d="M9 3 H13 V7"/><path d="M13 3 L7.5 8.5"/><path d="M11 9 V13 H3 V5 H7"/></g></svg>);
    case "filter":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><path d="M2.5 3.5 H13.5 L9.5 8.5 V12 L6.5 13.5 V8.5 Z"/></g></svg>);
    case "play":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><path d="M5 3 L13 8 L5 13 Z" fill="currentColor"/></g></svg>);
    case "pause":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><rect x="4" y="3" width="3" height="10" fill="currentColor"/><rect x="9" y="3" width="3" height="10" fill="currentColor"/></g></svg>);
    case "replay":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><path d="M3 8 a5 5 0 1 0 1.8 -3.85"/><path d="M3 3 V5 H5"/></g></svg>);
    case "x":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><path d="M4 4 L12 12 M12 4 L4 12"/></g></svg>);
    case "check":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><path d="M3 8.5 L6.5 12 L13 4.5"/></g></svg>);
    case "alert":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><path d="M8 2 L14 13 H2 Z"/><path d="M8 6 V9 M8 11 V11.5" strokeLinecap="round"/></g></svg>);
    case "spark":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><path d="M8 1.5 L9.2 6.8 L14.5 8 L9.2 9.2 L8 14.5 L6.8 9.2 L1.5 8 L6.8 6.8 Z" fill="currentColor"/></g></svg>);
    case "human":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><circle cx="8" cy="5" r="2.4"/><path d="M3 14 c0-2.8 2.2-4.5 5-4.5s5 1.7 5 4.5"/></g></svg>);
    case "dot":
      return (<svg style={s} viewBox="0 0 16 16"><circle cx="8" cy="8" r="3" fill="currentColor"/></svg>);
    case "git":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><circle cx="4" cy="3" r="1.5"/><circle cx="4" cy="13" r="1.5"/><circle cx="12" cy="8" r="1.5"/><path d="M4 4.5 V11.5 M4 8 H10.5"/></g></svg>);
    case "code":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><path d="M5 4 L1.5 8 L5 12 M11 4 L14.5 8 L11 12"/></g></svg>);
    case "upload":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><path d="M8 2 V11 M4.5 5.5 L8 2 L11.5 5.5"/><path d="M2.5 13 H13.5"/></g></svg>);
    case "tenant":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><rect x="2.5" y="6" width="11" height="7.5"/><path d="M5 6 V3 H11 V6 M5.5 9 H6.5 M9.5 9 H10.5 M5.5 11.5 H6.5 M9.5 11.5 H10.5"/></g></svg>);
    case "moon":
      return (<svg style={s} viewBox="0 0 16 16"><g {...common}><path d="M13 9.5 A6 6 0 1 1 6.5 3 a4.5 4.5 0 0 0 6.5 6.5 Z" fill="currentColor"/></g></svg>);
    default:
      return null;
  }
}
window.Icon = Icon;

// ------------- Badge -------------
function Badge({ children, tone = "default", style }) {
  const tones = {
    default: { bg: "transparent", fg: "var(--text-2)", border: "var(--border-2)" },
    signal: { bg: "rgba(208,255,0,0.08)", fg: "var(--signal)", border: "rgba(208,255,0,0.32)" },
    green:  { bg: "rgba(101,224,163,0.08)", fg: "var(--green)", border: "rgba(101,224,163,0.30)" },
    blue:   { bg: "rgba(132,169,255,0.10)", fg: "var(--blue)", border: "rgba(132,169,255,0.32)" },
    amber:  { bg: "rgba(255,181,71,0.10)", fg: "var(--amber)", border: "rgba(255,181,71,0.32)" },
    red:    { bg: "rgba(255,100,112,0.10)", fg: "var(--red)", border: "rgba(255,100,112,0.34)" },
    violet: { bg: "rgba(181,148,255,0.10)", fg: "var(--violet)", border: "rgba(181,148,255,0.30)" },
    muted:  { bg: "var(--panel-2)", fg: "var(--text-3)", border: "var(--border)" },
    solid:  { bg: "var(--signal)", fg: "#000", border: "var(--signal)" },
  };
  const t = tones[tone] || tones.default;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "2px 7px",
      fontSize: 10.5, fontFamily: "var(--mono)",
      fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase",
      color: t.fg, background: t.bg,
      border: `1px solid ${t.border}`,
      borderRadius: 3,
      lineHeight: 1.4,
      whiteSpace: "nowrap",
      ...style,
    }}>{children}</span>
  );
}
window.Badge = Badge;

// ------------- ActorTag (Agent vs Human) -------------
function ActorTag({ actor, compact }) {
  if (actor === "Agent") {
    return <Badge tone="signal" style={{ background: "rgba(208,255,0,0.06)" }}>
      <Icon name="dot" size={6} /> AGENT
    </Badge>;
  }
  return <Badge tone="violet">
    <Icon name="human" size={9} /> HUMAN
  </Badge>;
}
window.ActorTag = ActorTag;

// ------------- StatusDot -------------
function StatusDot({ status, size = 7 }) {
  const map = {
    running: { color: "var(--signal)", glow: true, pulse: true },
    ok: { color: "var(--green)" },
    failed: { color: "var(--red)" },
    waiting: { color: "var(--amber)", pulse: true },
    paused: { color: "var(--blue)" },
    idle: { color: "var(--text-3)" },
  };
  const s = map[status] || map.idle;
  return (
    <span style={{
      display: "inline-block",
      width: size, height: size,
      borderRadius: "50%",
      background: s.color,
      boxShadow: s.glow ? `0 0 8px ${s.color}` : "none",
      animation: s.pulse ? "pulse 1.4s infinite" : "none",
      flexShrink: 0,
    }} />
  );
}
window.StatusDot = StatusDot;

// ------------- Panel (the workhorse) -------------
function Panel({ title, subtitle, action, children, style, padded = true, scroll = false }) {
  return (
    <section style={{
      background: "var(--panel)",
      border: "1px solid var(--border)",
      borderRadius: 8,
      overflow: scroll ? "hidden" : "visible",
      display: "flex", flexDirection: "column",
      ...style,
    }}>
      {title && (
        <header style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 14px", borderBottom: "1px solid var(--border)",
          minHeight: 38, flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 11, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-2)" }}>{title}</span>
            {subtitle && <span style={{ fontSize: 11, color: "var(--text-3)" }}>{subtitle}</span>}
          </div>
          {action && <div>{action}</div>}
        </header>
      )}
      <div style={{
        padding: padded ? "14px" : 0,
        flex: 1,
        overflow: scroll ? "auto" : "visible",
        minHeight: 0,
      }}>
        {children}
      </div>
    </section>
  );
}
window.Panel = Panel;

// ------------- Stat (compact KPI) -------------
function Stat({ label, value, sub, tone, accent, mono = true, big }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-3)" }}>{label}</div>
      <div style={{
        fontSize: big ? 28 : 22,
        fontFamily: mono ? "var(--mono)" : "var(--sans)",
        fontWeight: 500,
        letterSpacing: "-0.01em",
        color: accent || "var(--text)",
        lineHeight: 1.1,
      }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: tone === "down" ? "var(--red)" : tone === "up" ? "var(--green)" : "var(--text-3)" }}>{sub}</div>}
    </div>
  );
}
window.Stat = Stat;

// ------------- Button -------------
function Button({ children, tone = "default", icon, onClick, small, style, title }) {
  const tones = {
    default: { bg: "transparent", fg: "var(--text)", border: "var(--border-2)", hover: "var(--panel-2)" },
    primary: { bg: "var(--signal)", fg: "#000", border: "var(--signal)", hover: "var(--signal)" },
    ghost:   { bg: "transparent", fg: "var(--text-2)", border: "transparent", hover: "var(--panel-2)" },
    danger:  { bg: "transparent", fg: "var(--red)", border: "rgba(255,100,112,0.35)", hover: "rgba(255,100,112,0.08)" },
  };
  const t = tones[tone];
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      title={title}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: small ? "4px 8px" : "5px 11px",
        fontSize: small ? 11 : 12, fontFamily: "var(--sans)", fontWeight: 500,
        color: t.fg,
        background: hov ? t.hover : t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: 5,
        transition: "background 0.12s",
        whiteSpace: "nowrap",
        ...style,
      }}>
      {icon && <Icon name={icon} size={small ? 11 : 12} />}
      {children}
    </button>
  );
}
window.Button = Button;

// ------------- Sparkline (inline SVG line for KPIs) -------------
function Sparkline({ values, width = 80, height = 22, color = "var(--signal)", filled = true }) {
  if (!values || values.length === 0) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = Math.max(1, max - min);
  const w = width;
  const h = height;
  const pad = 1.5;
  const stepX = (w - pad * 2) / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => `${pad + i * stepX},${pad + (h - pad * 2) * (1 - (v - min) / range)}`);
  const linePath = "M" + pts.join(" L");
  const areaPath = `${linePath} L${pad + (values.length - 1) * stepX},${h - pad} L${pad},${h - pad} Z`;
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      {filled && <path d={areaPath} fill={color} opacity={0.12} />}
      <path d={linePath} stroke={color} fill="none" strokeWidth={1.25} />
    </svg>
  );
}
window.Sparkline = Sparkline;

// ------------- Time / formatting helpers -------------
window.fmtAgo = function (ms) {
  const d = Date.now() - ms;
  if (d < 60_000) return `${Math.max(1, Math.floor(d/1000))}s ago`;
  if (d < 3_600_000) return `${Math.floor(d/60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d/3_600_000)}h ago`;
  return `${Math.floor(d/86_400_000)}d ago`;
};
window.fmtDur = function (ms) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms/1000).toFixed(2)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms/60_000)}m ${Math.floor((ms%60_000)/1000)}s`;
  return `${Math.floor(ms/3_600_000)}h ${Math.floor((ms%3_600_000)/60_000)}m`;
};
window.fmtBytes = function (n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n/1024).toFixed(1)} KB`;
  return `${(n/1024/1024).toFixed(1)} MB`;
};
window.fmtNum = function (n) {
  if (n >= 1_000_000) return (n/1_000_000).toFixed(1) + "M";
  if (n >= 1000) return (n/1000).toFixed(1) + "K";
  return String(n);
};
window.fmtTime = function (ms) {
  const d = new Date(ms);
  return d.toTimeString().slice(0, 8);
};

// ------------- KBD -------------
function Kbd({ children }) {
  return (
    <kbd style={{
      display: "inline-block",
      padding: "1px 5px",
      fontSize: 10, fontFamily: "var(--mono)",
      color: "var(--text-2)",
      background: "var(--panel-2)",
      border: "1px solid var(--border-2)",
      borderBottom: "2px solid var(--border-2)",
      borderRadius: 3,
      lineHeight: 1.2,
    }}>{children}</kbd>
  );
}
window.Kbd = Kbd;

// ------------- Section header inside a view -------------
function ViewHeader({ title, subtitle, badge, action }) {
  return (
    <header style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "18px 24px 16px 24px",
      borderBottom: "1px solid var(--border)",
      flexShrink: 0,
      gap: 16,
    }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h1 style={{
            margin: 0,
            fontSize: 22, fontFamily: "var(--display)", fontWeight: 400,
            letterSpacing: "-0.015em", color: "var(--text)",
            lineHeight: 1.1,
            whiteSpace: "nowrap",
          }}>{title}</h1>
          {badge && <span style={{ display: "inline-flex", alignItems: "center" }}>{badge}</span>}
        </div>
        {subtitle && <div style={{ marginTop: 5, fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>{subtitle}</div>}
      </div>
      {action && <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>{action}</div>}
    </header>
  );
}
window.ViewHeader = ViewHeader;

// ------------- Empty state -------------
function Empty({ title, hint }) {
  return (
    <div style={{ padding: "60px 20px", textAlign: "center", color: "var(--text-3)" }}>
      <div style={{ fontSize: 14, color: "var(--text-2)" }}>{title}</div>
      {hint && <div style={{ marginTop: 6, fontSize: 12 }}>{hint}</div>}
    </div>
  );
}
window.Empty = Empty;

// ------------- Color helper for event tones -------------
window.eventTone = function (color) {
  return { green: "green", blue: "blue", amber: "amber", red: "red", muted: "muted" }[color] || "default";
};

console.log("[Agentic Operator] components loaded");
