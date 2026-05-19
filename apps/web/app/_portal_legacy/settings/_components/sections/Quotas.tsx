"use client";

import { Button, Panel } from "@/components";
import { Field, Td, TextIn, Th } from "../atoms";
import { SETTINGS_QUOTAS } from "../data";

function QuotaBar({
  used,
  cap,
  format,
}: {
  used: number;
  cap: number;
  format: (v: number) => string;
}) {
  const pct = Math.min(100, (used / cap) * 100);
  const color =
    pct > 85 ? "var(--red)" : pct > 65 ? "var(--amber)" : "var(--signal)";
  return (
    <div
      style={{
        minWidth: 180,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          fontFamily: "var(--mono)",
        }}
      >
        <span style={{ color: "var(--text-2)" }}>{format(used)}</span>
        <span style={{ color: "var(--text-3)" }}>/ {format(cap)}</span>
      </div>
      <div
        style={{
          height: 4,
          background: "var(--bg-2)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{ width: `${pct}%`, height: "100%", background: color }}
        />
      </div>
    </div>
  );
}

function BudgetCell({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRight: "1px solid var(--border)",
        background: "var(--panel)",
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontFamily: "var(--mono)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--text-3)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 22,
          fontFamily: "var(--mono)",
          color: "var(--text)",
        }}
      >
        {value}
      </div>
      <div
        style={{
          marginTop: 2,
          fontSize: 11,
          color: "var(--text-3)",
        }}
      >
        {sub}
      </div>
    </div>
  );
}

export function QuotasSection() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Panel
        title="Per-tenant quotas"
        subtitle="Hard caps. Runs over the limit are queued and surface as a Quota event."
        padded={false}
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
              <Th>Tenant</Th>
              <Th>Concurrent runs</Th>
              <Th>Tokens · 24h</Th>
              <Th>Spend · 30d</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {SETTINGS_QUOTAS.map((q) => (
              <tr
                key={q.tenant}
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                <Td>
                  <span
                    style={{ color: "var(--text)", fontWeight: 500 }}
                  >
                    {q.tenant}
                  </span>
                </Td>
                <Td>
                  <QuotaBar
                    used={q.concurrency.used}
                    cap={q.concurrency.cap}
                    format={(v) => v.toString()}
                  />
                </Td>
                <Td>
                  <QuotaBar
                    used={q.tokens24h.used}
                    cap={q.tokens24h.cap}
                    format={(v) => `${(v / 1e6).toFixed(2)}M`}
                  />
                </Td>
                <Td>
                  <QuotaBar
                    used={q.spend30d.used}
                    cap={q.spend30d.cap}
                    format={(v) => `$${v}`}
                  />
                </Td>
                <Td style={{ textAlign: "right" }}>
                  <Button small tone="ghost">
                    Adjust
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Rate limits (HTTP API)" padded>
        <Field
          label="Anonymous reads"
          hint="Public dashboards & webhooks."
        >
          <TextIn value="60" mono suffix="req / min / IP" />
        </Field>
        <Field
          label="Authenticated reads"
          hint="API-key-scoped read operations."
        >
          <TextIn value="600" mono suffix="req / min / key" />
        </Field>
        <Field
          label="Writes (deploy, emit, mutate)"
          hint="Stricter cap on state-changing endpoints."
        >
          <TextIn value="60" mono suffix="req / min / key" />
        </Field>
        <Field
          label="Burst window"
          hint="How long the bucket fills before rejecting."
        >
          <TextIn value="10" mono suffix="seconds" />
        </Field>
      </Panel>

      <Panel
        title="Failure budgets"
        subtitle="When an agent crosses the budget, it auto-pauses and pages the on-call rotation."
        padded
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 0,
            border: "1px solid var(--border)",
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          <BudgetCell
            label="Agent error rate"
            value="2%"
            sub="rolling 5 min · over 50 runs"
          />
          <BudgetCell
            label="Step P99 latency"
            value="30s"
            sub="auto-pause if breached for 3 min"
          />
          <BudgetCell
            label="Tool timeouts"
            value="10%"
            sub="rolling 10 min · over 100 calls"
          />
        </div>
      </Panel>
    </div>
  );
}
