/**
 * POST /api/prefs — update user preferences cookie.
 *
 * The only API route in apps/web. It's cookie-only (no DB) so it stays here
 * rather than moving to apps/api. Used by the sidebar tenant switcher,
 * top-bar live toggle, and future settings page.
 */

import { z } from "zod";
import { cookies } from "next/headers";
import { DEFAULT_PREFS, PREFS_COOKIE } from "@/lib/prefs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  theme: z.enum(["dark", "light"]).optional(),
  density: z.enum(["compact", "default", "comfortable"]).optional(),
  accent: z.string().optional(),
  tenant: z.string().optional(),
  liveStream: z.boolean().optional(),
});

export async function POST(req: Request) {
  let body;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return Response.json(
      { ok: false, error: { code: "invalid_body", message: "invalid prefs" } },
      { status: 400 },
    );
  }

  const store = await cookies();
  let current = DEFAULT_PREFS;
  try {
    const raw = store.get(PREFS_COOKIE)?.value;
    if (raw) current = { ...current, ...JSON.parse(raw) };
  } catch {}
  const next = { ...current, ...body };

  store.set(PREFS_COOKIE, JSON.stringify(next), {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });

  return Response.json({ ok: true, data: next });
}
