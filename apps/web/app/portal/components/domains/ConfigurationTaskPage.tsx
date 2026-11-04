"use client";
import { useParams } from "next/navigation";
import Link from "@/lib/portal-link";
import { Badge, Button, ViewHeader } from "@/app/portal/components";
import { useI18n } from "@/app/portal/lib/preferences-context";
import { useDomainSlug } from "@/app/portal/lib/use-tenant";
import { useCan } from "@/lib/hooks/useMe";
import { useOntoCodeConfigurationTask, useVerifyOntoCodeConfigurationTask } from "@/lib/hooks/useOntoCodeWorkspace";
import { domainPortalPath } from "@/lib/portal-scope";
import { configurationTaskDestination } from "./configuration-task-destination";

export default function ConfigurationTaskPage() {
  const { tenant, taskId } = useParams<{ tenant: string; taskId: string }>();
  const domain = useDomainSlug();
  const { t } = useI18n();
  const can = useCan();
  const valid = /^ocfg-[a-f0-9]{32}$/.test(taskId);
  const query = useOntoCodeConfigurationTask(tenant, valid ? taskId : "");
  const verify = useVerifyOntoCodeConfigurationTask(tenant, taskId);
  const task = query.data?.task;
  const destination = task ? configurationTaskDestination(tenant, domain, task) : null;
  const terminal = task && (task.status === "cancelled" || task.status === "superseded");
  return <div style={{ height: "100%", overflow: "auto" }}>
    <ViewHeader title={task?.title ?? t("domains.configuration.title")} subtitle={t("domains.domainScope", { name: domain })} />
    <div style={{ padding: 24, maxWidth: 900, display: "grid", gap: 18 }}>
      {!valid || query.isError ? <p role="alert">{t("domains.configuration.unavailable")}</p> : query.isPending ? <p role="status">{t("common.loading")}</p> : null}
      {task ? <>
        <Badge tone={task.status === "satisfied" ? "green" : "muted"}>{t(`domains.configuration.status.${task.status}`)}</Badge>
        <p style={{ margin: 0 }}>{task.requirement.summary}</p>
        {task.requirement.reason ? <p style={{ color: "var(--text-2)", margin: 0 }}>{task.requirement.reason}</p> : null}
        {task.target.kind === "tool_profile" ? <p><strong>{task.target.toolName}</strong> · {task.target.environment} · <code>{task.target.profileKey}</code></p> : null}
        {task.target.kind === "environment" ? <div><p>{t("domains.configuration.environment")}</p><code>{task.target.envRefs.join(", ")}</code></div> : null}
        {task.requirement.missingFields.length ? <div><strong>{t("domains.configuration.fields")}</strong><ul>{task.requirement.missingFields.map((field) => <li key={field.key}>{field.label} · <code>{field.envRef ?? field.key}</code>{field.required ? " *" : ""}</li>)}</ul></div> : null}
        {task.target.kind === "tool_profile" ? <p>{t("domains.configuration.profileHint")}</p> : task.target.kind === "tool" ? <p>{t("domains.configuration.toolHint")}</p> : null}
        {destination && !terminal ? <Link href={destination} style={{ color: "var(--signal)" }}>{t(task.target.kind === "tool" || task.target.kind === "tool_profile" ? "domains.configuration.openTools" : "domains.configuration.openSettings")}</Link> : null}
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 18, display: "grid", gap: 12 }}>
          <p style={{ color: "var(--text-2)", margin: 0 }}>{t("domains.configuration.verifyHint")}</p>
          {task.lastVerification ? <p role="status" style={{ color: task.lastVerification.outcome === "passed" ? "var(--green)" : "var(--text-2)" }}>{task.lastVerification.summary}</p> : null}
          {verify.error ? <p role="alert" style={{ color: "var(--red)" }}>{verify.error.message}</p> : null}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {can("workflows.write") && !terminal ? <Button disabled={verify.isPending || task.status === "verifying"} onClick={() => verify.mutate(task.revision)}>{t(verify.isPending ? "domains.configuration.verifying" : "domains.configuration.verify")}</Button> : null}
            <Link href={`${domainPortalPath(tenant, domain, `ontocode-workspace/${encodeURIComponent(task.sessionId)}`)}?configTask=${encodeURIComponent(task.id)}`} style={{ color: "var(--signal)" }}>{t("domains.configuration.returnSession")}</Link>
          </div>
        </div>
      </> : null}
    </div>
  </div>;
}

/** Keep the return/verification step visible after editing a tool's real profile. */
export function ConfigurationTaskReturn({ taskId }: { taskId: string }) {
  const { tenant } = useParams<{ tenant: string }>();
  const domain = useDomainSlug();
  const { t } = useI18n();
  const query = useOntoCodeConfigurationTask(tenant, /^ocfg-[a-f0-9]{32}$/.test(taskId) ? taskId : "");
  if (!query.data?.task) return null;
  return <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", background: "var(--panel-2)", display: "flex", gap: 16, alignItems: "center" }}>
    <span style={{ fontSize: 12 }}>{query.data.task.title}</span>
    <Link href={domainPortalPath(tenant, domain, `configure/${encodeURIComponent(taskId)}`)} style={{ color: "var(--signal)", fontSize: 12 }}>{t("domains.configuration.returnVerify")}</Link>
  </div>;
}
