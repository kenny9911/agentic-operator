"use client";

import { Icon, Kbd } from "@/components";

export function EditDraftBanner({ onDiscard }: { onDiscard: () => void }) {
  return (
    <div
      style={{
        padding: "10px 24px",
        background: "rgba(255,181,71,0.06)",
        borderBottom: "1px solid rgba(255,181,71,0.25)",
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexShrink: 0,
      }}
    >
      <Icon name="alert" size={12} style={{ color: "var(--amber)" }} />
      <div style={{ fontSize: 12, color: "var(--text)" }}>
        <span
          style={{
            color: "var(--amber)",
            fontFamily: "var(--mono)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontSize: 10.5,
          }}
        >
          EDITING DRAFT
        </span>
        <span style={{ marginLeft: 12, color: "var(--text-2)" }}>
          2 nodes added · 2 modified · 0 removed
        </span>
        <span
          style={{
            marginLeft: 12,
            color: "var(--text-3)",
            fontFamily: "var(--mono)",
          }}
        >
          auto-saved 12s ago
        </span>
      </div>
      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          gap: 8,
          alignItems: "center",
          fontSize: 11,
          fontFamily: "var(--mono)",
          color: "var(--text-3)",
        }}
      >
        <span>
          <Kbd>⌘</Kbd> <Kbd>Z</Kbd> undo
        </span>
        <span>
          <Kbd>V</Kbd> select
        </span>
        <span>
          <Kbd>C</Kbd> connect
        </span>
        <span>
          <Kbd>N</Kbd> add node
        </span>
      </div>
    </div>
  );
}
