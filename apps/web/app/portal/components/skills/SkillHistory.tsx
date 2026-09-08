"use client";

import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { SkillBundle, SkillDetail } from "@agentic/contracts";
import { Button } from "@/app/portal/components";
import { ModalOverlay } from "@/app/portal/components/Modal";
import { useI18n } from "@/app/portal/lib/preferences-context";
import { useTenant } from "@/app/portal/lib/use-tenant";
import { skillApi, skillKeys } from "@/lib/hooks/useSkills";
import { formatApiError } from "@/lib/api-response";
import { SkillFileEditor } from "./SkillFileEditor";
import styles from "./skills.module.css";

export function SkillHistory({
  detail,
  canRestore,
  onRestore,
  onClose,
}: {
  detail: SkillDetail;
  canRestore: boolean;
  onRestore: (revision: number) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t, language } = useI18n();
  const tenant = useTenant();
  const [tab, setTab] = useState<"versions" | "drafts">("versions");
  const [preview, setPreview] = useState<{
    bundle: SkillBundle;
    revision: number;
    label: string;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const versions = useInfiniteQuery({
    queryKey: [...skillKeys.detail(tenant, detail.skill.id), "versions"],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => skillApi.versions(detail.skill.id, pageParam, tenant),
    getNextPageParam: (page) => page.nextOffset ?? undefined,
  });
  const revisions = useInfiniteQuery({
    queryKey: [...skillKeys.detail(tenant, detail.skill.id), "revisions"],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => skillApi.revisions(detail.skill.id, pageParam, tenant),
    getNextPageParam: (page) => page.nextOffset ?? undefined,
    enabled: Boolean(detail.draft),
  });
  async function inspect(revision: number, label: string, versionId?: string) {
    setBusy(true);
    setError(undefined);
    try {
      const result = versionId
        ? await skillApi.version(detail.skill.id, versionId)
        : await skillApi.revision(detail.skill.id, revision);
      setPreview({ bundle: result.bundle, revision, label });
    } catch (cause) {
      setError(formatApiError(cause, t));
    } finally {
      setBusy(false);
    }
  }
  const query = tab === "versions" ? versions : revisions;
  return (
    <ModalOverlay
      ariaLabel={t("skills.history")}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className={`${styles.dialog} ${preview ? styles.wideDialog : ""}`}>
        <div className={styles.header}>
          <h2>{t("skills.history")}</h2>
          <Button onClick={onClose} disabled={busy}>
            {t("skills.close")}
          </Button>
        </div>
        <div className={styles.segmented}>
          <button
            type="button"
            aria-pressed={tab === "versions"}
            onClick={() => setTab("versions")}
          >
            {t("skills.published")}
          </button>
          {detail.draft && (
            <button
              type="button"
              aria-pressed={tab === "drafts"}
              onClick={() => setTab("drafts")}
            >
              {t("skills.draft")}
            </button>
          )}
        </div>
        {query.isLoading && (
          <p role="status" className={styles.hint}>
            {t("common.loading")}
          </p>
        )}
        {query.error && (
          <p role="alert" className={styles.error}>
            {formatApiError(query.error, t)}{" "}
            <Button onClick={() => void query.refetch()}>
              {t("skills.retry")}
            </Button>
          </p>
        )}
        {tab === "versions" ? (
          <>
            {versions.data?.pages
              .flatMap((page) => page.versions)
              .map((version) => (
                <div key={version.id} className={styles.historyRow}>
                  <div>
                    {t("skills.version", { number: version.versionNo })}
                    <p>
                      {new Date(version.createdAt).toLocaleString(language)}
                    </p>
                    <code>{version.contentDigest}</code>
                  </div>
                  <div className={styles.actions}>
                    <Button
                      small
                      disabled={busy}
                      onClick={() =>
                        void inspect(
                          version.draftRevision,
                          t("skills.version", { number: version.versionNo }),
                          version.id,
                        )
                      }
                    >
                      {t("skills.read")}
                    </Button>
                    <Button
                      small
                      onClick={() =>
                        void skillApi
                          .export(detail.skill.id, version.name, {
                            versionId: version.id,
                          })
                          .catch((cause) => setError(formatApiError(cause, t)))
                      }
                    >
                      {t("skills.export")}
                    </Button>
                  </div>
                </div>
              ))}
            {versions.data && !versions.data.pages[0]?.versions.length && (
              <p className={styles.hint}>{t("skills.noVersions")}</p>
            )}
          </>
        ) : (
          <>
            {revisions.data?.pages
              .flatMap((page) => page.revisions)
              .map((revision) => (
                <div key={revision.revision} className={styles.historyRow}>
                  <div>
                    {t("skills.draftRevision", { number: revision.revision })}
                    <p>
                      {new Date(revision.updatedAt).toLocaleString(language)}
                    </p>
                  </div>
                  <Button
                    small
                    disabled={busy}
                    onClick={() =>
                      void inspect(
                        revision.revision,
                        t("skills.draftRevision", {
                          number: revision.revision,
                        }),
                      )
                    }
                  >
                    {t("skills.read")}
                  </Button>
                </div>
              ))}
            {revisions.data && !revisions.data.pages[0]?.revisions.length && (
              <p className={styles.hint}>{t("skills.noHistory")}</p>
            )}
          </>
        )}
        {query.hasNextPage && (
          <div className={styles.loadMore}>
            <Button
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {t("skills.loadMore")}
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {preview && (
          <>
            <div className={styles.editorActions}>
              <div>
                <h3>{preview.label}</h3>
                <p className={styles.hint}>{t("skills.restoreHint")}</p>
              </div>
              {canRestore && (
                <Button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    if (await onRestore(preview.revision)) onClose();
                    setBusy(false);
                  }}
                >
                  {t("skills.restore")}
                </Button>
              )}
            </div>
            <SkillFileEditor
              bundle={preview.bundle}
              onChange={() => undefined}
              readOnly
            />
          </>
        )}
      </div>
    </ModalOverlay>
  );
}
