"use client";

import { useState } from "react";
import { Badge, Button, Icon, Panel, Stat, StatusDot } from "@/components";
import { fmtAgo } from "@/lib/format";
import {
  Field,
  IntegrationGlyph,
  SelectIn,
  Td,
  TextIn,
  Th,
  Toggle,
} from "../atoms";
import { AddModelModal } from "../modals/AddModelModal";
import { AddProviderModal } from "../modals/AddProviderModal";
import { ConfigureModelDrawer } from "../modals/ConfigureModelDrawer";
import { ProviderKeyModal } from "../modals/ProviderKeyModal";
import { PROVIDERS, SETTINGS_MODELS, type Provider } from "../data";

export function ModelsSection() {
  const [configureId, setConfigureId] = useState<string | null>(null);
  const [providerEditId, setProviderEditId] = useState<string | null>(null);
  const [addProviderOpen, setAddProviderOpen] = useState(false);
  const [addModelOpen, setAddModelOpen] = useState(false);

  const configuringModel =
    SETTINGS_MODELS.find((m) => m.id === configureId) ?? null;
  const editingProvider =
    PROVIDERS.find((p) => p.id === providerEditId) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* PROVIDER CREDENTIALS */}
      <Panel
        title="Provider credentials"
        subtitle="API keys for upstream model vendors. Stored encrypted at rest (AES-256, keyring-rotated weekly)."
        padded={false}
        action={
          <Button
            small
            icon="plus"
            tone="ghost"
            onClick={() => setAddProviderOpen(true)}
          >
            Add provider
          </Button>
        }
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 1,
            background: "var(--border)",
          }}
        >
          {PROVIDERS.map((p) => (
            <ProviderCredentialCard
              key={p.id}
              provider={p}
              onEdit={() => setProviderEditId(p.id)}
            />
          ))}
        </div>
      </Panel>

      {/* MODEL FLEET */}
      <Panel
        title="Model fleet"
        subtitle="Models exposed to agents. Each pulls credentials from its provider above."
        padded={false}
        action={
          <Button
            small
            icon="plus"
            tone="ghost"
            onClick={() => setAddModelOpen(true)}
          >
            Add model
          </Button>
        }
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 12.5,
          }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <Th>Model</Th>
              <Th>Provider</Th>
              <Th>Used by</Th>
              <Th>Role</Th>
              <Th>Daily cap</Th>
              <Th>Spent today</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {SETTINGS_MODELS.map((m) => {
              const capNum =
                parseFloat(m.cap.replace(/[$\/day]/g, "")) || 1;
              const pct = Math.min(100, (m.spent / capNum) * 100);
              const isOpen = configureId === m.id;
              return (
                <tr
                  key={m.id}
                  style={{
                    borderBottom: "1px solid var(--border)",
                    background: isOpen ? "var(--panel-2)" : "transparent",
                  }}
                >
                  <Td>
                    <span
                      className="mono"
                      style={{ color: "var(--text)" }}
                    >
                      {m.name}
                    </span>
                  </Td>
                  <Td>
                    <span style={{ color: "var(--text-2)" }}>
                      {m.provider}
                    </span>
                  </Td>
                  <Td>
                    <span style={{ color: "var(--text-2)" }}>
                      {m.usedBy} agents
                    </span>
                  </Td>
                  <Td>
                    {m.status === "primary" ? (
                      <Badge tone="signal">PRIMARY</Badge>
                    ) : (
                      <Badge tone="muted">FALLBACK</Badge>
                    )}
                  </Td>
                  <Td>
                    <span
                      className="mono"
                      style={{ color: "var(--text-2)" }}
                    >
                      {m.cap}
                    </span>
                  </Td>
                  <Td>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 3,
                        minWidth: 120,
                      }}
                    >
                      <span
                        className="mono"
                        style={{
                          fontSize: 11.5,
                          color: "var(--text-2)",
                        }}
                      >
                        ${m.spent.toFixed(2)}
                      </span>
                      <div
                        style={{
                          height: 4,
                          background: "var(--bg-2)",
                          borderRadius: 2,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${pct}%`,
                            height: "100%",
                            background:
                              pct > 80 ? "var(--amber)" : "var(--signal)",
                          }}
                        />
                      </div>
                    </div>
                  </Td>
                  <Td style={{ textAlign: "right" }}>
                    <Button
                      small
                      tone={isOpen ? "primary" : "ghost"}
                      onClick={() =>
                        setConfigureId(isOpen ? null : m.id)
                      }
                    >
                      {isOpen ? "Editing…" : "Configure"}
                    </Button>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      {/* FALLBACK CHAIN */}
      <Panel
        title="Fallback chain"
        subtitle="If a model times out or rate-limits, fall through to the next."
        padded
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 0,
            overflow: "auto",
            padding: "4px 2px",
          }}
        >
          {["claude-sonnet-4-5", "claude-haiku-4-5", "gpt-4.1-mini"].map(
            (m, i, arr) => (
              <span
                key={m}
                style={{ display: "inline-flex", alignItems: "center" }}
              >
                <div
                  style={{
                    padding: "10px 14px",
                    background: "var(--panel-2)",
                    border: "1px solid var(--border-2)",
                    borderRadius: 5,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    whiteSpace: "nowrap",
                  }}
                >
                  <Icon
                    name="spark"
                    size={11}
                    style={{
                      color:
                        i === 0 ? "var(--signal)" : "var(--text-3)",
                    }}
                  />
                  <span
                    className="mono"
                    style={{ fontSize: 12, color: "var(--text)" }}
                  >
                    {m}
                  </span>
                  {i === 0 && <Badge tone="signal">PRIMARY</Badge>}
                </div>
                {i < arr.length - 1 && (
                  <div
                    style={{
                      padding: "0 10px",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 10,
                      fontFamily: "var(--mono)",
                      color: "var(--text-3)",
                    }}
                  >
                    <span>on 429 / timeout</span>
                    <Icon name="chevron-right" size={11} />
                  </div>
                )}
              </span>
            ),
          )}
        </div>
        <div
          style={{
            marginTop: 14,
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 12,
          }}
        >
          <Stat label="Fallbacks · 24h" value="42" mono />
          <Stat
            label="Avg latency"
            value="2.1s"
            mono
            accent="var(--green)"
          />
          <Stat label="Spend · 30d" value="$1,914" mono />
        </div>
      </Panel>

      {/* DEFAULTS */}
      <Panel title="Defaults" padded>
        <Field
          label="Default model"
          hint="Used when an agent doesn't pin one explicitly."
        >
          <SelectIn
            value="claude-sonnet-4-5"
            options={[
              "claude-sonnet-4-5",
              "claude-haiku-4-5",
              "gpt-4.1-mini",
            ]}
          />
        </Field>
        <Field
          label="Max tokens (output)"
          hint="Hard cap per agent step. Agents may request less."
        >
          <TextIn value="2048" mono suffix="tokens" />
        </Field>
        <Field
          label="Temperature"
          hint="Default sampling temperature for non-deterministic agents."
        >
          <TextIn value="0.2" mono />
        </Field>
        <Field
          label="Retry on 5xx"
          hint="Auto-retry transient model errors with exponential backoff (max 3)."
        >
          <Toggle value={true} />
        </Field>
      </Panel>

      {configuringModel && (
        <ConfigureModelDrawer
          model={configuringModel}
          provider={PROVIDERS.find(
            (p) => p.name === configuringModel.provider,
          )}
          onClose={() => setConfigureId(null)}
          onEditProvider={() => {
            const p = PROVIDERS.find(
              (p) => p.name === configuringModel.provider,
            );
            if (p) setProviderEditId(p.id);
          }}
        />
      )}

      {editingProvider && (
        <ProviderKeyModal
          provider={editingProvider}
          onClose={() => setProviderEditId(null)}
        />
      )}

      {addProviderOpen && (
        <AddProviderModal onClose={() => setAddProviderOpen(false)} />
      )}
      {addModelOpen && (
        <AddModelModal onClose={() => setAddModelOpen(false)} />
      )}
    </div>
  );
}

function ProviderCredentialCard({
  provider,
  onEdit,
}: {
  provider: Provider;
  onEdit: () => void;
}) {
  return (
    <div
      style={{
        padding: "14px 16px",
        background: "var(--panel)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <IntegrationGlyph id={provider.id} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13.5,
              color: "var(--text)",
              fontWeight: 500,
            }}
          >
            {provider.name}
          </div>
          <div
            className="mono"
            style={{ fontSize: 11, color: "var(--text-3)" }}
          >
            {provider.endpoint}
          </div>
        </div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11,
            color: "var(--green)",
            fontFamily: "var(--mono)",
          }}
        >
          <StatusDot status="ok" size={5} /> AUTHED
        </span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 10px",
          background: "var(--bg-2)",
          border: "1px solid var(--border)",
          borderRadius: 4,
        }}
      >
        <Icon name="code" size={11} style={{ color: "var(--text-3)" }} />
        <span
          className="mono"
          style={{
            flex: 1,
            fontSize: 11.5,
            color: "var(--text-2)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {provider.keyMasked}
        </span>
        <button
          title="Copy key reference"
          style={{
            color: "var(--text-3)",
            padding: 2,
            background: "transparent",
            border: "none",
            cursor: "pointer",
          }}
        >
          <Icon name="code" size={10} />
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 10,
          fontSize: 10.5,
          fontFamily: "var(--mono)",
        }}
      >
        <div>
          <div
            style={{
              color: "var(--text-4)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Set by
          </div>
          <div style={{ color: "var(--text-2)", marginTop: 2 }}>
            {provider.setBy}
          </div>
        </div>
        <div>
          <div
            style={{
              color: "var(--text-4)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Last used
          </div>
          <div style={{ color: "var(--text-2)", marginTop: 2 }}>
            {fmtAgo(provider.lastUsed)}
          </div>
        </div>
        <div>
          <div
            style={{
              color: "var(--text-4)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Spend · 30d
          </div>
          <div style={{ color: "var(--text-2)", marginTop: 2 }}>
            ${provider.monthlySpend.toLocaleString()}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 6,
          paddingTop: 4,
          borderTop: "1px dashed var(--border)",
        }}
      >
        <Button small tone="ghost" icon="check">
          Test
        </Button>
        <Button small tone="ghost" icon="external">
          Docs
        </Button>
        <Button
          small
          tone="primary"
          onClick={onEdit}
          style={{ marginLeft: "auto" }}
        >
          Update key
        </Button>
      </div>
    </div>
  );
}
