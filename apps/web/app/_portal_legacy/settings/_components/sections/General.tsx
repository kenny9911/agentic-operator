"use client";

import { useState } from "react";
import { Button, Panel } from "@/components";
import { TENANTS } from "@/lib/tenants";
import { Field, SelectIn, TextIn, Toggle } from "../atoms";

export function GeneralSection({
  tenantId,
  onTenantChange,
}: {
  tenantId: string;
  onTenantChange: (id: string) => void;
}) {
  const [name, setName] = useState("agentic-operator");
  const [display, setDisplay] = useState("Agentic Operator · RAAS");
  const [region, setRegion] = useState("cn-shenzhen-1");
  const [tz, setTz] = useState("Asia/Shanghai (UTC+08:00)");
  const [retention, setRetention] = useState("30");
  const [piiMask, setPiiMask] = useState(true);
  const [strict, setStrict] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Panel title="Workspace" padded>
        <Field
          label="Workspace ID"
          hint="Used in URLs and API endpoints. Cannot be changed once set."
          locked
        >
          <TextIn value={name} mono onChange={setName} />
        </Field>
        <Field
          label="Display name"
          hint="Shown in the sidebar and audit log."
        >
          <TextIn value={display} onChange={setDisplay} />
        </Field>
        <Field
          label="Region"
          hint="Workers and event storage run in this region. Moving regions requires re-deploy."
        >
          <SelectIn
            value={region}
            onChange={setRegion}
            options={[
              "cn-shenzhen-1",
              "cn-shanghai-2",
              "cn-beijing-3",
              "ap-singapore-1",
              "us-east-1",
            ]}
          />
        </Field>
        <Field
          label="Timezone"
          hint="Used for dashboards, audit log, and scheduled triggers."
        >
          <SelectIn
            value={tz}
            onChange={setTz}
            options={[
              "Asia/Shanghai (UTC+08:00)",
              "Asia/Singapore (UTC+08:00)",
              "America/Los_Angeles (UTC-07:00)",
              "UTC",
            ]}
          />
        </Field>
        <Field
          label="Default tenant"
          hint="Where new sessions land. Members can override per-browser."
        >
          <SelectIn
            value={tenantId}
            onChange={onTenantChange}
            options={TENANTS.map((t) => ({ value: t.id, label: t.name }))}
          />
        </Field>
      </Panel>

      <Panel title="Data retention & privacy" padded>
        <Field
          label="Run & event retention"
          hint="How long full payloads are kept. Metrics are kept forever."
        >
          <div style={{ display: "flex", gap: 8 }}>
            <TextIn
              value={retention}
              mono
              suffix="days"
              onChange={setRetention}
            />
          </div>
        </Field>
        <Field
          label="Mask PII in logs"
          hint="Email, phone and ID-card numbers are redacted in stored log lines."
        >
          <Toggle value={piiMask} onChange={setPiiMask} />
        </Field>
        <Field
          label="Strict schema validation"
          hint="Reject events whose payload doesn't match the agent's declared schema (recommended in prod)."
        >
          <Toggle value={strict} onChange={setStrict} />
        </Field>
      </Panel>

      <div
        style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}
      >
        <Button tone="ghost">Discard</Button>
        <Button tone="primary" icon="check">
          Save changes
        </Button>
      </div>
    </div>
  );
}
