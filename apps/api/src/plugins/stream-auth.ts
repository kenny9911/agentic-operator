import type { FastifyRequest } from "fastify";
import type { Permission } from "@agentic/contracts";
import { refreshRequestAuth, type AuthedContext } from "./auth";
import { can } from "./rbac";

/**
 * Check immediately before writing, including when draining buffered frames.
 * Changing grants closes the connection so replay restarts with a fresh
 * permission projection. No already-buffered privileged frames survive it.
 */
export function createStreamAuthorization(
  req: FastifyRequest,
  original: AuthedContext,
  permission: Permission,
  close: () => void,
): () => boolean {
  let revoked = false;
  const scopes = JSON.stringify([...(original.scopes ?? [])].sort());
  return () => {
    if (revoked) return false;
    try {
      const current = refreshRequestAuth(req, original);
      if (
        current &&
        current.userId === original.userId &&
        current.tenantId === original.tenantId &&
        current.tenantSlug === original.tenantSlug &&
        current.ownerTenantId === original.ownerTenantId &&
        current.domainId === original.domainId &&
        current.role === original.role &&
        current.ownerRole === original.ownerRole &&
        current.platformRole === original.platformRole &&
        JSON.stringify([...(current.scopes ?? [])].sort()) === scopes &&
        can(current, permission)
      )
        return true;
    } catch {
      // Missing/archived scope and unavailable authorization storage both
      // close the stream; neither permits data under a stale snapshot.
    }
    revoked = true;
    close();
    return false;
  };
}
