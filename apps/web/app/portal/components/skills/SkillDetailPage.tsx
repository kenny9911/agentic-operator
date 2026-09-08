"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type {
  SkillBundle,
  SkillDetail,
  SkillDiagnostic,
} from "@agentic/contracts";
import { Badge, Button } from "@/app/portal/components";
import { ModalOverlay } from "@/app/portal/components/Modal";
import { useI18n } from "@/app/portal/lib/preferences-context";
import { useTenant } from "@/app/portal/lib/use-tenant";
import { useDirty } from "@/app/portal/lib/dirty-context";
import { useCan } from "@/lib/hooks/useMe";
import { skillApi, skillKeys, useSkill } from "@/lib/hooks/useSkills";
import { ApiResponseError, formatApiError } from "@/lib/api-response";
import { SkillFileEditor } from "./SkillFileEditor";
import { CreateSkillDialog } from "./CreateSkillDialog";
import { SkillHistory } from "./SkillHistory";
import { SkillEvaluationPanel } from "./SkillEvaluationPanel";
import styles from "./skills.module.css";

// Keep up to four unsaved editors in memory for browser back/forward within
// this login. Never persist skill contents to localStorage or mix tenants.
const unsavedEditors = new Map<
  string,
  { detail: SkillDetail; bundle: SkillBundle }
>();

export function SkillDetailPage({ id }: { id: string }) {
  const query = useSkill(id);
  const tenant = useTenant();
  const { t } = useI18n();
  if (query.isLoading)
    return (
      <p role="status" className={styles.empty}>
        {t("skills.loading")}
      </p>
    );
  if (!query.data)
    return (
      <div className={styles.page}>
        <Link
          className={styles.backLink}
          href={`/portal/${tenant}/skills` as never}
        >
          ← {t("skills.back")}
        </Link>
        <h1>{t("skills.notFound")}</h1>
        <p role="alert" className={styles.error}>
          {formatApiError(query.error, t)}
        </p>
        <Button onClick={() => void query.refetch()}>
          {t("skills.retry")}
        </Button>
      </div>
    );
  return <SkillEditor key={`${tenant}:${id}`} initial={query.data} />;
}

