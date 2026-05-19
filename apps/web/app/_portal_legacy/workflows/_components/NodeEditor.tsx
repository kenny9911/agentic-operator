"use client";

import { useState } from "react";
import { Badge, Button, Icon } from "@/components";
import type { DagAgent } from "@agentic/contracts";

function FieldInline({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label
      style={{ display: "flex", flexDirection: "column", gap: 4 }}
    >
      <span
        style={{
          fontSize: 10.5,
          fontFamily: "var(--mono)",
          color: "var(--text-3)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function InlineText({
  value,
  onChange,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: "var(--panel-2)",
        border: "1px solid var(--border-2)",
        borderRadius: 4,
        padding: "5px 8px",
        color: "var(--text)",
        fontFamily: mono ? "var(--mono)" : "var(--sans)",
        fontSize: mono ? 11.5 : 12,
        outline: "none",
      }}
    />
  );
}

function InlineTextarea({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={3}
      style={{
        background: "var(--panel-2)",
        border: "1px solid var(--border-2)",
        borderRadius: 4,
        padding: "5px 8px",
        color: "var(--text)",
        fontFamily: "var(--sans)",
        fontSize: 12,
        outline: "none",
        resize: "vertical",
      }}
    />
  );
}

function EditableBadgeList({
  items,
  tone,
  placeholder,
}: {
  items: string[];
  tone: "blue" | "green" | "muted";
  placeholder: string;
}) {
  const colorMap = {
    blue: {
      fg: "var(--blue)",
      bg: "rgba(132,169,255,0.10)",
      bd: "rgba(132,169,255,0.32)",
    },
    green: {
      fg: "var(--green)",
      bg: "rgba(101,224,163,0.08)",
      bd: "rgba(101,224,163,0.30)",
    },
    muted: {
      fg: "var(--text-3)",
      bg: "var(--panel-2)",
      bd: "var(--border)",
    },
  };
  const c = colorMap[tone];
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 4,
        alignItems: "center",
      }}
    >
      {items.map((t) => (
        <span
          key={t}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 4px 2px 7px",
            fontSize: 10.5,
            fontFamily: "var(--mono)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: c.fg,
            background: c.bg,
            border: `1px solid ${c.bd}`,
            borderRadius: 3,
          }}
        >
          {t}
          <button
            style={{
              color: "currentColor",
              opacity: 0.6,
              padding: 1,
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
          >
            <Icon name="x" size={8} />
          </button>
        </span>
      ))}
      <button
        style={{
          padding: "2px 7px",
          fontSize: 10.5,
          fontFamily: "var(--mono)",
          color: "var(--text-3)",
          border: "1px dashed var(--border-2)",
          borderRadius: 3,
          background: "transparent",
          cursor: "pointer",
        }}
      >
        + {placeholder}
      </button>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: "12px 16px",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontFamily: "var(--mono)",
          textTransform: "uppercase",
          color: "var(--text-3)",
          letterSpacing: "0.08em",
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

export function NodeEditor({
  agent,
  onClose,
}: {
  agent: DagAgent;
  onClose: () => void;
}) {
  const [name, setName] = useState(agent.name);
  const [title, setTitle] = useState(agent.title);
  const [desc, setDesc] = useState("");

  return (
    <div
      style={{
        flex: 1,
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <Badge tone="amber">
              <Icon name="alert" size={9} /> EDITING
            </Badge>
            <Badge tone="muted">{agent.kebabId}</Badge>
          </div>
          <div
            style={{
              fontSize: 15,
              color: "var(--text)",
              fontWeight: 500,
              lineHeight: 1.3,
            }}
          >
            Edit node
          </div>
        </div>
        <Button small icon="x" tone="ghost" onClick={onClose} />
      </header>

      <Section title="Identity">
        <div
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <FieldInline label="Name (id)">
            <InlineText value={name} onChange={setName} mono />
          </FieldInline>
          <FieldInline label="Title">
            <InlineText value={title} onChange={setTitle} />
          </FieldInline>
          <FieldInline label="Description">
            <InlineTextarea value={desc} onChange={setDesc} />
          </FieldInline>
          <FieldInline label="Actor">
            <div
              style={{
                display: "flex",
                gap: 0,
                border: "1px solid var(--border-2)",
                borderRadius: 4,
                overflow: "hidden",
                width: "fit-content",
              }}
            >
              {(["Agent", "Human"] as const).map((o) => (
                <button
                  key={o}
                  style={{
                    padding: "4px 10px",
                    fontSize: 11,
                    fontFamily: "var(--mono)",
                    textTransform: "uppercase",
                    background:
                      agent.actor === o
                        ? "var(--panel-3)"
                        : "var(--panel-2)",
                    color:
                      agent.actor === o
                        ? "var(--text)"
                        : "var(--text-3)",
                    borderRight: "1px solid var(--border-2)",
                    borderBottom:
                      agent.actor === o
                        ? "2px solid var(--signal)"
                        : "2px solid transparent",
                    cursor: "pointer",
                  }}
                >
                  {o}
                </button>
              ))}
            </div>
          </FieldInline>
        </div>
      </Section>

      <Section title="Triggers · inbound events">
        <EditableBadgeList
          items={agent.triggers}
          tone="blue"
          placeholder="EVENT_NAME"
        />
      </Section>

      <Section title="Emits · outbound events">
        <EditableBadgeList
          items={agent.emits}
          tone="green"
          placeholder="EVENT_NAME"
        />
      </Section>

      <Section title="Model">
        <select
          defaultValue="claude-sonnet-4-5"
          style={{
            background: "var(--panel-2)",
            border: "1px solid var(--border-2)",
            borderRadius: 4,
            padding: "5px 8px",
            color: "var(--text)",
            fontSize: 12,
            fontFamily: "var(--mono)",
            outline: "none",
            width: "100%",
          }}
        >
          <option>claude-sonnet-4-5</option>
          <option>claude-haiku-4-5</option>
          <option>gpt-4.1-mini</option>
        </select>
      </Section>

      <div
        style={{
          padding: 14,
          marginTop: "auto",
          display: "flex",
          gap: 8,
          borderTop: "1px solid var(--border)",
        }}
      >
        <Button tone="danger" icon="x">
          Delete node
        </Button>
        <Button
          icon="check"
          tone="primary"
          style={{ marginLeft: "auto" }}
        >
          Apply
        </Button>
      </div>
    </div>
  );
}
