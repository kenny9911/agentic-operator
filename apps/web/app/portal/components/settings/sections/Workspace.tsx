"use client";

/**
 * Settings → Workspace
 *
 * Includes P2-FE-27 timezone picker — backed by useWorkspace() which persists
 * via POST /api/prefs.
 */

import { useState } from "react";
import { Button, Panel } from "@/app/portal/components";
import {
  Field,
  SelectIn,
  TextIn,
  Toggle,
} from "@/app/portal/components/settings/atoms";
import { LOCALES, TIMEZONES } from "@/app/portal/components/settings/data";
import { useRaasData } from "@/lib/hooks/data-context";
import { useWorkspace } from "@/lib/hooks/useWorkspace";

const ACCENTS = [
  { value: "#d0ff00", label: "Lime" },
  { value: "#5deeff", label: "Cyan" },
  { value: "#ffb547", label: "Amber" },
  { value: "#b594ff", label: "Violet" },
];

export function WorkspaceSection() {
  const { tenants } = useRaasData();
  const { timezone, locale, setTimezone, setLocale } = useWorkspace();
  const [name, setName] = useState("agentic-operator");
  const [display, setDisplay] = useState("Agentic Operator · RAAS");
  const [region, setRegion] = useState("cn-shenzhen-1");
  const [tenant, setTenant] = useState(tenants[0]?.id ?? "raas");
  const [accent, setAccent] = useState("#d0ff00");
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
        <Field label="Display name" hint="Shown in the sidebar and audit log.">
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
          hint="Used for dashboards, audit log, and scheduled triggers. Stored in cookie via /api/prefs."
        >
          <SelectIn value={timezone} onChange={setTimezone} options={TIMEZONES} />
        </Field>
        <Field
          label="Locale"
          hint="Number and date formatting throughout the UI."
        >
          <SelectIn value={locale} onChange={setLocale} options={LOCALES} />
        </Field>
        <Field
          label="Default tenant"
          hint="Where new sessions land. Members can override per-browser."
        >
          <SelectIn
            value={tenant}
            onChange={setTenant}
            options={tenants.map((t) => ({ value: t.id, label: t.name }))}
          />
        </Field>
        <Field
          label="Accent color"
          hint="UI signal color. Live and active affordances pick this up via CSS variables."
        >
          <div style={{ display: "flex", gap: 6 }}>
            {ACCENTS.map((a) => (
              <button
                key={a.value}
                onClick={() => setAccent(a.value)}
                aria-label={a.label}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 4,
                  background: a.value,
                  border: `2px solid ${accent === a.value ? "var(--text)" : "transparent"}`,
                  cursor: "pointer",
                }}
              />
            ))}
          </div>
        </Field>
      </Panel>

      <Panel title="Data retention & privacy" padded>
        <Field
          label="Run & event retention"
          hint="How long full payloads are kept. Metrics are kept forever."
        >
          <div style={{ display: "flex", gap: 8 }}>
            <TextIn value={retention} mono suffix="days" onChange={setRetention} />
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

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Button tone="ghost">Discard</Button>
        <Button tone="primary" icon="check">
          Save changes
        </Button>
      </div>
    </div>
  );
}
