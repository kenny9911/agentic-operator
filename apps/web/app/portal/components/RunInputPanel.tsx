"use client";

import { useId, type CSSProperties } from "react";
import {
  RUN_INPUT_MAX_ATTACHMENTS,
  RUN_INPUT_MAX_ATTACHMENT_TEXT_CHARS,
  RUN_INPUT_MAX_FILE_BYTES,
  RUN_INPUT_MAX_TEXT_CHARS,
  RUN_INPUT_MAX_TOTAL_CHARS,
} from "@agentic/contracts";
import { Button } from "./button";
import { useI18n } from "@/app/portal/lib/preferences-context";
import type { RunInputEditor } from "@/lib/hooks/useRunInput";
import { RUN_INPUT_FILE_ACCEPT } from "@/lib/run-input";

export function RunInputPanel({
  editor,
  disabled = false,
  hidePrompt = false,
}: {
  editor: RunInputEditor;
  disabled?: boolean;
  hidePrompt?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();

  return (
    <section aria-label={t("runInput.heading")} style={{ display: "grid", gap: 12, minWidth: 0 }}>
      {!hidePrompt ? (
        <label style={labelStyle}>
          {t("runInput.prompt")}
          <textarea
            value={editor.prompt}
            onChange={(event) => editor.setPrompt(event.target.value)}
            placeholder={t("runInput.promptPlaceholder")}
            maxLength={RUN_INPUT_MAX_TEXT_CHARS}
            rows={3}
            disabled={disabled}
            style={controlStyle}
          />
        </label>
      ) : null}
      <div style={{ display: "grid", gap: 7 }}>
        <label htmlFor={`${id}-files`} style={labelStyle}>{t("runInput.files")}</label>
        <p id={`${id}-files-help`} style={hintStyle}>{t("runInput.filesHint", {
          count: RUN_INPUT_MAX_ATTACHMENTS,
          sizeMiB: RUN_INPUT_MAX_FILE_BYTES / (1024 * 1024),
          attachmentChars: RUN_INPUT_MAX_ATTACHMENT_TEXT_CHARS.toLocaleString("en-US"),
          totalChars: RUN_INPUT_MAX_TOTAL_CHARS.toLocaleString("en-US"),
        })}</p>
        <input
          id={`${id}-files`}
          type="file"
          multiple
          accept={RUN_INPUT_FILE_ACCEPT}
          aria-describedby={`${id}-files-help`}
          disabled={disabled || editor.pending || editor.files.length >= RUN_INPUT_MAX_ATTACHMENTS}
          onChange={(event) => {
            const selected = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            void editor.addFiles(selected);
          }}
          style={{ ...controlStyle, fontSize: 12 }}
        />
        {editor.files.map((file) => (
          <div key={file.key} style={fileStyle}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
              <strong style={{ fontSize: 12, overflowWrap: "anywhere" }}>{file.file.name}</strong>
              <Button small tone="ghost" disabled={disabled}
                ariaLabel={t("runInput.removeFile", { name: file.file.name })}
                onClick={() => editor.removeFile(file.key)}>{t("runInput.remove")}</Button>
            </div>
            {file.parsed ? (
              <label style={labelStyle}>
                {t("runInput.reviewText")}
                <textarea
                  value={file.parsed.text}
                  onChange={(event) => editor.editFile(file.key, event.target.value)}
                  maxLength={RUN_INPUT_MAX_ATTACHMENT_TEXT_CHARS}
                  rows={5}
                  disabled={disabled}
                  style={controlStyle}
                />
              </label>
            ) : file.error ? (
              <>
                <p role="alert" style={{ ...hintStyle, color: "var(--red)" }}>{file.error}</p>
                <Button small disabled={disabled} onClick={() => void editor.retryFile(file)}>
                  {t("runInput.retry")}
                </Button>
              </>
            ) : (
              <p role="status" style={hintStyle}>{t("runInput.parsing")}</p>
            )}
          </div>
        ))}
        {editor.error ? <p role="alert" style={{ ...hintStyle, color: "var(--red)" }}>{editor.error}</p> : null}
      </div>
      <details>
        <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--text-2)" }}>{t("runInput.contextAndMemory")}</summary>
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          <label style={labelStyle}>
            {t("runInput.context")}
            <textarea
              value={editor.context}
              onChange={(event) => editor.setContext(event.target.value)}
              placeholder={t("runInput.contextPlaceholder")}
              rows={3}
              maxLength={RUN_INPUT_MAX_TEXT_CHARS}
              disabled={disabled}
              style={controlStyle}
            />
          </label>
          <label style={labelStyle}>
            {t("runInput.memorySession")}
            <input
              value={editor.contextKey}
              onChange={(event) => editor.setContextKey(event.target.value)}
              placeholder={t("runInput.memoryPlaceholder")}
              maxLength={160}
              disabled={disabled}
              aria-describedby={`${id}-memory-help`}
              style={controlStyle}
            />
          </label>
          <p id={`${id}-memory-help`} style={hintStyle}>{t("runInput.memoryHint")}</p>
        </div>
      </details>
    </section>
  );
}

const labelStyle: CSSProperties = { display: "grid", gap: 6, fontSize: 12, color: "var(--text-2)" };
const hintStyle: CSSProperties = { margin: 0, fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.5 };
const controlStyle: CSSProperties = {
  width: "100%", minWidth: 0, boxSizing: "border-box", padding: "8px 10px",
  border: "1px solid var(--border)", borderRadius: 5,
  color: "var(--text)", background: "var(--panel-2)", font: "inherit", fontSize: 12.5,
  lineHeight: 1.5, resize: "vertical",
};
const fileStyle: CSSProperties = {
  display: "grid", gap: 7, padding: 10, border: "1px solid var(--border)",
  borderRadius: 5, background: "var(--panel)",
};
