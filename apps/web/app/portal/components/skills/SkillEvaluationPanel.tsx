"use client";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CreateSkillEvaluationBodySchema,
  type SkillDetail,
  type SkillEvaluation,
  type SkillEvaluationAttempt,
} from "@agentic/contracts";
import { Button } from "@/app/portal/components/button";
import { useI18n } from "@/app/portal/lib/preferences-context";
import { useTenant } from "@/app/portal/lib/use-tenant";
import { useCan } from "@/lib/hooks/useMe";
import {
  skillEvaluationApi,
  skillEvaluationKeys,
  useSkillEvaluations,
} from "@/lib/hooks/useSkillEvaluations";
import { ApiResponseError, formatApiError } from "@/lib/api-response";
import { skillEvaluationCopy } from "@/lib/i18n/skill-evaluation";
import { SkillModelPicker } from "./SkillModelPicker";
import styles from "./evaluation.module.css";

type Copy = ReturnType<typeof skillEvaluationCopy>;
function statusLabel(item: SkillEvaluation, copy: Copy) {
  return item.status === "completed"
    ? copy.completed
    : item.status === "failed"
      ? copy.failed
      : item.status === "cancelled"
        ? copy.cancelledStatus
        : copy.inProgress;
}
function reviewLabel(item: SkillEvaluation, copy: Copy) {
  return !item.grade
    ? copy.ungraded
    : item.grade.verdict === "pass"
      ? copy.reviewedPass
      : copy.reviewedFail;
}

