"use client";

import type { ReactNode } from "react";
import { Button, Icon } from "@/components";

function DangerCard({
  title,
  body,
  cta,
  tone,
  confirm,
}: {
  title: string;
  body: ReactNode;
  cta: string;
  tone: "amber" | "red";
  confirm?: boolean;
}) {
  const border =
    tone === "red" ? "rgba(255,100,112,0.35)" : "rgba(255,181,71,0.30)";
  const accent = tone === "red" ? "var(--red)" : "var(--amber)";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 16,
        alignItems: "center",
        padding: "16px 18px",
        background: "var(--panel)",
        border: `1px solid ${border}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 6,
      }}
    >
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 4,
          }}
        >
          <Icon name="alert" size={12} style={{ color: accent }} />
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "var(--text)",
            }}
          >
            {title}
          </span>
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--text-2)",
            lineHeight: 1.55,
            maxWidth: 640,
          }}
        >
          {body}
        </div>
      </div>
      <div
        style={{ display: "flex", alignItems: "center", gap: 8 }}
      >
        {confirm && (
          <span
            className="mono"
            style={{ fontSize: 11, color: "var(--text-3)" }}
          >
            Type workspace name to confirm
          </span>
        )}
        <Button tone="danger" icon="alert">
          {cta}
        </Button>
      </div>
    </div>
  );
}

export function DangerSection() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <DangerCard
        title="Pause all agents"
        body="Halts incoming events workspace-wide. In-flight runs complete; new triggers are queued. Resume any time."
        cta="Pause workspace"
        tone="amber"
      />
      <DangerCard
        title="Rebuild event index"
        body="Re-derives the events table from raw runs. Read-only views are unaffected; observability lags up to 2 minutes."
        cta="Rebuild index"
        tone="amber"
      />
      <DangerCard
        title="Rotate all API keys"
        body="Invalidates every key in this workspace and issues replacements. CI/CD will need new values before next deploy."
        cta="Rotate everything"
        tone="amber"
      />
      <DangerCard
        title="Transfer ownership"
        body="Hand the Owner role to another Admin. You'll be downgraded to Admin and lose billing access."
        cta="Transfer…"
        tone="amber"
      />
      <DangerCard
        title="Delete workspace"
        body={
          <>
            Permanently deletes{" "}
            <span className="mono">agentic-operator</span> and all tenants,
            agents, runs, events and audit logs.{" "}
            <strong style={{ color: "var(--red)" }}>
              This cannot be undone.
            </strong>
          </>
        }
        cta="Delete workspace"
        tone="red"
        confirm
      />
    </div>
  );
}
