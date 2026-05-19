"use client";

import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import { Badge, Icon, StatusDot, type IconName } from "@/components";

/**
 * Settings-local atoms — ported from prototype views/settings.jsx, runs.jsx,
 * dashboard.jsx. The visual contract matches the prototype 1:1.
 */

// ---------- Field row (left label / right control) ----------
export function Field({
  label,
  hint,
  children,
  locked,
  right,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  locked?: boolean;
  right?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "200px 1fr",
        gap: 16,
        padding: "14px 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div style={{ paddingTop: 5 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12.5,
            color: "var(--text)",
          }}
        >
          {label}
          {locked && (
            <Icon name="check" size={10} style={{ color: "var(--text-4)" }} />
          )}
        </div>
        {hint && (
          <div
            style={{
              marginTop: 3,
              fontSize: 11,
              color: "var(--text-3)",
              lineHeight: 1.5,
            }}
          >
            {hint}
          </div>
        )}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
        {right}
      </div>
    </div>
  );
}

// ---------- Text input ----------
export function TextIn({
  value,
  onChange,
  placeholder,
  mono,
  suffix,
  prefix,
}: {
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  suffix?: string;
  prefix?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "var(--panel-2)",
        border: "1px solid var(--border-2)",
        borderRadius: 5,
        padding: "6px 9px",
      }}
    >
      {prefix && (
        <span
          style={{
            fontSize: 12,
            color: "var(--text-3)",
            fontFamily: "var(--mono)",
          }}
        >
          {prefix}
        </span>
      )}
      <input
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1,
          background: "transparent",
          border: "none",
          outline: "none",
          color: "var(--text)",
          fontFamily: mono ? "var(--mono)" : "var(--sans)",
          fontSize: mono ? 12 : 12.5,
          minWidth: 0,
        }}
      />
      {suffix && (
        <span
          style={{
            fontSize: 11,
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

// ---------- Select ----------
export function SelectIn<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange?: (v: T) => void;
  options: Array<T | { value: T; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange?.(e.target.value as T)}
      style={{
        background: "var(--panel-2)",
        border: "1px solid var(--border-2)",
        borderRadius: 5,
        padding: "6px 9px",
        color: "var(--text)",
        fontSize: 12.5,
        fontFamily: "var(--sans)",
        outline: "none",
        cursor: "pointer",
        appearance: "none",
        backgroundImage:
          "linear-gradient(45deg, transparent 50%, var(--text-3) 50%), linear-gradient(135deg, var(--text-3) 50%, transparent 50%)",
        backgroundPosition: "calc(100% - 14px) 50%, calc(100% - 10px) 50%",
        backgroundSize: "4px 4px, 4px 4px",
        backgroundRepeat: "no-repeat",
        paddingRight: 26,
      }}
    >
      {options.map((o) => {
        if (typeof o === "string") {
          return (
            <option key={o} value={o}>
              {o}
            </option>
          );
        }
        return (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        );
      })}
    </select>
  );
}

// ---------- Toggle ----------
export function Toggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange?: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange?.(!value)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        background: value ? "var(--signal)" : "var(--panel-3)",
        border: `1px solid ${value ? "var(--signal)" : "var(--border-2)"}`,
        position: "relative",
        cursor: "pointer",
        transition: "background 0.12s",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 1,
          left: value ? 17 : 1,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: value ? "#000" : "var(--text-3)",
          transition: "left 0.12s",
        }}
      />
    </button>
  );
}

// ---------- Status pill (for integration rows) ----------
export function StatusPill({
  status,
}: {
  status: "ok" | "warn" | "err" | "off";
}) {
  const map = {
    ok:   { tone: "green" as const, label: "CONNECTED",    dot: "ok" as const },
    warn: { tone: "amber" as const, label: "DEGRADED",     dot: "waiting" as const },
    err:  { tone: "red"   as const, label: "ERROR",        dot: "failed" as const },
    off:  { tone: "muted" as const, label: "DISCONNECTED", dot: "idle" as const },
  };
  const t = map[status] ?? map.off;
  return (
    <Badge tone={t.tone}>
      <StatusDot status={t.dot} size={5} /> {t.label}
    </Badge>
  );
}

// ---------- Role badge ----------
export function RoleBadge({
  role,
}: {
  role: "Owner" | "Admin" | "Operator" | "Viewer" | "Service";
}) {
  const map = {
    Owner: "signal",
    Admin: "violet",
    Operator: "blue",
    Viewer: "muted",
    Service: "amber",
  } as const;
  return <Badge tone={map[role] ?? "muted"}>{role}</Badge>;
}

// ---------- Search input ----------
export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        flex: 1,
        padding: "5px 8px",
        background: "var(--panel-2)",
        border: "1px solid var(--border)",
        borderRadius: 4,
      }}
    >
      <Icon name="search" size={12} style={{ color: "var(--text-3)" }} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1,
          background: "transparent",
          border: "none",
          outline: "none",
          color: "var(--text)",
          fontSize: 12,
          fontFamily: "var(--sans)",
        }}
      />
    </div>
  );
}

// ---------- Filter chip ----------
export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "3px 9px",
        fontSize: 11,
        fontFamily: "var(--mono)",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: active ? "#000" : "var(--text-2)",
        background: active ? "var(--signal)" : "transparent",
        border: `1px solid ${active ? "var(--signal)" : "var(--border-2)"}`,
        borderRadius: 3,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

// ---------- Table cells ----------
export function Th({
  children,
  style,
}: {
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "8px 12px",
        fontSize: 10.5,
        fontFamily: "var(--mono)",
        fontWeight: 500,
        color: "var(--text-3)",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        ...style,
      }}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  style,
}: {
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <td style={{ padding: "8px 12px", verticalAlign: "middle", ...style }}>
      {children}
    </td>
  );
}

