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
    return <div role="alert" style={{ padding: 24, display: "grid", gap: 12 }}>
      <strong>{t("domains.unavailable")}</strong>
      <p>{query.error?.message ?? t("domains.archived")}</p>
      <Link scope="tenant" href={`/portal/${tenant}/domains` as never}>{t("domains.choose")}</Link>
    </div>;
  }
  return children;
}
