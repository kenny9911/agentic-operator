"use client";

import type { ReactNode } from "react";

export function ModalOverlay({
  onClose,
  side,
  children,
}: {
  onClose: () => void;
  side?: "right";
  children: ReactNode;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        justifyContent: side === "right" ? "flex-end" : "center",
        alignItems: side === "right" ? "stretch" : "center",
        backdropFilter: "blur(2px)",
        animation: "fadein 0.14s ease",
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ display: "flex" }}>
        {children}
      </div>
    </div>
  );
}
