"use client";

import { useState } from "react";
import { Button, Panel } from "@/components";
import { fmtAgo } from "@/lib/format";
import { SearchInput, Td, Th } from "../atoms";
import { SETTINGS_AUDIT } from "../data";

function actionColor(action: string) {
  if (action.startsWith("deploy.rollback") || action.startsWith("key."))
    return "var(--amber)";
  if (action.startsWith("deploy.")) return "var(--signal)";
  if (action.startsWith("member.")) return "var(--violet)";
  if (action.startsWith("integration.")) return "var(--blue)";
  return "var(--text-2)";
}

export function AuditSection() {
  const [q, setQ] = useState("");
  const rows = SETTINGS_AUDIT.filter(
    (a) =>
      !q ||
      a.actor.toLowerCase().includes(q.toLowerCase()) ||
      a.action.includes(q.toLowerCase()) ||
      a.target.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Panel
        title={`Recent admin actions · ${rows.length}`}
        subtitle="Workspace-scoped. Append-only. 365-day retention."
        padded={false}
        action={
          <div style={{ display: "flex", gap: 6 }}>
            <Button small icon="filter" tone="ghost">
              Filter
            </Button>
            <Button small icon="upload" tone="ghost">
              Export
            </Button>
          </div>
        }
      >
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="actor, action, or target…"
          />
        </div>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 12.5,
          }}
        >
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <Th>When</Th>
              <Th>Actor</Th>
              <Th>Action</Th>
              <Th>Target</Th>
              <Th>From</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((a, i) => (
              <tr
                key={i}
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                <Td>
                  <span style={{ color: "var(--text-2)" }}>
                    {fmtAgo(a.at)}
                  </span>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: "var(--text-3)",
                      fontFamily: "var(--mono)",
                    }}
                  >
                    {new Date(a.at).toISOString().slice(11, 19)}
                  </div>
                </Td>
                <Td>
                  <span style={{ color: "var(--text)" }}>{a.actor}</span>
                </Td>
                <Td>
                  <span
                    className="mono"
                    style={{ fontSize: 11.5, color: actionColor(a.action) }}
                  >
                    {a.action}
                  </span>
                </Td>
                <Td>
                  <span
                    className="mono"
                    style={{ fontSize: 11.5, color: "var(--text-2)" }}
                  >
                    {a.target}
                  </span>
                </Td>
                <Td>
                  <span
                    className="mono"
                    style={{ fontSize: 11, color: "var(--text-3)" }}
                  >
                    {a.ip}
                  </span>
                </Td>
                <Td style={{ textAlign: "right" }}>
                  <Button small tone="ghost" icon="external">
                    JSON
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
