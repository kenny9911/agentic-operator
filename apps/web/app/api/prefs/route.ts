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
import { readSession, writeSession } from "@/lib/auth/session";
import { TENANT_SLUG_PATTERN } from "@/lib/tenant-preference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  theme: z.enum(["dark", "light"]).optional(),
  density: z.enum(["compact", "default", "comfortable"]).optional(),
  accent: z.string().optional(),
  tenant: z.string().regex(TENANT_SLUG_PATTERN).optional(),
  liveStream: z.boolean().optional(),
});

const API_URL = process.env.AGENTIC_API_URL ?? "http://localhost:3501";

async function validateTenantAccess(
  req: Request,
  tenant: string,
): Promise<Response | null> {
  let response: Response;
  try {
    response = await fetch(
      new URL(`/v1/tenants/${encodeURIComponent(tenant)}/access`, API_URL),
      {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          cookie: req.headers.get("cookie") ?? "",
        },
      },
    );
  } catch {
    return Response.json(
      {
        ok: false,
        error: {
          code: "tenant_access_unavailable",
          message: "unable to verify tenant access",
        },
      },
      { status: 503 },
    );
  }
  if (response.ok) return null;
  const status = [400, 401, 403, 404].includes(response.status)
    ? response.status
    : 503;
  return Response.json(
    {
      ok: false,
      error: {
        code: status === 503 ? "tenant_access_unavailable" : "tenant_forbidden",
        message:
          status === 404
            ? `tenant "${tenant}" is not available`
            : "the current user cannot access the selected tenant",
      },
    },
    { status },
  );
}

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

  if (body.tenant) {
    const denied = await validateTenantAccess(req, body.tenant);
    if (denied) return denied;
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

  // Browser sessions are tenant-scoped in production. Rotate the signed
  // session alongside the preference so the hard navigation that follows a
  // switch is authenticated for the selected tenant. The API still performs
  // its normal tenant-membership check before returning any scoped data.
  if (body.tenant) {
    const session = await readSession();
    if (session) {
      await writeSession({ ...session, tenant: body.tenant });
    }
  }

  return Response.json({ ok: true, data: next });
}

/** Clear only the remembered tenant while preserving visual preferences. */
export async function DELETE() {
  const store = await cookies();
  let current = DEFAULT_PREFS;
  try {
    const raw = store.get(PREFS_COOKIE)?.value;
    if (raw) current = { ...current, ...JSON.parse(raw) };
  } catch {}
  const next = { ...current, tenant: "" };

  store.set(PREFS_COOKIE, JSON.stringify(next), {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  return Response.json({ ok: true, data: next });
}
