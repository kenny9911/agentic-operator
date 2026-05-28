/**
 * robohireHealthApi — wraps GET /api/v1/health on the real RoboHire.io API.
 * Useful as a smoke test the LLM can call to confirm the API is reachable
 * before attempting heavier endpoints.
 *
 * Per-tenant config (manifest `tool_use[].config`): see rest-helper.ts.
 */

import { defineTool } from "@agentic/agent-kit";
import { z } from "zod";

import { rhFetch } from "./rest-helper";

export const robohireHealthApi = defineTool({
  name: "robohireHealthApi",
  description:
    "Call RoboHire.io GET /api/v1/health. Returns {status: 'ok' | ...} from the upstream. " +
    "Use to verify connectivity + credentials before invoking write endpoints.",
  output: z.record(z.string(), z.unknown()),
  async handler(ctx) {
    const res = await rhFetch<Record<string, unknown>>(ctx, "GET", "/health");
    if (!res.ok) {
      throw new Error(
        `robohireHealthApi: ${res.message} — body=${JSON.stringify(res.errorBody)}`,
      );
    }
    return {
      data: res.data,
      meta: {
        provider: "robohire.io",
        endpoint: "GET /api/v1/health",
        upstreamStatus: res.status,
      },
    };
  },
});
