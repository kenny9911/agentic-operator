import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `/portal/<tenant>` → `/portal/<tenant>/domains`. */
export default async function TenantIndex({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  redirect(`/portal/${tenant}/domains`);
}
