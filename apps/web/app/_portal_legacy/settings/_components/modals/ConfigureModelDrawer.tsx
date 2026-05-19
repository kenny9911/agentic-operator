"use client";

import { useState } from "react";
import { Badge, Button, Icon } from "@/components";
import { fmtAgo } from "@/lib/format";
import {
  Field,
  IntegrationGlyph,
  SelectIn,
  SliderRow,
  SpecCell,
  TextIn,
  Toggle,
} from "../atoms";
import { ModalOverlay } from "./ModalOverlay";
import type { Provider, SettingsModel } from "../data";
import { MODEL_DEFAULTS, MOCK_AGENTS_FOR_FLEET } from "../data";

function DrawerSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 18 }}>
      <div
        style={{
          marginBottom: 4,
          fontSize: 11,
          fontFamily: "var(--mono)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--signal)",
        }}
      >
        {title}
      </div>
      {hint && (
        <div
          style={{
            fontSize: 11,
            color: "var(--text-3)",
            marginBottom: 8,
          }}
        >
          {hint}
        </div>
      )}
      <div style={{ borderTop: "1px solid var(--border)" }}>{children}</div>
    </div>
  );
}

export function ConfigureModelDrawer({
  model,
  provider,
  onClose,
  onEditProvider,
}: {
  model: SettingsModel;
  provider?: Provider;
  onClose: () => void;
  onEditProvider: () => void;
}) {
  const d =
    MODEL_DEFAULTS[model.name] ?? {
      contextWindow: 200_000,
      maxOut: 8192,
      inPrice: 3,
      outPrice: 15,
    };
  const initialCap = parseFloat(model.cap.replace(/[$\/day]/g, "")) || 60;
  const [role, setRole] = useState<"primary" | "fallback" | "shadow">(
    model.status,
  );
  const [dailyCap, setDailyCap] = useState(initialCap);
  const [maxOut, setMaxOut] = useState(2048);
  const [temp, setTemp] = useState(0.2);
  const [topP, setTopP] = useState(0.95);
  const [timeoutVal, setTimeoutVal] = useState(60);
  const [concurrency, setConcurrency] = useState(24);
  const [reasoning, setReasoning] = useState("auto");
  const [streaming, setStreaming] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [alertAt, setAlertAt] = useState(80);

  return (
    <ModalOverlay onClose={onClose} side="right">
      <div
        style={{
          width: 540,
          height: "100%",
          background: "var(--panel)",
          borderLeft: "1px solid var(--border-2)",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-16px 0 40px -20px rgba(0,0,0,0.6)",
        }}
      >
        <header
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 10,
            }}
          >
            <Badge tone="signal">Configure model</Badge>
            <button
              onClick={onClose}
              style={{
                marginLeft: "auto",
                color: "var(--text-3)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
              }}
            >
              <Icon name="x" size={13} />
            </button>
          </div>
          <div
            style={{ display: "flex", alignItems: "baseline", gap: 10 }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: 22,
                fontFamily: "var(--display)",
                fontWeight: 400,
                color: "var(--text)",
              }}
            >
              {model.name}
            </h3>
            <span
              className="mono"
              style={{ fontSize: 12, color: "var(--text-3)" }}
            >
              {model.provider}
            </span>
          </div>
          {/* Provider link */}
          <div
            style={{
              marginTop: 10,
              padding: "8px 10px",
              background: "var(--panel-2)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <IntegrationGlyph id={provider?.id ?? "anthropic"} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, color: "var(--text-2)" }}>
                Using {provider?.name} key{" "}
                <span className="mono" style={{ color: "var(--text)" }}>
                  {provider?.keyMasked}
                </span>
              </div>
              <div
                style={{
                  fontSize: 10.5,
                  color: "var(--text-3)",
                  fontFamily: "var(--mono)",
                }}
              >
                Set {fmtAgo(provider?.setAt ?? Date.now())} by{" "}
                {provider?.setBy}
              </div>
            </div>
            <Button small tone="ghost" onClick={onEditProvider}>
              Update key
            </Button>
          </div>

          {/* Spec strip */}
          <div
            style={{
              marginTop: 10,
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 8,
              fontSize: 10.5,
              fontFamily: "var(--mono)",
            }}
          >
            <SpecCell label="Context" value={`${(d.contextWindow / 1000).toFixed(0)}k`} />
            <SpecCell label="Max out" value={`${(d.maxOut / 1000).toFixed(0)}k`} />
            <SpecCell label="$ / 1M in"  value={`$${d.inPrice}`} />
            <SpecCell label="$ / 1M out" value={`$${d.outPrice}`} />
          </div>
        </header>

        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "8px 20px 20px 20px",
          }}
        >
          <DrawerSection title="Routing">
            <Field
              label="Status"
              hint="Disable to take this model out of rotation immediately."
            >
              <Toggle value={enabled} onChange={setEnabled} />
            </Field>
            <Field
              label="Role"
              hint="Primary models receive traffic first; fallbacks are tried on 429 / timeout."
            >
              <div
                style={{
                  display: "flex",
                  gap: 0,
                  border: "1px solid var(--border-2)",
                  borderRadius: 5,
                  overflow: "hidden",
                  width: "fit-content",
                }}
              >
                {(["primary", "fallback", "shadow"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRole(r)}
                    style={{
                      padding: "5px 12px",
                      background:
                        role === r ? "var(--panel-3)" : "var(--panel-2)",
                      color: role === r ? "var(--text)" : "var(--text-3)",
                      fontSize: 11.5,
                      fontFamily: "var(--mono)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      borderRight: "1px solid var(--border-2)",
                      borderBottom:
                        role === r
                          ? "2px solid var(--signal)"
                          : "2px solid transparent",
                      cursor: "pointer",
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </Field>
            <Field
              label="Concurrency"
              hint="Max simultaneous in-flight requests across all agents."
            >
              <TextIn
                value={String(concurrency)}
                mono
                suffix="requests"
                onChange={(v) => setConcurrency(parseInt(v) || 0)}
              />
            </Field>
            <Field
              label="Request timeout"
              hint="After this, fall through to the next model in the chain."
            >
              <TextIn
                value={String(timeoutVal)}
                mono
                suffix="seconds"
                onChange={(v) => setTimeoutVal(parseInt(v) || 0)}
              />
            </Field>
          </DrawerSection>

          <DrawerSection
            title="Sampling defaults"
            hint="Agents may override these per-request."
          >
            <Field label="Max output tokens">
              <TextIn
                value={String(maxOut)}
                mono
                suffix="tokens"
                onChange={(v) => setMaxOut(parseInt(v) || 0)}
              />
            </Field>
            <Field
              label="Temperature"
              hint="0.0 — deterministic. 1.0 — creative."
            >
              <SliderRow
                value={temp}
                onChange={setTemp}
                min={0}
                max={1}
                step={0.05}
              />
            </Field>
            <Field label="Top-p">
              <SliderRow
                value={topP}
                onChange={setTopP}
                min={0}
                max={1}
                step={0.05}
              />
            </Field>
            {model.provider === "Anthropic" && (
              <Field
                label="Extended thinking"
                hint="Sonnet/Haiku 4.5 supports server-side reasoning. Auto = use when problem complexity warrants it."
              >
                <SelectIn
                  value={reasoning}
                  onChange={setReasoning}
                  options={[
                    { value: "off",  label: "Off" },
                    { value: "auto", label: "Auto (recommended)" },
                    { value: "on",   label: "Always on" },
                  ]}
                />
              </Field>
            )}
            <Field
              label="Stream tokens"
              hint="Stream incremental tokens to the run viewer."
            >
              <Toggle value={streaming} onChange={setStreaming} />
            </Field>
          </DrawerSection>

          <DrawerSection title="Spend control">
            <Field
              label="Daily cap"
              hint="Hard cap. Once exceeded, this model returns 429 to agents and they fall through."
            >
              <TextIn
                value={String(dailyCap)}
                mono
                prefix="$"
                suffix="/ day"
                onChange={(v) => setDailyCap(parseFloat(v) || 0)}
              />
            </Field>
            <Field
              label="Alert threshold"
              hint="Page #ops-models when daily spend crosses this percent of the cap."
            >
              <SliderRow
                value={alertAt}
                onChange={setAlertAt}
                min={50}
                max={100}
                step={5}
                format={(v) => `${v}%`}
              />
            </Field>

            <div
              style={{
                marginTop: 10,
                padding: "12px 14px",
                background: "var(--panel-2)",
                border: "1px solid var(--border)",
                borderRadius: 4,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--mono)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: "var(--text-3)",
                  }}
                >
                  Spend today
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 12,
                    fontFamily: "var(--mono)",
                    color: "var(--text)",
                  }}
                >
                  ${model.spent.toFixed(2)} / ${dailyCap}
                </span>
              </div>
              <div
                style={{
                  height: 6,
                  background: "var(--bg-2)",
                  borderRadius: 3,
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, (model.spent / dailyCap) * 100)}%`,
                    height: "100%",
                    background: "var(--signal)",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    top: -2,
                    left: `${alertAt}%`,
                    height: 10,
                    width: 1,
                    background: "var(--amber)",
                  }}
                />
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 10.5,
                  fontFamily: "var(--mono)",
                  color: "var(--text-3)",
                }}
              >
                ~ $
                {(
                  (model.spent * 24) /
                  Math.max(1, new Date().getHours() || 1)
                ).toFixed(2)}{" "}
                projected · alert at{" "}
                <span style={{ color: "var(--amber)" }}>
                  ${((dailyCap * alertAt) / 100).toFixed(2)}
                </span>
              </div>
            </div>
          </DrawerSection>

          <DrawerSection
            title="Used by"
            hint={`${model.usedBy} agents currently pin this model.`}
          >
            <div
              style={{ display: "flex", flexWrap: "wrap", gap: 5 }}
            >
              {MOCK_AGENTS_FOR_FLEET.filter(
                (a) => a.model === model.name,
              )
                .slice(0, 12)
                .map((a) => (
                  <Badge key={a.id} tone="muted">
                    {a.name}
                  </Badge>
                ))}
              {MOCK_AGENTS_FOR_FLEET.filter((a) => a.model === model.name)
                .length === 0 && (
                <span
                  style={{ fontSize: 11.5, color: "var(--text-3)" }}
                >
                  No agents pinned — used via fallback chain only.
                </span>
              )}
            </div>
          </DrawerSection>
        </div>

        <footer
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 20px",
            borderTop: "1px solid var(--border)",
            background: "var(--panel-2)",
          }}
        >
          <Button tone="ghost" icon="replay">
            Reset to defaults
          </Button>
          <div
            style={{ marginLeft: "auto", display: "flex", gap: 6 }}
          >
            <Button tone="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button tone="primary" icon="check">
              Save changes
            </Button>
          </div>
        </footer>
      </div>
    </ModalOverlay>
  );
}
