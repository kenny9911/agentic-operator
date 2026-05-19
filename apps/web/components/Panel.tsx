import type { CSSProperties, ReactNode } from "react";

export interface PanelProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
  padded?: boolean;
  scroll?: boolean;
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  style,
  padded = true,
  scroll = false,
}: PanelProps) {
  return (
    <section
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        overflow: scroll ? "hidden" : "visible",
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      {title && (
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 14px",
            borderBottom: "1px solid var(--border)",
            minHeight: 38,
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span
              style={{
                fontSize: 11,
                fontFamily: "var(--mono)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--text-2)",
              }}
            >
              {title}
            </span>
            {subtitle && (
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                {subtitle}
              </span>
            )}
          </div>
          {action && <div>{action}</div>}
        </header>
      )}
      <div
        style={{
          padding: padded ? 14 : 0,
          flex: 1,
          overflow: scroll ? "auto" : "visible",
          minHeight: 0,
        }}
      >
        {children}
      </div>
    </section>
  );
}
