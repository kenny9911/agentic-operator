"use client";

import { Badge, Button, Icon, Panel } from "@/components";
import { fmtAgo } from "@/lib/format";
import { CodeBlock, Td, Th } from "../atoms";
import { SETTINGS_KEYS } from "../data";

export function KeysSection() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Panel
        title="Workspace API keys"
        subtitle="Use these to call the runtime from CI, scripts, or downstream services."
        padded={false}
        action={
          <Button small icon="plus" tone="primary">
            New key
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
              <Th>Label</Th>
              <Th>Key prefix</Th>
              <Th>Scopes</Th>
              <Th>Created</Th>
              <Th>Last used</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {SETTINGS_KEYS.map((k) => (
              <tr
                key={k.id}
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                <Td>
                  <div style={{ color: "var(--text)" }}>{k.label}</div>
                  <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                    by {k.author}
                  </div>
                </Td>
                <Td>
                  <span
                    className="mono"
                    style={{ fontSize: 12, color: "var(--text-2)" }}
                  >
                    {k.prefix}
                    <span style={{ color: "var(--text-4)" }}>
                      •••••••••••••
                    </span>
                  </span>
                </Td>
                <Td>
                  <div
                    style={{ display: "flex", gap: 4, flexWrap: "wrap" }}
                  >
                    {k.scopes.map((s) => (
                      <Badge key={s} tone="muted">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </Td>
                <Td>
                  <span style={{ color: "var(--text-3)" }}>
                    {fmtAgo(k.created)}
                  </span>
                </Td>
                <Td>
                  <div
                    style={{ display: "flex", flexDirection: "column" }}
                  >
                    <span style={{ color: "var(--text-2)" }}>
                      {fmtAgo(k.lastUsed)}
                    </span>
                    {k.expiring && (
                      <span style={{ fontSize: 10.5, color: "var(--amber)" }}>
                        Expires in {k.expiring}d
                      </span>
                    )}
                  </div>
                </Td>
                <Td style={{ textAlign: "right" }}>
                  <div style={{ display: "inline-flex", gap: 4 }}>
                    <Button small tone="ghost">
                      Rotate
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

      <Panel title="CLI authentication" padded>
        <div
          style={{
            fontSize: 12.5,
            color: "var(--text-2)",
            marginBottom: 10,
            lineHeight: 1.55,
          }}
        >
          Authenticate the <span className="mono">agentic</span> CLI for shell
          deploys and tail logs.
        </div>
        <CodeBlock>{`$ agentic login \\
    --workspace agentic-operator \\
    --region cn-shenzhen-1

→ Open this URL in your browser:
  https://agentic.local/auth/cli?code=GTCN-7K2P-49AX

✓ Authenticated as Liu Wei
✓ Token saved to ~/.agentic/credentials (mode 0600)`}</CodeBlock>
      </Panel>

      <Panel
        title="IP allow-list"
        padded
        action={
          <Button small icon="plus" tone="ghost">
            Add range
          </Button>
        }
      >
        <div
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          {[
            { cidr: "10.42.0.0/16",   note: "Office VPN — Shenzhen" },
            { cidr: "203.0.113.0/24", note: "Tencent ATS callback range" },
            {
              cidr: "0.0.0.0/0",
              note: "Public — disabled in prod",
              off: true,
            },
          ].map((r) => (
            <div
              key={r.cidr}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 10px",
                background: "var(--panel-2)",
                border: "1px solid var(--border)",
                borderRadius: 4,
              }}
            >
              <Icon
                name="dot"
                size={8}
                style={{
                  color: r.off ? "var(--text-4)" : "var(--green)",
                }}
              />
              <span
                className="mono"
                style={{
                  fontSize: 12,
                  color: r.off ? "var(--text-4)" : "var(--text)",
                }}
              >
                {r.cidr}
              </span>
              <span
                style={{
                  flex: 1,
                  fontSize: 11.5,
                  color: "var(--text-3)",
                }}
              >
                {r.note}
              </span>
              {r.off && <Badge tone="muted">disabled</Badge>}
              <Icon
                name="x"
                size={11}
                style={{ color: "var(--text-3)", cursor: "pointer" }}
              />
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
