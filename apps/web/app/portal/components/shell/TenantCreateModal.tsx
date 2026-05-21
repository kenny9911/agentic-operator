"use client";

/**
 * TenantCreateModal — 4-step wizard for `POST /v1/tenants`.
 *
 * Steps: Identity → Template → Quotas → Review.
 *
 * Validates the slug client-side against the same regex and reserved-list
 * the server enforces (both exported from `@agentic/contracts`). On success
 * returns the unwrapped `TenantCreateResponse` envelope. The caller wires
 * the response into a token-reveal flow + navigates to the new tenant.
 *
 * Ported from `apps/web/public/portal/views/tenants.jsx` (TenantsCreateModal).
 */

import { useEffect, useState } from "react";
import {
  RESERVED_TENANT_SLUGS,
  TENANT_SLUG_REGEX,
  type TenantCreateBody,
  type TenantCreateResponse,
} from "@agentic/contracts";
import { Button, Icon, ModalOverlay } from "@/app/portal/components";
import type { TenantOption } from "./tenant-switcher";

const DEFAULT_COLORS = [
  "#d0ff00",
  "#7c9eff",
  "#f5c46b",
  "#65e0a3",
  "#b594ff",
  "#ff6470",
  "#5deeff",
  "#ffb547",
];

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

type StarterKind = "empty" | "hello" | "copy-from";

export interface TenantCreateModalProps {
  onClose: () => void;
  onCreated: (created: TenantCreateResponse) => void;
  existingSlugs: Set<string>;
  existingTenants: TenantOption[];
}

