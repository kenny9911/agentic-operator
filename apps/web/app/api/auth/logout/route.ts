/**
 * POST /api/auth/logout (P2-FE-19)
 *
 * Clears the session cookie. Returns `{ ok: true }`. The caller redirects.
 */

import { clearSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  await clearSession();
  return Response.json({ ok: true });
}
