"use client";

/**
 * AuthForm (P6-AUTH) — the sign-in / sign-up card.
 *
 * Lives outside /portal, so it mounts its own PreferencesProvider to get
 * i18n + theme (the portal's provider isn't an ancestor here). Submits
 * straight to the api (`/v1/auth/{login,register}`) through the Next `/v1/*`
 * rewrite so the Set-Cookie lands same-origin; on success it hard-navigates
 * to the portal (or the `?return=` path).
 */

import { useId, useState, type FormEvent } from "react";
import {
  PreferencesProvider,
  useI18n,
} from "@/app/portal/lib/preferences-context";
import { LanguageToggle } from "@/app/portal/components/shell/appearance-controls";
import { ApiResponseError, readApiData } from "@/lib/api-response";

interface AuthResult {
  tenant?: unknown;
  memberships?: Array<{ tenantSlug?: unknown }>;
}

function tenantFromAuthResult(result: AuthResult): string | null {
  const candidate =
    typeof result.tenant === "string"
      ? result.tenant
      : result.memberships?.[0]?.tenantSlug;
  return typeof candidate === "string" && /^[a-z0-9_-]{1,64}$/i.test(candidate)
    ? candidate
    : null;
}

export function AuthForm({
  initialMode,
  authMode,
}: {
  initialMode: "signin" | "signup";
  authMode: "accounts" | "local";
}) {
  return (
    <PreferencesProvider>
      <AuthFormInner initialMode={initialMode} authMode={authMode} />
    </PreferencesProvider>
  );
}

function mapError(code: string | undefined, t: (k: string) => string): string {
  switch (code) {
    case "invalid_credentials":
      return t("auth.invalidCredentials");
    case "account_pending":
      return t("auth.accountPending");
    case "account_rejected":
      return t("auth.accountRejected");
    case "account_paused":
      return t("auth.accountPaused");
    case "product_access_required":
      return t("auth.productAccessRequired");
    case "username_taken":
      return t("auth.usernameTaken");
    case "account_authority_unavailable":
      return t("auth.authorityUnavailable");
    case "email_taken":
      return t("auth.emailTaken");
    default:
      return t("auth.genericError");
  }
}

