import { readPrefs } from "@/lib/prefs";
import { SettingsView } from "./_components/SettingsView";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SearchParams {
  section?: string;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const prefs = await readPrefs();
  return (
    <SettingsView
      initialSection={params.section}
      initialTenantId={prefs.tenant}
    />
  );
}
