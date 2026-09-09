"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Badge, Button } from "@/app/portal/components";
import { useI18n } from "@/app/portal/lib/preferences-context";
import { useTenant } from "@/app/portal/lib/use-tenant";
import { useCan } from "@/lib/hooks/useMe";
import { useSkills, skillKeys } from "@/lib/hooks/useSkills";
import { formatApiError } from "@/lib/api-response";
import { CreateSkillDialog, type SkillCreateMode } from "./CreateSkillDialog";
import { SkillAvailabilityControl } from "./SkillAvailabilityControl";
import styles from "./skills.module.css";

export function SkillsPage() {
  const { t, language } = useI18n();
  const tenant = useTenant();
  const router = useRouter();
  const cache = useQueryClient();
  const can = useCan();
  const [mode, setMode] = useState<SkillCreateMode | null>(null);
  const [scope, setScope] = useState<"available" | "owned" | "shared">(
    "available",
  );
  const [archived, setArchived] = useState(false);
  const [search, setSearch] = useState("");
  const query = useSkills({ scope, archived });
  const rows = query.data?.pages.flatMap((page) => page.skills) ?? [];
  const normalized = search.trim().toLocaleLowerCase();
  const filtered = rows.filter((row) =>
    `${row.name} ${row.description}`.toLocaleLowerCase().includes(normalized),
  );
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>{t("skills.title")}</h1>
          <p className={styles.subheading}>{t("skills.subtitle")}</p>
          <p className={styles.hint}>
            {t("skills.workspaceScope", { tenant })}
          </p>
          <p className={styles.hint}>{t("skills.availabilityHint")}</p>
        </div>
        <div className={styles.actions}>
          <Button
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t(query.isFetching ? "skills.refreshing" : "skills.refresh")}
          </Button>
          <Link
            className={styles.helpLink}
            href={`/portal/${tenant}/skills/help` as never}
          >
            {t("skills.help")}
          </Link>
          {can("skills.write") && (
            <>
              <Button onClick={() => setMode("import")}>
                {t("skills.import")}
              </Button>
              <Button onClick={() => setMode("blank")}>
                {t("skills.blank")}
              </Button>
              <Button
                tone="primary"
                icon="spark"
                onClick={() => setMode("describe")}
              >
                {t("skills.describe")}
              </Button>
            </>
          )}
        </div>
      </div>
      <div className={styles.libraryToolbar}>
        <div className={styles.segmented}>
          {(["available", "owned", "shared"] as const).map((value) => (
            <button
              key={value}
              aria-pressed={scope === value}
              onClick={() => setScope(value)}
            >
              {t(`skills.${value}`)}
            </button>
          ))}
        </div>
        <label className={styles.archiveFilter}>
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => setArchived(event.target.checked)}
          />
          {t("skills.archived")}
        </label>
        <input
          type="search"
          aria-label={t("skills.search")}
          placeholder={t("skills.search")}
          className={styles.control}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {query.data && (
        <p role="status" className={styles.hint}>
          {normalized
            ? t("skills.filteredCount", {
                shown: filtered.length,
                loaded: rows.length,
              })
            : t("skills.loadedCount", { count: rows.length })}
          {query.hasNextPage && ` · ${t("skills.moreAvailable")}`}
        </p>
      )}
      {query.isLoading ? (
        <p role="status" className={styles.empty}>
          {t("skills.loading")}
        </p>
      ) : query.error && !rows.length ? (
        <div role="alert" className={styles.error}>
          {formatApiError(query.error, t)}{" "}
          <Button small onClick={() => void query.refetch()}>
            {t("skills.retry")}
          </Button>
        </div>
      ) : !filtered.length ? (
        <div className={styles.empty}>
          <h2>
            {t(
              rows.length || search || scope !== "available" || archived
                ? "skills.noMatches"
                : "skills.empty",
            )}
          </h2>
          <p>
            {t(
              rows.length || search || scope !== "available" || archived
                ? "skills.noMatchesBody"
                : "skills.emptyBody",
            )}
          </p>
        </div>
      ) : (
        <div className={styles.skillList}>
          {filtered.map((skill) => (
            <div key={skill.id} className={styles.skillRow}>
              <Link
                className={styles.skillLink}
                href={`/portal/${tenant}/skills/${skill.id}` as never}
              >
                <div className={styles.skillIdentity}>
                  <span className={styles.skillGlyph} aria-hidden="true">
                    SK
                  </span>
                  <div>
                    <h2>{skill.name}</h2>
                    <p>{skill.description}</p>
                  </div>
                </div>
                <div className={styles.skillMeta}>
                  <div className={styles.actions}>
                    {skill.visibility === "shared" && (
                      <Badge>{t("skills.shared")}</Badge>
                    )}
                    {skill.archivedAt ? (
                      <Badge tone="muted">{t("skills.archived")}</Badge>
                    ) : skill.latestVersionNo ? (
                      <Badge tone="green">
                        {t("skills.version", { number: skill.latestVersionNo })}
                      </Badge>
                    ) : (
                      <Badge tone="amber">{t("skills.draft")}</Badge>
                    )}
                  </div>
                  <time dateTime={new Date(skill.updatedAt).toISOString()}>
                    {new Date(skill.updatedAt).toLocaleDateString(language)}
                  </time>
                  <span>
                    {t(skill.canEdit ? "skills.edit" : "skills.read")} →
                  </span>
                </div>
              </Link>
              <SkillAvailabilityControl skill={skill} compact />
            </div>
          ))}
        </div>
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
      {query.error && rows.length > 0 && (
        <p role="alert" className={styles.error}>
          {formatApiError(query.error, t)}
        </p>
      )}
      {mode && (
        <CreateSkillDialog
          mode={mode}
          onClose={() => setMode(null)}
          onComplete={(detail) => {
            cache.setQueryData(
              skillKeys.detail(tenant, detail.skill.id),
              detail,
            );
            void cache.invalidateQueries({
              queryKey: skillKeys.tenant(tenant),
            });
            setMode(null);
            router.push(`/portal/${tenant}/skills/${detail.skill.id}` as never);
          }}
        />
      )}
    </div>
  );
}
