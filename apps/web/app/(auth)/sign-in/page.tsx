import { AuthForm } from "../auth-form";
import { readAuthMode } from "@/lib/auth/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sign-in page (P6-AUTH). The form posts to /v1/auth/login (the api owns
 * password verification + the session cookie). Development uses the same
 * real login route with a seeded user account.
 */
export default async function SignInPage() {
  return <AuthForm initialMode="signin" authMode={await readAuthMode()} />;
}
