"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
} from "react";
import {
  SKILL_BUNDLE_LIMITS,
  type SkillBundle,
  type SkillDetail,
  type SkillDiagnostic,
} from "@agentic/contracts";
import { Button } from "@/app/portal/components";
import { ModalOverlay } from "@/app/portal/components/Modal";
import { useI18n } from "@/app/portal/lib/preferences-context";
import { useTenant } from "@/app/portal/lib/use-tenant";
import { useIsSuperadmin } from "@/lib/hooks/useMe";
import { skillApi } from "@/lib/hooks/useSkills";
import { formatApiError } from "@/lib/api-response";
import { SkillFileEditor } from "./SkillFileEditor";
import { SkillModelPicker } from "./SkillModelPicker";
import {
  submitSkillCreateRequest,
  type SkillCreateMode,
} from "./create-request";
import {
  encodeBrowserBytes,
  readBrowserSkillFolder,
  SkillEditorError,
} from "./editor-model";
import styles from "./skills.module.css";

export type { SkillCreateMode } from "./create-request";

interface CreateSkillDialogProps {
  mode: SkillCreateMode;
  onClose: () => void;
  onComplete: (detail: SkillDetail) => void;
  existing?: { id: string; revision: number };
  initialBundle?: SkillBundle;
}

export function CreateSkillDialog(props: CreateSkillDialogProps) {
  const tenant = useTenant();
  // Tenant navigation remounts the dialog and aborts its old request lifecycle.
  return <TenantCreateSkillDialog key={tenant} tenant={tenant} {...props} />;
}

