"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge, Button, Icon, ViewHeader, type IconName } from "@/components";
import { SETTINGS_SECTIONS, type SettingsSection } from "./data";
import { GeneralSection } from "./sections/General";
import { MembersSection } from "./sections/Members";
import { KeysSection } from "./sections/Keys";
import { IntegrationsSection } from "./sections/Integrations";
import { ModelsSection } from "./sections/Models";
import { UsageSection } from "./sections/Usage";
import { QuotasSection } from "./sections/Quotas";
import { AuditSection } from "./sections/Audit";
import { DangerSection } from "./sections/Danger";

export function SettingsView({
  initialSection,
  initialTenantId,
}: {
  initialSection?: string;
  initialTenantId: string;
}) {
  const [section, setSection] = useState<string>(initialSection || "general");
  const [tenantId, setTenantId] = useState(initialTenantId);
  const router = useRouter();
  const [, startTransition] = useTransition();

  const sec =
    SETTINGS_SECTIONS.find((s) => s.id === section) ?? SETTINGS_SECTIONS[0]!;

  // Persist tenant changes via the prefs cookie so the sidebar reflects them.
  function onTenantChange(id: string) {
    setTenantId(id);
    startTransition(async () => {
      try {
        await fetch("/api/prefs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenant: id }),
        });
        router.refresh();
      } catch {
        // silent in dev
      }
    });
  }

  return (
    <div
      style={{ display: "flex", flexDirection: "column", height: "100%" }}
    >
      <ViewHeader
        title="Settings"
        subtitle={
          <>
            Workspace{" "}
            <span className="mono" style={{ color: "var(--text)" }}>
              agentic-operator
            </span>{" "}
            · region{" "}
            <span className="mono" style={{ color: "var(--text)" }}>
              cn-shenzhen-1
            </span>{" "}
            · operator <span style={{ color: "var(--text)" }}>Liu Wei</span>{" "}
            (Owner)
          </>
        }
        badge={<Badge tone="muted">v0.6.2</Badge>}
        action={
          <>
            <Button small icon="external" tone="ghost">
              Settings docs
            </Button>
            <Button small icon="upload">
              Export config
            </Button>
          </>
        }
      />

      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "232px 1fr",
          minHeight: 0,
        }}
      >
        {/* Section nav */}
        <aside
          style={{
            borderRight: "1px solid var(--border)",
            overflow: "auto",
            padding: "14px 10px",
            background: "var(--bg-2)",
          }}
        >
          {SETTINGS_SECTIONS.map((s) => (
            <SectionNavItem
              key={s.id}
              section={s}
              active={s.id === section}
              onClick={() => setSection(s.id)}
            />
          ))}
        </aside>

        {/* Section body */}
        <div style={{ overflow: "auto", minHeight: 0 }}>
          <div style={{ padding: 24, maxWidth: 1080 }}>
            <SectionHeader section={sec} />
            {section === "general" && (
              <GeneralSection
                tenantId={tenantId}
                onTenantChange={onTenantChange}
              />
            )}
            {section === "members" && <MembersSection />}
            {section === "keys" && <KeysSection />}
            {section === "integrations" && <IntegrationsSection />}
            {section === "models" && <ModelsSection />}
            {section === "usage" && <UsageSection />}
            {section === "quotas" && <QuotasSection />}
            {section === "audit" && <AuditSection />}
            {section === "danger" && <DangerSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionNavItem({
  section,
  active,
  onClick,
}: {
  section: SettingsSection;
  active: boolean;
  onClick: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "8px 10px",
        marginBottom: 2,
        background: active
          ? "var(--panel-2)"
          : hov
            ? "var(--panel)"
            : "transparent",
        borderLeft: `2px solid ${active ? "var(--signal)" : "transparent"}`,
        borderTop: "none",
        borderRight: "none",
        borderBottom: "none",
        borderRadius: 4,
        textAlign: "left",
        cursor: "pointer",
        transition: "background 0.1s",
      }}
    >
      <Icon
        name={section.icon as IconName}
        size={13}
        style={{ color: active ? "var(--text)" : "var(--text-3)" }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12.5,
            color: active ? "var(--text)" : "var(--text-2)",
            fontWeight: active ? 500 : 400,
          }}
        >
          {section.label}
        </div>
        <div
          style={{
            fontSize: 10,
            color: "var(--text-3)",
            marginTop: 1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {section.hint}
        </div>
      </div>
    </button>
  );
}

function SectionHeader({ section }: { section: SettingsSection }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 4,
        }}
      >
        <Icon
          name={section.icon as IconName}
          size={14}
          style={{ color: "var(--signal)" }}
        />
        <span
          style={{
            fontSize: 11,
            fontFamily: "var(--mono)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "var(--text-3)",
          }}
        >
          Settings · {section.label}
        </span>
      </div>
      <h2
        style={{
          margin: 0,
          fontSize: 26,
          fontFamily: "var(--display)",
          fontWeight: 400,
          letterSpacing: "-0.01em",
          color: "var(--text)",
        }}
      >
        {section.label}
      </h2>
      <div
        style={{
          marginTop: 4,
          fontSize: 12.5,
          color: "var(--text-2)",
        }}
      >
        {section.hint}
      </div>
    </div>
  );
}
