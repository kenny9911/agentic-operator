"use client";

import { useState, type CSSProperties } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "@/lib/portal-link";
import { useDomains, useDomainMutations, type Domain } from "@/lib/hooks/useDomains";
import { useTenants } from "@/lib/hooks/useTenants";
import { useIsSuperadmin } from "@/lib/hooks/useMe";
import { domainPortalPath } from "@/lib/portal-scope";
import { useI18n } from "@/app/portal/lib/preferences-context";
import { DomainRuntime } from "./DomainRuntime";
import { DomainMembers } from "./DomainMembers";
import { Button, Badge, ViewHeader } from "@/app/portal/components";

const field: CSSProperties = { padding: "9px 10px", color: "var(--text)", background: "var(--panel-2)", border: "1px solid var(--border-2)", borderRadius: 5, width: "100%", boxSizing: "border-box" };
const panel: CSSProperties = { border: "1px solid var(--border)", borderRadius: 8, background: "var(--panel)", padding: 18 };

export default function DomainsPage() {
  const { tenant } = useParams<{ tenant: string }>();
  const { t } = useI18n();
  const router = useRouter();
  const [includeArchived, setIncludeArchived] = useState(false);
  const query = useDomains(tenant, includeArchived);
  const tenants = useTenants();
  const superadmin = useIsSuperadmin();
  const owner = tenants.data?.items.find((item) => item.slug === tenant);
  const canManage = superadmin || owner?.membership === "admin";
  const mutations = useDomainMutations(tenant);
  const [editor, setEditor] = useState<{ domain: Domain | null; name: string; slug: string; description: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = Object.values(mutations).some((mutation) => mutation.isPending);

  async function save() {
    if (!editor || !editor.name.trim()) return;
    setError(null);
    if (!editor.domain && !/^[a-z][a-z0-9-]{0,47}$/.test(editor.slug)) { setError(t("domains.invalidSlug")); return; }
    try {
      if (editor.domain) {
        await mutations.update.mutateAsync({ slug: editor.domain.slug, name: editor.name.trim(), description: editor.description.trim() || null });
        setEditor(null);
      } else {
        const receipt = await mutations.create.mutateAsync({ slug: editor.slug, name: editor.name.trim(), description: editor.description.trim() || undefined });
        setEditor(null);
        router.push(domainPortalPath(tenant, receipt.domain.slug, "workflows?new=blank"));
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  }

  async function changeArchive(domain: Domain) {
    setError(null);
    if (domain.archivedAt === null && !window.confirm(t("domains.archiveConfirm", { name: domain.name }))) return;
    try {
      if (domain.archivedAt === null) await mutations.archive.mutateAsync(domain.slug);
      else await mutations.restore.mutateAsync(domain.slug);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  }

  return <div style={{ height: "100%", overflow: "auto" }}>
    <ViewHeader title={t("domains.title")} subtitle={t("domains.tenantScope", { name: owner?.name ?? tenant })} action={canManage ? <Button tone="primary" icon="plus" onClick={() => { setError(null); setEditor({ domain: null, name: "", slug: "", description: "" }); }}>{t("domains.create")}</Button> : undefined} />
    <div style={{ padding: 24, display: "grid", gap: 18, maxWidth: 1200 }}>
      <p style={{ margin: 0, color: "var(--text-2)", lineHeight: 1.6 }}>{t("domains.description")}</p>
      {canManage ? <label style={{ color: "var(--text-2)", fontSize: 12 }}><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} /> {t("domains.showArchived")}</label> : null}
      {error ? <p role="alert" style={{ color: "var(--red)" }}>{error}</p> : null}
      {editor ? <form onSubmit={(event) => { event.preventDefault(); void save(); }} style={{ ...panel, display: "grid", gap: 12, maxWidth: 620 }}>
        <h2 style={{ fontSize: 17, margin: 0 }}>{t(editor.domain ? "domains.edit" : "domains.create")}</h2>
        <label>{t("domains.name")}<input autoFocus required maxLength={200} value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} style={field} /></label>
        <label>{t("domains.slug")}<input required disabled={Boolean(editor.domain)} maxLength={48} value={editor.slug} onChange={(event) => setEditor({ ...editor, slug: event.target.value })} style={field} /></label>
        <p style={{ color: "var(--text-3)", fontSize: 12, margin: 0 }}>{t("domains.slugHint")}</p>
        <label>{t("domains.descriptionLabel")}<textarea value={editor.description} maxLength={2000} onChange={(event) => setEditor({ ...editor, description: event.target.value })} style={{ ...field, minHeight: 70 }} /></label>
        <div style={{ display: "flex", gap: 8 }}><Button type="submit" tone="primary" disabled={pending || !editor.name.trim()}>{t("domains.save")}</Button><Button disabled={pending} onClick={() => setEditor(null)}>{t("domains.cancel")}</Button></div>
      </form> : null}
      {query.isPending ? <p role="status">{t("domains.loading")}</p> : query.isError ? <p role="alert" style={{ color: "var(--red)" }}>{query.error.message}</p> : query.data?.items.length === 0 ? <p>{t("domains.empty")}</p> : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        {(query.data?.items ?? []).map((domain) => <article key={domain.id} style={{ ...panel, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}><h2 style={{ margin: 0, fontSize: 18 }}>{domain.name}</h2>{domain.isDefault ? <Badge tone="muted">{t("domains.default")}</Badge> : null}{domain.archivedAt !== null ? <Badge tone="muted">{t("domains.archivedLabel")}</Badge> : null}</div>
          <code style={{ color: "var(--text-3)", fontSize: 12 }}>{domain.slug}</code>
          {domain.description ? <p style={{ margin: 0, color: "var(--text-2)", fontSize: 13 }}>{domain.description}</p> : null}
          {domain.archivedAt === null ? <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12 }}>
            {[["workflows", "domains.open"], ["ontocode-workspace", "domains.build"], ["runs", "domains.monitor"], ["ontology", "domains.ontology"]].map(([feature, label]) => <Link key={feature} href={domainPortalPath(tenant, domain.slug, feature) as never} style={{ color: "var(--signal)" }}>{t(label!)}</Link>)}
          </div> : null}
          {domain.archivedAt === null ? <DomainRuntime tenant={tenant} domain={domain.slug} canManage={canManage} /> : null}
          {canManage ? <details><summary style={{ cursor: "pointer", fontSize: 12 }}>{t("domains.members")}</summary><div style={{ paddingTop: 10 }}><DomainMembers tenant={tenant} domain={domain} /></div></details> : null}
          {canManage ? <div style={{ display: "flex", gap: 8 }}><Button small onClick={() => setEditor({ domain, name: domain.name, slug: domain.slug, description: domain.description ?? "" })}>{t("domains.edit")}</Button><Button small disabled={pending} onClick={() => void changeArchive(domain)}>{t(domain.archivedAt === null ? "domains.archive" : "domains.restore")}</Button></div> : null}
        </article>)}
      </div>
    </div>
  </div>;
}
