"use client";
import { useParams } from "next/navigation";
import { DomainSyncPanel } from "@/app/portal/[tenant]/(views)/tenants/domain-sync";
import { RuntimeProfilesPanel } from "@/app/portal/[tenant]/(views)/tenants/runtime-profiles";
import Link from "@/lib/portal-link";
import { domainPortalPath } from "@/lib/portal-scope";
import { ViewHeader } from "@/app/portal/components";
import { DomainRuntime } from "@/app/portal/components/domains/DomainRuntime";
import { useCan } from "@/lib/hooks/useMe";
import { useI18n } from "@/app/portal/lib/preferences-context";

export default function DomainOntologyPage() {
  const { tenant, domain } = useParams<{ tenant: string; domain: string }>();
  const { t } = useI18n();
  const can = useCan();
  return <div style={{ overflow: "auto", height: "100%" }}>
    <ViewHeader title={t("domains.ontology")} subtitle={`${tenant} / ${domain}`} />
    <div style={{ padding: 20, display: "grid", gap: 20 }}>
      <DomainRuntime tenant={tenant} domain={domain} canManage={can("settings.write")} />
      <div style={{ border: "1px solid var(--border)", padding: 14, borderRadius: 7, background: "var(--panel-2)", display: "grid", gap: 8 }}>
        <Link href={domainPortalPath(tenant, domain, "factory")} style={{ color: "var(--signal)" }}>{t("domains.uploadOntology")}</Link>
        <p style={{ margin: 0, color: "var(--text-2)", fontSize: 12, lineHeight: 1.6 }}>{t("domains.uploadOntologyHint")}</p>
      </div>
      <DomainSyncPanel activeTenant={tenant} domainLabel={domain} />
      <RuntimeProfilesPanel activeTenant={tenant} domainLabel={domain} />
    </div>
  </div>;
}
