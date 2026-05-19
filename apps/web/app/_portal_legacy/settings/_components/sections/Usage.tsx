"use client";

import { useState } from "react";
import { Badge, Button, Icon, Panel, Stat } from "@/components";
import { fmtAgo } from "@/lib/format";
import { TENANTS } from "@/lib/tenants";
import { IntegrationGlyph, RoleBadge, SegPicker, Td, Th } from "../atoms";
import {
  USAGE_BY_AGENT,
  USAGE_BY_MODEL,
  USAGE_BY_PROVIDER,
  USAGE_BY_TENANT,
  USAGE_BY_USER,
  USAGE_DAILY,
  type UsageDailyPoint,
} from "../data";

function UsageKpi({
  label,
  value,
  delta,
  deltaUp,
}: {
  label: string;
  value: string;
  delta: string;
  deltaUp?: boolean;
}) {
  return (
    <div
      style={{
        padding: "14px 18px",
        borderRight: "1px solid var(--border)",
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
          color: deltaUp ? "var(--green)" : "var(--text-3)",
        }}
      >
        {delta}
      </div>
    </div>
  );
}

function UsageChart({ series }: { series: UsageDailyPoint[] }) {
  const w = 980;
  const h = 180;
  const pad = { l: 38, r: 8, t: 12, b: 22 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const max = Math.max(...series.map((d) => d.spend));
  const yMax = Math.ceil(max / 20) * 20;
  const barW = innerW / series.length - 2;
  const ticks = [0, yMax * 0.25, yMax * 0.5, yMax * 0.75, yMax];

  return (
    <div style={{ overflow: "auto" }}>
      <svg width={w} height={h} style={{ display: "block" }}>
        {ticks.map((t, i) => {
          const y = pad.t + innerH * (1 - t / yMax);
          return (
            <g key={i}>
              <line
                x1={pad.l}
                x2={w - pad.r}
                y1={y}
                y2={y}
                stroke="var(--border)"
                strokeWidth={1}
                strokeDasharray={i === 0 ? undefined : "2 4"}
              />
              <text
                x={pad.l - 6}
                y={y + 3}
                fill="var(--text-3)"
                fontSize="9"
                fontFamily="var(--mono)"
                textAnchor="end"
              >
                ${t.toFixed(0)}
              </text>
            </g>
          );
        })}

        {series.map((d, i) => {
          const x = pad.l + i * (barW + 2) + 1;
          const totalH = (d.spend / yMax) * innerH;
          const openaiH = totalH * 0.05;
          const anthropicH = totalH - openaiH;
          const yTop = pad.t + innerH - totalH;
          return (
            <g key={i}>
              <rect
                x={x}
                y={yTop}
                width={barW}
                height={anthropicH}
                fill="var(--signal)"
                opacity={0.85}
              />
              <rect
                x={x}
                y={yTop + anthropicH}
                width={barW}
                height={openaiH}
                fill="var(--blue)"
                opacity={0.85}
              />
              <rect
                x={x - 1}
                y={pad.t}
                width={barW + 2}
                height={innerH}
                fill="transparent"
                pointerEvents="all"
              >
                <title>
                  {new Date(d.day).toDateString()} · ${d.spend.toFixed(2)} ·{" "}
                  {(d.tokens / 1000).toFixed(0)}k tokens
                </title>
              </rect>
            </g>
          );
        })}

        {series.map((d, i) => {
          if (i % 5 !== 0 && i !== series.length - 1) return null;
          const x = pad.l + i * (barW + 2) + barW / 2 + 1;
          const label = new Date(d.day).toLocaleDateString([], {
            month: "short",
            day: "numeric",
          });
          return (
            <text
              key={i}
              x={x}
              y={h - 6}
              fill="var(--text-3)"
              fontSize="9"
              fontFamily="var(--mono)"
              textAnchor="middle"
            >
              {label}
            </text>
          );
        })}
      </svg>

      <div
        style={{
          display: "flex",
          gap: 14,
          marginTop: 8,
          paddingLeft: pad.l,
          fontSize: 11,
          fontFamily: "var(--mono)",
          color: "var(--text-3)",
        }}
      >
        <span>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              background: "var(--signal)",
              marginRight: 5,
            }}
          />
          Anthropic
        </span>
        <span>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              background: "var(--blue)",
              marginRight: 5,
            }}
          />
          OpenAI
        </span>
      </div>
    </div>
  );
}

