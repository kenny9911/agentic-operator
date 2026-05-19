"use client";

import { useState } from "react";
import { Button, Icon } from "@/components";
import { fmtAgo } from "@/lib/format";
import { IntegrationGlyph, SecretInput } from "../atoms";
import { ModalOverlay } from "./ModalOverlay";
import type { Provider } from "../data";

export function ProviderKeyModal({
  provider,
  onClose,
}: {
  provider: Provider;
  onClose: () => void;
}) {
  const [val, setVal] = useState("");
  const [scope, setScope] = useState<"workspace" | "tenant">("workspace");
  const [testState, setTestState] = useState<
    null | "running" | "ok" | "err"
  >(null);

  function runTest() {
    if (!val.trim()) return;
    setTestState("running");
    setTimeout(() => setTestState(val.length >= 20 ? "ok" : "err"), 900);
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div
        style={{
          width: 560,
          background: "var(--panel)",
          border: "1px solid var(--border-2)",
          borderRadius: 8,
          overflow: "hidden",
          boxShadow: "0 24px 60px -20px rgba(0,0,0,0.6)",
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
          <IntegrationGlyph id={provider.id} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 14,
                color: "var(--text)",
                fontWeight: 500,
              }}
            >
              {provider.name} · API key
            </div>
            <div style={{ fontSize: 11, color: "var(--text-3)" }}>
              Replaces the current key. Active agents finish on the old key;
              new runs use the new one.
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              color: "var(--text-3)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
          >
            <Icon name="x" size={13} />
          </button>
        </header>

        <div
          style={{
            padding: 18,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {/* Current state */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              padding: "10px 12px",
              background: "var(--panel-2)",
              border: "1px solid var(--border)",
              borderRadius: 5,
              fontSize: 11,
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
                Current key
              </div>
              <div style={{ color: "var(--text-2)", marginTop: 2 }}>
                {provider.keyMasked}
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
                Set
              </div>
              <div style={{ color: "var(--text-2)", marginTop: 2 }}>
                {fmtAgo(provider.setAt)} by {provider.setBy}
              </div>
            </div>
          </div>

          <div>
            <label
              style={{
                display: "block",
                fontSize: 12,
                color: "var(--text-2)",
                marginBottom: 6,
              }}
            >
              New API key
            </label>
            <SecretInput
              value={val}
              onChange={setVal}
              placeholder={`Paste your ${provider.name} key`}
              prefix={provider.keyPrefix}
            />
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                color: "var(--text-3)",
                lineHeight: 1.5,
              }}
            >
              Sent to{" "}
              <span className="mono" style={{ color: "var(--text-2)" }}>
                {provider.endpoint}
              </span>{" "}
              as{" "}
              <span className="mono" style={{ color: "var(--text-2)" }}>
                {provider.headerName}
              </span>
              . Encrypted at rest. Never logged.{" "}
              <a
                href={provider.docs}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--signal)" }}
              >
                Get a key →
              </a>
            </div>
          </div>

          <div>
            <label
              style={{
                display: "block",
                fontSize: 12,
                color: "var(--text-2)",
                marginBottom: 6,
              }}
            >
              Scope
            </label>
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
              {[
                { id: "workspace" as const, label: "Workspace-wide", hint: "All tenants" },
                { id: "tenant"    as const, label: "Active tenant only", hint: "RAAS" },
              ].map((s) => (
                <button
                  key={s.id}
                  onClick={() => setScope(s.id)}
                  style={{
                    padding: "6px 12px",
                    background:
                      scope === s.id ? "var(--panel-3)" : "var(--panel-2)",
                    color: scope === s.id ? "var(--text)" : "var(--text-3)",
                    fontSize: 12,
                    borderRight: "1px solid var(--border-2)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 1,
                    borderBottom:
                      scope === s.id
                        ? "2px solid var(--signal)"
                        : "2px solid transparent",
                    cursor: "pointer",
                  }}
                >
                  <span>{s.label}</span>
                  <span
                    style={{
                      fontSize: 10,
                      fontFamily: "var(--mono)",
                      color: "var(--text-3)",
                    }}
                  >
                    {s.hint}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Test result row */}
          {testState && (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 5,
                fontSize: 12,
                lineHeight: 1.5,
                border: `1px solid ${
                  testState === "ok"
                    ? "rgba(101,224,163,0.3)"
                    : testState === "err"
                      ? "rgba(255,100,112,0.35)"
                      : "var(--border)"
                }`,
                background:
                  testState === "ok"
                    ? "rgba(101,224,163,0.06)"
                    : testState === "err"
                      ? "rgba(255,100,112,0.06)"
                      : "var(--panel-2)",
                color:
                  testState === "ok"
                    ? "var(--green)"
                    : testState === "err"
                      ? "var(--red)"
                      : "var(--text-2)",
              }}
            >
              {testState === "running" && (
                <span>
                  <Icon name="spark" size={11} style={{ marginRight: 6 }} />{" "}
                  Probing {provider.endpoint}/v1/models …
                </span>
              )}
              {testState === "ok" && (
                <span>
                  <Icon name="check" size={11} style={{ marginRight: 6 }} />{" "}
                  200 OK · 187 ms · returned 14 models · billing reachable
                </span>
              )}
              {testState === "err" && (
                <span>
                  <Icon name="alert" size={11} style={{ marginRight: 6 }} />{" "}
                  401 Unauthorized — key format looks invalid
                </span>
              )}
            </div>
          )}
        </div>

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
          <Button tone="ghost" icon="check" onClick={runTest}>
            Test connection
          </Button>
          <div
            style={{ marginLeft: "auto", display: "flex", gap: 6 }}
          >
            <Button tone="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button tone="primary" icon="check">
              Save &amp; rotate
            </Button>
          </div>
        </footer>
      </div>
    </ModalOverlay>
  );
}
