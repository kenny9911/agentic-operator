"use client";

/**
 * Settings → Billing / Cost caps. Will link to /v1/budgets when wired.
 */

import { Badge, Button, Panel } from "@/app/portal/components";
import { Field, TextIn } from "@/app/portal/components/settings/atoms";

const PER_TENANT_BUDGETS = [
  { tenant: "RAAS", spend30d: 1924, cap: 4000 },
  { tenant: "SupportFlow", spend30d: 318, cap: 1000 },
  { tenant: "FinanceClose", spend30d: 42, cap: 500 },
];

export function BillingSection() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Panel
        title="Plan"
        padded
        action={
          <Button small icon="external" tone="ghost">
            Open invoice
          </Button>
        }
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0 }}>
          <BudgetCell label="Plan" value="Team" sub="$420 / mo base" />
          <BudgetCell label="This cycle" value="$2,284" sub="May 1 → May 31" />
          <BudgetCell label="Projection" value="$3,140" sub="based on 60% of cycle" />
        </div>
      </Panel>

      <Panel
        title="Per-tenant cost caps"
        subtitle="Soft monthly caps. Calls to /v1/budgets enforce these."
        padded={false}
      >
        {PER_TENANT_BUDGETS.map((b, i) => {
          const pct = (b.spend30d / b.cap) * 100;
          return (
            <div
              key={b.tenant}
              style={{
                padding: "12px 14px",
                borderBottom: i < PER_TENANT_BUDGETS.length - 1 ? "1px solid var(--border)" : "none",
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
                <span style={{ fontSize: 13, color: "var(--text)" }}>{b.tenant}</span>
                <Badge tone={pct >= 80 ? "amber" : "muted"}>
                  ${b.spend30d.toLocaleString()} / ${b.cap.toLocaleString()}
                </Badge>
                <Button small tone="ghost" style={{ marginLeft: "auto" }}>
                  Edit
                </Button>
              </div>
              <div
                style={{
                  height: 6,
                  background: "var(--panel-2)",
                  border: "1px solid var(--border)",
                  borderRadius: 3,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, pct)}%`,
                    height: "100%",
                    background:
                      pct >= 90 ? "var(--red)" : pct >= 70 ? "var(--amber)" : "var(--signal)",
                  }}
                />
              </div>
            </div>
          );
        })}
      </Panel>

      <Panel title="Billing contact" padded>
        <Field label="Email">
          <TextIn value="billing@agentic.local" />
        </Field>
        <Field label="VAT / Tax ID">
          <TextIn value="" placeholder="Optional — e.g. EU VAT" mono />
        </Field>
      </Panel>
    </div>
  );
}

function BudgetCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ padding: "10px 14px", borderRight: "1px solid var(--border)" }}>
      <div
        style={{
          fontSize: 10,
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
          fontSize: 18,
          fontFamily: "var(--mono)",
          color: "var(--text)",
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ marginTop: 2, fontSize: 11, color: "var(--text-3)" }}>{sub}</div>
      )}
    </div>
  );
}
