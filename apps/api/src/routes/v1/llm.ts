/**
 * /v1/llm/* — gateway introspection + provider-key management + model fleet.
 *
 * GET    /v1/llm/providers                → ProviderInfo[]
 * GET    /v1/llm/models?provider=…        → string[] (or full catalog when omitted)
 * GET    /v1/llm/catalog                  → Record<ProviderId, CatalogModel[]> (full metadata)
 * GET    /v1/llm/providers/keys           → masked metadata for every provider
 * GET    /v1/llm/providers/:id/key        → masked key + metadata for one provider
 * POST   /v1/llm/providers/:id/key        → save & rotate (body: { apiKey, scope })
 * POST   /v1/llm/providers/:id/test       → probe upstream with a candidate key
 * GET    /v1/llm/fleet                    → tenant's model fleet
 * POST   /v1/llm/fleet                    → add an entry
 * PATCH  /v1/llm/fleet/:id                → update an entry
 * DELETE /v1/llm/fleet/:id                → remove an entry
 */

import type { FastifyInstance } from "fastify";
import { PROVIDER_IDS, PROVIDER_MODEL_CATALOG, type ProviderId } from "@agentic/contracts";
import { getLLMGateway, resetLLMGateway } from "../../services/llm";
import { requireAuth } from "../../plugins/auth";
import { writeAudit } from "../../plugins/audit";
import {
  getProviderKey,
  getProviderKeyMeta,
  listProviderKeyMeta,
  setProviderKey,
  type KeyScope,
} from "../../services/provider-keys";
import { testProviderKey } from "../../services/provider-test";
import {
  addFleetEntry,
  deleteFleetEntry,
  FleetValidationError,
  listFleet,
  updateFleetEntry,
} from "../../services/model-fleet";

function isProviderId(s: string): s is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(s);
}

