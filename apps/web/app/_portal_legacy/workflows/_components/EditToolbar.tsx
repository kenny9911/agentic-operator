"use client";

import { Icon, type IconName } from "@/components";

export type EditTool = "select" | "connect" | "add";

export function EditToolbar({
  tool,
  setTool,
}: {
  tool: EditTool;
  setTool: (t: EditTool) => void;
}) {
  const tools: Array<{ id: EditTool; icon: IconName; label: string }> = [
    { id: "select",  icon: "filter", label: "Select" },
    { id: "connect", icon: "git",    label: "Connect" },
    { id: "add",     icon: "plus",   label: "Add" },
  ];
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        zIndex: 20,
        display: "flex",
        gap: 1,
        background: "var(--panel)",
        border: "1px solid var(--border-2)",
        borderRadius: 6,
        padding: 2,
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      }}
    >
      {tools.map((t) => (
        <button
          key={t.id}
          onClick={() => setTool(t.id)}
          title={t.label}
          style={{
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: tool === t.id ? "var(--signal)" : "transparent",
            color: tool === t.id ? "#000" : "var(--text-2)",
            borderRadius: 4,
            border: "none",
            cursor: "pointer",
          }}
        >
          <Icon name={t.icon} size={13} />
        </button>
      ))}
      <div
        style={{
          width: 1,
          background: "var(--border)",
          margin: "4px 4px",
        }}
      />
      <button
        title="Auto-layout"
        style={{
          width: 32,
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-2)",
          background: "transparent",
          border: "none",
          cursor: "pointer",
        }}
      >
        <Icon name="dashboard" size={13} />
      </button>
      <button
        title="Zoom to fit"
        style={{
          width: 32,
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-2)",
          background: "transparent",
          border: "none",
          cursor: "pointer",
        }}
      >
        <Icon name="external" size={13} />
      </button>
    </div>
  );
}
