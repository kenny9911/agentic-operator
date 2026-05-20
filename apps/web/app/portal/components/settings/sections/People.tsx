"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  FilterChip,
  Icon,
  Panel,
  SearchInput,
  Td,
  Th,
} from "@/app/portal/components";
import { fmtAgo } from "@/lib/format";
import { Field, RoleBadge, SelectIn } from "@/app/portal/components/settings/atoms";
import { SETTINGS_MEMBERS } from "@/app/portal/components/settings/data";

export function PeopleSection() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "human" | "service">("all");
  const rows = SETTINGS_MEMBERS.filter(
    (m) =>
      (filter === "all" ||
        (filter === "service"
          ? m.role === "Service"
          : m.role !== "Service")) &&
      (!q ||
        m.name.toLowerCase().includes(q.toLowerCase()) ||
        m.email.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 1,
          background: "var(--border)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        {[
          { role: "Owner", perms: "Everything · billing · destroy" },
          { role: "Admin", perms: "Deploy · members · keys" },
          { role: "Operator", perms: "Run · approve tasks · view" },
          { role: "Viewer", perms: "Read-only across workspace" },
          { role: "Service", perms: "Machine accounts (CI, bots)" },
        ].map((r) => (
          <div key={r.role} style={{ padding: "10px 12px", background: "var(--panel)" }}>
            <div style={{ marginBottom: 5 }}>
              <RoleBadge role={r.role} />
            </div>
            <div style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.45 }}>{r.perms}</div>
          </div>
        ))}
      </div>

      <Panel
        title={`Members · ${rows.length}`}
        padded={false}
        action={
          <div style={{ display: "flex", gap: 6 }}>
            <Button small icon="upload" tone="ghost">
              Import CSV
            </Button>
            <Button small icon="plus" tone="primary">
              Invite
            </Button>
          </div>
        }
      >
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <SearchInput value={q} onChange={setQ} placeholder="name or email…" />
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
            All
          </FilterChip>
          <FilterChip active={filter === "human"} onClick={() => setFilter("human")}>
            People
          </FilterChip>
          <FilterChip active={filter === "service"} onClick={() => setFilter("service")}>
            Service
          </FilterChip>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <Th>Member</Th>
              <Th>Role</Th>
              <Th>Last active</Th>
              <Th>2FA</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <Td>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: "50%",
                        background: m.color,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 10.5,
                        fontWeight: 600,
                        color: "#000",
                      }}
                    >
                      {m.avatar}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ color: "var(--text)" }}>{m.name}</span>
                      <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                        {m.email}
                      </span>
                    </div>
                  </div>
                </Td>
                <Td>
                  <RoleBadge role={m.role} />
                </Td>
                <Td>
                  <span style={{ color: "var(--text-3)" }}>{fmtAgo(m.last)}</span>
                </Td>
                <Td>
                  {m.role === "Service" ? (
                    <span style={{ fontSize: 11, color: "var(--text-4)" }}>n/a</span>
                  ) : (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 11,
                        color: m.role === "Viewer" ? "var(--amber)" : "var(--green)",
                      }}
                    >
                      <Icon
                        name={m.role === "Viewer" ? "alert" : "check"}
                        size={10}
                      />
                      {m.role === "Viewer" ? "Required" : "Enabled"}
                    </span>
                  )}
                </Td>
                <Td style={{ textAlign: "right" }}>
                  <div style={{ display: "inline-flex", gap: 4 }}>
                    <Button small tone="ghost">
                      Change role
                    </Button>
                    <Button small tone="ghost">
                      Revoke
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="SSO & domain" padded>
        <Field label="SSO provider" hint="All non-service members must sign in via SSO.">
          <SelectIn
            value="Okta SAML 2.0"
            options={["Okta SAML 2.0", "Google Workspace", "Azure AD", "None (password)"]}
          />
        </Field>
        <Field
          label="Allowed email domains"
          hint="Members outside these domains can't be invited."
          right={
            <Button small icon="plus" tone="ghost">
              Add
            </Button>
          }
        >
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["agentic.local", "tencent-raas.com"].map((d) => (
              <span
                key={d}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "3px 8px",
                  background: "var(--panel-2)",
                  border: "1px solid var(--border-2)",
                  borderRadius: 3,
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: "var(--text-2)",
                }}
              >
                {d}
                <Icon name="x" size={9} style={{ color: "var(--text-3)", cursor: "pointer" }} />
              </span>
            ))}
          </div>
        </Field>
        <Field label="Session timeout" hint="Sign out inactive sessions automatically.">
          <SelectIn
            value="8 hours"
            options={["1 hour", "4 hours", "8 hours", "24 hours", "Never"]}
          />
        </Field>
      </Panel>

      {/* Keep Badge import used (future role legend tooltips) */}
      {false && <Badge tone="muted">unused</Badge>}
    </div>
  );
}
