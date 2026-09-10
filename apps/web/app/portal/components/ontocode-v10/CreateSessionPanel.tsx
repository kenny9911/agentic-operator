"use client";
// OntoCode v10 · 原生新建 Session：选活跃 Ontology 域 + 一句业务目标 → 创建并进入。
// 复用旧 Hub 的创建语义（确保 Project → 创建 Session → bootstrap），零 mock。
import React, { useMemo, useState } from "react";
import type { OntoCodeAutonomyMode } from "@agentic/contracts";
import { useBusinessOntologyDomains } from "@/lib/hooks/useBusinessOntologyDomains";
import {
  useBootstrapOntoCodeSession,
  useCreateOntoCodeProject,
  useCreateOntoCodeSession,
  useOntoCodeProjects,
} from "@/lib/hooks/useOntoCodeWorkspace";
import { HelpTip } from "@/app/portal/components";
import Link from "@/lib/portal-link";
import { useI18n } from "@/app/portal/lib/preferences-context";
import { useDomainSlug } from "@/app/portal/lib/use-tenant";
import { domainPortalPath } from "@/lib/portal-scope";
import styles from "./workbench.module.css";
import { autonomyModeCopy } from "./autonomy-copy";

export interface CreateSessionPanelProps {
  tenant: string;
  open: boolean;
  /** standalone=true 用于「还没有任何 Session」的首屏，占满内容区而非弹层。 */
  standalone?: boolean;
  onClose?: () => void;
  onCreated: (sessionId: string) => void;
}

