import { appIdForTenant } from "@agentic/runtime";
import { reregisterInngest, servePathForSlug } from "./inngest-registry";
import { syncTenantApp, verifyTenantAppRegistration } from "./inngest-sync";
import type { TenantInngestRuntimeReceipt } from "./tenant-inngest-deployment";

/**
 * Domain lifecycle is complete only after its runtime namespace has been
 * rebuilt and accepted by Inngest. Empty apps must also synchronize so an
 * archive removes functions left by the previous active registration.
 */
export async function synchronizeDomainRuntime(
  runtimeTenantSlug: string,
): Promise<TenantInngestRuntimeReceipt> {
  const registered = await reregisterInngest({
    tenantSlug: runtimeTenantSlug,
    scope: "tenant",
  });
  if (registered.appFnCount === undefined) {
    throw new Error(
      `No runtime function count returned for ${runtimeTenantSlug}`,
    );
  }
  const sync = await syncTenantApp(runtimeTenantSlug);
  if (!sync.ok) {
    throw new Error(
      `Inngest registration failed for ${runtimeTenantSlug}: ${sync.error ?? sync.status ?? "unknown"}`,
    );
  }
  if (registered.appFnCount > 0) {
    const verification = await verifyTenantAppRegistration(
      runtimeTenantSlug,
      registered.appFnCount,
    );
    if (!verification.verified) {
      throw new Error(
        `Inngest function verification failed for ${runtimeTenantSlug}: ${verification.error ?? "function count did not converge"}`,
      );
    }
  }
  return {
    appId: registered.appId ?? appIdForTenant(runtimeTenantSlug),
    servePath: servePathForSlug(runtimeTenantSlug),
    functionCount: registered.appFnCount,
    brokerVerified: true,
  };
}
