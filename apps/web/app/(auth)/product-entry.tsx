"use client";

import { useEffect, useRef, useState } from "react";
import {
  PreferencesProvider,
  useI18n,
} from "@/app/portal/lib/preferences-context";
import { AuthFormInner } from "./auth-form";

/** The product's own origin owns the dialog and its HttpOnly account cookie. */
export function ProductEntry({ authMode }: { authMode: "accounts" | "local" }) {
  return (
    <PreferencesProvider>
      <ProductEntryInner authMode={authMode} />
    </PreferencesProvider>
  );
}

function ProductEntryInner({ authMode }: { authMode: "accounts" | "local" }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const enter = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      element.querySelector<HTMLInputElement>("input")?.focus();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  function close() {
    dialog.current?.close();
    setOpen(false);
    enter.current?.focus();
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "var(--bg)",
        color: "var(--text)",
      }}
    >
      <section style={{ maxWidth: 560, textAlign: "center" }}>
        <p
          style={{
            color: "var(--accent-text)",
            fontSize: 12,
            letterSpacing: ".16em",
            textTransform: "uppercase",
          }}
        >
          OntoPlanet
        </p>
        <h1
          style={{
            fontFamily: "var(--display)",
            fontSize: "clamp(48px, 9vw, 80px)",
            fontWeight: 400,
            margin: "14px 0",
          }}
        >
          Agent OS
        </h1>
        <p
          style={{
            color: "var(--text-2)",
            fontSize: 16,
            lineHeight: 1.7,
            margin: "0 0 28px",
          }}
        >
          {t("auth.productEntryDescription")}
        </p>
        <button
          ref={enter}
          type="button"
          onClick={() => setOpen(true)}
          style={{
            border: 0,
            borderRadius: 8,
            padding: "13px 24px",
            background: "var(--signal)",
            color: "var(--on-signal)",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {t("auth.enterProduct")}
        </button>
      </section>
      <dialog
        ref={dialog}
        className="account-entry-dialog"
        aria-label={t("auth.accountDialog")}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClose={() => {
          setOpen(false);
          enter.current?.focus();
        }}
      >
        <AuthFormInner
          initialMode="signin"
          authMode={authMode}
          presentation="modal"
          onClose={close}
        />
      </dialog>
    </main>
  );
}
