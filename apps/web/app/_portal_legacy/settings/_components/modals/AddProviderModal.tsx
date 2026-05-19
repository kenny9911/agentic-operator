"use client";

import { useState } from "react";
import { Badge, Button, Icon } from "@/components";
import {
  Field,
  SecretInput,
  StepDot,
  TextIn,
} from "../atoms";
import { ModalOverlay } from "./ModalOverlay";
import { PROVIDER_PRESETS, type ProviderPreset } from "../data";

export function AddProviderModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<"pick" | "configure" | "done">("pick");
  const [picked, setPicked] = useState<ProviderPreset | null>(null);
  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [region, setRegion] = useState("");
  const [orgId, setOrgId] = useState("");
  const [customName, setCustomName] = useState("");
  const [testState, setTestState] = useState<
    null | "running" | "ok" | "err"
  >(null);

  function pick(p: ProviderPreset) {
    if (p.installed) return;
    setPicked(p);
    setEndpoint(p.endpoint);
    setStep("configure");
  }

  function runTest() {
    if (!apiKey.trim()) return;
    setTestState("running");
    setTimeout(() => setTestState(apiKey.length >= 12 ? "ok" : "err"), 900);
  }

  function save() {
    setStep("done");
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div
        style={{
          width: 680,
          maxHeight: "86vh",
          background: "var(--panel)",
          border: "1px solid var(--border-2)",
          borderRadius: 8,
          overflow: "hidden",
          boxShadow: "0 24px 60px -20px rgba(0,0,0,0.6)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <Icon name="plus" size={14} style={{ color: "var(--signal)" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 14,
                color: "var(--text)",
                fontWeight: 500,
              }}
            >
              {step === "pick" && "Add a model provider"}
              {step === "configure" && `Configure ${picked?.name}`}
              {step === "done" && `${picked?.name} connected`}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-3)" }}>
              {step === "pick" &&
                "Pick a vendor. We'll provision an encrypted credential and surface its models in the fleet."}
              {step === "configure" &&
                `Credentials stay in the workspace keyring. ${picked?.name} models won't appear until the key tests green.`}
              {step === "done" &&
                "Models from this provider are now selectable when adding agents."}
            </div>
          </div>

          {/* Stepper */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 10,
              fontFamily: "var(--mono)",
              color: "var(--text-3)",
            }}
          >
            <StepDot
              label="01 PICK"
              active={step === "pick"}
              done={step !== "pick"}
            />
            <span style={{ color: "var(--text-4)" }}>—</span>
            <StepDot
              label="02 KEY"
              active={step === "configure"}
              done={step === "done"}
            />
            <span style={{ color: "var(--text-4)" }}>—</span>
            <StepDot label="03 DONE" active={step === "done"} />
          </div>

          <button
            onClick={onClose}
            style={{
              color: "var(--text-3)",
              marginLeft: 6,
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
          >
            <Icon name="x" size={13} />
          </button>
        </header>

        <div
          style={{ padding: 18, overflow: "auto", flex: 1 }}
        >
          {step === "pick" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 8,
              }}
            >
              {PROVIDER_PRESETS.map((p) => (
                <button
                  key={p.id}
                  disabled={p.installed}
                  onClick={() => pick(p)}
                  style={{
                    textAlign: "left",
                    padding: "12px 12px",
                    background: p.installed
                      ? "var(--bg-2)"
                      : "var(--panel-2)",
                    border: "1px solid var(--border-2)",
                    borderRadius: 5,
                    cursor: p.installed ? "not-allowed" : "pointer",
                    opacity: p.installed ? 0.55 : 1,
                    transition: "background 0.12s, border-color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    if (!p.installed) {
                      e.currentTarget.style.background = "var(--panel-3)";
                      e.currentTarget.style.borderColor = "var(--signal)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!p.installed) {
                      e.currentTarget.style.background = "var(--panel-2)";
                      e.currentTarget.style.borderColor = "var(--border-2)";
                    }
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 6,
                    }}
                  >
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 4,
                        background: p.color,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#fff",
                        fontFamily: "var(--mono)",
                      }}
                    >
                      {p.name[0]}
                    </div>
                    <span
                      style={{
                        fontSize: 12.5,
                        color: "var(--text)",
                        fontWeight: 500,
                      }}
                    >
                      {p.name}
                    </span>
                    {p.installed && (
                      <Badge tone="muted" style={{ marginLeft: "auto" }}>
                        connected
                      </Badge>
                    )}
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: "var(--text-3)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {p.endpoint || "—"}
                  </div>
                </button>
              ))}
            </div>
          )}

          {step === "configure" && picked && (
            <div
              style={{ display: "flex", flexDirection: "column", gap: 14 }}
            >
              {picked.id === "custom" && (
                <Field
                  label="Provider name"
                  hint="Shown in the fleet & in agent model pickers."
                >
                  <TextIn
                    value={customName}
                    onChange={setCustomName}
                    placeholder="e.g. internal-llm-proxy"
                  />
                </Field>
              )}
              <Field
                label="Endpoint"
                hint="Base URL. We append /v1/messages, /v1/chat/completions, etc."
              >
                <TextIn value={endpoint} onChange={setEndpoint} mono />
              </Field>
              {(picked.id === "bedrock" ||
                picked.id === "vertex" ||
                picked.id === "azure") && (
                <Field
                  label="Region"
                  hint={
                    picked.id === "azure"
                      ? "Azure resource region (e.g. eastus)"
                      : "AWS / GCP region (e.g. us-east-1)"
                  }
                >
                  <TextIn
                    value={region}
                    onChange={setRegion}
                    mono
                    placeholder="us-east-1"
                  />
                </Field>
              )}
              {picked.id === "openai" && (
                <Field
                  label="Organization ID"
                  hint="Optional. Restricts billing to one OpenAI org."
                >
                  <TextIn
                    value={orgId}
                    onChange={setOrgId}
                    mono
                    placeholder="org-…"
                  />
                </Field>
              )}
              <Field
                label="API key"
                hint={
                  <>
                    Sent as{" "}
                    <span className="mono" style={{ color: "var(--text-2)" }}>
                      {picked.header}
                    </span>
                    . Encrypted at rest, never logged.{" "}
                    {picked.docs && (
                      <a
                        href={picked.docs}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--signal)" }}
                      >
                        Get a key →
                      </a>
                    )}
                  </>
                }
              >
                <SecretInput
                  value={apiKey}
                  onChange={setApiKey}
                  prefix={picked.keyPrefix}
                  placeholder={`Paste your ${picked.name} key`}
                />
              </Field>

              <div>
                <div
                  style={{ display: "flex", alignItems: "center", gap: 10 }}
                >
                  <Button tone="ghost" icon="check" onClick={runTest}>
                    Test connection
                  </Button>
                  {testState === "running" && (
                    <span
                      style={{
                        fontSize: 11.5,
                        color: "var(--text-3)",
                        fontFamily: "var(--mono)",
                      }}
                    >
                      Probing {endpoint}/v1/models …
                    </span>
                  )}
                  {testState === "ok" && (
                    <span
                      style={{
                        fontSize: 11.5,
                        color: "var(--green)",
                        fontFamily: "var(--mono)",
                      }}
                    >
                      <Icon name="check" size={10} /> 200 OK · returned 14
                      models
                    </span>
                  )}
                  {testState === "err" && (
                    <span
                      style={{
                        fontSize: 11.5,
                        color: "var(--red)",
                        fontFamily: "var(--mono)",
                      }}
                    >
                      <Icon name="alert" size={10} /> 401 — key invalid
                    </span>
                  )}
                </div>
              </div>

              {/* Preview models we'll surface */}
              {testState === "ok" && (
                <div
                  style={{
                    padding: "10px 12px",
                    background: "var(--panel-2)",
                    border: "1px solid var(--border)",
                    borderRadius: 5,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontFamily: "var(--mono)",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: "var(--text-3)",
                      marginBottom: 6,
                    }}
                  >
                    Models discovered · 14
                  </div>
                  <div
                    style={{ display: "flex", flexWrap: "wrap", gap: 4 }}
                  >
                    {(picked.id === "anthropic"
                      ? ["claude-opus-4", "claude-sonnet-4-5", "claude-haiku-4-5"]
                      : picked.id === "openai"
                        ? ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "o1-pro"]
                        : picked.id === "gemini"
                          ? [
                              "gemini-2.0-pro",
                              "gemini-2.0-flash",
                              "gemini-1.5-pro",
                            ]
                          : ["model-a", "model-b", "model-c"]
                    ).map((m) => (
                      <Badge key={m} tone="muted">
                        {m}
                      </Badge>
                    ))}
                    <Badge tone="muted">+ 11 more</Badge>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === "done" && picked && (
            <div
              style={{ textAlign: "center", padding: "32px 20px" }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  margin: "0 auto",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(208,255,0,0.10)",
                  border: "1px solid var(--signal)",
                }}
              >
                <Icon
                  name="check"
                  size={22}
                  style={{ color: "var(--signal)" }}
                />
              </div>
              <div
                style={{
                  marginTop: 14,
                  fontSize: 18,
                  color: "var(--text)",
                }}
              >
                {picked.name} connected
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 12.5,
                  color: "var(--text-3)",
                  maxWidth: 380,
                  margin: "6px auto 0",
                }}
              >
                14 models available. Add them to the fleet to expose them to
                agents.
              </div>
              <div
                style={{
                  marginTop: 18,
                  display: "flex",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <Button tone="ghost" onClick={onClose}>
                  Close
                </Button>
                <Button tone="primary" icon="plus">
                  Add models from {picked.name}
                </Button>
              </div>
            </div>
          )}
        </div>

        {step !== "done" && (
          <footer
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 18px",
              borderTop: "1px solid var(--border)",
              background: "var(--panel-2)",
            }}
          >
            {step === "configure" && (
              <Button
                tone="ghost"
                icon="chevron-left"
                onClick={() => {
                  setStep("pick");
                  setTestState(null);
                }}
              >
                Back
              </Button>
            )}
            <div
              style={{ marginLeft: "auto", display: "flex", gap: 6 }}
            >
              <Button tone="ghost" onClick={onClose}>
                Cancel
              </Button>
              {step === "configure" && (
                <Button tone="primary" icon="check" onClick={save}>
                  {testState === "ok" ? "Save provider" : "Save anyway"}
                </Button>
              )}
            </div>
          </footer>
        )}
      </div>
    </ModalOverlay>
  );
}
