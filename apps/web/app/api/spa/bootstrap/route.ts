/**
 * GET /api/spa/bootstrap?source=json|neo4j
 *
 * One-shot payload for the v1_1 SPA. data.js fetches this on startup and
 * populates window.RAAS_* globals. The source query param selects the data
 * backing store; only `json` works today, `neo4j` is stubbed for later.
 */

import { loadFromJson } from "@/lib/spa/source-json";
import { Neo4jNotConfigured, loadFromNeo4j } from "@/lib/spa/source-neo4j";
import type { DataSource } from "@/lib/spa/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = (url.searchParams.get("source") ?? "json").toLowerCase();
  const source: DataSource = raw === "neo4j" ? "neo4j" : "json";

  try {
    const payload =
      source === "neo4j" ? await loadFromNeo4j() : await loadFromJson();
    return Response.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (err instanceof Neo4jNotConfigured) {
      return Response.json(
        { ok: false, error: { code: err.code, message: err.message } },
        { status: 501 },
      );
    }
    const message =
      err instanceof Error ? err.message : "spa bootstrap failed";
    return Response.json(
      { ok: false, error: { code: "bootstrap_failed", message } },
      { status: 500 },
    );
  }
}
