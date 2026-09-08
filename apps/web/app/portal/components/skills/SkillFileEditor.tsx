"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  SkillBundle,
  SkillDiagnostic,
  SkillFile,
} from "@agentic/contracts";
import { Button, MonacoEditor } from "@/app/portal/components";
import { ModalOverlay } from "@/app/portal/components/Modal";
import { useI18n } from "@/app/portal/lib/preferences-context";
import {
  checkEditorFiles,
  downloadSkillFile,
  readBrowserSkillFile,
  resolveSkillResourceLink,
  SkillEditorError,
  skillFileBytes,
} from "./editor-model";
import styles from "./skills.module.css";

const MARKDOWN_PLUGINS = [remarkGfm];
const PREVIEW_BYTES = 128 * 1024;
function editorLanguage(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase();
  return (
    (
      {
        md: "markdown",
        json: "json",
        yaml: "yaml",
        yml: "yaml",
        py: "python",
        js: "javascript",
        mjs: "javascript",
        ts: "typescript",
        html: "html",
        css: "css",
        sh: "shell",
      } as Record<string, string>
    )[extension ?? ""] ?? "plaintext"
  );
}

export function SkillFileEditor({
  bundle,
  onChange,
  onPendingChange,
  readOnly = false,
  diagnostics = [],
  validationCurrent = false,
}: {
  bundle: SkillBundle;
  onChange: (bundle: SkillBundle) => void;
  onPendingChange?: (pending: boolean) => void;
  readOnly?: boolean;
  diagnostics?: readonly SkillDiagnostic[];
  validationCurrent?: boolean;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState("SKILL.md");
  const [mode, setMode] = useState<"source" | "preview">("source");
  const [dialog, setDialog] = useState<"add" | "rename" | null>(null);
  const [newPath, setNewPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<SkillFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [editorReset, setEditorReset] = useState(0);
  const pendingImport = useRef<{
    finish: () => void;
  } | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const replace = useRef<HTMLInputElement>(null);
  const latest = useRef({ bundle, readOnly, onChange });
  useLayoutEffect(() => {
    latest.current = { bundle, readOnly, onChange };
  }, [bundle, readOnly, onChange]);
  useEffect(
    () => () => {
      const pending = pendingImport.current;
      pendingImport.current = null;
      pending?.finish();
    },
    [],
  );
  const current =
    bundle.files.find((file) => file.path === selected) ??
    bundle.files.find((file) => file.path === "SKILL.md") ??
    bundle.files[0];
  const bytes = useMemo(
    () => (current ? skillFileBytes(current) : new Uint8Array()),
    [current],
  );
  const markdown =
    current?.encoding === "utf8" && editorLanguage(current.path) === "markdown";

  function apply(files: SkillFile[]): boolean {
    if (latest.current.readOnly) return false;
    try {
      checkEditorFiles(files);
      const next = { files };
      latest.current.bundle = next;
      latest.current.onChange(next);
      setError(null);
      return true;
    } catch (cause) {
      setError(
        cause instanceof SkillEditorError
          ? t(`skills.editor.${cause.key}`)
          : String(cause),
      );
      return false;
    }
  }
  function editPath(event: FormEvent) {
    event.preventDefault();
    if (readOnly) return;
    const files =
      dialog === "rename"
        ? bundle.files.map((file) =>
            file.path === current?.path ? { ...file, path: newPath } : file,
          )
        : [
            ...bundle.files,
            { path: newPath, encoding: "utf8" as const, content: "" },
          ];
    if (apply(files)) {
      setSelected(newPath);
      setDialog(null);
    }
  }
  async function importFiles(files: File[], replacing = false) {
    if (latest.current.readOnly || pendingImport.current || !files.length)
      return;
    const replacement = replacing ? current : undefined;
    const pending = { finish: () => onPendingChange?.(false) };
    pendingImport.current = pending;
    onPendingChange?.(true);
    setUploading(true);
    setError(null);
    try {
      const additions = await Promise.all(
        files.map((file) =>
          readBrowserSkillFile(
            file,
            replacement ? replacement.path : file.name,
          ),
        ),
      );
      if (pendingImport.current !== pending) return;
      if (latest.current.readOnly) {
        setError(t("skills.editor.uploadInterrupted"));
        return;
      }
      // Do not overwrite an edit or revive a file removed while its replacement
      // was being read. Other concurrent file edits are merged, not discarded.
      const latestFiles = latest.current.bundle.files;
      if (replacement && !latestFiles.includes(replacement))
        throw new SkillEditorError("pathConflict");
      const next = replacement
        ? latestFiles.filter((file) => file !== replacement)
        : latestFiles;
      if (apply([...next, ...additions])) setSelected(additions[0]!.path);
    } catch (cause) {
      if (pendingImport.current !== pending) return;
      setError(
        cause instanceof SkillEditorError
          ? t(`skills.editor.${cause.key}`)
          : String(cause),
      );
    } finally {
      if (pendingImport.current === pending) {
        pendingImport.current = null;
        pending.finish();
        setUploading(false);
      }
    }
  }
  const sortedFiles = [...bundle.files].sort((a, b) =>
    a.path === "SKILL.md"
      ? -1
      : b.path === "SKILL.md"
        ? 1
        : a.path.localeCompare(b.path),
  );

  return (
    <div className={styles.fileWorkspace}>
      <nav className={styles.fileRail} aria-label={t("skills.editor.files")}>
        <div className={styles.railHeading}>
          {t("skills.editor.files")} <span>{bundle.files.length}</span>
        </div>
        <div className={styles.fileList}>
          {sortedFiles.map((file) => (
            <button
              type="button"
              className={styles.file}
              data-active={file.path === current?.path}
              key={file.path}
              onClick={() => {
                setSelected(file.path);
                setMode("source");
              }}
              aria-current={file.path === current?.path ? "true" : undefined}
            >
              <span className={styles.fileMark}>
                {file.path === "SKILL.md"
                  ? "MD"
                  : file.encoding === "base64"
                    ? "BIN"
                    : file.path.split(".").at(-1)?.slice(0, 3).toUpperCase()}
              </span>
              <span>{file.path}</span>
            </button>
          ))}
        </div>
        {!readOnly && (
          <div className={styles.railActions}>
            <Button
              small
              onClick={() => {
                setNewPath("references/");
                setError(null);
                setDialog("add");
              }}
            >
              {t("skills.editor.add")}
            </Button>
            <Button
              small
              disabled={uploading}
              onClick={() => upload.current?.click()}
            >
              {t("skills.editor.upload")}
            </Button>
            <input
              ref={upload}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                void importFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
          </div>
        )}
      </nav>
      <section
        className={styles.editorPane}
        aria-label={current?.path ?? t("skills.editor.instructions")}
      >
        <div className={styles.editorToolbar}>
          <code className={styles.fileTitle}>{current?.path}</code>
          {markdown && (
            <div
              className={styles.segmented}
              role="group"
              aria-label={t("skills.editor.preview")}
            >
              <button
                type="button"
                aria-pressed={mode === "source"}
                onClick={() => setMode("source")}
              >
                {t("skills.editor.source")}
              </button>
              <button
                type="button"
                aria-pressed={mode === "preview"}
                onClick={() => setMode("preview")}
              >
                {t("skills.editor.preview")}
              </button>
            </div>
          )}
          {current && (
            <Button
              small
              tone="ghost"
              onClick={() => downloadSkillFile(current)}
            >
              {t("skills.editor.download")}
            </Button>
          )}
          {!readOnly && current && (
            <>
              {current.path !== "SKILL.md" && (
                <Button
                  small
                  tone="ghost"
                  onClick={() => {
                    setNewPath(current.path);
                    setError(null);
                    setDialog("rename");
                  }}
                >
                  {t("skills.editor.rename")}
                </Button>
              )}
              <Button
                small
                tone="ghost"
                disabled={uploading}
                onClick={() => replace.current?.click()}
              >
                {t("skills.editor.replace")}
              </Button>
              {current.path !== "SKILL.md" && (
                <Button
                  small
                  tone="danger"
                  onClick={() => {
                    setRemoved(current);
                    apply(
                      bundle.files.filter((file) => file.path !== current.path),
                    );
                  }}
                >
                  {t("skills.editor.remove")}
                </Button>
              )}
            </>
          )}
          <input
            ref={replace}
            type="file"
            hidden
            onChange={(event) => {
              void importFiles(Array.from(event.target.files ?? []), true);
              event.target.value = "";
            }}
          />
        </div>
        {uploading && (
          <p role="status" className={styles.notice}>
            {t("skills.editor.uploading")}
          </p>
        )}
        {error && !dialog && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {removed && (
          <div className={styles.notice} role="status">
            {t("skills.editor.removed", { path: removed.path })}{" "}
            <Button
              small
              onClick={() => {
                if (apply([...bundle.files, removed])) setRemoved(null);
              }}
            >
              {t("skills.editor.undo")}
            </Button>
          </div>
        )}
        {!current ? (
          <p className={styles.empty}>{t("skills.editor.fileMissing")}</p>
        ) : current.encoding === "base64" ? (
          <div className={styles.binary}>
            <span className={styles.binaryLabel}>BIN</span>
            <h2>{t("skills.editor.binary")}</h2>
            <p>{t("skills.editor.binaryHint")}</p>
            <code>{t("skills.editor.size", { bytes: bytes.byteLength })}</code>
            <Button onClick={() => downloadSkillFile(current)}>
              {t("skills.editor.download")}
            </Button>
          </div>
        ) : markdown && mode === "preview" ? (
          <div className={`${styles.preview} factory-md`}>
            <p className={styles.hint}>{t("skills.editor.previewHint")}</p>
            {bytes.byteLength > PREVIEW_BYTES && (
              <p className={styles.notice}>{t("skills.previewLimit")}</p>
            )}
            <ReactMarkdown
              remarkPlugins={MARKDOWN_PLUGINS}
              skipHtml
              components={{
                img: ({ alt }) => (
                  <span>[{alt || t("skills.editor.binary")}]</span>
                ),
                a: ({ href, children }) => {
                  const relative = href
                    ? resolveSkillResourceLink(current.path, href)
                    : null;
                  if (
                    relative &&
                    bundle.files.some((file) => file.path === relative)
                  )
                    return (
                      <button
                        type="button"
                        className={styles.resourceLink}
                        onClick={() => {
                          setSelected(relative);
                          setMode("source");
                        }}
                      >
                        {children}
                      </button>
                    );
                  if (href && /^https?:\/\//i.test(href))
                    return (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {children}
                      </a>
                    );
                  return <span>{children}</span>;
                },
              }}
            >
              {new TextDecoder().decode(bytes.subarray(0, PREVIEW_BYTES))}
            </ReactMarkdown>
          </div>
        ) : (
          <MonacoEditor
            key={`${current.path}:${editorReset}`}
            value={current.content}
            language={editorLanguage(current.path)}
            height={520}
            readOnly={readOnly}
            onChange={(content) => {
              if (latest.current.readOnly) return;
              const files = latest.current.bundle.files;
              const edited = files.find((file) => file.path === current.path);
              if (
                !edited ||
                edited.encoding !== "utf8" ||
                edited.content === content
              )
                return;
              const accepted = apply(
                files.map((file) =>
                  file === edited ? { ...file, content } : file,
                ),
              );
              // Monaco already holds the proposed text when this callback
              // runs. A rejected edit leaves the controlled value unchanged,
              // so remount to show exactly the bytes the parent can save.
              if (!accepted) setEditorReset((value) => value + 1);
            }}
          />
        )}
        {current?.path.startsWith("scripts/") && (
          <p className={styles.notice}>{t("skills.editor.scriptNote")}</p>
        )}
      </section>
      <aside
        className={styles.validation}
        aria-label={t("skills.editor.diagnostics")}
      >
        <h2>{t("skills.editor.diagnostics")}</h2>
        {!validationCurrent && (
          <p className={styles.hint}>{t("skills.editor.unvalidated")}</p>
        )}
        {validationCurrent && !diagnostics.length && (
          <p className={styles.valid}>{t("skills.editor.clean")}</p>
        )}
        {diagnostics.map((issue, index) => (
          <button
            type="button"
            className={styles.issue}
            key={`${issue.code}-${index}`}
            data-severity={issue.severity}
            disabled={
              !issue.path ||
              !bundle.files.some((file) => file.path === issue.path)
            }
            onClick={() => {
              if (issue.path) {
                setSelected(issue.path);
                setMode("source");
              }
            }}
          >
            <code>
              {issue.path ?? "SKILL.md"}
              {issue.line ? `:${issue.line}` : ""}
            </code>
            <span>{issue.message}</span>
          </button>
        ))}
      </aside>
      {dialog && (
        <ModalOverlay
          onClose={() => setDialog(null)}
          ariaLabel={t(
            dialog === "add" ? "skills.editor.add" : "skills.editor.rename",
          )}
        >
          <form className={styles.dialog} onSubmit={editPath}>
            <h2>
              {t(
                dialog === "add" ? "skills.editor.add" : "skills.editor.rename",
              )}
            </h2>
            <label className={styles.label}>
              {t("skills.editor.path")}
              <input
                className={styles.control}
                data-autofocus="true"
                value={newPath}
                onChange={(event) => setNewPath(event.target.value)}
                maxLength={240}
                required
              />
            </label>
            <p className={styles.hint}>{t("skills.editor.pathHint")}</p>
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            <div className={styles.actions}>
              <Button onClick={() => setDialog(null)}>
                {t("skills.cancel")}
              </Button>
              <Button type="submit" tone="primary">
                {t(
                  dialog === "add"
                    ? "skills.editor.create"
                    : "skills.editor.applyRename",
                )}
              </Button>
            </div>
          </form>
        </ModalOverlay>
      )}
    </div>
  );
}