function BreakdownByTenant() {
  const total = USAGE_BY_TENANT.reduce((s, t) => s + t.spend, 0);
  return (
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
          <Th>Share</Th>
          <Th>Calls</Th>
          <Th>Tokens in / out</Th>
          <Th>Spend · 30d</Th>
          <Th>Δ vs prev</Th>
        </tr>
      </thead>
      <tbody>
        {USAGE_BY_TENANT.map((t) => {
          const share = (t.spend / total) * 100;
          const tenant = TENANTS.find((x) => x.id === t.id);
          return (
            <tr
              key={t.id}
              style={{ borderBottom: "1px solid var(--border)" }}
            >
              <Td>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      background: tenant?.color ?? "var(--text-4)",
                      borderRadius: 3,
                    }}
                  />
                  <span style={{ color: "var(--text)" }}>{t.name}</span>
                </div>
              </Td>
              <Td>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minWidth: 140,
                  }}
                >
                  <div
                    style={{
                      flex: 1,
                      height: 4,
                      background: "var(--bg-2)",
                      borderRadius: 2,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${share}%`,
                        height: "100%",
                        background: tenant?.color ?? "var(--signal)",
                      }}
                    />
                  </div>
                  <span
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: "var(--text-3)",
                      minWidth: 38,
                      textAlign: "right",
                    }}
                  >
                    {share.toFixed(0)}%
                  </span>
                </div>
              </Td>
              <Td>
                <span
                  className="mono"
                  style={{ color: "var(--text-2)" }}
                >
                  {t.calls.toLocaleString()}
                </span>
              </Td>
              <Td>
                <span
                  className="mono"
                  style={{ color: "var(--text-2)" }}
                >
                  {(t.tokensIn / 1e6).toFixed(2)}M /{" "}
                  {(t.tokensOut / 1e6).toFixed(2)}M
                </span>
              </Td>
              <Td>
                <span className="mono" style={{ color: "var(--text)" }}>
                  ${t.spend.toFixed(2)}
                </span>
              </Td>
              <Td>
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--mono)",
                    color: t.delta >= 0 ? "var(--green)" : "var(--red)",
                  }}
                >
                  {t.delta >= 0 ? "+" : ""}
                  {(t.delta * 100).toFixed(0)}%
                </span>
              </Td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function BreakdownByAgent() {
  const max = Math.max(...USAGE_BY_AGENT.map((a) => a.spend));
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontSize: 12.5,
      }}
    >
      <thead>
        <tr style={{ borderBottom: "1px solid var(--border)" }}>
          <Th>Agent</Th>
          <Th>Tenant</Th>
          <Th>Model</Th>
          <Th>Calls</Th>
          <Th>Avg latency</Th>
          <Th>Err</Th>
          <Th>Spend · 30d</Th>
        </tr>
      </thead>
      <tbody>
        {USAGE_BY_AGENT.map((a) => (
          <tr
            key={a.id}
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <Td>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Badge tone="muted">{a.id}</Badge>
                <span className="mono" style={{ color: "var(--text)" }}>
                  {a.name}
                </span>
              </div>
            </Td>
            <Td>
              <span style={{ color: "var(--text-2)" }}>{a.tenant}</span>
            </Td>
            <Td>
              <span
                className="mono"
                style={{ fontSize: 11.5, color: "var(--text-2)" }}
              >
                {a.model}
              </span>
            </Td>
            <Td>
              <span
                className="mono"
                style={{ color: "var(--text-2)" }}
              >
                {a.calls.toLocaleString()}
              </span>
            </Td>
            <Td>
              <span
                className="mono"
                style={{ color: "var(--text-2)" }}
              >
                {a.avgLat.toFixed(1)}s
              </span>
            </Td>
            <Td>
              <span
                className="mono"
                style={{
                  color:
                    a.errRate > 0.015 ? "var(--amber)" : "var(--text-3)",
                }}
              >
                {(a.errRate * 100).toFixed(1)}%
              </span>
            </Td>
            <Td>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  minWidth: 150,
                }}
              >
                <div
                  style={{
                    flex: 1,
                    height: 4,
                    background: "var(--bg-2)",
                    borderRadius: 2,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${(a.spend / max) * 100}%`,
                      height: "100%",
                      background: "var(--signal)",
                    }}
                  />
                </div>
                <span
                  className="mono"
                  style={{
                    fontSize: 11.5,
                    color: "var(--text)",
                    minWidth: 56,
                    textAlign: "right",
                  }}
                >
                  ${a.spend.toFixed(2)}
                </span>
              </div>
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BreakdownByUser() {
  const max = Math.max(...USAGE_BY_USER.map((u) => u.spend));
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontSize: 12.5,
      }}
    >
      <thead>
        <tr style={{ borderBottom: "1px solid var(--border)" }}>
          <Th>User</Th>
          <Th>Role</Th>
          <Th>Last active</Th>
          <Th>Calls · 30d</Th>
          <Th>Spend · 30d</Th>
        </tr>
      </thead>
      <tbody>
        {USAGE_BY_USER.map((u) => (
          <tr
            key={u.id}
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <Td>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    background: u.color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: "#000",
                  }}
                >
                  {u.initials}
                </div>
                <span style={{ color: "var(--text)" }}>{u.name}</span>
              </div>
            </Td>
            <Td>
              <RoleBadge
                role={u.role as "Owner" | "Admin" | "Operator" | "Viewer" | "Service"}
              />
            </Td>
            <Td>
              <span style={{ color: "var(--text-3)" }}>
                {fmtAgo(u.lastActive)}
              </span>
            </Td>
            <Td>
              <span
                className="mono"
                style={{ color: "var(--text-2)" }}
              >
                {u.calls.toLocaleString()}
              </span>
            </Td>
            <Td>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  minWidth: 150,
                }}
              >
                <div
                  style={{
                    flex: 1,
                    height: 4,
                    background: "var(--bg-2)",
                    borderRadius: 2,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${(u.spend / max) * 100}%`,
                      height: "100%",
                      background: u.color,
                    }}
                  />
                </div>
                <span
                  className="mono"
                  style={{
                    fontSize: 11.5,
                    color: "var(--text)",
                    minWidth: 64,
                    textAlign: "right",
                  }}
                >
                  ${u.spend.toFixed(2)}
                </span>
              </div>
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BreakdownByProvider() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: 1,
        background: "var(--border)",
      }}
    >
      {USAGE_BY_PROVIDER.map((p) => (
        <div
          key={p.id}
          style={{ padding: "16px 18px", background: "var(--panel)" }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <IntegrationGlyph id={p.id} />
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 14,
                  color: "var(--text)",
                  fontWeight: 500,
                }}
              >
                {p.name}
              </div>
              <div
                className="mono"
                style={{ fontSize: 11, color: "var(--text-3)" }}
              >
                {p.calls.toLocaleString()} calls · 30d
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div
                style={{
                  fontSize: 18,
                  fontFamily: "var(--mono)",
                  color: "var(--text)",
                }}
              >
                ${p.spend.toFixed(2)}
              </div>
              <div
                className="mono"
                style={{ fontSize: 11, color: "var(--text-3)" }}
              >
                {(p.share * 100).toFixed(0)}% of total
              </div>
            </div>
          </div>
          <div
            style={{
              height: 5,
              background: "var(--bg-2)",
              borderRadius: 2,
              overflow: "hidden",
              marginBottom: 10,
            }}
          >
            <div
              style={{
                width: `${p.share * 100}%`,
                height: "100%",
                background: p.id === "anthropic" ? "#d97757" : "#10a37f",
              }}
            />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              fontSize: 11,
              fontFamily: "var(--mono)",
            }}
          >
            <div>
              <div style={{ color: "var(--text-3)" }}>Tokens in</div>
              <div style={{ color: "var(--text)", marginTop: 2 }}>
                {(p.tokensIn / 1e6).toFixed(2)}M
              </div>
            </div>
            <div>
              <div style={{ color: "var(--text-3)" }}>Tokens out</div>
              <div style={{ color: "var(--text)", marginTop: 2 }}>
                {(p.tokensOut / 1e6).toFixed(2)}M
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function BreakdownByModel() {
  const max = Math.max(...USAGE_BY_MODEL.map((m) => m.spend));
  return (
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
          <Th>Calls</Th>
          <Th>Avg tokens (in / out)</Th>
          <Th>Avg latency</Th>
          <Th>Spend · 30d</Th>
        </tr>
      </thead>
      <tbody>
        {USAGE_BY_MODEL.map((m) => (
          <tr
            key={m.name}
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <Td>
              <span className="mono" style={{ color: "var(--text)" }}>
                {m.name}
              </span>
            </Td>
            <Td>
              <span style={{ color: "var(--text-2)" }}>{m.provider}</span>
            </Td>
            <Td>
              <span
                className="mono"
                style={{ color: "var(--text-2)" }}
              >
                {m.calls.toLocaleString()}
              </span>
            </Td>
            <Td>
              <span
                className="mono"
                style={{ color: "var(--text-2)" }}
              >
                {m.avgIn} / {m.avgOut}
              </span>
            </Td>
            <Td>
              <span
                className="mono"
                style={{ color: "var(--text-2)" }}
              >
                {m.avgLat.toFixed(1)}s
              </span>
            </Td>
            <Td>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  minWidth: 160,
                }}
              >
                <div
                  style={{
                    flex: 1,
                    height: 4,
                    background: "var(--bg-2)",
                    borderRadius: 2,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${(m.spend / max) * 100}%`,
                      height: "100%",
                      background:
                        m.provider === "Anthropic" ? "#d97757" : "#10a37f",
                    }}
                  />
                </div>
                <span
                  className="mono"
                  style={{
                    fontSize: 11.5,
                    color: "var(--text)",
                    minWidth: 70,
                    textAlign: "right",
                  }}
                >
                  ${m.spend.toFixed(2)}
                </span>
              </div>
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function UsageSection() {
  const [period, setPeriod] = useState<"24h" | "7d" | "30d" | "90d" | "custom">(
    "30d",
  );
  const [tab, setTab] = useState<
    "tenant" | "agent" | "user" | "provider" | "model"
  >("tenant");
  const [groupBy, setGroupBy] = useState<"day" | "week">("day");

  const totalSpend = USAGE_DAILY.reduce((s, d) => s + d.spend, 0);
  const totalTokens = USAGE_DAILY.reduce((s, d) => s + d.tokens, 0);
  const totalCalls = USAGE_BY_TENANT.reduce((s, t) => s + t.calls, 0);
  const avgCost = totalSpend / Math.max(1, totalCalls);
  const projected = (totalSpend / 30) * 30 * 1.08;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Top filter strip */}
      <div
        style={{ display: "flex", alignItems: "center", gap: 8 }}
      >
        <SegPicker
          value={period}
          onChange={setPeriod}
          options={[
            { value: "24h",    label: "24h" },
            { value: "7d",     label: "7d" },
            { value: "30d",    label: "30d" },
            { value: "90d",    label: "90d" },
            { value: "custom", label: "Custom" },
          ]}
        />
        <div
          style={{ marginLeft: "auto", display: "flex", gap: 6 }}
        >
          <Button small icon="filter" tone="ghost">
            Filter
          </Button>
          <Button small icon="upload" tone="ghost">
            Export CSV
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 0,
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "var(--panel)",
          overflow: "hidden",
        }}
      >
        <UsageKpi
          label="Total spend"
          value={`$${totalSpend.toFixed(2)}`}
          delta="+8.2% vs prev 30d"
          deltaUp
        />
        <UsageKpi
          label="Tokens"
          value={`${(totalTokens / 1e6).toFixed(2)}M`}
          delta="+11.4%"
          deltaUp
        />
        <UsageKpi
          label="Avg cost / call"
          value={`$${avgCost.toFixed(4)}`}
          delta="−3.1%"
        />
        <UsageKpi
          label="Projected · this month"
          value={`$${projected.toFixed(0)}`}
          delta="pace under $2.5k cap"
        />
      </div>

      {/* Daily spend chart */}
      <Panel
        title={`Daily spend · last ${period}`}
        subtitle="Stacked by provider"
        padded
        action={
          <SegPicker
            small
            value={groupBy}
            onChange={setGroupBy}
            options={[
              { value: "day",  label: "Day" },
              { value: "week", label: "Week" },
            ]}
          />
        }
      >
        <UsageChart series={USAGE_DAILY} />
      </Panel>

      {/* Breakdown tabs */}
      <Panel
        title="Breakdown"
        padded={false}
        action={
          <div
            style={{
              display: "flex",
              gap: 0,
              border: "1px solid var(--border-2)",
              borderRadius: 4,
              overflow: "hidden",
            }}
          >
            {(
              [
                { id: "tenant",   label: "By tenant" },
                { id: "agent",    label: "By agent" },
                { id: "user",     label: "By user" },
                { id: "provider", label: "By provider" },
                { id: "model",    label: "By model" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  padding: "5px 12px",
                  fontSize: 11,
                  fontFamily: "var(--mono)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  background:
                    tab === t.id ? "var(--panel-3)" : "var(--panel-2)",
                  color: tab === t.id ? "var(--text)" : "var(--text-3)",
                  borderRight: "1px solid var(--border-2)",
                  borderBottom:
                    tab === t.id
                      ? "2px solid var(--signal)"
                      : "2px solid transparent",
                  cursor: "pointer",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      >
        {tab === "tenant" && <BreakdownByTenant />}
        {tab === "agent" && <BreakdownByAgent />}
        {tab === "user" && <BreakdownByUser />}
        {tab === "provider" && <BreakdownByProvider />}
        {tab === "model" && <BreakdownByModel />}
      </Panel>

      {/* Forecast & alerts */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.6fr 1fr",
          gap: 14,
        }}
      >
        <Panel
          title="Forecast"
          subtitle="Next 30 days, based on rolling 14-day trend."
          padded
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 14,
            }}
          >
            <Stat
              label="P50 forecast"
              value={`$${projected.toFixed(0)}`}
              mono
              accent="var(--signal)"
            />
            <Stat
              label="P90 forecast"
              value={`$${(projected * 1.18).toFixed(0)}`}
              mono
              accent="var(--amber)"
            />
            <Stat label="Budget cap" value="$2,500" mono />
          </div>
          <div
            style={{
              marginTop: 14,
              padding: "10px 12px",
              background: "var(--panel-2)",
              border: "1px solid var(--border)",
              borderRadius: 5,
              fontSize: 12,
              color: "var(--text-2)",
              lineHeight: 1.55,
            }}
          >
            <Icon
              name="spark"
              size={11}
              style={{ color: "var(--signal)", marginRight: 6 }}
            />
            At the current pace,{" "}
            <span style={{ color: "var(--text)" }}>matchResume</span> will
            exceed its $400/mo soft target around{" "}
            <span className="mono" style={{ color: "var(--amber)" }}>
              day 22
            </span>
            . Consider routing low-priority candidates through{" "}
            <span className="mono">claude-haiku-4-5</span>.
          </div>
        </Panel>

        <Panel title="Budget alerts" padded={false}>
          {[
            { kind: "tenant", name: "RAAS",                cap: 2000, used: 1684.2 },
            { kind: "agent",  name: "evaluateInterview",   cap: 400,  used: 318.8  },
            { kind: "model",  name: "claude-sonnet-4-5",   cap: 1800, used: 1648.3 },
          ].map((b) => {
            const pct = (b.used / b.cap) * 100;
            const tone =
              pct > 90
                ? "var(--red)"
                : pct > 75
                  ? "var(--amber)"
                  : "var(--signal)";
            return (
              <div
                key={b.name}
                style={{
                  padding: "10px 14px",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 4,
                  }}
                >
                  <Badge tone="muted">{b.kind}</Badge>
                  <span
                    className="mono"
                    style={{ fontSize: 12, color: "var(--text)" }}
                  >
                    {b.name}
                  </span>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 11.5,
                      fontFamily: "var(--mono)",
                      color: tone,
                    }}
                  >
                    {pct.toFixed(0)}%
                  </span>
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
                    style={{
                      width: `${Math.min(100, pct)}%`,
                      height: "100%",
                      background: tone,
                    }}
                  />
                </div>
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 10.5,
                    fontFamily: "var(--mono)",
                    color: "var(--text-3)",
                  }}
                >
                  ${b.used.toFixed(2)} / ${b.cap.toLocaleString()}
                </div>
              </div>
            );
          })}
        </Panel>
      </div>
    </div>
  );
}
