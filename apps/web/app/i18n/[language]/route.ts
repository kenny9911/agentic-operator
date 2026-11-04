import { getI18nBundle } from "@/lib/i18n/server";
import { isLanguage } from "@/lib/i18n/types";

/** Public UI copy only. Revalidate across deployments instead of retaining
 * a stale dictionary under an unversioned URL. Browser memory deduplicates
 * switches within the current page. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ language: string }> },
) {
  const { language } = await params;
  if (!isLanguage(language)) {
    return Response.json({ error: "Unknown language" }, { status: 404 });
  }
  return Response.json(getI18nBundle(language), {
    headers: { "Cache-Control": "public, max-age=0, must-revalidate" },
  });
}
