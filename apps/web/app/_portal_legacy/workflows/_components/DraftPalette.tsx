"use client";

import { Icon } from "@/components";

function DiffRow({
  kind,
  name,
  hint,
}: {
  kind: "add" | "del" | "mod";
  name: string;
  hint: string;
}) {
  const tone =
    kind === "add"
      ? "var(--green)"
      : kind === "del"
        ? "var(--red)"
        : "var(--amber)";
  const sigil = kind === "add" ? "+" : kind === "del" ? "−" : "~";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 8px",
        background: "var(--bg-2)",
        border: "1px solid var(--border)",
        borderRadius: 3,
      }}
    >
      <span
        className="mono"
        style={{ color: tone, width: 12, fontWeight: 700 }}
      >
        {sigil}
      </span>
      <span
        className="mono"
        style={{ color: "var(--text-2)", fontSize: 11.5 }}
      >
        {name}
      </span>
      <span
        style={{
          marginLeft: "auto",
          color: "var(--text-3)",
          fontSize: 10.5,
        }}
      >
        {hint}
      </span>
    </div>
  );
}

export function DraftPalette() {
  const presets = [
    {
      kind: "Agent",
      title: "New agent node",
      sub: "Code-backed step",
      color: "var(--signal)",
    },
    {
      kind: "Human",
      title: "Human task",
      sub: "Pause for approval",
      color: "var(--violet)",
    },
    {
      kind: "Agent",
      title: "From template…",
      sub: "matchResume, etc.",
      color: "var(--text-3)",
    },
  ];
  return (
    <div
      style={{
        flex: 1,
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontFamily: "var(--mono)",
            textTransform: "uppercase",
            color: "var(--text-3)",
            letterSpacing: "0.08em",
            marginBottom: 4,
          }}
        >
          Editing
        </div>
        <div style={{ fontSize: 14, color: "var(--text)" }}>
          raas{" "}
          <span
            style={{
              color: "var(--amber)",
              fontFamily: "var(--mono)",
              fontSize: 11,
            }}
          >
            · DRAFT
          </span>
        </div>
      </div>

      <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontFamily: "var(--mono)",
            textTransform: "uppercase",
            color: "var(--text-3)",
            letterSpacing: "0.08em",
            marginBottom: 8,
          }}
        >
          Drag onto canvas
        </div>
        <div
          style={{ display: "flex", flexDirection: "column", gap: 6 }}
        >
          {presets.map((p, i) => (
            <div
              key={i}
              draggable
              style={{
                padding: "8px 10px",
                background: "var(--panel-2)",
                border: "1px dashed var(--border-2)",
                borderLeft: `3px solid ${p.color}`,
                borderRadius: 4,
                cursor: "grab",
              }}
            >
              <div style={{ fontSize: 12, color: "var(--text)" }}>
                {p.title}
              </div>
              <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                {p.sub}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontFamily: "var(--mono)",
            textTransform: "uppercase",
            color: "var(--text-3)",
            letterSpacing: "0.08em",
            marginBottom: 8,
          }}
        >
          Pending changes
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            fontSize: 11.5,
          }}
        >
          <DiffRow kind="mod" name="matchResume" hint="Bonus weights for WXG" />
          <DiffRow
            kind="mod"
            name="analyzeRequirement"
            hint="Added market.lookup tool"
          />
          <DiffRow
            kind="add"
            name="enrichCandidateLinkedIn"
            hint="New agent · stage 4"
          />
          <DiffRow
            kind="add"
            name="generateRecommendationPackage"
            hint="Wired to evaluateInterview"
          />
        </div>
      </div>

      <div
        style={{
          padding: "14px 16px",
          marginTop: "auto",
          borderTop: "1px solid var(--border)",
          fontSize: 11.5,
          color: "var(--text-3)",
          lineHeight: 1.55,
        }}
      >
        <Icon name="check" size={11} style={{ color: "var(--green)" }} /> Graph
        valid · 0 cycles · 0 orphans
      </div>
    </div>
  );
}