function SkillEditor({ initial }: { initial: SkillDetail }) {
  const { t, language } = useI18n();
  const tenant = useTenant();
  const router = useRouter();
  const cache = useQueryClient();
  const dirtyRegistry = useDirty();
  const can = useCan();
  const editorKey = `${tenant}:${initial.skill.id}`;
  const retained = initial.skill.canEdit
    ? unsavedEditors.get(editorKey)
    : undefined;
  const [detail, setDetail] = useState(retained?.detail ?? initial);
  const [bundle, setBundle] = useState<SkillBundle>(
    retained?.bundle ??
      initial.draft?.bundle ??
      initial.latestVersion?.bundle ?? { files: [] },
  );
  const [baseline, setBaseline] = useState<SkillBundle>(
    detail.draft?.bundle ?? detail.latestVersion?.bundle ?? bundle,
  );
  const [validation, setValidation] = useState<
    { bundle: SkillBundle; diagnostics: SkillDiagnostic[] } | undefined
  >(
    detail.draft
      ? { bundle: detail.draft.bundle, diagnostics: detail.draft.diagnostics }
      : undefined,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState(false);
  const actionsLocked = Boolean(busy) || pendingFiles;
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [modal, setModal] = useState<
    "publish" | "archive" | "history" | "revision" | "copy" | "reload" | null
  >(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const editable =
    detail.skill.canEdit && can("skills.write") && Boolean(detail.draft);
  const dirty = editable && bundle !== baseline;
  const currentValidation = validation?.bundle === bundle;
  const invalid =
    currentValidation &&
    validation.diagnostics.some((issue) => issue.severity === "error");
  const notes = detail.draft?.creatorNotes;

  useEffect(() => {
    dirtyRegistry.setDirty(
      `skill:${editorKey}`,
      dirty || pendingFiles ? detail.skill.name : null,
    );
    if (dirty) {
      unsavedEditors.delete(editorKey);
      unsavedEditors.set(editorKey, { detail, bundle });
      if (unsavedEditors.size > 4)
        unsavedEditors.delete(unsavedEditors.keys().next().value!);
    } else unsavedEditors.delete(editorKey);
    return () => dirtyRegistry.setDirty(`skill:${editorKey}`, null);
  }, [dirty, pendingFiles, bundle, detail, editorKey, dirtyRegistry]);
  useEffect(() => {
    if (!dirty && !pendingFiles) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const interceptLink = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      )
        return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download"))
        return;
      const url = new URL(link.href, location.href);
      if (
        url.origin !== location.origin ||
        (url.pathname === location.pathname && url.search === location.search)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      setLeaving(url.pathname + url.search + url.hash);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", interceptLink, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", interceptLink, true);
    };
  }, [dirty, pendingFiles]);

  function accept(next: SkillDetail) {
    const savedBundle = next.draft?.bundle ??
      next.latestVersion?.bundle ?? { files: [] };
    setDetail(next);
    setBundle(savedBundle);
    setBaseline(savedBundle);
    setValidation(
      next.draft
        ? { bundle: savedBundle, diagnostics: next.draft.diagnostics }
        : undefined,
    );
    setConflict(false);
    setError(null);
    unsavedEditors.delete(editorKey);
    cache.setQueryData(skillKeys.detail(tenant, next.skill.id), next);
    void cache.invalidateQueries({ queryKey: skillKeys.tenant(tenant) });
  }
  function fail(cause: unknown) {
    const stale = cause instanceof ApiResponseError && cause.status === 409;
    setConflict(stale);
    setError(stale ? t("skills.conflict") : formatApiError(cause, t));
  }
  async function mutate(
    label: string,
    action: () => Promise<SkillDetail>,
  ): Promise<boolean> {
    if (actionsLocked) return false;
    setBusy(label);
    setError(null);
    try {
      accept(await action());
      return true;
    } catch (cause) {
      fail(cause);
      return false;
    } finally {
      setBusy(null);
    }
  }
  async function save() {
    if (!detail.draft || !editable) return false;
    return mutate("save", () =>
      skillApi.save(detail.skill.id, detail.draft!.revision, bundle),
    );
  }
  async function validate() {
    if (actionsLocked) return;
    setBusy("validate");
    setError(null);
    const submitted = bundle;
    try {
      const result = await skillApi.validate(submitted);
      setValidation({ bundle: submitted, diagnostics: result.diagnostics });
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(null);
    }
  }
  function navigate(href: string) {
    unsavedEditors.delete(editorKey);
    dirtyRegistry.setDirty(`skill:${editorKey}`, null);
    setLeaving(null);
    router.push(href as never);
  }
  return (
    <div className={styles.page}>
      <Link
        className={styles.backLink}
        href={`/portal/${tenant}/skills` as never}
      >
        ← {t("skills.back")}
      </Link>
      <div className={styles.header}>
        <div>
          <h1>{detail.skill.name}</h1>
          <p className={styles.subheading}>{detail.skill.description}</p>
          <div className={styles.draftStatus}>
            {detail.skill.visibility === "shared" && (
              <Badge>{t("skills.shared")}</Badge>
            )}
            {detail.skill.archivedAt ? (
              <Badge tone="muted">{t("skills.archived")}</Badge>
            ) : (
              detail.latestVersion && (
                <Badge tone="green">
                  {t("skills.version", {
                    number: detail.latestVersion.versionNo,
                  })}
                </Badge>
              )
            )}
            {detail.draft && (
              <span>
                {t("skills.draftRevision", { number: detail.draft.revision })}
              </span>
            )}
            <span role="status">
              {t(
                pendingFiles
                  ? "skills.importing"
                  : dirty
                    ? "skills.unsaved"
                    : "skills.saved",
              )}
            </span>
          </div>
        </div>
        <div className={styles.actions}>
          <Link
            className={styles.helpLink}
            href={`/portal/${tenant}/skills/help` as never}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("skills.help")}
          </Link>
          <Button onClick={() => setModal("history")}>
            {t("skills.history")}
          </Button>
          {editable ? (
            <>
              <Button
                disabled={actionsLocked || !dirty}
                onClick={() => void save()}
              >
                {t(busy === "save" ? "skills.saving" : "skills.save")}
              </Button>
              {can("skills.publish") && (
                <Button
                  tone="primary"
                  disabled={
                    actionsLocked ||
                    dirty ||
                    Boolean(detail.skill.archivedAt) ||
                    invalid
                  }
                  onClick={() => setModal("publish")}
                >
                  {t(
                    busy === "publish" ? "skills.publishing" : "skills.publish",
                  )}
                </Button>
              )}
            </>
          ) : (
            can("skills.write") && (
              <Button tone="primary" onClick={() => setModal("copy")}>
                {t("skills.copy")}
              </Button>
            )
          )}
        </div>
      </div>
      {!editable && <p className={styles.notice}>{t("skills.readonly")}</p>}
      {error && (
        <div className={styles.error} role="alert">
          {error}
          {conflict && (
            <div className={styles.actions}>
              <Button small onClick={() => setModal("reload")}>
                {t("skills.reload")}
              </Button>
            </div>
          )}
        </div>
      )}
      <div className={styles.editorActions}>
        <div className={styles.actions}>
          {can("skills.write") && (
            <Button
              small
              disabled={actionsLocked}
              onClick={() => void validate()}
            >
              {t(busy === "validate" ? "skills.validating" : "skills.validate")}
            </Button>
          )}
          {editable && (
            <Button
              small
              icon="spark"
              disabled={actionsLocked || dirty}
              title={dirty ? t("skills.saveBeforeRevision") : undefined}
              onClick={() => setModal("revision")}
            >
              {t("skills.revision")}
            </Button>
          )}
        </div>
        <div className={styles.actions}>
          <Button
            small
            disabled={actionsLocked || dirty}
            onClick={() =>
              void skillApi
                .export(
                  detail.skill.id,
                  detail.skill.name,
                  detail.draft ? { draft: true } : {},
                )
                .catch(fail)
            }
          >
            {t("skills.export")}
          </Button>
          <Button
            small
            disabled={actionsLocked || dirty}
            onClick={() =>
              void skillApi
                .export(detail.skill.id, detail.skill.name, {
                  format: "markdown",
                  draft: Boolean(detail.draft),
                })
                .catch(fail)
            }
          >
            {t("skills.exportMarkdown")}
          </Button>
          {editable && (
            <Button
              small
              tone={detail.skill.archivedAt ? "default" : "danger"}
              disabled={actionsLocked || dirty}
              onClick={() => setModal("archive")}
            >
              {t(
                detail.skill.archivedAt ? "skills.unarchive" : "skills.archive",
              )}
            </Button>
          )}
        </div>
      </div>
      <SkillFileEditor
        bundle={bundle}
        onChange={setBundle}
        readOnly={!editable || Boolean(busy)}
        onPendingChange={setPendingFiles}
        diagnostics={validation?.diagnostics}
        validationCurrent={currentValidation}
      />
      <SkillEvaluationPanel detail={detail} disabled={dirty || actionsLocked} />
      {notes && (
        <details className={styles.notes} open>
          <summary>
            {t("skills.generationEvidence")} ·{" "}
            {t("skills.draftRevision", { number: notes.generatedRevision })}
          </summary>
          <p>{t("skills.notEvaluated")}</p>
          {notes.changeSummary.length > 0 && (
            <ul>
              {notes.changeSummary.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          )}
          {notes.assumptions.length > 0 && (
            <>
              <h3>{t("skills.assumptions")}</h3>
              <ul>
                {notes.assumptions.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            </>
          )}
          <h3>{t("skills.suggestedTests")}</h3>
          {notes.suggestedTests.map((test) => (
            <details key={test.id}>
              <summary>
                {test.id} ·{" "}
                {t(
                  test.shouldTrigger
                    ? "skills.shouldTrigger"
                    : "skills.shouldNotTrigger",
                )}
              </summary>
              <pre>{test.prompt}</pre>
              <ul>
                {test.expectedCriteria.map((criterion, index) => (
                  <li key={index}>{criterion}</li>
                ))}
              </ul>
            </details>
          ))}
          {detail.draft?.provenance && (
            <details>
              <summary>{t("skills.modelEvidence")}</summary>
              <p>
                {new Date(detail.draft.provenance.generatedAt).toLocaleString(
                  language,
                )}
              </p>
              {detail.draft.provenance.attempts.map((attempt, index) => (
                <p key={index}>
                  {attempt.provider} / {attempt.model} ·{" "}
                  {attempt.tokensIn ?? "—"} → {attempt.tokensOut ?? "—"}
                </p>
              ))}
              <code>{detail.draft.provenance.creatorPolicyDigest}</code>
            </details>
          )}
        </details>
      )}
      {modal === "revision" && detail.draft && (
        <CreateSkillDialog
          mode="revision"
          existing={{ id: detail.skill.id, revision: detail.draft.revision }}
          onClose={() => setModal(null)}
          onComplete={(next) => {
            accept(next);
            setModal(null);
          }}
        />
      )}
      {modal === "copy" && (
        <CreateSkillDialog
          mode="import"
          initialBundle={bundle}
          onClose={() => setModal(null)}
          onComplete={(next) => {
            cache.setQueryData(skillKeys.detail(tenant, next.skill.id), next);
            void cache.invalidateQueries({
              queryKey: skillKeys.tenant(tenant),
            });
            setModal(null);
            navigate(`/portal/${tenant}/skills/${next.skill.id}`);
          }}
        />
      )}
      {modal === "history" && (
        <SkillHistory
          detail={detail}
          canRestore={editable && !dirty && !pendingFiles}
          onClose={() => setModal(null)}
          onRestore={(revision) =>
            mutate("restore", () =>
              skillApi.restore(
                detail.skill.id,
                detail.draft!.revision,
                revision,
              ),
            )
          }
        />
      )}
      {(modal === "publish" || modal === "archive" || modal === "reload") && (
        <ModalOverlay
          ariaLabel={t(
            modal === "publish"
              ? "skills.publishTitle"
              : modal === "archive"
                ? detail.skill.archivedAt
                  ? "skills.unarchive"
                  : "skills.archiveTitle"
                : "skills.reload",
          )}
          onClose={() => {
            if (!actionsLocked) setModal(null);
          }}
        >
          <div className={styles.dialog}>
            <h2>
              {t(
                modal === "publish"
                  ? "skills.publishTitle"
                  : modal === "archive"
                    ? detail.skill.archivedAt
                      ? "skills.unarchive"
                      : "skills.archiveTitle"
                    : "skills.reload",
              )}
            </h2>
            <p className={styles.hint}>
              {t(
                modal === "publish"
                  ? "skills.publishBody"
                  : modal === "archive"
                    ? detail.skill.archivedAt
                      ? "skills.unarchiveBody"
                      : "skills.archiveBody"
                    : "skills.reloadBody",
              )}
            </p>
            {modal === "publish" && (
              <>
                <p>
                  {detail.skill.name} ·{" "}
                  {t("skills.draftRevision", {
                    number: detail.draft!.revision,
                  })}{" "}
                  →{" "}
                  {t("skills.version", {
                    number: (detail.skill.latestVersionNo ?? 0) + 1,
                  })}
                </p>
                {detail.skill.visibility === "shared" && (
                  <p className={styles.hint}>{t("skills.publishSharedBody")}</p>
                )}
              </>
            )}
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            <div className={styles.actions}>
              <Button disabled={actionsLocked} onClick={() => setModal(null)}>
                {t("skills.cancel")}
              </Button>
              <Button
                tone={
                  modal === "archive" && !detail.skill.archivedAt
                    ? "danger"
                    : "primary"
                }
                disabled={actionsLocked}
                onClick={async () => {
                  const ok = await mutate(modal, () =>
                    modal === "publish"
                      ? skillApi.publish(
                          detail.skill.id,
                          detail.draft!.revision,
                        )
                      : modal === "archive"
                        ? skillApi.archive(detail.skill.id, {
                            archived: !detail.skill.archivedAt,
                            expectedRevision: detail.draft!.revision,
                            expectedLatestVersionId:
                              detail.skill.latestVersionId,
                          })
                        : skillApi.get(detail.skill.id),
                  );
                  if (ok) setModal(null);
                }}
              >
                {t(
                  modal === "publish"
                    ? "skills.publish"
                    : modal === "archive"
                      ? detail.skill.archivedAt
                        ? "skills.unarchive"
                        : "skills.archive"
                      : "skills.reload",
                )}
              </Button>
            </div>
          </div>
        </ModalOverlay>
      )}
      {leaving && (
        <ModalOverlay
          ariaLabel={t("skills.discardTitle")}
          onClose={() => setLeaving(null)}
        >
          <div className={styles.dialog}>
            <h2>{t("skills.discardTitle")}</h2>
            <p className={styles.hint}>{t("skills.discardBody")}</p>
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            <div className={styles.actions}>
              <Button disabled={actionsLocked} onClick={() => setLeaving(null)}>
                {t("skills.keepEditing")}
              </Button>
              <Button
                disabled={actionsLocked}
                tone="danger"
                onClick={() => navigate(leaving)}
              >
                {t("skills.discard")}
              </Button>
              <Button
                disabled={actionsLocked}
                tone="primary"
                onClick={async () => {
                  if (await save()) navigate(leaving);
                }}
              >
                {t("skills.save")}
              </Button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}
