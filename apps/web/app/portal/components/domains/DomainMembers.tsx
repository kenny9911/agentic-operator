"use client";
import { useDomainMembers, type Domain } from "@/lib/hooks/useDomains";
import { useI18n } from "@/app/portal/lib/preferences-context";
import Link from "@/lib/portal-link";

export function DomainMembers({ tenant, domain }: { tenant: string; domain: Domain }) {
  const { query, update } = useDomainMembers(tenant, domain.slug);
  const { t } = useI18n();
  return <section style={{ display: "grid", gap: 8, fontSize: 12 }}>
    <p style={{ margin: 0, color: "var(--text-2)" }}>{t("domains.membersDescription")}</p>
    {domain.isDefault ? <Link scope="tenant" href={`/portal/${tenant}/access` as never}>{t("domains.tenantAccess")}</Link> : null}
    {query.isPending ? <p role="status">{t("common.loading")}</p> : null}
    {query.error || update.error ? <p role="alert" style={{ color: "var(--red)" }}>{query.error?.message ?? update.error?.message}</p> : null}
    {(query.data?.items ?? []).map((member) => <label key={member.userId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <span>{member.name || member.email}</span>
      {member.tenantRole === "admin" ? <span>{t("domains.inheritedAdmin")}</span> : <select aria-label={`${t("domains.domainRole")}: ${member.email}`} value={member.domainRole ?? ""} disabled={domain.isDefault || update.isPending} onChange={(event) => update.mutate({ userId: member.userId, role: (event.target.value || null) as typeof member.domainRole })} style={{ color: "var(--text)", background: "var(--panel-2)", padding: 5, border: "1px solid var(--border-2)", borderRadius: 4 }}>
        <option value="">{t("domains.noAccess")}</option>{(["viewer", "operator", "admin"] as const).map((role) => <option key={role} value={role}>{t(`domains.${role}`)}</option>)}
      </select>}
    </label>)}
  </section>;
}