function isKeyScope(s: unknown): s is KeyScope {
  return s === "workspace" || s === "tenant";
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

  // Full catalog with metadata (context, prices, capabilities). The plain
  // /llm/models endpoint returns names only for backwards-compat; this
  // endpoint is what the Settings UI uses to render the "Add model" picker.
  app.get("/llm/catalog", async (_req, reply) => {
    return reply.ok(PROVIDER_MODEL_CATALOG);
  });

  // ── Provider key vault ──────────────────────────────────────────────────
  // List masked key metadata for every provider — used by the Settings UI
  // to populate the credentials grid without fetching plaintext keys.
  app.get("/llm/providers/keys", async (_req, reply) => {
    return reply.ok(listProviderKeyMeta());
  });

  app.get<{ Params: { id: string } }>("/llm/providers/:id/key", async (req, reply) => {
    if (!isProviderId(req.params.id)) {
      return reply.fail("bad_request", `Unknown provider: ${req.params.id}`, 400);
    }
    return reply.ok(getProviderKeyMeta(req.params.id));
  });

  app.post<{
    Params: { id: string };
    Body: { apiKey?: string; scope?: string };
  }>("/llm/providers/:id/key", async (req, reply) => {
    const auth = requireAuth(req);
    const id = req.params.id;
    if (!isProviderId(id)) {
      return reply.fail("bad_request", `Unknown provider: ${id}`, 400);
    }
    const { apiKey, scope } = req.body ?? {};
    if (typeof apiKey !== "string" || apiKey.trim().length < 8) {
      return reply.fail("bad_request", "apiKey is required (min 8 chars)", 400);
    }
    if (!isKeyScope(scope)) {
      return reply.fail("bad_request", `scope must be "workspace" or "tenant"`, 400);
    }
    try {
      const meta = setProviderKey(id, {
        apiKey: apiKey.trim(),
        scope,
        tenantId: scope === "tenant" ? auth.tenantId : undefined,
        setBy: auth.tenantSlug,
      });
      resetLLMGateway();
      writeAudit({
        tenantId: auth.tenantId,
        action: "llm.key.rotate",
        targetType: "provider",
        targetId: id,
        meta: { scope, keyMasked: meta.keyMasked },
      });
      return reply.ok(meta);
    } catch (err) {
      return reply.fail("bad_request", (err as Error).message, 400);
    }
  });

  app.post<{
    Params: { id: string };
    Body: { apiKey?: string };
  }>("/llm/providers/:id/test", async (req, reply) => {
    const auth = requireAuth(req);
    const id = req.params.id;
    if (!isProviderId(id)) {
      return reply.fail("bad_request", `Unknown provider: ${id}`, 400);
    }
    // Candidate key from body wins; fall back to whatever the vault/env has
    // for the caller's tenant. The vault is tenant-scoped (P5-TEN-01) so we
    // pass the auth's tenantId to honor tenant-specific keys.
    const candidate = req.body?.apiKey?.trim();
    const key = candidate && candidate.length > 0
      ? candidate
      : (getProviderKey(id, auth.tenantId) ?? "");
    if (!key) {
      return reply.ok({
        ok: false,
        statusCode: null,
        latencyMs: 0,
        modelCount: null,
        message: "No key configured for this provider",
      });
    }
    const result = await testProviderKey(id, key);
    return reply.ok(result);
  });

  // ── Model fleet ─────────────────────────────────────────────────────────
  app.get("/llm/fleet", async (req, reply) => {
    const auth = requireAuth(req);
    return reply.ok(listFleet(auth.tenantSlug));
  });

  app.post<{
    Body: {
      provider?: string;
      modelName?: string;
      alias?: string;
      role?: string;
      dailyCapUsd?: number;
      maxOutTokens?: number;
      temperature?: number;
    };
  }>("/llm/fleet", async (req, reply) => {
    const auth = requireAuth(req);
    try {
      const entry = addFleetEntry({
        tenantSlug: auth.tenantSlug,
        provider: req.body?.provider ?? "",
        modelName: req.body?.modelName ?? "",
        alias: req.body?.alias,
        role: req.body?.role,
        dailyCapUsd: req.body?.dailyCapUsd,
        maxOutTokens: req.body?.maxOutTokens,
        temperature: req.body?.temperature,
        addedBy: auth.tenantSlug,
      });
      writeAudit({
        tenantId: auth.tenantId,
        action: "llm.fleet.add",
        targetType: "model",
        targetId: entry.id,
        meta: {
          provider: entry.provider,
          modelName: entry.modelName,
          alias: entry.alias,
          role: entry.role,
        },
      });
      return reply.ok(entry);
    } catch (err) {
      if (err instanceof FleetValidationError) {
        return reply.fail("bad_request", err.message, 400);
      }
      throw err;
    }
  });

  app.patch<{
    Params: { id: string };
    Body: {
      alias?: string;
      role?: string;
      dailyCapUsd?: number;
      maxOutTokens?: number;
      temperature?: number;
    };
  }>("/llm/fleet/:id", async (req, reply) => {
    const auth = requireAuth(req);
    try {
      const entry = updateFleetEntry(auth.tenantSlug, req.params.id, req.body ?? {});
      if (!entry) return reply.fail("not_found", "fleet entry not found", 404);
      writeAudit({
        tenantId: auth.tenantId,
        action: "llm.fleet.update",
        targetType: "model",
        targetId: entry.id,
        meta: req.body as Record<string, unknown>,
      });
      return reply.ok(entry);
    } catch (err) {
      if (err instanceof FleetValidationError) {
        return reply.fail("bad_request", err.message, 400);
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>("/llm/fleet/:id", async (req, reply) => {
    const auth = requireAuth(req);
    const ok = deleteFleetEntry(auth.tenantSlug, req.params.id);
    if (!ok) return reply.fail("not_found", "fleet entry not found", 404);
    writeAudit({
      tenantId: auth.tenantId,
      action: "llm.fleet.remove",
      targetType: "model",
      targetId: req.params.id,
    });
    return reply.ok({ id: req.params.id, deleted: true });
  });
}
