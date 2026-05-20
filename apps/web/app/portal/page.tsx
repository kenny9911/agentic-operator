import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `/portal` — redirect to `/portal/<active-tenant>/dashboard`. The active
 * tenant comes from the session; fall back to "raas" when unset.
 */
export default async function PortalIndex() {
  const session = await readSession();
  const tenant = session?.tenant ?? "raas";
  redirect(`/portal/${tenant}/dashboard`);
}
