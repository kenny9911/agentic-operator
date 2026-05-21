/**
 * `/` — root entry. Redirects to `/portal`.
 *
 * Prior behaviour (pre-P5-TEN-01b) rewrote `/` directly to the Babel SPA at
 * `/public/portal/index.html`. The SPA now lives at `/demo` (it's the v1_1
 * design reference, not the production app); the canonical UI is the Next
 * App Router portal at `/portal/<tenant>/dashboard`.
 *
 * Keeping this redirect as an App Router page (rather than a next.config
 * rewrite) means tenant resolution happens server-side via the session
 * cookie inside `/portal/page.tsx` — the same code path as a direct
 * `/portal` visit, no double-redirect logic to maintain.
 */

import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function RootIndex(): never {
  redirect("/portal");
}