export function SkillEvaluationPanel({
  detail,
  disabled = false,
}: {
  detail: SkillDetail;
  disabled?: boolean;
}) {
  const { language, t } = useI18n();
  const copy = skillEvaluationCopy(language);
  const tenant = useTenant();
  const can = useCan();
  const history = useSkillEvaluations(detail.skill.id);
  const cache = useQueryClient();
  const formId = useId();
  const [prompt, setPrompt] = useState("");
  const [expectations, setExpectations] = useState("");
  const [modelRoute, setModelRoute] = useState("");
  const canDraft =
    detail.skill.canEdit && Boolean(detail.draft) && !detail.skill.archivedAt;
  const [source, setSource] = useState(canDraft ? "draft" : "version");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<SkillEvaluation | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      activeRequest.current?.abort();
    },
    [tenant, detail.skill.id],
  );
  const records = history.data?.pages.flatMap((page) => page.evaluations) ?? [];
  const writable = can("skills.write");
  const draftSource = source === "draft" && canDraft;
  const hasSource = draftSource || Boolean(detail.latestVersion);
  const notes = detail.draft?.creatorNotes;
  const criteria = expectations
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const invalidCriteria =
    criteria.length > 10 || criteria.some((line) => line.length > 2000);

  async function refresh() {
    await history.refetch();
    if (selected) {
      try {
        setSelected(
          await skillEvaluationApi.get(tenant, detail.skill.id, selected.id),
        );
      } catch (cause) {
        setError(formatApiError(cause, t));
      }
    }
  }
  async function run(event: FormEvent) {
    event.preventDefault();
    if (
      busy ||
      disabled ||
      !detail.skill.enabled ||
      !writable ||
      !hasSource ||
      invalidCriteria
    )
      return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body = CreateSkillEvaluationBodySchema.parse({
        prompt,
        expectations: criteria,
        ...(modelRoute ? { modelRoute } : {}),
        ...(draftSource
          ? { expectedRevision: detail.draft!.revision }
          : { versionId: detail.latestVersion!.id }),
      });
      setSelected(
        await skillEvaluationApi.run(
          tenant,
          detail.skill.id,
          body,
          controller.signal,
        ),
      );
    } catch (cause) {
      if (controller.signal.aborted) setNotice(copy.cancelled);
      else setError(formatApiError(cause, t));
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
      setBusy(false);
      void cache.invalidateQueries({
        queryKey: skillEvaluationKeys.list(tenant, detail.skill.id),
      });
    }
  }

  return (
    <section className={styles.panel} aria-labelledby={`${formId}-title`}>
      <div className={styles.header}>
        <div>
          <h2 id={`${formId}-title`}>{copy.title}</h2>
          <p className={styles.hint}>{copy.subtitle}</p>
        </div>
        <Button
          small
          disabled={history.isFetching}
          onClick={() => void refresh()}
        >
          {copy.refresh}
        </Button>
      </div>
      <p className={styles.limits}>{copy.limits}</p>
      <form onSubmit={(event) => void run(event)}>
        <div className={styles.form}>
          <div>
            {notes && notes.suggestedTests.length > 0 && (
              <label className={styles.label}>
                {copy.suggestions}
                <select
                  className={styles.control}
                  defaultValue=""
                  disabled={busy || disabled}
                  onChange={(event) => {
                    const suggestion =
                      notes.suggestedTests[Number(event.target.value)];
                    if (event.target.value !== "" && suggestion) {
                      setPrompt(suggestion.prompt);
                      setExpectations(suggestion.expectedCriteria.join("\n"));
                    }
                  }}
                >
                  <option value="">{copy.chooseSuggestion}</option>
                  {notes.suggestedTests.map((test, index) => (
                    <option key={test.id} value={index}>
                      {test.id}
                    </option>
                  ))}
                </select>
                <span>
                  {copy.suggestedRevision} {notes.generatedRevision}.{" "}
                  {copy.triggerLimit}
                </span>
              </label>
            )}
            <label className={styles.label} htmlFor={`${formId}-prompt`}>
              {copy.prompt}
              <textarea
                id={`${formId}-prompt`}
                className={styles.control}
                rows={6}
                required
                maxLength={16000}
                value={prompt}
                disabled={busy || disabled || !writable}
                placeholder={copy.promptPlaceholder}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </label>
            <label className={styles.label} htmlFor={`${formId}-expectations`}>
              {copy.expectations}
              <textarea
                id={`${formId}-expectations`}
                className={styles.control}
                rows={4}
                required
                maxLength={40019}
                value={expectations}
                disabled={busy || disabled || !writable}
                aria-invalid={invalidCriteria}
                onChange={(event) => setExpectations(event.target.value)}
              />
              <span>{copy.expectationsHint}</span>
            </label>
            {invalidCriteria && (
              <p className={styles.error} role="alert">
                {copy.expectationsLimit}
              </p>
            )}
          </div>
          <div>
            <label className={styles.label}>
              {copy.source}
              <select
                className={styles.control}
                value={draftSource ? "draft" : "version"}
                disabled={busy || disabled || !writable}
                onChange={(event) => setSource(event.target.value)}
              >
                {canDraft && (
                  <option value="draft">
                    {copy.draft} {detail.draft!.revision}
                  </option>
                )}
                {detail.latestVersion && (
                  <option value="version">
                    {copy.version} {detail.latestVersion.versionNo}
                  </option>
                )}
                {!hasSource && (
                  <option value="version">{copy.unavailable}</option>
                )}
              </select>
            </label>
            <SkillModelPicker
              value={modelRoute}
              onChange={setModelRoute}
              disabled={busy || disabled || !writable}
            />
            <p className={styles.hint}>{copy.compareCosts}</p>
            {disabled && <p className={styles.hint}>{copy.savedOnly}</p>}
            {!detail.skill.enabled && (
              <p className={styles.hint}>{copy.skillDisabled}</p>
            )}
            {!writable && <p className={styles.hint}>{copy.permission}</p>}
            <div className={styles.actions}>
              {busy && (
                <Button onClick={() => activeRequest.current?.abort()}>
                  {copy.cancel}
                </Button>
              )}
              <Button
                type="submit"
                tone="primary"
                disabled={
                  busy ||
                  disabled ||
                  !detail.skill.enabled ||
                  !writable ||
                  !hasSource ||
                  invalidCriteria ||
                  !prompt.trim() ||
                  !criteria.length
                }
              >
                {busy ? copy.running : copy.run}
              </Button>
            </div>
          </div>
        </div>
      </form>
      {busy && (
        <p className={styles.hint} role="status">
          {copy.running}
        </p>
      )}
      {notice && (
        <p className={styles.hint} role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <details className={styles.history} open>
        <summary>{copy.history}</summary>
        {history.isLoading ? (
          <p role="status" className={styles.hint}>
            {copy.loading}
          </p>
        ) : history.error ? (
          <p className={styles.error} role="alert">
            {formatApiError(history.error, t)}
          </p>
        ) : !records.length ? (
          <p className={styles.hint}>{copy.empty}</p>
        ) : (
          <div className={styles.historyList}>
            {records.map((item) => (
              <button
                type="button"
                key={item.id}
                className={styles.historyItem}
                aria-pressed={selected?.id === item.id}
                onClick={() => setSelected(item)}
              >
                <span className={styles.historyPrompt}>{item.prompt}</span>
                <span>
                  {new Date(item.createdAt).toLocaleString(language)} ·{" "}
                  {item.source.kind === "draft" ? copy.draft : copy.version}{" "}
                  {item.source.kind === "draft"
                    ? item.source.draftRevision
                    : item.source.versionId}
                </span>
                <span>
                  {statusLabel(item, copy)} · {reviewLabel(item, copy)}
                </span>
              </button>
            ))}
          </div>
        )}
        {history.hasNextPage && (
          <div className={styles.actions}>
            <Button
              small
              disabled={history.isFetchingNextPage}
              onClick={() => void history.fetchNextPage()}
            >
              {copy.more}
            </Button>
          </div>
        )}
      </details>
      {selected && (
        <SkillEvaluationResult
          key={`${selected.id}:${selected.grade?.revision ?? 0}`}
          record={selected}
          writable={writable}
          disabled={busy}
          onSaved={(record) => {
            setSelected(record);
            void cache.invalidateQueries({
              queryKey: skillEvaluationKeys.list(tenant, detail.skill.id),
            });
          }}
          onRefresh={() => void refresh()}
        />
      )}
    </section>
  );
}

function EvaluationOutput({
  attempt,
  title,
  copy,
}: {
  attempt: SkillEvaluationAttempt | null;
  title: string;
  copy: Copy;
}) {
  return (
    <article className={styles.output}>
      <h4 className={styles.outputHeading}>{title}</h4>
      {attempt?.text !== null && attempt?.text !== undefined ? (
        <pre className={styles.outputText}>{attempt.text}</pre>
      ) : (
        <p className={styles.hint}>{copy.pending}</p>
      )}
      {attempt?.error && (
        <p role="alert" className={styles.error}>
          {attempt.error.message}
        </p>
      )}
      {attempt && (
        <div className={styles.usage}>
          <span>
            {attempt.provider ?? copy.unknown} / {attempt.model ?? copy.unknown}
          </span>
          <span>
            {copy.inputTokens}: {attempt.tokensIn ?? copy.unknown} ·{" "}
            {copy.outputTokens}: {attempt.tokensOut ?? copy.unknown}
          </span>
          {attempt.effectiveRoute && <span>{attempt.effectiveRoute}</span>}
        </div>
      )}
    </article>
  );
}
export function SkillEvaluationResult({
  record,
  writable,
  disabled,
  onSaved,
  onRefresh,
}: {
  record: SkillEvaluation;
  writable: boolean;
  disabled: boolean;
  onSaved: (record: SkillEvaluation) => void;
  onRefresh: () => void;
}) {
  const { language, t } = useI18n();
  const copy = skillEvaluationCopy(language);
  const tenant = useTenant();
  const [verdict, setVerdict] = useState<"" | "pass" | "fail">(
    record.grade?.verdict ?? "",
  );
  const [comment, setComment] = useState(record.grade?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function saveGrade(event: FormEvent) {
    event.preventDefault();
    if (!verdict || busy || disabled || !writable) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await skillEvaluationApi.grade(tenant, record.skillId, record.id, {
          expectedGradeRevision: record.grade?.revision ?? 0,
          verdict,
          comment,
        }),
      );
    } catch (cause) {
      setError(
        cause instanceof ApiResponseError && cause.code === "grade_conflict"
          ? copy.gradeConflict
          : formatApiError(cause, t),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.result}>
      <h3>{statusLabel(record, copy)}</h3>
      <pre className={styles.prompt}>{record.prompt}</pre>
      <ul>
        {record.expectations.map((expectation, index) => (
          <li key={index}>{expectation}</li>
        ))}
      </ul>
      {record.error && (
        <p className={styles.error} role="alert">
          {record.error.message}
        </p>
      )}
      <div className={styles.outputs}>
        <EvaluationOutput
          attempt={record.baseline}
          title={copy.baseline}
          copy={copy}
        />
        <EvaluationOutput
          attempt={record.withSkill}
          title={copy.withSkill}
          copy={copy}
        />
      </div>
      <details className={styles.evidence}>
        <summary>{copy.requestEvidence}</summary>
        <p>
          {record.source.name} · {copy.draft} {record.source.draftRevision}
          {record.source.versionId ? ` · ${record.source.versionId}` : ""}
        </p>
        <code>{record.id}</code>
        <code>{record.source.contentDigest}</code>
        <code>{record.requestDigest}</code>
      </details>
      <div className={styles.grade}>
        <h3>{copy.review}</h3>
        <p className={styles.reviewStatus} data-verdict={record.grade?.verdict}>
          {reviewLabel(record, copy)}
        </p>
        {record.grade && (
          <p className={styles.hint}>
            {copy.reviewBy}: {record.grade.actorId ?? copy.unknown} ·{" "}
            {new Date(record.grade.gradedAt).toLocaleString(language)} ·{" "}
            {copy.gradeRevision} {record.grade.revision}
          </p>
        )}
        {record.status === "completed" && writable ? (
          <form onSubmit={(event) => void saveGrade(event)}>
            <label className={styles.label}>
              {copy.verdict}
              <select
                required
                className={styles.control}
                value={verdict}
                disabled={busy || disabled}
                onChange={(event) =>
                  setVerdict(event.target.value as "" | "pass" | "fail")
                }
              >
                <option value="">{copy.chooseVerdict}</option>
                <option value="pass">{copy.pass}</option>
                <option value="fail">{copy.fail}</option>
              </select>
            </label>
            <label className={styles.label}>
              {copy.comment}
              <textarea
                className={styles.control}
                rows={3}
                maxLength={4000}
                value={comment}
                disabled={busy || disabled}
                placeholder={copy.commentHint}
                onChange={(event) => setComment(event.target.value)}
              />
            </label>
            {error && (
              <p className={styles.error} role="alert">
                {error}
                <Button small onClick={onRefresh}>
                  {copy.refresh}
                </Button>
              </p>
            )}
            <div className={styles.actions}>
              <Button type="submit" disabled={busy || disabled || !verdict}>
                {busy ? copy.savingGrade : copy.saveGrade}
              </Button>
            </div>
          </form>
        ) : (
          record.grade?.comment && (
            <pre className={styles.prompt}>{record.grade.comment}</pre>
          )
        )}
      </div>
    </div>
  );
}
