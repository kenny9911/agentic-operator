"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";

/**
 * Modal — fixed full-screen backdrop with click-to-close.
 *
 * Ported from `workflows.jsx:983-998`, `agents.jsx:1116-1128`, etc. — these
 * were all duplicated in each view in v1_1. Backdrop is `rgba(0,0,0,0.5)`
 * with `backdrop-filter: blur(2px)` and `fadein 0.14s ease`.
 *
 * P2-FE-24 — accessibility:
 *   - Outer `<div>` carries `role="dialog"` + `aria-modal="true"`.
 *   - `ariaLabel` (or `ariaLabelledBy`) names the dialog so screen
 *     readers announce the modal correctly on open. Most callers pass
 *     a static title — see the per-modal wizards.
 *   - Escape closes the dialog (in addition to the click-outside path).
 *   - Focus is NOT auto-managed because every consumer wraps the body
 *     in its own form / wizard step that already manages tab order.
 *     Use `autoFocus` on the first interactive element inside.
 */
export function ModalOverlay({
  onClose,
  children,
  ariaLabel,
  ariaLabelledBy,
}: {
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
  ariaLabelledBy?: string;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: "var(--z-modal)" as unknown as number,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        backdropFilter: "blur(2px)",
        animation: "fadein 0.14s ease",
      }}
    >
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}
