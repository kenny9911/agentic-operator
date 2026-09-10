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
): () => Promise<boolean> {
  let revoked = false;
  const scopes = JSON.stringify([...(original.scopes ?? [])].sort());
  let inFlight: Promise<boolean> | null = null;
  const check = async (): Promise<boolean> => {
    if (revoked) return false;
    try {
      const current = await refreshRequestAuth(req, original);
      if (
        !revoked &&
        current &&
        current.userId === original.userId &&
        current.tenantId === original.tenantId &&
        current.tenantSlug === original.tenantSlug &&
        current.role === original.role &&
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
  return () => {
    if (revoked) return Promise.resolve(false);
    if (!inFlight)
      inFlight = check().finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}
