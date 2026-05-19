import type { ReactNode } from "react";

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "up" | "down" | "neutral";
  accent?: string;
  mono?: boolean;
  big?: boolean;
}

export function Stat({
  label,
  value,
  sub,
  tone,
  accent,
  mono = true,
  big,
}: StatProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontFamily: "var(--mono)",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: "var(--text-3)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: big ? 28 : 22,
          fontFamily: mono ? "var(--mono)" : "var(--sans)",
          fontWeight: 500,
          letterSpacing: "-0.01em",
          color: accent || "var(--text)",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            fontSize: 11,
            color:
              tone === "down"
                ? "var(--red)"
                : tone === "up"
                  ? "var(--green)"
                  : "var(--text-3)",
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
