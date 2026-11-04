"use client";

import {
  createContext,
  useContext,
  useEffect,
  type ComponentType,
} from "react";
import { useI18n } from "@/app/portal/lib/preferences-context";
import { ModalOverlay } from "./Modal";

const DialogCloseContext = createContext<(() => void) | null>(null);

/** Lightweight fallback shared by optional editors and settings sections. */
export function DeferredContentLoading() {
  const { t } = useI18n();
  return (
    <div
      role="status"
      aria-live="polite"
      style={{ padding: 24, color: "var(--text-2)" }}
    >
      {t("common.loading")}
    </div>
  );
}

/** Keep a dialog dismissible and keyboard-accessible while its chunk loads. */
export function DeferredDialogLoading() {
  const onClose = useContext(DialogCloseContext);
  const { t } = useI18n();
  if (!onClose) return <DeferredContentLoading />;
  return (
    <ModalOverlay onClose={onClose} ariaLabel={t("common.loading")}>
      <div
        style={{
          minWidth: 240,
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 8,
        }}
      >
        <DeferredContentLoading />
        <button
          type="button"
          onClick={onClose}
          style={{
            margin: "0 24px 20px",
            color: "var(--text)",
            padding: "6px 12px",
          }}
        >
          {t("importManifestModal.cancel")}
        </button>
      </div>
    </ModalOverlay>
  );
}

/**
 * The loading dialog is replaced by the real dialog after import. Preserve the
 * original opener across that replacement instead of restoring focus to a
 * loading button that has already unmounted.
 */
export function withDeferredDialog<Props extends { onClose: () => void }>(
  Component: ComponentType<Props>,
): ComponentType<Props> {
  return function DeferredDialog(props: Props) {
    useEffect(() => {
      const opener = document.activeElement;
      return () => {
        if (!(opener instanceof HTMLElement) || !opener.isConnected) return;
        const activeDialog = Array.from(
          document.querySelectorAll<HTMLElement>("[data-modal-dialog='true']"),
        ).at(-1);
        if (!activeDialog || activeDialog.contains(opener)) opener.focus();
      };
    }, []);
    return (
      <DialogCloseContext.Provider value={props.onClose}>
        <Component {...props} />
      </DialogCloseContext.Provider>
    );
  };
}
