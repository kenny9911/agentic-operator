import type { CSSProperties, ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * Small server-component-safe primitives ported from prototype components.jsx:
 * Badge, StatusDot, ActorTag, Kbd, Empty.
 */

type BadgeTone =
  | "default"
  | "signal"
  | "green"
  | "blue"
  | "amber"
  | "red"
  | "violet"
  | "muted"
  | "solid";

const BADGE_TONES: Record<
  BadgeTone,
  { bg: string; fg: string; border: string }
> = {
  default: { bg: "transparent", fg: "var(--text-2)", border: "var(--border-2)" },
  signal: {
    bg: "rgba(208,255,0,0.08)",
    fg: "var(--signal)",
    border: "rgba(208,255,0,0.32)",
  },
  green: {
    bg: "rgba(101,224,163,0.08)",
    fg: "var(--green)",
    border: "rgba(101,224,163,0.30)",
  },
  blue: {
    bg: "rgba(132,169,255,0.10)",
    fg: "var(--blue)",
    border: "rgba(132,169,255,0.32)",
  },
  amber: {
    bg: "rgba(255,181,71,0.10)",
    fg: "var(--amber)",
    border: "rgba(255,181,71,0.32)",
  },
  red: {
    bg: "rgba(255,100,112,0.10)",
    fg: "var(--red)",
    border: "rgba(255,100,112,0.34)",
  },
  violet: {
    bg: "rgba(181,148,255,0.10)",
    fg: "var(--violet)",
    border: "rgba(181,148,255,0.30)",
  },
  muted: { bg: "var(--panel-2)", fg: "var(--text-3)", border: "var(--border)" },
  solid: { bg: "var(--signal)", fg: "#000", border: "var(--signal)" },
};

export function Badge({
  children,
  tone = "default",
  style,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  style?: CSSProperties;
}) {
  const t = BADGE_TONES[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 7px",
        fontSize: 10.5,
        fontFamily: "var(--mono)",
        fontWeight: 500,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: t.fg,
        background: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: 3,
        lineHeight: 1.4,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function ActorTag({ actor }: { actor: "Agent" | "Human" }) {
  if (actor === "Agent") {
    return (
      <Badge tone="signal" style={{ background: "rgba(208,255,0,0.06)" }}>
        <Icon name="dot" size={6} /> AGENT
      </Badge>
    );
  }
  return (
    <Badge tone="violet">
      <Icon name="human" size={9} /> HUMAN
    </Badge>
  );
}

export type StatusName =
  | "running"
  | "ok"
  | "failed"
  | "waiting"
  | "paused"
  | "idle";

const STATUS_MAP: Record<
  StatusName,
  { color: string; glow?: boolean; pulse?: boolean }
> = {
  running: { color: "var(--signal)", glow: true, pulse: true },
  ok: { color: "var(--green)" },
  failed: { color: "var(--red)" },
  waiting: { color: "var(--amber)", pulse: true },
  paused: { color: "var(--blue)" },
  idle: { color: "var(--text-3)" },
};

export function StatusDot({
  status,
  size = 7,
}: {
  status: StatusName;
  size?: number;
}) {
  const s = STATUS_MAP[status] || STATUS_MAP.idle;
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: s.color,
        boxShadow: s.glow ? `0 0 8px ${s.color}` : "none",
        animation: s.pulse ? "pulse 1.4s infinite" : "none",
        flexShrink: 0,
      }}
    />
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      style={{
        display: "inline-block",
        padding: "1px 5px",
        fontSize: 10,
        fontFamily: "var(--mono)",
        color: "var(--text-2)",
        background: "var(--panel-2)",
        border: "1px solid var(--border-2)",
        borderBottom: "2px solid var(--border-2)",
        borderRadius: 3,
        lineHeight: 1.2,
      }}
    >
      {children}
    </kbd>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div
      style={{
        padding: "60px 20px",
        textAlign: "center",
        color: "var(--text-3)",
      }}
    >
      <div style={{ fontSize: 14, color: "var(--text-2)" }}>{title}</div>
      {hint && <div style={{ marginTop: 6, fontSize: 12 }}>{hint}</div>}
    </div>
  );
}

export function eventTone(
  color: string,
): "green" | "blue" | "amber" | "red" | "muted" | "default" {
  const map: Record<string, "green" | "blue" | "amber" | "red" | "muted"> = {
    green: "green",
    blue: "blue",
    amber: "amber",
    red: "red",
    muted: "muted",
  };
  return map[color] ?? "default";
}