export function AuthFormInner({
  initialMode,
  authMode,
  presentation = "page",
  onClose,
}: {
  initialMode: "signin" | "signup";
  authMode: "accounts" | "local";
  presentation?: "page" | "modal";
  onClose?: () => void;
}) {
  const accounts = authMode === "accounts";
  const modal = presentation === "modal";
  const { t } = useI18n();
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const isSignup = mode === "signup";
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [pending, setPending] = useState(false);
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Toggle between sign-in and register in place (no navigation) so the login
  // screen itself can register. Also keeps the URL in sync for shareability.
  function switchMode() {
    const next = isSignup ? "signin" : "signup";
    setMode(next);
    setPending(false);
    setError(null);
    setPassword("");
    if (!modal && typeof window !== "undefined") {
      window.history.replaceState(
        null,
        "",
        next === "signup" ? "/sign-up" : "/sign-in",
      );
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (
      accounts &&
      !/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username.trim().toLowerCase())
    ) {
      setError(t("auth.usernameHint"));
      return;
    }
    if (
      accounts &&
      isSignup &&
      ([...password].length < 15 ||
        new TextEncoder().encode(password).length > 72)
    ) {
      setError(t("auth.accountPasswordHint"));
      return;
    }
    if (!accounts && isSignup && password.length < 8) {
      setError(t("auth.passwordMin"));
      return;
    }
    setBusy(true);
    try {
      const path = isSignup ? "/v1/auth/register" : "/v1/auth/login";
      const body = accounts
        ? {
            username: username.trim(),
            password,
            ...(!isSignup ? { rememberMe } : {}),
            ...(isSignup && name.trim() ? { displayName: name.trim() } : {}),
          }
        : isSignup
          ? { email, password, name }
          : { email, password };
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      const result = await readApiData<AuthResult>(res, path);
      if (accounts && isSignup) {
        setPending(true);
        setPassword("");
        setBusy(false);
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const requested = params.get("return");
      const authenticatedTenant = tenantFromAuthResult(result);
      let destination = authenticatedTenant
        ? `/portal/${encodeURIComponent(authenticatedTenant)}/dashboard`
        : "/portal";
      if (
        requested?.startsWith("/") &&
        !requested.startsWith("//") &&
        !requested.includes("\\")
      ) {
        try {
          const resolved = new URL(requested, window.location.origin);
          if (resolved.origin === window.location.origin) {
            destination = `${resolved.pathname}${resolved.search}${resolved.hash}`;
          }
        } catch {
          // Malformed return targets fall back to the tenant portal.
        }
      }
      window.location.href = destination;
    } catch (cause) {
      setError(
        cause instanceof ApiResponseError
          ? mapError(cause.code, t)
          : t("auth.genericError"),
      );
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: modal ? undefined : "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        padding: modal ? 0 : 20,
      }}
    >
      {!modal ? (
        <div
          style={{
            position: "fixed",
            top: 20,
            right: 20,
            zIndex: 1,
          }}
        >
          <LanguageToggle />
        </div>
      ) : null}
      <div
        style={{
          width: modal ? "100%" : 380,
          maxWidth: "100%",
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 28,
        }}
      >
        {modal ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 22,
            }}
          >
            <LanguageToggle />
            <button
              type="button"
              onClick={onClose}
              aria-label={t("auth.closeDialog")}
              style={{
                width: 32,
                height: 32,
                display: "grid",
                placeItems: "center",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--panel-2)",
                color: "var(--text-2)",
                cursor: "pointer",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        ) : null}
        <h1
          style={{
            margin: 0,
            fontSize: 24,
            fontFamily: "var(--display)",
            fontWeight: 400,
            color: "var(--text)",
          }}
        >
          {t(isSignup ? "auth.signUpTitle" : "auth.signInTitle")}
        </h1>
        <p
          style={{
            marginTop: 6,
            marginBottom: 20,
            fontSize: 12.5,
            color: "var(--text-3)",
          }}
        >
          {t(
            accounts
              ? "auth.suiteAccountSubtitle"
              : isSignup
                ? "auth.signUpSubtitle"
                : "auth.signInSubtitle",
          )}
        </p>

        {pending ? (
          <p role="status" style={{ color: "var(--text-2)", lineHeight: 1.6 }}>
            {t("auth.registrationPending")}
          </p>
        ) : null}
        <form
          autoComplete="on"
          hidden={pending}
          onSubmit={onSubmit}
          style={{
            display: pending ? "none" : "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {isSignup ? (
            <Field
              label={t("auth.name")}
              value={name}
              onChange={setName}
              type="text"
              autoComplete="name"
              required={!accounts}
            />
          ) : null}
          <Field
            label={t(accounts ? "auth.username" : "auth.email")}
            value={accounts ? username : email}
            onChange={accounts ? setUsername : setEmail}
            type={accounts ? "text" : "email"}
            autoComplete="username"
            required
          />
          <Field
            label={t("auth.password")}
            value={password}
            onChange={setPassword}
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            required
            revealLabels={{
              show: t("auth.showPassword"),
              hide: t("auth.hidePassword"),
            }}
          />

          {accounts && !isSignup ? (
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                fontSize: 13,
                color: "var(--text-2)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                name="rememberMe"
                checked={rememberMe}
                onChange={(event) => setRememberMe(event.target.checked)}
                style={{ accentColor: "var(--signal)", width: 16, height: 16 }}
              />
              {t("auth.rememberMe")}
            </label>
          ) : null}

          {accounts && isSignup ? (
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-3)" }}>
              {t("auth.accountPasswordHint")}
            </p>
          ) : null}
          {error ? (
            <div
              role="alert"
              style={{
                fontSize: 12,
                color: "var(--red)",
                background: "color-mix(in srgb, var(--red) 10%, transparent)",
                border:
                  "1px solid color-mix(in srgb, var(--red) 30%, transparent)",
                borderRadius: 6,
                padding: "8px 10px",
              }}
            >
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            style={{
              marginTop: 4,
              padding: "10px 12px",
              background: "var(--signal)",
              color: "var(--on-signal)",
              border: "none",
              borderRadius: 7,
              fontSize: 13,
              fontWeight: 600,
              cursor: busy ? "wait" : "pointer",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy
              ? t(isSignup ? "auth.signingUp" : "auth.signingIn")
              : t(isSignup ? "auth.signUp" : "auth.signIn")}
          </button>
        </form>

        <div
          style={{
            marginTop: 18,
            fontSize: 12,
            color: "var(--text-3)",
            textAlign: "center",
          }}
        >
          {t(isSignup ? "auth.haveAccount" : "auth.noAccount")}{" "}
          <button
            type="button"
            onClick={switchMode}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              color: "var(--accent-text)",
              fontSize: 12,
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            {t(isSignup ? "auth.signInLink" : "auth.signUpLink")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Text input, with an optional reveal toggle for password fields.
 *
 * Passing `revealLabels` swaps the input between `password` and `text` — the
 * usual defence against a typo in a masked field that only surfaces as a
 * failed sign-in. The toggle is a real button so it is reachable by keyboard.
 */
function Field({
  label,
  value,
  onChange,
  type,
  autoComplete,
  required,
  revealLabels,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type: string;
  autoComplete?: string;
  required?: boolean;
  revealLabels?: { show: string; hide: string };
}) {
  const [revealed, setRevealed] = useState(false);
  const inputId = useId();
  const canReveal = Boolean(revealLabels);
  const effectiveType = canReveal && revealed ? "text" : type;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label
        htmlFor={inputId}
        style={{ fontSize: 11.5, color: "var(--text-2)" }}
      >
        {label}
      </label>
      <span style={{ position: "relative", display: "block" }}>
        <input
          id={inputId}
          name={
            autoComplete === "new-password" ||
            autoComplete === "current-password"
              ? "password"
              : autoComplete
          }
          type={effectiveType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required={required}
          style={{
            width: "100%",
            padding: canReveal ? "9px 40px 9px 11px" : "9px 11px",
            background: "var(--panel-2)",
            border: "1px solid var(--border-2)",
            borderRadius: 7,
            color: "var(--text)",
            fontSize: 13,
            outline: "none",
          }}
        />
        {canReveal ? (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            aria-pressed={revealed}
            aria-label={revealed ? revealLabels!.hide : revealLabels!.show}
            title={revealed ? revealLabels!.hide : revealLabels!.show}
            style={{
              position: "absolute",
              top: "50%",
              right: 6,
              transform: "translateY(-50%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              padding: 0,
              background: "transparent",
              border: "none",
              borderRadius: 5,
              color: "var(--text-3)",
              cursor: "pointer",
            }}
          >
            <EyeIcon off={revealed} />
          </button>
        ) : null}
      </span>
    </div>
  );
}

/** Outline eye; the `off` variant adds the slash. 16px, inherits currentColor. */
function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {off ? <path d="m4 4 16 16" /> : null}
    </svg>
  );
}
