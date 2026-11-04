"use client";

import { useParams, usePathname, useRouter } from "next/navigation";
import Link from "@/lib/portal-link";
import { useDomains } from "@/lib/hooks/useDomains";
import { domainSwitchPath } from "@/lib/portal-scope";
import { useDirty } from "@/app/portal/lib/dirty-context";
import { useI18n } from "@/app/portal/lib/preferences-context";
import { Icon } from "../Icon";

export function DomainSwitcher({ expanded }: { expanded: boolean }) {
  const { tenant, domain } = useParams<{ tenant: string; domain?: string }>();
  const query = useDomains(tenant);
  const pathname = usePathname();
  const router = useRouter();
  const dirty = useDirty();
  const { t } = useI18n();
  const rows = query.data?.items ?? [];
  const active = rows.find((item) => item.slug === domain);
  function select(nextDomain: string) {
    if (!nextDomain || nextDomain === domain) return;
    if (dirty.isDirty() && !window.confirm(t("domains.switchUnsaved"))) return;
    router.push(domainSwitchPath(tenant, nextDomain, pathname));
  }
  return <div style={{ padding: expanded ? "8px 12px 12px" : "8px 14px", borderBottom: "1px solid var(--border)" }}>
    {expanded ? <>
      <label style={{ display: "grid", gap: 5, color: "var(--text-3)", fontSize: 10 }}>
        {t("domains.domain")}
        <select aria-label={t("domains.choose")} value={domain ?? ""} onChange={(event) => select(event.target.value)} disabled={query.isPending || query.isError}
          style={{ width: "100%", padding: "7px 5px", color: "var(--text)", background: "var(--panel-2)", border: "1px solid var(--border-2)", borderRadius: 5, fontSize: 12 }}>
          <option value="">{query.isPending ? t("domains.loading") : t("domains.choose")}</option>
          {rows.map((item) => <option key={item.id} value={item.slug}>{item.name}</option>)}
        </select>
      </label>
      <Link href={`/portal/${tenant}/domains` as never} scope="tenant" style={{ color: "var(--signal)", display: "inline-block", fontSize: 11, marginTop: 7 }}>{t("domains.manage")}</Link>
      {query.isError ? <p role="alert" style={{ fontSize: 11, color: "var(--red)" }}>{query.error.message}</p> : null}
    </> : <Link href={`/portal/${tenant}/domains` as never} scope="tenant" aria-label={active ? t("domains.domainScope", { name: active.name }) : t("domains.choose")} data-sidebar-tooltip={active?.name ?? t("domains.choose")} style={{ color: "var(--text-2)", display: "flex", justifyContent: "center" }}><Icon name="workflow" size={18} /></Link>}
  </div>;
}
