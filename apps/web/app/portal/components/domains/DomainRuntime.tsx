"use client";
import { useDomainRuntime } from "@/lib/hooks/useDomains";
import { useI18n } from "@/app/portal/lib/preferences-context";
import { Badge, Button } from "@/app/portal/components";

export function DomainRuntime({ tenant, domain, canManage }: { tenant: string; domain: string; canManage: boolean }) {
  const { t } = useI18n();
  const { query, update } = useDomainRuntime(tenant, domain);
  return <div style={{ display: "grid", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 12 }}>{t("domains.runtime")}</span>
      {query.data ? <Badge tone={query.data.enabled ? "signal" : "muted"}>{t(query.data.status === "blocked" ? "domains.runtimeBlocked" : query.data.enabled ? "domains.runtimeStarted" : "domains.runtimeStopped")}</Badge> : null}
      {query.data ? <span style={{ fontSize: 11, color: "var(--text-3)" }}>{t("domains.runtimeFunctions", { count: query.data.localFnCount })}</span> : null}
      {canManage ? <Button small disabled={query.isPending || query.isError || update.isPending} onClick={() => update.mutate(!query.data?.enabled)}>{t(query.data?.enabled ? "domains.stopRuntime" : "domains.startRuntime")}</Button> : null}
    </div>
    {query.data && !query.data.enabled ? <span style={{ fontSize: 12, color: "var(--text-2)" }}>{t(canManage ? "domains.runtimePublishHint" : "domains.runtimeAdminHint")}</span> : null}
    {query.isPending ? <span role="status">{t("common.loading")}</span> : null}
    {query.error || update.error ? <span role="alert" style={{ fontSize: 12, color: "var(--red)" }}>{query.error?.message ?? update.error?.message}</span> : null}
  </div>;
}
