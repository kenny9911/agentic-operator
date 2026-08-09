/**
 * POST /api/auth/login (P2-FE-19)
 *
 * Body: `{ email, name?, tenant? }`. When `tenant` is omitted, the
 * last-opened tenant from the preference cookie is restored.
 *
 * Issues a signed session cookie. v1 is operator-only and intentionally
 * permissive — anyone with the right env var (or local dev) can sign in.
 * The magic-link flow lives in `/sign-in/page.tsx` and is post-v1.
 *
 * Response: `{ ok: true, data: { tenant } }`. The caller redirects after.
 */

import { z } from "zod";
import { writeSession } from "@/lib/auth/session";
import { readRememberedTenant, writeRememberedTenant } from "@/lib/prefs";
import { TENANT_SLUG_PATTERN } from "@/lib/tenant-preference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(),
  tenant: z.string().regex(TENANT_SLUG_PATTERN).optional(),
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
  const tenant = body.tenant ?? (await readRememberedTenant());
  if (!tenant) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "tenant_required",
          message: "select a tenant on first sign-in",
        },
      },
      { status: 400 },
    );
  }
  await writeSession({
    sub: body.email,
    name,
    initials: initialsFor(name),
    tenant,
  });
  await writeRememberedTenant(tenant);
  return Response.json({ ok: true, data: { tenant } });
}
