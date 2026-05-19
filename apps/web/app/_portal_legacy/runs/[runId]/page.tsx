import { redirect } from "next/navigation";

export default async function RunRedirect({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  redirect(`/runs?id=${encodeURIComponent(runId)}`);
}
