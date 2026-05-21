"use client";

/**
 * TenantTokenRevealModal — one-time bootstrap API token disclosure.
 *
 * Shown after `POST /v1/tenants` returns with `token.plaintext` set. The
 * operator must acknowledge they stored the token before the modal can be
 * dismissed; we never get a second chance to show it (server only persists
 * the hash). Mirrors the GitHub / Atlassian convention.
 *
 * Ported from `apps/web/public/portal/views/tenants.jsx` (TenantsTokenRevealModal).
 */

import { useState } from "react";
import { Button, Icon, ModalOverlay } from "@/app/portal/components";

export interface TenantTokenRevealPayload {
  slug: string;
  name: string;
  token: string;
  scopes: readonly string[];
}

export interface TenantTokenRevealModalProps {
  payload: TenantTokenRevealPayload;
  onClose: () => void;
}

export function TenantTokenRevealModal({
  payload,
  onClose,
}: TenantTokenRevealModalProps) {
  const [acked, setAcked] = useState(false);
  const [copied, setCopied] = useState(false);

  function copy() {
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(payload.token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  // Block dismissal until acked — the parent component should not call onClose
  // until acked anyway, but enforce it here too for direct ESC presses.
  function handleDismiss() {
    if (acked) onClose();
  }

  return (
    <ModalOverlay
      onClose={handleDismiss}
      ariaLabel={`Bootstrap token for ${payload.name}`}
    >
      <div
        style={{
          width: 560,
          maxWidth: "92vw",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--panel)",
          border: "1px solid var(--border-2)",
          borderRadius: 6,
          boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>
            Bootstrap token · {payload.name}
          </div>
          <button
            onClick={handleDismiss}
            style={{ color: "var(--text-3)" }}
            disabled={!acked}
            aria-label="Close"
          >
            <Icon name="x" size={12} />
          </button>
        </header>

        <div style={{ padding: "16px 18px", overflowY: "auto", flex: 1 }}>
          <div style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 12, lineHeight: 1.5 }}>
            This is the only time you&apos;ll see this token. Save it now. The hash is
            stored on the server; we cannot show the plaintext again.
          </div>
          <div
            style={{
              padding: 14,
              background: "var(--bg)",
              border: "1px solid var(--border-2)",
              borderRadius: 5,
              marginBottom: 10,
              fontFamily: "var(--mono)",
              fontSize: 12,
              wordBreak: "break-all",
              position: "relative",
              color: "var(--text)",
            }}
          >
            {payload.token}
            <button
              onClick={copy}
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                padding: "3px 8px",
                background: copied ? "var(--signal)" : "var(--panel-2)",
                color: copied ? "#000" : "var(--text-2)",
                border: "1px solid var(--border-2)",
                borderRadius: 4,
                fontSize: 10,
                fontFamily: "var(--mono)",
                cursor: "pointer",
              }}
            >
              {copied ? "COPIED" : "COPY"}
            </button>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>
            Scopes: {(payload.scopes || []).join(", ") || "(default)"}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 14 }}>
            Use it as:
            <pre
              style={{
                background: "var(--bg)",
                padding: 8,
                marginTop: 4,
                fontSize: 10.5,
                color: "var(--text-2)",
                overflow: "auto",
                borderRadius: 4,
              }}
            >{`curl -H "Authorization: Bearer ${payload.token}" \\
  http://localhost:3501/v1/agents`}</pre>
          </div>
        </div>

        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)" }}>
          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "var(--text-2)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={acked}
                onChange={(e) => setAcked(e.target.checked)}
              />
              I have stored this token securely
            </label>
            <Button tone="primary" disabled={!acked} onClick={onClose}>
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}
