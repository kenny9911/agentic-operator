"use client";

/**
 * TweaksPanel (P2-FE-16) — floating control panel for runtime preferences.
 *
 * Layout / visual style ported from v1_1 tweaks-panel.jsx (light glass card,
 * bottom-right anchor, draggable header, ~280px wide). The wiring is
 * different: postMessage plumbing is replaced by localStorage via
 * `useTweaks`, and the panel opens/closes on a keyboard hotkey + a
 * cog button rather than the v1_1 `__activate_edit_mode` protocol.
 *
 * Hotkey: Cmd/Ctrl + Shift + T.
 *
 * Controls:
 *   1. Theme       (dark / light)
 *   2. Density     (compact / default / comfortable)
 *   3. Accent      (4 color chips)
 *   4. Live stream (toggle)
 *   5. Show debug  (toggle)
 *   6. Tenant      (select)
 *   7. Data source (radio; no-op since real API is the only source — kept
 *                   for prototype parity per audit §6 D-3)
 */

import { useEffect, useState } from "react";
import { Icon } from "../Icon";
import { useTweaks, type Tweaks } from "./use-tweaks";
import { useTenantNavigate } from "../../lib/use-tenant";

const ACCENT_OPTIONS: { value: string; label: string }[] = [
  { value: "#d0ff00", label: "Lime" },
  { value: "#5deeff", label: "Cyan" },
  { value: "#ffb547", label: "Amber" },
  { value: "#b594ff", label: "Violet" },
];

interface TenantOption {
  id: string;
  name: string;
}

export interface TweaksPanelProps {
  tenants?: TenantOption[];
}

export function TweaksPanel({ tenants = [] }: TweaksPanelProps) {
  const [open, setOpen] = useState(false);
  const [tweaks, setTweak] = useTweaks();
  const goTenant = useTenantNavigate();

  // Hotkey: Cmd/Ctrl+Shift+T toggles the panel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Open tweaks panel"
        title="Tweaks (⌘⇧T)"
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          width: 28,
          height: 28,
          borderRadius: 14,
          background: "var(--panel-2)",
          border: "1px solid var(--border-2)",
          color: "var(--text-3)",
          display: open ? "none" : "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: "var(--z-overlay)" as unknown as number,
        }}
      >
        <Icon name="settings" size={13} />
      </button>
      {open && (
        <PanelBody
          tweaks={tweaks}
          setTweak={setTweak}
          tenants={tenants}
          onClose={() => setOpen(false)}
          onTenantChange={goTenant}
        />
      )}
    </>
  );
}

function PanelBody({
  tweaks,
  setTweak,
  tenants,
  onClose,
  onTenantChange,
}: {
  tweaks: Tweaks;
  setTweak: ReturnType<typeof useTweaks>[1];
  tenants: TenantOption[];
  onClose: () => void;
  onTenantChange: (next: string) => void;
}) {
  return (
    <div
      role="dialog"
      aria-label="Tweaks panel"
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        width: 280,
        maxHeight: "calc(100vh - 32px)",
        display: "flex",
        flexDirection: "column",
        background: "rgba(250,249,247,.86)",
        color: "#29261b",
        backdropFilter: "blur(24px) saturate(160%)",
        WebkitBackdropFilter: "blur(24px) saturate(160%)",
        border: "0.5px solid rgba(255,255,255,.6)",
        borderRadius: 14,
        boxShadow:
          "0 1px 0 rgba(255,255,255,.5) inset, 0 12px 40px rgba(0,0,0,.18)",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        fontSize: 11.5,
        lineHeight: 1.4,
        overflow: "hidden",
        zIndex: "var(--z-tooltip)" as unknown as number,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 8px 10px 14px",
        }}
      >
        <strong style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".01em" }}>
          Tweaks
        </strong>
        <button
          onClick={onClose}
          aria-label="Close tweaks"
          style={{
            color: "rgba(41,38,27,.55)",
            width: 22,
            height: 22,
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          ✕
        </button>
      </div>
      <div
        style={{
          padding: "2px 14px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          overflowY: "auto",
        }}
      >
        <RadioRow
          label="Theme"
          value={tweaks.theme}
          options={["dark", "light"]}
          onChange={(v) => setTweak("theme", v as Tweaks["theme"])}
        />
        <RadioRow
          label="Density"
          value={tweaks.density}
          options={["compact", "default", "comfortable"]}
          onChange={(v) => setTweak("density", v as Tweaks["density"])}
        />
        <ColorRow
          label="Accent"
          value={tweaks.accent}
          options={ACCENT_OPTIONS}
          onChange={(v) => setTweak("accent", v)}
        />
        <ToggleRow
          label="Live event stream"
          value={tweaks.liveStream}
          onChange={(v) => setTweak("liveStream", v)}
        />
        <ToggleRow
          label="Show debug panels"
          value={tweaks.showDebug}
          onChange={(v) => setTweak("showDebug", v)}
        />
        {tenants.length > 0 && (
          <SelectRow
            label="Active tenant"
            value={tweaks.tenant}
            options={tenants.map((t) => ({ value: t.id, label: t.name }))}
            onChange={(v) => {
              setTweak("tenant", v);
              onTenantChange(v);
            }}
          />
        )}
        {tweaks.showDebug && (
          <RadioRow
            label="Data source"
            value={tweaks.dataSource}
            options={["json", "neo4j"]}
            onChange={(v) =>
              setTweak("dataSource", v as Tweaks["dataSource"])
            }
            note="Latent — real API is always the source."
          />
        )}
      </div>
    </div>
  );
}

