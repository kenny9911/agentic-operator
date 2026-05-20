"use client";

/**
 * Settings → Channels — job board / messaging routes.
 *
 * Skeleton implementation. The audit calls for at least skeleton content here
 * (per task brief); the cleanup engineer / channels engineer will fill in
 * full OAuth + posting + quota tracking.
 */

import { Button, Panel } from "@/app/portal/components";
import { Field, SelectIn, TextIn, Toggle } from "@/app/portal/components/settings/atoms";
import { SETTINGS_INTEGRATIONS } from "@/app/portal/components/settings/data";

export function ChannelsSection() {
  const channels = SETTINGS_INTEGRATIONS.filter((i) => i.kind.startsWith("Channel"));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Panel
        title={`Connected channels · ${channels.length}`}
        subtitle="Where the workflow posts job openings + sources candidates."
        padded={false}
        action={
          <Button small icon="plus" tone="primary">
            Connect channel
          </Button>
        }
      >
        {channels.map((c, i) => (
          <div
            key={c.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              borderBottom: i < channels.length - 1 ? "1px solid var(--border)" : "none",
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 4,
                background: "var(--panel-2)",
                border: "1px solid var(--border-2)",
              }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: "var(--text)" }}>{c.name}</div>
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>{c.detail}</div>
            </div>
            <Button small tone="ghost">
              Configure
            </Button>
          </div>
        ))}
      </Panel>

      <Panel title="Default routing" padded>
        <Field label="Primary channel" hint="First channel to receive new job posts.">
          <SelectIn value="zhilian" options={channels.map((c) => ({ value: c.id, label: c.name }))} />
        </Field>
        <Field label="Fallback channel" hint="Used if the primary fails or hits quota.">
          <SelectIn value="boss" options={channels.map((c) => ({ value: c.id, label: c.name }))} />
        </Field>
        <Field label="Daily post cap (per channel)" hint="Soft cap. Set 0 to disable throttling.">
          <TextIn value="20" mono suffix="posts" />
        </Field>
        <Field
          label="Throttle on quota"
          hint="Pause posting to a channel automatically when it reports ≥90% quota use."
        >
          <Toggle value onChange={() => {}} />
        </Field>
      </Panel>
    </div>
  );
}
