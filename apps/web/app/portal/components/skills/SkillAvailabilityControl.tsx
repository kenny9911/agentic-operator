"use client";

import { useId } from "react";
import type { ManagedSkillSummary, SkillDetail } from "@agentic/contracts";
import { useI18n } from "@/app/portal/lib/preferences-context";
import { useTenant } from "@/app/portal/lib/use-tenant";
import { useCan } from "@/lib/hooks/useMe";
import { useSetSkillEnabled } from "@/lib/hooks/useSkills";
import { ApiResponseError, formatApiError } from "@/lib/api-response";
import styles from "./skills.module.css";

export function SkillAvailabilityControl({
  skill,
  disabled = false,
  compact = false,
  onChange,
}: {
  skill: ManagedSkillSummary;
  disabled?: boolean;
  compact?: boolean;
  onChange?: (detail: SkillDetail) => void;
}) {
  const { t } = useI18n();
  const tenant = useTenant();
  const can = useCan();
  const mutation = useSetSkillEnabled(tenant);
  const hintId = useId();
  const canToggle =
    skill.canEdit && can("skills.write") && skill.draftRevision !== null;
  const conflict =
    mutation.error instanceof ApiResponseError && mutation.error.status === 409;
  return (
    <div className={styles.availability}>
      <button
        type="button"
        role="switch"
        aria-checked={skill.enabled}
        aria-label={t("skills.runtimeToggle", { name: skill.name })}
        aria-describedby={hintId}
        aria-busy={mutation.isPending}
        className={styles.availabilitySwitch}
        disabled={
          disabled ||
          !canToggle ||
          Boolean(skill.archivedAt) ||
          mutation.isPending
        }
        onClick={() =>
          mutation.mutate(
            { skill, enabled: !skill.enabled },
            { onSuccess: (next) => onChange?.(next) },
          )
        }
      >
        <span className={styles.switchTrack} aria-hidden="true">
          <span />
        </span>
        <span>
          {t(
            mutation.isPending
              ? "skills.updatingAvailability"
              : skill.enabled
                ? "skills.enabled"
                : "skills.disabled",
          )}
        </span>
      </button>
      <span
        id={hintId}
        className={
          compact ? styles.availabilityHintHidden : styles.availabilityHint
        }
      >
        {t(
          skill.archivedAt
            ? "skills.availabilityArchived"
            : !canToggle
              ? "skills.availabilityReadonly"
              : "skills.availabilityHint",
        )}
      </span>
      {mutation.error && (
        <p role="alert" className={styles.availabilityError}>
          {conflict
            ? t("skills.availabilityConflict")
            : formatApiError(mutation.error, t)}
        </p>
      )}
    </div>
  );
}
