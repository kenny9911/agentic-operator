/**
 * GET /api/spa/bootstrap
 *
 * One-shot payload for the v1_1 SPA — fans out to `/v1/*` via
 * `loadBootstrapFromApi`. Forwarded auth headers (cookie + bearer) propagate
 * so the apps/api auth plugin can resolve the caller's tenant.
 *
 * P1-FE-01 removed the JSON-on-disk synthesis path; this is now a thin proxy
 * over the REST surface.
 *
 * `?tenant=<slug>` is parsed and forwarded so the DataProvider can refetch
 * per-tenant after a URL switch. The apps/api auth plugin still has the
 * final word on which tenant the request resolves to (cookie/bearer in
 * prod; AGENTIC_DEV_TENANT in dev), so the param is advisory — the route
 * passes it through to `loadBootstrapFromApi` and the loader honors it
 * once the api exposes a tenant-override mechanism.
 */

import { loadBootstrapFromApi } from "@/lib/spa/source-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const cookie = req.headers.get("cookie");
  const authorization = req.headers.get("authorization");
  const url = new URL(req.url);
  const tenant = url.searchParams.get("tenant") ?? null;

  try {
    const payload = await loadBootstrapFromApi({
      cookie,
      authorization,
      tenant,
    });
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
