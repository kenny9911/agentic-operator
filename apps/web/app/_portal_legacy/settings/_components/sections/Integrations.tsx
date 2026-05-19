"use client";

import { useMemo } from "react";
import { Button, Panel } from "@/components";
import { IntegrationGlyph, StatusPill } from "../atoms";
import { SETTINGS_INTEGRATIONS, type SettingsIntegration } from "../data";

export function IntegrationsSection() {
  const grouped = useMemo(() => {
    const g: Record<string, SettingsIntegration[]> = {};
    SETTINGS_INTEGRATIONS.forEach((i) => {
      (g[i.kind] = g[i.kind] || []).push(i);
    });
    return g;
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {Object.entries(grouped).map(([kind, items]) => (
        <Panel
          key={kind}
          title={kind}
          padded={false}
          action={
            <Button small icon="plus" tone="ghost">
              Connect
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
            {items.map((i) => (
              <div
                key={i.id}
                style={{
                  padding: "14px 16px",
                  background: "var(--panel)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <IntegrationGlyph id={i.id} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13.5,
                        color: "var(--text)",
                        fontWeight: 500,
                      }}
                    >
                      {i.name}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-3)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {i.detail}
                    </div>
                  </div>
                  <StatusPill status={i.status} />
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    paddingTop: 4,
                    borderTop: "1px dashed var(--border)",
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: "var(--mono)",
                      color: "var(--text-3)",
                    }}
                  >
                    {i.monthly}
                  </span>
                  <div
                    style={{
                      marginLeft: "auto",
                      display: "flex",
                      gap: 4,
                    }}
                  >
                    <Button small tone="ghost">
                      Configure
                    </Button>
                    {i.status === "err" && (
                      <Button small tone="primary">
                        Renew
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ))}
    </div>
  );
}
