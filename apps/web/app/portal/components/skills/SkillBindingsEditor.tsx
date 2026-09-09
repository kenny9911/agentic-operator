"use client";

import Link from "next/link";
import { useId, useState, type CSSProperties } from "react";
import { SkillBindingsSchema, type SkillBindings } from "@agentic/contracts";
import { useI18n } from "@/app/portal/lib/preferences-context";
import { skillBindingsCopy } from "@/lib/i18n/skill-bindings";
import { useSkill, useSkills, useSkillVersion } from "@/lib/hooks/useSkills";
import { ApiResponseError } from "@/lib/api-response";

type Binding = NonNullable<SkillBindings["skills"]>[number];
type Copy = ReturnType<typeof skillBindingsCopy>;
export interface SkillBindingsEditorProps {
  tenant: string;
  scope: "workflow" | "agent";
  value?: unknown;
  onChange: (value: SkillBindings) => void;
  disabled?: boolean;
  inherited?: SkillBindings;
}

/** No effect repairs or removes authored bindings. Unavailable references stay editable. */
export function SkillBindingsEditor({
  tenant,
  scope,
  value,
  onChange,
  disabled = false,
  inherited,
}: SkillBindingsEditorProps) {
  const { language } = useI18n();
  const copy = skillBindingsCopy(language);
  const id = useId();
  const parsed =
    value === undefined
      ? { success: true as const, data: { mode: "inherit" as const } }
      : SkillBindingsSchema.safeParse(value);
  const binding = parsed.success ? parsed.data : undefined;
  const selected = binding?.skills ?? [];
  return (
    <section
      aria-label={scope === "workflow" ? copy.workflowTitle : copy.agentTitle}
      style={{ display: "grid", gap: 12 }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 10,
          justifyContent: "space-between",
        }}
      >
        <strong style={{ color: "var(--text)", fontSize: 13 }}>
          {scope === "workflow" ? copy.workflowTitle : copy.agentTitle}
        </strong>
        <Link
          href={`/portal/${encodeURIComponent(tenant)}/skills/help` as never}
          target="_blank"
          rel="noopener noreferrer"
          style={linkStyle}
        >
          {copy.help}
        </Link>
      </div>
      <p style={hintStyle}>
        {scope === "workflow" ? copy.workflowHint : copy.agentHint}
      </p>
      {!parsed.success ? (
        <p role="alert" style={{ ...hintStyle, color: "var(--red)" }}>
          {copy.invalid}
        </p>
      ) : null}
      <label htmlFor={id} style={labelStyle}>
        {copy.scope}
      </label>
      <select
        id={id}
        value={binding?.mode ?? ""}
        disabled={disabled}
        style={inputStyle}
        onChange={(event) => {
          const mode = event.target.value as SkillBindings["mode"];
          onChange(
            SkillBindingsSchema.parse({
              mode,
              ...(selected.length
                ? { skills: selected }
                : mode === "selected"
                  ? { skills: [] }
                  : {}),
            }),
          );
        }}
      >
        {!binding ? (
          <option value="" disabled>
            {copy.invalid}
          </option>
        ) : null}
        <option value="inherit">{copy.inherit}</option>
        <option value="selected">{copy.selected}</option>
        <option value="disabled">{copy.disabled}</option>
      </select>
      {binding?.mode === "selected" ? (
        <SkillSelection
          tenant={tenant}
          selected={selected}
          disabled={disabled}
          inherited={inherited}
          copy={copy}
          onChange={(skills) => onChange({ mode: "selected", skills })}
        />
      ) : null}
      {binding?.mode === "disabled" ? (
        <p style={hintStyle}>{copy.disabledHint}</p>
      ) : null}
      {binding?.mode !== "selected" && selected.length ? (
        <p style={hintStyle}>
          {selected.length} {copy.selectedCount}. {copy.preserved}
        </p>
      ) : null}
      <p style={hintStyle}>{copy.permissions}</p>
    </section>
  );
}

