/**
 * POST /api/auth/login (P2-FE-19)
 *
 * Body: `{ email, name? }`
 *
 * Issues a signed session cookie. v1 is operator-only and intentionally
 * permissive — anyone with the right env var (or local dev) can sign in.
 * The magic-link flow lives in `/sign-in/page.tsx` and is post-v1.
 *
 * Response: `{ ok: true, data: { tenant } }`. The caller redirects after.
 */

import { z } from "zod";
import { writeSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(),
  tenant: z.string().min(1).optional(),
});

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  const first = parts[0]?.[0] ?? "";
  const last = parts[parts.length - 1]?.[0] ?? "";
  return (first + last).toUpperCase();
}

export async function POST(req: Request) {
  let body;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: { code: "invalid_body", message: "invalid login body" },
      },
      { status: 400 },
    );
  }
  const name = body.name ?? body.email.split("@")[0] ?? body.email;
  await writeSession({
    sub: body.email,
    name,
    initials: initialsFor(name),
    tenant: body.tenant ?? "raas",
  });
  return Response.json({ ok: true, data: { tenant: body.tenant ?? "raas" } });
}