function TenantCreateSkillDialog({
  mode,
  onClose,
  onComplete,
  existing,
  initialBundle,
  tenant,
}: CreateSkillDialogProps & { tenant: string }) {
  const { t } = useI18n();
  const superadmin = useIsSuperadmin();
  const [purpose, setPurpose] = useState("");
  const [examples, setExamples] = useState("");
  const [name, setName] = useState("");
  const [modelRoute, setModelRoute] = useState("");
  const [visibility, setVisibility] = useState<"tenant" | "shared">("tenant");
  const [bundle, setBundle] = useState<SkillBundle | undefined>(initialBundle);
  const [validation, setValidation] = useState<{
    bundle: SkillBundle;
    diagnostics: SkillDiagnostic[];
  }>();
  const [busy, setBusy] = useState(false);
  const [cancelEnabled, setCancelEnabled] = useState(false);
  const [pendingFiles, setPendingFiles] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      const controller = active.current;
      active.current = null;
      controller?.abort();
    },
    [],
  );
  const title = t(`skills.${mode === "revision" ? "revision" : mode}`);

  function dismiss() {
    if (pendingFiles) return;
    if (busy) {
      if (cancelEnabled) active.current?.abort();
      return;
    }
    onClose();
  }
  async function readImport(files: File[], folder = false) {
    if (!files.length || busy || pendingFiles) return;
    setCancelEnabled(true);
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(null);
    try {
      let source: Parameters<typeof skillApi.preview>[0];
      if (folder)
        source = {
          format: "bundle",
          bundle: await readBrowserSkillFolder(files),
        };
      else {
        const file = files[0]!;
        if (file.size > SKILL_BUNDLE_LIMITS.maxArchiveBytes)
          throw new SkillEditorError("fileLimit");
        const bytes = new Uint8Array(await file.arrayBuffer());
        source = file.name.toLowerCase().endsWith(".zip")
          ? { format: "zip", archiveBase64: encodeBrowserBytes(bytes) }
          : {
              format: "markdown",
              content: new TextDecoder("utf-8", {
                fatal: true,
                ignoreBOM: true,
              }).decode(bytes),
            };
      }
      if (controller.signal.aborted) return;
      const preview = await skillApi.preview(source, controller.signal, tenant);
      if (controller.signal.aborted) return;
      setBundle(preview.bundle);
      setValidation({
        bundle: preview.bundle,
        diagnostics: preview.diagnostics,
      });
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof SkillEditorError
            ? t(`skills.editor.${cause.key}`)
            : formatApiError(cause, t),
        );
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || pendingFiles) return;
    setCancelEnabled(mode === "describe" || mode === "revision");
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(null);
    try {
      const detail = await submitSkillCreateRequest(
        {
          tenant,
          mode,
          purpose,
          examples,
          name,
          modelRoute,
          visibility,
          bundle,
          existing,
        },
        controller.signal,
        setValidation,
      );
      if (detail && active.current === controller && !controller.signal.aborted)
        onComplete(detail);
    } catch (cause) {
      if (active.current === controller)
        setError(
          controller.signal.aborted
            ? t("skills.generationCancel")
            : formatApiError(cause, t),
        );
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <ModalOverlay ariaLabel={title} onClose={dismiss}>
      <div className={`${styles.dialog} ${bundle ? styles.wideDialog : ""}`}>
        <h2>{title}</h2>
        <form onSubmit={(event) => void submit(event)}>
          {mode === "import" ? (
            <>
              <p className={styles.hint}>{t("skills.importHint")}</p>
              <div className={styles.actions}>
                <Button
                  disabled={busy || pendingFiles}
                  onClick={() => importInput.current?.click()}
                >
                  {t("skills.chooseImport")}
                </Button>
                <Button
                  disabled={busy || pendingFiles}
                  onClick={() => folderInput.current?.click()}
                >
                  {t("skills.chooseFolder")}
                </Button>
              </div>
              <input
                hidden
                type="file"
                accept=".zip,.md,.markdown"
                ref={importInput}
                onChange={(event) => {
                  void readImport(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
              <input
                hidden
                type="file"
                multiple
                {...({
                  webkitdirectory: "",
                } as InputHTMLAttributes<HTMLInputElement>)}
                ref={folderInput}
                onChange={(event) => {
                  void readImport(Array.from(event.target.files ?? []), true);
                  event.target.value = "";
                }}
              />
            </>
          ) : (
            <>
              {mode === "blank" && (
                <label className={styles.label}>
                  {t("skills.name")}
                  <input
                    className={styles.control}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    maxLength={64}
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    disabled={busy || pendingFiles}
                    autoFocus
                  />
                  <span className={styles.hint}>{t("skills.nameHint")}</span>
                </label>
              )}
              <label className={styles.label}>
                {t("skills.purpose")}
                <textarea
                  className={styles.control}
                  rows={5}
                  value={purpose}
                  onChange={(event) => setPurpose(event.target.value)}
                  placeholder={t("skills.purposePlaceholder")}
                  required
                  maxLength={mode === "blank" ? 1024 : 16000}
                  disabled={busy || pendingFiles}
                  autoFocus={mode !== "blank"}
                />
              </label>
              {mode !== "blank" && (
                <>
                  <label className={styles.label}>
                    {t("skills.examples")}
                    <textarea
                      className={styles.control}
                      rows={3}
                      value={examples}
                      onChange={(event) => setExamples(event.target.value)}
                      maxLength={40000}
                      disabled={busy || pendingFiles}
                    />
                  </label>
                  <SkillModelPicker
                    purpose="creation"
                    value={modelRoute}
                    onChange={setModelRoute}
                    disabled={busy || pendingFiles}
                  />
                </>
              )}
            </>
          )}
          {superadmin && !existing && (
            <label className={styles.label}>
              {t("skills.visibility")}
              <select
                className={styles.control}
                value={visibility}
                disabled={busy || pendingFiles}
                onChange={(event) =>
                  setVisibility(event.target.value as "tenant" | "shared")
                }
              >
                <option value="tenant">{t("skills.owned")}</option>
                <option value="shared">{t("skills.shared")}</option>
              </select>
              {visibility === "shared" && (
                <span className={styles.hint}>{t("skills.sharedHint")}</span>
              )}
            </label>
          )}
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <Button
              onClick={dismiss}
              disabled={pendingFiles || (busy && !cancelEnabled)}
            >
              {t(busy && cancelEnabled ? "skills.cancel" : "skills.close")}
            </Button>
            <Button
              type="submit"
              tone="primary"
              disabled={busy || pendingFiles || (mode === "import" && !bundle)}
            >
              {t(
                busy
                  ? mode === "import"
                    ? "skills.importing"
                    : mode === "revision"
                      ? "skills.revising"
                      : "skills.generating"
                  : mode === "import"
                    ? "skills.importConfirm"
                    : mode === "revision"
                      ? "skills.revise"
                      : "skills.generate",
              )}
            </Button>
          </div>
          {busy && (
            <p role="status" className={styles.hint}>
              {t(
                mode === "import"
                  ? "skills.importing"
                  : mode === "revision"
                    ? "skills.revising"
                    : "skills.generating",
              )}
            </p>
          )}
        </form>
        {bundle && (
          <div style={{ marginTop: 20 }}>
            <SkillFileEditor
              bundle={bundle}
              onChange={setBundle}
              readOnly={busy}
              onPendingChange={setPendingFiles}
              diagnostics={validation?.diagnostics}
              validationCurrent={validation?.bundle === bundle}
            />
          </div>
        )}
      </div>
    </ModalOverlay>
  );
}
