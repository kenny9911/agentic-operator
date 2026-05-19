/**
 * /v1/llm/* — gateway introspection endpoints.
 *
 * GET /v1/llm/providers      → ProviderInfo[]
 * GET /v1/llm/models?provider=…  → string[] (or full catalog when omitted)
 *
 * No mutation endpoints — config lives in env, not in the DB (per v1 scope).
 */

import type { FastifyInstance } from "fastify";
import { PROVIDER_IDS, PROVIDER_MODEL_CATALOG, type ProviderId } from "@agentic/contracts";
import { getLLMGateway } from "../../services/llm";

function isProviderId(s: string): s is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(s);
}

export async function llmRoutes(app: FastifyInstance): Promise<void> {
  app.get("/llm/providers", async (_req, reply) => {
    const gateway = getLLMGateway();
    return reply.ok(gateway.listProviders());
  });

  app.get<{ Querystring: { provider?: string } }>(
    "/llm/models",
    async (req, reply) => {
      const q = req.query.provider;
      if (q !== undefined && q !== "") {
        if (!isProviderId(q)) {
          return reply.fail("bad_request", `Unknown provider: ${q}`, 400);
        }
        return reply.ok(PROVIDER_MODEL_CATALOG[q].map((m) => m.name));
      }

      const fullCatalog: Record<string, string[]> = {};
      for (const id of PROVIDER_IDS) {
        fullCatalog[id] = PROVIDER_MODEL_CATALOG[id].map((m) => m.name);
      }
      return reply.ok(fullCatalog);
    },
  );
}
