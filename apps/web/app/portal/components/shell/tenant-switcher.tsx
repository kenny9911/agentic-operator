"use client";

/**
 * TenantSwitcher — dropdown of available tenants with active highlight.
 *
 * Ported from v1_1 app.jsx:181-238. Behaviour:
 *   - Tenant is in the URL (P2-FE-25); selecting one calls `useTenantNavigate`
 *     to push `/portal/<new-slug>/<rest>`.
 *   - "New tenant" row is wired to a stub onClick (toast for now).
 */

import { useState } from "react";
import { Icon } from "../Icon";
import { useTenant, useTenantNavigate } from "../../lib/use-tenant";
import { toast } from "../toast";

export interface TenantOption {
  id: string;
  name: string;
  subtitle?: string;
  color: string;
  agentCount?: number;
  runs24h?: number;
}

export function TenantSwitcher({ tenants }: { tenants: TenantOption[] }) {
  const [open, setOpen] = useState(false);
  const activeId = useTenant();
  const navigate = useTenantNavigate();
  const active = tenants.find((t) => t.id === activeId) ?? tenants[0];
  if (!active) return null;

  return (
    <div
      style={{
        padding: "10px 12px",
        borderBottom: "1px solid var(--border)",
        position: "relative",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: "8px 10px",
          background: "var(--panel)",
          border: "1px solid var(--border-2)",
          borderRadius: 5,
          textAlign: "left",
        }}
      >
        <div
          style={{
            width: 22,
            height: 22,
            background: active.color,
            borderRadius: 3,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontFamily: "var(--mono)",
            color: "#000",
            fontWeight: 700,
          }}
        >
          {active.name[0]}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "var(--text)", fontWeight: 500 }}>
            {active.name}
          </div>
          {active.subtitle && (
            <div
              style={{
                fontSize: 10.5,
                color: "var(--text-3)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {active.subtitle}
            </div>
          )}
        </div>
        <Icon
          name="chevron-down"
          size={11}
          style={{ color: "var(--text-3)" }}
        />
      </button>
      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute",
            top: "100%",
            left: 12,
            right: 12,
            zIndex: "var(--z-overlay)" as unknown as number,
            marginTop: 4,
            background: "var(--panel)",
            border: "1px solid var(--border-2)",
            borderRadius: 5,
            boxShadow: "0 8px 20px rgba(0,0,0,0.4)",
            overflow: "hidden",
          }}
        >
          {tenants.map((t) => (
            <button
              key={t.id}
              role="option"
              aria-selected={t.id === active.id}
              onClick={() => {
                if (t.id !== active.id) navigate(t.id);
                setOpen(false);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                padding: "8px 10px",
                background:
                  t.id === active.id ? "var(--panel-2)" : "transparent",
                textAlign: "left",
                fontSize: 12,
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div
                style={{
                  width: 18,
                  height: 18,
                  background: t.color,
                  borderRadius: 3,
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ color: "var(--text)" }}>{t.name}</div>
                {(t.agentCount != null || t.runs24h != null) && (
                  <div style={{ fontSize: 10, color: "var(--text-3)" }}>
                    {t.agentCount != null && `${t.agentCount} agents`}
                    {t.agentCount != null && t.runs24h != null && " · "}
                    {t.runs24h != null && `${t.runs24h} runs/24h`}
                  </div>
                )}
              </div>
              {t.id === active.id && (
                <Icon
                  name="check"
                  size={12}
                  style={{ color: "var(--signal)" }}
                />
              )}
            </button>
          ))}
          <button
            onClick={() => {
              toast({
                tone: "amber",
                title: "Not yet implemented",
                description: "Tenant provisioning is post-v1.",
              });
              setOpen(false);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "8px 10px",
              fontSize: 12,
              color: "var(--text-2)",
            }}
          >
            <Icon name="plus" size={11} /> New tenant
          </button>
        </div>
      )}
    </div>
  );
}