export function TenantCreateModal({
  onClose,
  onCreated,
  existingSlugs,
  existingTenants,
}: TenantCreateModalProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugDirty, setSlugDirty] = useState(false);
  const [subtitle, setSubtitle] = useState("");
  const [color, setColor] = useState<string>(DEFAULT_COLORS[0]!);

  const [starter, setStarter] = useState<StarterKind>("hello");
  const [copyFromSlug, setCopyFromSlug] = useState("");

  const [tokenCap, setTokenCap] = useState("");
  const [usdCap, setUsdCap] = useState("");
  const [mintToken, setMintToken] = useState(true);

  // Auto-derive slug from name until the user edits the slug field.
  useEffect(() => {
    if (slugDirty) return;
    const derived = name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/^[^a-z]/, "t");
    setSlug(derived.slice(0, 32));
  }, [name, slugDirty]);

  const slugIssues = computeSlugIssues(slug, existingSlugs);
  const canNextFrom1 = name.trim().length > 0 && slugIssues.length === 0;
  const canNextFrom2 = starter !== "copy-from" || copyFromSlug.length > 0;
  const canNextFrom3 = true;
  const colorValid = HEX_COLOR_RE.test(color);

  async function submit() {
    if (!colorValid) {
      setErr("Color must be a 6-digit hex like #d0ff00");
      return;
    }
    setSubmitting(true);
    setErr(null);

    const body: TenantCreateBody = {
      slug,
      name: name.trim(),
      subtitle: subtitle.trim() || undefined,
      color,
      starter:
        starter === "copy-from"
          ? (`copy-from:${copyFromSlug}` as `copy-from:${string}`)
          : starter,
      mintToken,
      budget: {
        monthlyTokenCap: tokenCap === "" ? null : Number(tokenCap),
        monthlyUsdCap: usdCap === "" ? null : Math.round(Number(usdCap) * 100),
      },
    };
    try {
      const idemKey = `ten-${slug}-${Date.now().toString(36)}`;
      const res = await fetch("/v1/tenants", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "idempotency-key": idemKey,
        },
        body: JSON.stringify(body),
      });
      const raw: unknown = await res.json().catch(() => ({}));
      if (!res.ok || isErrorEnvelope(raw)) {
        setErr(extractError(raw, `HTTP ${res.status}`));
        return;
      }
      const data = unwrapData<TenantCreateResponse>(raw);
      onCreated(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalOverlay onClose={onClose} ariaLabel={`New tenant · step ${step} of 4`}>
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
            New tenant · Step {step} of 4
          </div>
          <button onClick={onClose} style={{ color: "var(--text-3)" }} aria-label="Close">
            <Icon name="x" size={12} />
          </button>
        </header>

        <div style={{ padding: "16px 18px", overflowY: "auto", flex: 1 }}>
          {err && (
            <div
              style={{
                padding: "8px 12px",
                marginBottom: 12,
                background: "rgba(255,100,112,0.08)",
                border: "1px solid rgba(255,100,112,0.3)",
                borderRadius: 4,
                color: "var(--red)",
                fontSize: 12,
              }}
            >
              {err}
            </div>
          )}

          {step === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Field label="Display name" hint="Shown in the sidebar switcher and tenant lists.">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Acme Recruiting"
                  style={inputStyle()}
                />
              </Field>
              <Field
                label="Slug"
                hint="Immutable. Used in URLs, log paths, and Inngest function IDs. [a-z][a-z0-9-]{1,31}"
                error={slugDirty && slugIssues.length > 0 ? slugIssues.join("; ") : null}
              >
                <input
                  value={slug}
                  onChange={(e) => {
                    setSlug(e.target.value.toLowerCase());
                    setSlugDirty(true);
                  }}
                  placeholder="acme"
                  style={{ ...inputStyle(), fontFamily: "var(--mono)" }}
                />
              </Field>
              <Field label="Subtitle" hint="Optional short description shown under the name.">
                <input
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder="Recruitment-as-a-Service · Asia-Pac"
                  style={inputStyle()}
                />
              </Field>
              <Field label="Accent color" hint="Used for the tenant avatar and accent strokes.">
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {DEFAULT_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 5,
                        background: c,
                        border:
                          color === c
                            ? "2px solid var(--text)"
                            : "1px solid var(--border-2)",
                        cursor: "pointer",
                      }}
                      title={c}
                      aria-label={`Color ${c}`}
                    />
                  ))}
                  <input
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    style={{
                      ...inputStyle(),
                      width: 110,
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                    }}
                  />
                </div>
              </Field>
            </div>
          )}

          {step === 2 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Field
                label="Starter content"
                hint="Seed the new tenant with sample events / a cloned manifest, or start empty."
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <RadioRow
                    checked={starter === "empty"}
                    onChange={() => setStarter("empty")}
                    title="Empty"
                    body="Just the tenant row and a default budget. You'll deploy a workflow later via PUT /v1/tenants/:slug/workflow."
                  />
                  <RadioRow
                    checked={starter === "hello"}
                    onChange={() => setStarter("hello")}
                    title="Hello (recommended)"
                    body="Seeds TENANT_BOOTSTRAPPED + HELLO_WORLD event types so the dashboard isn't blank."
                  />
                  <RadioRow
                    checked={starter === "copy-from"}
                    onChange={() => setStarter("copy-from")}
                    title="Copy from existing tenant"
                    body="Clone the live manifest, event types, and entity types from another tenant."
                  />
                </div>
                {starter === "copy-from" && (
                  <select
                    value={copyFromSlug}
                    onChange={(e) => setCopyFromSlug(e.target.value)}
                    style={{ ...inputStyle(), marginTop: 10 }}
                  >
                    <option value="">— pick a source tenant —</option>
                    {existingTenants.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.id})
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
          )}

          {step === 3 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Field
                label="Monthly token cap"
                hint="Hard limit on input+output tokens charged through the LLM gateway. Empty = unlimited."
              >
                <input
                  value={tokenCap}
                  type="number"
                  min="0"
                  onChange={(e) => setTokenCap(e.target.value)}
                  placeholder="e.g. 50000000"
                  style={{ ...inputStyle(), fontFamily: "var(--mono)" }}
                />
              </Field>
              <Field
                label="Monthly USD cap"
                hint="Stored as integer cents. Empty = unlimited."
              >
                <input
                  value={usdCap}
                  type="number"
                  min="0"
                  step="0.01"
                  onChange={(e) => setUsdCap(e.target.value)}
                  placeholder="e.g. 500.00"
                  style={{ ...inputStyle(), fontFamily: "var(--mono)" }}
                />
              </Field>
              <Field
                label="API token"
                hint="Issue a bootstrap token in the response. You can revoke it later from Settings → API keys."
              >
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12,
                    color: "var(--text-2)",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={mintToken}
                    onChange={(e) => setMintToken(e.target.checked)}
                  />
                  Mint a bootstrap token now (shown ONCE)
                </label>
              </Field>
            </div>
          )}

          {step === 4 && (
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontFamily: "var(--mono)",
                  color: "var(--text-3)",
                  marginBottom: 8,
                }}
              >
                REVIEW
              </div>
              <div
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  padding: 14,
                  fontFamily: "var(--mono)",
                  fontSize: 12,
                  color: "var(--text-2)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <KvRow k="name" v={name} />
                <KvRow k="slug" v={slug} />
                <KvRow k="subtitle" v={subtitle || "(none)"} />
                <KvRow k="color" v={color} />
                <KvRow
                  k="starter"
                  v={starter === "copy-from" ? `copy-from:${copyFromSlug}` : starter}
                />
                <KvRow k="monthly_token_cap" v={tokenCap === "" ? "unlimited" : tokenCap} />
                <KvRow k="monthly_usd_cap" v={usdCap === "" ? "unlimited" : `$${usdCap}`} />
                <KvRow k="mint_bootstrap_token" v={mintToken ? "yes" : "no"} />
              </div>
              <div style={{ marginTop: 14, fontSize: 11.5, color: "var(--text-3)" }}>
                Provisioning runs in a single DB transaction. On success you&apos;ll
                receive the bootstrap token (if requested) and the new tenant will
                appear in the sidebar.
              </div>
            </div>
          )}
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
            <div style={{ fontSize: 11, color: "var(--text-3)" }}>
              {step === 1 && "Identity"}
              {step === 2 && "Template"}
              {step === 3 && "Quotas & budget"}
              {step === 4 && "Review & create"}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {step > 1 && (
                <Button tone="ghost" onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3 | 4)}>
                  Back
                </Button>
              )}
              {step < 4 && (
                <Button
                  tone="primary"
                  disabled={
                    (step === 1 && !canNextFrom1) ||
                    (step === 2 && !canNextFrom2) ||
                    (step === 3 && !canNextFrom3)
                  }
                  onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3 | 4)}
                >
                  Next
                </Button>
              )}
              {step === 4 && (
                <Button
                  tone="primary"
                  onClick={submit}
                  disabled={submitting || !colorValid}
                >
                  {submitting ? "Provisioning…" : "Create tenant"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

function computeSlugIssues(slug: string, existingSlugs: Set<string>): string[] {
  const issues: string[] = [];
  if (!slug) {
    issues.push("required");
    return issues;
  }
  if (!TENANT_SLUG_REGEX.test(slug)) {
    issues.push("must start with a lowercase letter and contain only [a-z0-9-]");
  }
  if (RESERVED_TENANT_SLUGS.has(slug)) issues.push("reserved");
  if (slug.startsWith("_") || slug.startsWith("-") || slug.endsWith("-")) {
    issues.push("cannot start/end with - or _");
  }
  if (existingSlugs.has(slug)) issues.push("already taken");
  return issues;
}

function unwrapData<T>(body: unknown): T {
  if (
    body !== null &&
    typeof body === "object" &&
    (body as { data?: unknown }).data !== undefined
  ) {
    return (body as { data: T }).data;
  }
  return body as T;
}

function isErrorEnvelope(body: unknown): boolean {
  return (
    body !== null &&
    typeof body === "object" &&
    (body as { ok?: unknown }).ok === false
  );
}

function extractError(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    const err = obj.error;
    if (err && typeof err === "object") {
      const e = err as { message?: unknown; code?: unknown };
      if (typeof e.message === "string") return e.message;
      if (typeof e.code === "string") return e.code;
    }
    if (typeof obj.message === "string") return obj.message;
  }
  return fallback;
}

function inputStyle() {
  return {
    padding: "7px 10px",
    background: "var(--bg)",
    border: "1px solid var(--border-2)",
    borderRadius: 4,
    color: "var(--text)",
    fontSize: 13,
    fontFamily: "var(--sans)",
    width: "100%",
    outline: "none" as const,
  };
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div
        style={{
          fontSize: 11,
          fontFamily: "var(--mono)",
          color: "var(--text-3)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {label}
      </div>
      {children}
      {error && <div style={{ fontSize: 11, color: "var(--red)" }}>{error}</div>}
      {hint && !error && (
        <div style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.4 }}>{hint}</div>
      )}
    </div>
  );
}

function RadioRow({
  checked,
  onChange,
  title,
  body,
}: {
  checked: boolean;
  onChange: () => void;
  title: string;
  body: string;
}) {
  return (
    <button
      onClick={onChange}
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        padding: 10,
        textAlign: "left",
        width: "100%",
        background: checked ? "var(--panel-2)" : "transparent",
        border: `1px solid ${checked ? "var(--signal)" : "var(--border-2)"}`,
        borderRadius: 5,
        cursor: "pointer",
      }}
    >
      <div
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          border: `2px solid ${checked ? "var(--signal)" : "var(--border-3)"}`,
          background: checked ? "var(--signal)" : "transparent",
          flexShrink: 0,
          marginTop: 2,
        }}
      />
      <div>
        <div style={{ fontSize: 13, color: "var(--text)" }}>{title}</div>
        <div
          style={{
            fontSize: 11.5,
            color: "var(--text-3)",
            marginTop: 2,
            lineHeight: 1.45,
          }}
        >
          {body}
        </div>
      </div>
    </button>
  );
}

function KvRow({ k, v }: { k: string; v: string | number | boolean }) {
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <div style={{ color: "var(--text-3)", width: 180, flexShrink: 0 }}>{k}</div>
      <div style={{ color: "var(--text)" }}>{String(v)}</div>
    </div>
  );
}
