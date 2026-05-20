"use client";

import { useState } from "react";
import { Badge, Button, Icon, Panel, Td, Th } from "@/app/portal/components";
import {
  DEFAULT_MODELS,
  type ConfiguredModel,
} from "@/app/portal/components/settings/data";
import { Field, SelectIn, TextIn } from "@/app/portal/components/settings/atoms";

export function ModelsSection() {
  const [models, setModels] = useState<ConfiguredModel[]>(DEFAULT_MODELS);
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftProvider, setDraftProvider] = useState("anthropic");
  const [draftContext, setDraftContext] = useState("200k");

  function addModel() {
    if (!draftName.trim()) return;
    setModels((cur) => [
      ...cur,
      {
        id: `m_${Date.now()}`,
        name: draftName.trim(),
        provider: draftProvider,
        context: draftContext,
        role: "experiment",
      },
    ]);
    setDraftName("");
    setAdding(false);
  }
  function removeModel(id: string) {
    setModels((cur) => cur.filter((m) => m.id !== id));
  }
  function updateRole(id: string, role: ConfiguredModel["role"]) {
    setModels((cur) => cur.map((m) => (m.id === id ? { ...m, role } : m)));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Panel
        title={`Configured models · ${models.length}`}
        subtitle="The fleet available to agents. Set a primary and one or more fallbacks."
        padded={false}
        action={
          <Button small icon="plus" tone="primary" onClick={() => setAdding(true)}>
            Add model
          </Button>
        }
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <Th>Name</Th>
              <Th>Provider</Th>
              <Th>Context</Th>
              <Th>Role</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <Td>
                  <span className="mono" style={{ color: "var(--text)" }}>{m.name}</span>
                </Td>
                <Td>
                  <Badge tone="muted">{m.provider}</Badge>
                </Td>
                <Td>
                  <span className="mono" style={{ color: "var(--text-2)" }}>{m.context}</span>
                </Td>
                <Td>
                  <select
                    value={m.role ?? "experiment"}
                    onChange={(e) => updateRole(m.id, e.target.value as ConfiguredModel["role"])}
                    style={{
                      background: "var(--panel-2)",
                      border: "1px solid var(--border-2)",
                      borderRadius: 4,
                      padding: "4px 8px",
                      color: "var(--text)",
                      fontSize: 11.5,
                      fontFamily: "var(--mono)",
                      outline: "none",
                    }}
                  >
                    <option value="primary">primary</option>
                    <option value="fallback">fallback</option>
                    <option value="experiment">experiment</option>
                    <option value="disabled">disabled</option>
                  </select>
                </Td>
                <Td style={{ textAlign: "right" }}>
                  <Button small tone="ghost" onClick={() => removeModel(m.id)}>
                    <Icon name="x" size={10} /> Remove
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>

        {adding && (
          <div
            style={{
              padding: "12px 14px",
              borderTop: "1px solid var(--border)",
              background: "var(--bg-2)",
              display: "grid",
              gridTemplateColumns: "2fr 1fr 1fr auto",
              gap: 8,
              alignItems: "end",
            }}
          >
            <Field label="Model name" hint="e.g. gpt-4.1 or mistral-large-latest">
              <TextIn value={draftName} onChange={setDraftName} mono />
            </Field>
            <Field label="Provider">
              <SelectIn
                value={draftProvider}
                onChange={setDraftProvider}
                options={[
                  "anthropic",
                  "openai",
                  "openrouter",
                  "gemini",
                  "azure",
                  "groq",
                  "together",
                  "mistral",
                  "deepseek",
                  "qwen",
                  "bedrock",
                  "vertex",
                  "custom",
                ]}
              />
            </Field>
            <Field label="Context">
              <TextIn value={draftContext} onChange={setDraftContext} mono />
            </Field>
            <div style={{ display: "flex", gap: 4 }}>
              <Button tone="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button tone="primary" onClick={addModel}>
                Add
              </Button>
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Fallback chain" padded>
        <div style={{ fontSize: 12.5, color: "var(--text-2)", marginBottom: 10, lineHeight: 1.55 }}>
          When the primary model is unavailable or rate-limited, requests cascade through fallbacks
          in this order.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {models
            .filter((m) => m.role === "primary" || m.role === "fallback")
            .map((m, i) => (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 12px",
                  background: "var(--panel-2)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                }}
              >
                <span
                  style={{
                    fontSize: 10.5,
                    fontFamily: "var(--mono)",
                    color: "var(--text-3)",
                    width: 18,
                  }}
                >
                  {i + 1}.
                </span>
                <span className="mono" style={{ fontSize: 12, color: "var(--text)", flex: 1 }}>
                  {m.name}
                </span>
                <Badge tone={m.role === "primary" ? "signal" : "muted"}>{m.role}</Badge>
              </div>
            ))}
        </div>
      </Panel>
    </div>
  );
}
