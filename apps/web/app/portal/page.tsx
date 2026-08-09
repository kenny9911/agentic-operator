import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { readRememberedTenant } from "@/lib/prefs";
import { resolvePortalTenant } from "@/lib/tenant-preference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `/portal` — restore the last tenant the user opened. A successful switch
 * updates both the signed session and the longer-lived preference cookie.
 */
export default async function PortalIndex() {
  const [session, rememberedTenant] = await Promise.all([
    readSession(),
    readRememberedTenant(),
  ]);
  const tenant = resolvePortalTenant(rememberedTenant, session?.tenant);
  if (!tenant) redirect("/sign-in?return=/portal");
  redirect(`/portal/${tenant}/dashboard`);
}
