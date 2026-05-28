/**
 * Back-compat shim — canonical implementation lives in @agentic/tools.
 *
 * The new helper takes a ToolContext argument (so per-tenant manifest
 * config can override the API key/base URL). This shim adapts the
 * old no-context signature by synthesising a minimal context — only
 * the no-config (env-fallback) path is supported via this shim. New
 * callers should import from `@agentic/tools/robohire` directly.
 */
import type { ToolContext } from "@agentic/agent-kit";
import {
  rhFetch as rhFetchCanonical,
  type RoboHireResponse,
  type RoboHireError,
} from "@agentic/tools/robohire";

export type { RoboHireResponse, RoboHireError };

const NO_CONFIG_CTX: ToolContext = {
  agentName: "back-compat-shim",
  actionName: "rhFetch",
  correlationId: "back-compat-shim",
  tenantSlug: "unknown",
};

export async function rhFetch<TBody = unknown>(
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
  path: string,
  body?: unknown,
): Promise<RoboHireResponse<TBody> | RoboHireError> {
  return rhFetchCanonical<TBody>(NO_CONFIG_CTX, method, path, body);
}
