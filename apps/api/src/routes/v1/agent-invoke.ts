/**
 * POST /v1/agents/:name/invoke — synchronously invoke a code-defined agent.
 *
 * Request body (JSON):
 *   {
 *     input?:    unknown,            // passed to BaseAgent.buildMessages()
 *     provider?: ProviderId,         // override gateway default
 *     model?:    string,             // override gateway default
 *     async?:    boolean             // if true, fires inngest event instead of running inline
 *   }
 *
 * Sync response: { ok: true, data: { runId, status:'ok', output, ... } }
 * Async response: { ok: true, data: { runId: <reserved>, status:'queued' } }
 *
 * Error envelope: { ok: false, error: { code, message, hint? } }
 *   - 400 bad_request — unknown provider, validation failed
 *   - 404 not_found   — agent not registered
 *   - 503 not_configured — provider lacks credentials
 *   - 500 internal_error — gateway provider_error or unexpected
 */

import type { FastifyInstance } from "fastify";
import { agentRegistry } from "@agentic/agents";
import { PROVIDER_IDS, type ProviderId } from "@agentic/contracts";
import { isLLMError } from "@agentic/llm-gateway";
import { InvokeAgentBody } from "@agentic/contracts";
import { makeId } from "@agentic/shared";
import { getLLMGateway } from "../../services/llm";

function isProviderId(s: string): s is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(s);
}

export async function agentInvokeRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { name: string } }>(
    "/agents/:name/invoke",
    async (req, reply) => {
      const agentName = req.params.name;
      const body = InvokeAgentBody.parse(req.body ?? {});

      // Validate provider exists in the gateway registry
      if (body.provider !== undefined) {
        if (!isProviderId(body.provider)) {
          return reply.fail("bad_request", `Unknown provider: ${body.provider}`, 400);
        }
        const gateway = getLLMGateway();
        if (!gateway.hasProvider(body.provider)) {
          return reply.fail(
            "bad_request",
            `Provider not registered: ${body.provider}`,
            400,
          );
        }
      }

      const agent = agentRegistry.get(agentName);
      if (!agent) {
        return reply.fail(
          "not_found",
          `Agent '${agentName}' not found in code registry`,
          404,
        );
      }

      if (!agent.enabled) {
        return reply.fail(
          "agent_disabled",
          `Agent '${agentName}' is disabled`,
          409,
        );
      }

      const invocationId = makeId("inv");
      const correlationId = makeId("cor");

      // Async path → Inngest
      if (body.async) {
        // TODO(v2): wire inngest.send here. For v1 we surface async as 501 since
        // the Inngest function is registered but the API-side send/queue tracking
        // is not wired. Sync is the documented path for v1.
        return reply.fail(
          "not_implemented",
          "Async invocation via Inngest is reserved for v2; use sync (omit `async`).",
          501,
        );
      }

      // Sync path → BaseAgent.run()
      try {
        const result = await agent.run(body.input as never, {
          tenantSlug: "__system",
          correlationId,
          invocationId,
          provider: body.provider as ProviderId | undefined,
          model: body.model,
        });

        return reply.ok({
          runId: result.runId,
          status: result.status,
          output: result.output,
          provider: result.provider,
          model: result.model,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          durationMs: result.durationMs,
        });
      } catch (err) {
        if (isLLMError(err)) {
          const status = mapErrorStatus(err.code);
          return reply.fail(err.code, err.message, status);
        }
        throw err;
      }
    },
  );
}

function mapErrorStatus(code: string): number {
  switch (code) {
    case "auth":
      return 401;
    case "rate_limit":
      return 429;
    case "timeout":
      return 504;
    case "model_not_found":
    case "bad_request":
      return 400;
    case "not_configured":
      return 503;
    case "network":
    case "provider_error":
    default:
      return 502;
  }
}
