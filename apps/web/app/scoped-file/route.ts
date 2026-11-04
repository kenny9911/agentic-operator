import type { NextRequest } from "next/server";
import { serverApiUrl } from "@/lib/server-api-url";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET-only forwarding for downloads and log tails that cannot set browser headers. */
export async function GET(request: NextRequest): Promise<Response> {
  const path = request.nextUrl.searchParams.get("path") ?? "";
  const tenant = request.nextUrl.searchParams.get("tenant");
  const domain = request.nextUrl.searchParams.get("domain");
  if (!tenant || !path.startsWith("/v1/") || path.includes("\\")) return new Response("invalid resource", { status: 400 });
  const api = new URL(serverApiUrl());
  const target = new URL(path, api);
  if (target.origin !== api.origin || !target.pathname.startsWith("/v1/")) return new Response("invalid resource", { status: 400 });
  const headers: Record<string, string> = { cookie: request.headers.get("cookie") ?? "", "x-agentic-tenant": tenant };
  if (domain) headers["x-agentic-domain"] = domain;
  let upstream: Response;
  try { upstream = await fetch(target, { headers, signal: request.signal, cache: "no-store", redirect: "manual" }); }
  catch { return new Response("upstream unavailable", { status: 502 }); }
  if (upstream.status >= 300 && upstream.status < 400) return new Response("resource redirect refused", { status: 502 });
  const outgoing = new Headers({ "cache-control": "no-store", "x-content-type-options": "nosniff", "x-accel-buffering": "no" });
  for (const name of ["content-type", "content-disposition"]) {
    const value = upstream.headers.get(name); if (value) outgoing.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: outgoing });
}