function SkillSelection({
  tenant,
  selected,
  disabled,
  inherited,
  copy,
  onChange,
}: {
  tenant: string;
  selected: Binding[];
  disabled: boolean;
  inherited?: SkillBindings;
  copy: Copy;
  onChange: (bindings: Binding[]) => void;
}) {
  const catalog = useSkills({ scope: "available", archived: false });
  const [search, setSearch] = useState("");
  const [choice, setChoice] = useState("");
  const [visibleBindings, setVisibleBindings] = useState(10);
  const id = useId();
  const existing = new Set(selected.map((entry) => entry.id));
  const published = (
    catalog.data?.pages.flatMap((page) => page.skills) ?? []
  ).filter(
    (skill) =>
      skill.enabled &&
      skill.latestVersionId &&
      !skill.archivedAt &&
      !existing.has(skill.id),
  );
  const allowed = published.filter(
    (skill) =>
      inherited?.mode !== "disabled" &&
      (inherited?.mode !== "selected" ||
        inherited.skills?.some((entry) => entry.id === skill.id)),
  );
  const filtered = allowed.filter((skill) =>
    `${skill.name} ${skill.description}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  );
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {selected.slice(0, visibleBindings).map((entry) => (
        <SkillBindingRow
          key={entry.id}
          tenant={tenant}
          entry={entry}
          inherited={inherited}
          disabled={disabled}
          copy={copy}
          onChange={(next) =>
            onChange(
              selected.map((item) => (item.id === entry.id ? next : item)),
            )
          }
          onRemove={() =>
            onChange(selected.filter((item) => item.id !== entry.id))
          }
        />
      ))}
      {selected.length > visibleBindings ? (
        <button
          type="button"
          style={buttonStyle}
          onClick={() => setVisibleBindings((count) => count + 10)}
        >
          {copy.more} ({selected.length - visibleBindings})
        </button>
      ) : null}
      {!selected.length ? <p style={hintStyle}>{copy.noneSelected}</p> : null}
      {catalog.isError ? (
        <div role="alert">
          <p style={{ ...hintStyle, color: "var(--red)" }}>{copy.error}</p>
          <button
            type="button"
            style={buttonStyle}
            onClick={() => void catalog.refetch()}
          >
            {copy.retry}
          </button>
        </div>
      ) : null}
      {catalog.isLoading ? (
        <p role="status" style={hintStyle}>
          {copy.loading}
        </p>
      ) : null}
      {!disabled ? (
        <>
          <label htmlFor={`${id}-search`} style={labelStyle}>
            {copy.search}
          </label>
          <input
            id={`${id}-search`}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={inputStyle}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <select
              aria-label={copy.choose}
              style={{ ...inputStyle, flex: "1 1 220px" }}
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
            >
              <option value="">{copy.choose}</option>
              {filtered.map((skill) => (
                <option key={skill.id} value={skill.id}>
                  {skill.name} ·{" "}
                  {skill.visibility === "shared" ? copy.shared : copy.tenant}
                </option>
              ))}
            </select>
            <button
              type="button"
              style={buttonStyle}
              disabled={!filtered.some((skill) => skill.id === choice)}
              onClick={() => {
                if (!filtered.some((skill) => skill.id === choice)) return;
                onChange([...selected, { id: choice }]);
                setChoice("");
              }}
            >
              {copy.add}
            </button>
          </div>
          {!catalog.isLoading && !catalog.isError && !filtered.length ? (
            <p style={hintStyle}>{copy.empty}</p>
          ) : null}
          {catalog.hasNextPage ? (
            <button
              type="button"
              disabled={catalog.isFetchingNextPage}
              style={buttonStyle}
              onClick={() => void catalog.fetchNextPage()}
            >
              {copy.more}
            </button>
          ) : null}
        </>
      ) : null}
      <Link
        href={`/portal/${encodeURIComponent(tenant)}/skills` as never}
        target="_blank"
        rel="noopener noreferrer"
        style={linkStyle}
      >
        {copy.library}
      </Link>
    </div>
  );
}

function SkillBindingRow({
  tenant,
  entry,
  inherited,
  disabled,
  copy,
  onChange,
  onRemove,
}: {
  tenant: string;
  entry: Binding;
  inherited?: SkillBindings;
  disabled: boolean;
  copy: Copy;
  onChange: (binding: Binding) => void;
  onRemove: () => void;
}) {
  const detail = useSkill(entry.id);
  const id = useId();
  const skill = detail.data?.skill;
  const recentVersions = detail.data?.versions ?? [];
  const pinInRecentVersions = recentVersions.some(
    (version) => version.id === entry.versionId,
  );
  const needsPin = Boolean(skill && entry.versionId && !pinInRecentVersions);
  const pinned = useSkillVersion(entry.id, entry.versionId, needsPin, tenant);
  const versions =
    pinned.data && needsPin ? [...recentVersions, pinned.data] : recentVersions;
  const parentEntry =
    inherited?.mode === "selected"
      ? inherited.skills?.find((item) => item.id === entry.id)
      : undefined;
  const outside =
    inherited?.mode === "disabled" ||
    (inherited?.mode === "selected" && !parentEntry);
  const pinUnresolved = Boolean(
    entry.versionId &&
    !versions.some((version) => version.id === entry.versionId),
  );
  const badPin =
    needsPin &&
    pinUnresolved &&
    pinned.isError &&
    pinned.error instanceof ApiResponseError &&
    pinned.error.status === 404;
  const pinLoading = needsPin && pinUnresolved && !pinned.isError;
  const pinFailed = needsPin && pinned.isError && !badPin;
  const mismatchedParentPin =
    parentEntry?.versionId &&
    entry.versionId &&
    parentEntry.versionId !== entry.versionId;
  const problem = outside
    ? copy.outsideScope
    : mismatchedParentPin
      ? copy.parentVersion
      : detail.isError
        ? copy.missing
        : skill?.archivedAt
          ? copy.archived
          : skill && !skill.enabled
            ? copy.skillDisabled
            : skill && !skill.latestVersionId
              ? copy.unpublished
              : badPin
                ? copy.invalidVersion
                : pinFailed
                  ? copy.error
                  : null;
  return (
    <article
      style={{
        padding: 12,
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--panel-2)",
        display: "grid",
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "start",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <Link
            href={
              `/portal/${encodeURIComponent(tenant)}/skills/${encodeURIComponent(entry.id)}` as never
            }
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...linkStyle, overflowWrap: "anywhere" }}
          >
            {skill?.name ?? entry.id}
          </Link>
          {skill ? (
            <p style={hintStyle}>
              {skill.visibility === "shared" ? copy.shared : copy.tenant}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={disabled}
          style={buttonStyle}
          aria-label={`${copy.remove} ${skill?.name ?? entry.id}`}
          onClick={onRemove}
        >
          {copy.remove}
        </button>
      </div>
      {detail.isLoading || pinLoading ? (
        <p role="status" style={hintStyle}>
          {copy.loading}
        </p>
      ) : null}
      {problem ? (
        <p role="alert" style={{ ...hintStyle, color: "var(--red)" }}>
          {problem}
        </p>
      ) : null}
      {detail.isError ? (
        <button
          type="button"
          style={buttonStyle}
          onClick={() => void detail.refetch()}
        >
          {copy.retry}
        </button>
      ) : null}
      {needsPin && pinned.isError ? (
        <button
          type="button"
          style={buttonStyle}
          onClick={() => void pinned.refetch()}
        >
          {copy.retry}
        </button>
      ) : null}
      <label htmlFor={`${id}-version`} style={labelStyle}>
        {copy.version}
      </label>
      <select
        id={`${id}-version`}
        disabled={disabled || detail.isLoading || detail.isError}
        value={entry.versionId ?? ""}
        style={inputStyle}
        onChange={(event) => {
          const { versionId: _prior, ...rest } = entry;
          onChange({
            ...rest,
            ...(event.target.value ? { versionId: event.target.value } : {}),
          });
        }}
      >
        <option value="">
          {parentEntry?.versionId ? copy.inheritedVersion : copy.latest}
        </option>
        {entry.versionId && pinUnresolved ? (
          <option value={entry.versionId}>
            {badPin
              ? copy.unavailableVersion
              : pinLoading
                ? copy.loading
                : copy.version}
            : {entry.versionId}
          </option>
        ) : null}
        {versions.map((version) => (
          <option
            key={version.id}
            value={version.id}
            disabled={Boolean(
              parentEntry?.versionId && parentEntry.versionId !== version.id,
            )}
          >
            {copy.version} {version.versionNo}
          </option>
        ))}
      </select>
      <label
        style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8 }}
      >
        <input
          type="checkbox"
          checked={entry.activate ?? false}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...entry, activate: event.target.checked })
          }
        />
        {copy.activate}
      </label>
      <p style={hintStyle}>{copy.activateHint}</p>
    </article>
  );
}

const hintStyle: CSSProperties = {
  margin: 0,
  color: "var(--text-2)",
  fontSize: 12,
  lineHeight: 1.55,
};
const labelStyle: CSSProperties = {
  color: "var(--text)",
  fontSize: 12,
  fontWeight: 500,
};
const inputStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  padding: "8px 10px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--panel)",
  color: "var(--text)",
  fontSize: 12,
};
const buttonStyle: CSSProperties = {
  padding: "6px 10px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--panel)",
  color: "var(--text)",
  fontSize: 12,
  cursor: "pointer",
};
const linkStyle: CSSProperties = {
  color: "var(--signal)",
  fontSize: 12,
  textDecoration: "underline",
  textUnderlineOffset: 3,
};