// ─── Sub-controls — minimal but on-spec ─────────────────────────────────────

function Row({
  label,
  children,
  note,
  inline,
}: {
  label: string;
  children: React.ReactNode;
  note?: string;
  inline?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          color: "rgba(41,38,27,.72)",
        }}
      >
        <span style={{ fontWeight: 500 }}>{label}</span>
        {inline && children}
      </div>
      {!inline && children}
      {note && (
        <div style={{ fontSize: 10, color: "rgba(41,38,27,.5)" }}>{note}</div>
      )}
    </div>
  );
}

function RadioRow({
  label,
  value,
  options,
  onChange,
  note,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  note?: string;
}) {
  return (
    <Row label={label} note={note}>
      <div
        style={{
          display: "flex",
          padding: 2,
          background: "rgba(0,0,0,.06)",
          borderRadius: 8,
          gap: 0,
        }}
      >
        {options.map((o) => {
          const active = o === value;
          return (
            <button
              key={o}
              onClick={() => onChange(o)}
              style={{
                flex: 1,
                padding: "4px 6px",
                borderRadius: 6,
                background: active ? "rgba(255,255,255,.9)" : "transparent",
                boxShadow: active
                  ? "0 1px 2px rgba(0,0,0,.12)"
                  : "none",
                color: "#29261b",
                fontWeight: 500,
                fontSize: 11.5,
                minHeight: 22,
              }}
            >
              {o}
            </button>
          );
        })}
      </div>
    </Row>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Row label={label} inline>
      <button
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        style={{
          position: "relative",
          width: 32,
          height: 18,
          borderRadius: 999,
          background: value ? "#34c759" : "rgba(0,0,0,.15)",
          transition: "background .15s",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: 2,
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 1px 2px rgba(0,0,0,.25)",
            transform: value ? "translateX(14px)" : "translateX(0)",
            transition: "transform .15s",
          }}
        />
      </button>
    </Row>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <Row label={label}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          height: 26,
          padding: "0 8px",
          border: "0.5px solid rgba(0,0,0,.1)",
          borderRadius: 7,
          background: "rgba(255,255,255,.6)",
          color: "inherit",
          font: "inherit",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Row>
  );
}

function ColorRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <Row label={label}>
      <div style={{ display: "flex", gap: 6 }}>
        {options.map((o) => {
          const on = o.value.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={o.value}
              onClick={() => onChange(o.value)}
              aria-label={o.label}
              title={o.label}
              style={{
                flex: 1,
                height: 28,
                borderRadius: 6,
                background: o.value,
                boxShadow: on
                  ? "0 0 0 2px #29261b, 0 2px 6px rgba(0,0,0,.15)"
                  : "0 0 0 .5px rgba(0,0,0,.12), 0 1px 2px rgba(0,0,0,.06)",
                cursor: "pointer",
              }}
            />
          );
        })}
      </div>
    </Row>
  );
}
