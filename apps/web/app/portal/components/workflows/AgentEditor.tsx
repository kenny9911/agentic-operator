"use client";

/**
 * AgentEditor — inline node editor for the Workflow editor (P3-FE-01).
 *
 * Drops into the right inspector aside when `editing && selectedAgent`. The
 * operator changes title / triggers / triggered_event, those mutations go
 * into the draft, and the "Save & deploy" action in the top toolbar fires
 * `POST /v1/agents`.
 *
 * Triggers and triggered_event are managed as comma-or-newline-separated
 * lists; we trim + dedupe on commit.
 */

import { useState, useEffect } from "react";
import { ActorTag, Badge, Button } from "@/app/portal/components";
import type { RaasAgent, RaasEvent } from "@/lib/hooks/data-context";
import { Section } from "./inspectors";
import type { DraftAgent } from "./draft";

export interface AgentEditorProps {
  agent: RaasAgent;
  events: RaasEvent[];
  /** Current draft for this agent (so the editor stays controlled across re-renders). */
  draft: DraftAgent | undefined;
  onChange: (next: DraftAgent) => void;
  onRemove: () => void;
  onClose: () => void;
}

export function AgentEditor({
  agent,
  events,
  draft,
  onChange,
  onRemove,
  onClose,
}: AgentEditorProps) {
  const effective = mergeAgent(agent, draft);
  const [titleInput, setTitleInput] = useState(effective.title);
  const [triggerInput, setTriggerInput] = useState(effective.triggers.join(", "));
  const [emitInput, setEmitInput] = useState(effective.emits.join(", "));

  // When the agent changes (operator picks a different node), reset inputs.
  useEffect(() => {
    setTitleInput(effective.title);
    setTriggerInput(effective.triggers.join(", "));
    setEmitInput(effective.emits.join(", "));
    // We intentionally key off agent.id so React's lint rule isn't quite
    // right; rerunning on every field change would clobber typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  function commit(partial: Partial<DraftAgent>) {
    onChange({
      id: agent.id,
      title: titleInput,
      triggers: parseList(triggerInput),
      emits: parseList(emitInput),
      ...partial,
    });
  }

  return (
    <div
      style={{
        flex: 1,
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
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
            <ActorTag actor={agent.actor} />
            <Badge tone="muted">{agent.id}</Badge>
            <Badge tone="amber">EDIT</Badge>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>
            Changes stay in your draft until you deploy.
          </div>
        </div>
        <Button small icon="x" tone="ghost" onClick={onClose} ariaLabel="Close" />
      </header>

      <Section title="Title">
        <input
          value={titleInput}
          onChange={(e) => {
            setTitleInput(e.target.value);
            commit({ title: e.target.value });
          }}
          placeholder="Human-readable title"
          style={inputStyle}
        />
      </Section>

      <Section title="Triggered by · events this agent listens for">
        <textarea
          value={triggerInput}
          onChange={(e) => {
            setTriggerInput(e.target.value);
            commit({ triggers: parseList(e.target.value) });
          }}
          placeholder="EVENT_A, EVENT_B"
          rows={2}
          style={textareaStyle}
        />
        <EventDictHint events={events} prefix="Available" />
      </Section>

      <Section title="Triggered event · emitted on success">
        <textarea
          value={emitInput}
          onChange={(e) => {
            setEmitInput(e.target.value);
            commit({ emits: parseList(e.target.value) });
          }}
          placeholder="EVENT_A, EVENT_B"
          rows={2}
          style={textareaStyle}
        />
        <EventDictHint events={events} prefix="Available" />
      </Section>

      <Section title="Description">
        <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.55 }}>
          {agent.description || "(no description set)"}
        </div>
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
        <Button icon="x" tone="danger" onClick={onRemove}>
          Remove node
        </Button>
      </div>
    </div>
  );
}

function EventDictHint({
  events,
  prefix,
}: {
  events: RaasEvent[];
  prefix: string;
}) {
  if (events.length === 0) return null;
  return (
    <div style={{ marginTop: 6, fontSize: 10.5, color: "var(--text-3)" }}>
      {prefix}: {events.slice(0, 6).map((e) => e.name).join(", ")}
      {events.length > 6 ? `, +${events.length - 6} more` : ""}
    </div>
  );
}

/** Pure helper exposed for tests. */
export function parseList(s: string): string[] {
  const out = new Set<string>();
  for (const part of s.split(/[,\s]+/)) {
    const t = part.trim();
    if (t.length > 0) out.add(t);
  }
  return Array.from(out);
}

function mergeAgent(
  base: RaasAgent,
  draft: DraftAgent | undefined,
): RaasAgent {
  if (!draft) return base;
  return {
    ...base,
    title: draft.title ?? base.title,
    triggers: draft.triggers ?? base.triggers,
    emits: draft.emits ?? base.emits,
  };
}

const inputStyle = {
  width: "100%",
  padding: "6px 10px",
  fontSize: 12.5,
  fontFamily: "var(--sans)",
  background: "var(--bg-2)",
  color: "var(--text)",
  border: "1px solid var(--border-2)",
  borderRadius: 4,
};

const textareaStyle = {
  ...inputStyle,
  fontFamily: "var(--mono)",
  fontSize: 12,
  resize: "vertical" as const,
};