// ---------- Code block (used in CLI auth panel) ----------
export function CodeBlock({ children }: { children: ReactNode }) {
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

// ---------- Seg picker (Usage section period selector) ----------
export function SegPicker<T extends string>({
  value,
  onChange,
  options,
  small,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  small?: boolean;
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
            padding: small ? "3px 9px" : "5px 11px",
            fontSize: small ? 10.5 : 11.5,
            fontFamily: "var(--mono)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            background: value === o.value ? "var(--panel-3)" : "var(--panel-2)",
            color: value === o.value ? "var(--text)" : "var(--text-3)",
            borderRight: "1px solid var(--border-2)",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Integration glyph (small colored square w/ letter) ----------
export function IntegrationGlyph({ id }: { id: string }) {
  const colors: Record<string, string> = {
    anthropic: "#d97757",
    openai: "#10a37f",
    inngest: "#52525b",
    boss: "#3ed5a5",
    zhilian: "#1b75ff",
    liepin: "#ff6432",
    wechat: "#07c160",
    ses: "#ff9900",
    tencent: "#0052d9",
    github: "#6e7681",
  };
  const letter = id[0] ? id[0].toUpperCase() : "?";
  return (
    <div
      style={{
        width: 30,
        height: 30,
        borderRadius: 6,
        background: colors[id] ?? "var(--panel-3)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        fontWeight: 700,
        color: "#fff",
        flexShrink: 0,
        fontFamily: "var(--mono)",
      }}
    >
      {letter}
    </div>
  );
}

// ---------- Spec cell (4-up grid in model drawer) ----------
export function SpecCell({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div
      style={{
        padding: "6px 8px",
        background: "var(--panel-2)",
        border: "1px solid var(--border)",
        borderRadius: 3,
      }}
    >
      <div
        style={{
          color: "var(--text-4)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontSize: 9.5,
        }}
      >
        {label}
      </div>
      <div style={{ color: "var(--text)", marginTop: 1, fontSize: 12 }}>
        {value}
      </div>
    </div>
  );
}

// ---------- Slider row ----------
export function SliderRow({
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  format,
}: {
  value: number;
  onChange?: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div
        style={{
          flex: 1,
          position: "relative",
          height: 18,
          display: "flex",
          alignItems: "center",
        }}
      >
        <div
          style={{
            width: "100%",
            height: 3,
            background: "var(--bg-2)",
            borderRadius: 2,
            position: "relative",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              height: "100%",
              width: `${pct}%`,
              background: "var(--signal)",
            }}
          />
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange?.(parseFloat(e.target.value))}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: "100%",
            opacity: 0,
            cursor: "pointer",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `calc(${pct}% - 6px)`,
            top: 3,
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: "var(--signal)",
            border: "2px solid var(--bg)",
            pointerEvents: "none",
          }}
        />
      </div>
      <span
        className="mono"
        style={{
          fontSize: 12,
          color: "var(--text)",
          minWidth: 44,
          textAlign: "right",
        }}
      >
        {format ? format(value) : value.toFixed(2)}
      </span>
    </div>
  );
}

// ---------- Secret input ----------
export function SecretInput({
  value,
  onChange,
  placeholder,
  prefix,
}: {
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  prefix?: string;
}) {
  const [show, setShow] = useState(false);
  const [pasted, setPasted] = useState(false);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 0,
        background: "var(--bg-2)",
        border: "1px solid var(--border-2)",
        borderRadius: 5,
        overflow: "hidden",
      }}
    >
      {prefix && (
        <span
          className="mono"
          style={{
            padding: "8px 4px 8px 10px",
            fontSize: 12,
            color: "var(--text-4)",
          }}
        >
          {prefix}
        </span>
      )}
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => {
          onChange?.(e.target.value);
          setPasted(false);
        }}
        onPaste={() => setPasted(true)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        style={{
          flex: 1,
          background: "transparent",
          border: "none",
          outline: "none",
          color: "var(--text)",
          fontFamily: "var(--mono)",
          fontSize: 12,
          padding: prefix ? "8px 4px" : "8px 10px",
          letterSpacing: show ? 0 : "0.08em",
          minWidth: 0,
        }}
      />
      {pasted && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "0 8px",
            fontSize: 10,
            fontFamily: "var(--mono)",
            color: "var(--green)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          <Icon name="check" size={9} /> pasted
        </span>
      )}
      <button
        onClick={() => setShow((s) => !s)}
        title={show ? "Hide" : "Show"}
        style={{
          padding: "0 10px",
          borderLeft: "1px solid var(--border-2)",
          color: "var(--text-3)",
          fontFamily: "var(--mono)",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          background: "transparent",
          cursor: "pointer",
        }}
      >
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}

// ---------- StepDot (Add Provider modal stepper) ----------
export function StepDot({
  label,
  active,
  done,
}: {
  label: string;
  active?: boolean;
  done?: boolean;
}) {
  return (
    <span
      style={{
        padding: "3px 6px",
        borderRadius: 3,
        background: active
          ? "var(--signal)"
          : done
            ? "rgba(208,255,0,0.10)"
            : "transparent",
        border: `1px solid ${active ? "var(--signal)" : done ? "rgba(208,255,0,0.30)" : "var(--border-2)"}`,
        color: active ? "#000" : done ? "var(--signal)" : "var(--text-3)",
      }}
    >
      {label}
    </span>
  );
}

// Re-export for convenience inside settings files
export type { IconName };
