/**
 * GET /api/spa/bootstrap
 *
 * One-shot payload for the v1_1 SPA — fans out to `/v1/*` via
 * `loadBootstrapFromApi`. Forwarded auth headers (cookie + bearer) propagate
 * so the apps/api auth plugin can resolve the caller's tenant.
 *
 * P1-FE-01 removed the JSON-on-disk synthesis path; this is now a thin proxy
 * over the REST surface.
 */

import { loadBootstrapFromApi } from "@/lib/spa/source-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const cookie = req.headers.get("cookie");
  const authorization = req.headers.get("authorization");

  try {
    const payload = await loadBootstrapFromApi({ cookie, authorization });
    return Response.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "spa bootstrap failed";
    return Response.json(
      { ok: false, error: { code: "bootstrap_failed", message } },
      { status: 500 },
    );
  }
}
