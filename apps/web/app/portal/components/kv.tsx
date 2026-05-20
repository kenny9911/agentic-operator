import type { ReactNode } from "react";

/**
 * KV — label/value row. Ported from v1_1 views/tasks.jsx:280-288 where it
 * was defined and exposed on `window`. Used in Tasks detail and Agents
 * detail config tabs.
 *
 * Layout: `120px | 1fr` grid, mono uppercase label, value either mono or
 * sans depending on `mono` prop (matches v1_1 exactly).
 */

export interface KVProps {
  label: ReactNode;
  value: ReactNode;
  mono?: boolean;
}

export function KV({ label, value, mono }: KVProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "120px 1fr",
        gap: 8,
        fontSize: 12.5,
        alignItems: "center",
      }}
    >
      <span
        style={{
          fontSize: 10.5,
          fontFamily: "var(--mono)",
          textTransform: "uppercase",
          color: "var(--text-3)",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: "var(--text)",
          fontFamily: mono ? "var(--mono)" : "var(--sans)",
        }}
      >
        {value}
      </span>
    </div>
  );
}