export function CreateSessionPanel(props: CreateSessionPanelProps) {
  const { t, language } = useI18n();
  const domainSlug = useDomainSlug();
  const modes = autonomyModeCopy(language);
  const sourceLabels: Record<string, string> = {
    allmeta: t("ontocode.hub.sourceAllmeta"), upload: t("ontocode.hub.sourceUpload"), manifest_legacy: t("domains.createSession.sourceLegacy"),
  };
  const domainsQ = useBusinessOntologyDomains(props.tenant);
  const projectsQ = useOntoCodeProjects(props.tenant);
  const createProject = useCreateOntoCodeProject(props.tenant);
  const createSession = useCreateOntoCodeSession(props.tenant);
  const bootstrap = useBootstrapOntoCodeSession(props.tenant);

  const [goal, setGoal] = useState("");
  const [registrationId, setRegistrationId] = useState<string | null>(null);
  const [autonomyMode, setAutonomyMode] =
    useState<OntoCodeAutonomyMode>("copilot");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const registrations = useMemo(
    () =>
      (domainsQ.data?.items ?? []).filter(
        (d) => d.status === "active" && d.archivedAt === null,
      ),
    [domainsQ.data],
  );
  const selected =
    registrations.find((r) => r.id === registrationId) ??
    registrations.find((r) => r.isDefault) ??
    registrations[0] ??
    null;

  if (!props.open) return null;

  const submit = async () => {
    if (!selected) {
      setError(t("domains.createSession.missing"));
      return;
    }
    if (!selected.executionReadiness.executable) {
      setError(selected.executionReadiness.message || t("domains.createSession.notReady"));
      return;
    }
    const goalText =
      goal.trim() ||
      t("domains.createSession.defaultGoal");
    setBusy(true);
    setError(null);
    try {
      let project = (projectsQ.data?.items ?? []).find(
        (p) => p.ontologyDomainRegistrationId === selected.id,
      );
      if (!project) {
        const receipt = await createProject.mutateAsync({
          domain: selected.ontologyDomainId,
          ontologyDomainRegistrationId: selected.id,
          name: selected.displayName || selected.ontologyDomainId,
          description: t("domains.createSession.projectDescription"),
        });
        project = receipt.project;
      }
      const receipt = await createSession.mutateAsync({
        projectId: project.id,
        title: goalText.slice(0, 56) || t("domains.createSession.defaultTitle"),
        goal: goalText,
        autonomyMode,
      });
      // Only a goal sentence is supplied here — no scope picker — so bootstrap
      // routes this through the conversational planner, which is the single
      // authority for turning free text into an action. The planner may answer
      // a question-shaped goal with an explanation and NO Harness Job; that is
      // a successful bootstrap. Navigation is therefore unconditional: the FDE
      // lands in the Session on the assistant's reply. Never gate entry on a
      // Job existing — doing so is what forced every Session into a scope run.
      await bootstrap.mutateAsync({
        sessionId: receipt.session.id,
        goal: goalText,
      });
      props.onCreated(receipt.session.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <div className={styles.createPanel}>
      <h2 className={styles.goalTitle}>{t("domains.createSession.title")}</h2>
      <label className={styles.createLabel} htmlFor="oc-create-domain">
        {t("domains.createSession.source")}
        <HelpTip>
          {t("domains.createSession.sourceHint")}
        </HelpTip>
      </label>
      <select
        id="oc-create-domain"
        className={styles.createSelect}
        value={selected?.id ?? ""}
        onChange={(e) => setRegistrationId(e.target.value)}
        disabled={busy || registrations.length === 0}
      >
        {registrations.length === 0 ? (
          <option value="">{t("domains.createSession.empty")}</option>
        ) : (
          registrations.map((r) => (
            <option key={r.id} value={r.id}>
              {r.displayName || r.ontologyDomainId} ·{" "}
              {sourceLabels[r.source] ?? r.source}
              {r.executionReadiness.executable ? "" : ` · ${t("domains.createSession.readySuffix")}`}
            </option>
          ))
        )}
      </select>
      <Link href={domainPortalPath(props.tenant, domainSlug, "ontology")} style={{ color: "var(--signal)", fontSize: 12 }}>
        {t("domains.ontology")}
      </Link>
      {domainsQ.isPending ? <div role="status">{t("domains.loading")}</div> : null}
      {domainsQ.isError ? <div role="alert" className={styles.cardError}>{t("domains.createSession.unavailable")}</div> : null}
      {selected && !selected.executionReadiness.executable ? (
        <div className={styles.cardError}>
          {selected.executionReadiness.message || t("domains.createSession.notReady")}
        </div>
      ) : null}
      <label className={styles.createLabel} htmlFor="oc-create-goal">
        {t("domains.createSession.goal")}
      </label>
      <textarea
        id="oc-create-goal"
        className={styles.createGoal}
        placeholder={t("domains.createSession.placeholder")}
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        disabled={busy}
      />
      <label className={styles.createLabel} htmlFor="oc-create-autonomy">
        {t("domains.createSession.execution")}
        {/* 模式的能力边界事实收进 HelpTip（与 Composer 共享同一份权威文案）。 */}
        <HelpTip>
          {
            modes.find((option) => option.value === autonomyMode)!
              .description
          }
        </HelpTip>
      </label>
      <select
        id="oc-create-autonomy"
        className={styles.createSelect}
        value={autonomyMode}
        onChange={(event) =>
          setAutonomyMode(event.target.value as OntoCodeAutonomyMode)
        }
        disabled={busy}
      >
        {modes.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? <div className={styles.cardError}>{error}</div> : null}
      <div className={styles.cardBtns}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnGreen}`}
          onClick={() => void submit()}
          disabled={busy || domainsQ.isPending || projectsQ.isPending || domainsQ.isError || projectsQ.isError || !selected?.executionReadiness.executable}
        >
          {busy ? t("domains.createSession.creating") : t("domains.createSession.create")}
        </button>
        {props.onClose ? (
          <button
            type="button"
            className={styles.btn}
            onClick={props.onClose}
            disabled={busy}
          >
            {t("domains.cancel")}
          </button>
        ) : null}
      </div>
    </div>
  );

  if (props.standalone) {
    return <div className={styles.createStandalone}>{body}</div>;
  }
  return (
    <div
      className={styles.overlayBackdrop}
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) props.onClose?.();
      }}
    >
      {body}
    </div>
  );
}
