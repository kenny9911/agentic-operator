import { redirect } from "next/navigation";
import { Panel } from "@/components";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sign-in page.
 *
 * - dev mode (AUTH_MODE=dev / NODE_ENV !== production): auto-redirect to /portal
 *   since `authenticate()` in lib/auth.ts returns the seeded admin context.
 * - production: stub for magic-link via Resend. v1 portal is operator-only
 *   so the full magic-link flow is post-v1; this page documents the contract.
 */
export default async function SignInPage() {
  if (
    process.env.AUTH_MODE === "dev" ||
    process.env.NODE_ENV !== "production"
  ) {
    redirect("/portal");
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
      }}
    >
      <Panel title="Sign in" padded style={{ width: 360 }}>
        <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
          <p>
            Magic-link sign-in is configured at runtime. Set{" "}
            <code className="mono">RESEND_API_KEY</code> +{" "}
            <code className="mono">AUTH_FROM_EMAIL</code> in env, then a magic
            link is emailed and clicking it sets a session cookie.
          </p>
          <p style={{ color: "var(--text-3)", fontSize: 12 }}>
            For local dev, set <code className="mono">AUTH_MODE=dev</code> in{" "}
            <code className="mono">.env.local</code> to bypass.
          </p>
        </div>
      </Panel>
    </div>
  );
}
