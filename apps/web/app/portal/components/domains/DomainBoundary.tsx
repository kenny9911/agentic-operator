"use client";

import type { ReactNode } from "react";
import { useParams } from "next/navigation";
import Link from "@/lib/portal-link";
import { useDomain } from "@/lib/hooks/useDomains";
import { useI18n } from "@/app/portal/lib/preferences-context";

export function DomainBoundary({ children }: { children: ReactNode }) {
  const { tenant, domain } = useParams<{ tenant: string; domain: string }>();
  const query = useDomain(tenant, domain);
  const { t } = useI18n();
  if (query.isPending) return <p role="status" style={{ padding: 24 }}>{t("domains.loading")}</p>;
  if (query.isError || !query.data || query.data.domain.archivedAt !== null) {
    return <DomainUnavailable tenant={tenant} archived={query.data?.domain.archivedAt != null} message={query.error?.message} />;
  }
  return children;
}

/** Also used by the server layout, which omits protected children entirely
 * when fresh access verification fails even if the browser has cached data. */
export function DomainUnavailable({ tenant, archived = false, message }: {
  tenant: string;
  archived?: boolean;
  message?: string;
}) {
  const { t } = useI18n();
  return <div role="alert" style={{ padding: 24, display: "grid", gap: 12 }}>
    <strong>{t("domains.unavailable")}</strong>
    {message || archived ? <p>{message ?? t("domains.archived")}</p> : null}
    <Link scope="tenant" href={`/portal/${tenant}/domains` as never}>{t("domains.choose")}</Link>
  </div>;
}
