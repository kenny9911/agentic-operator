import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  agents,
  agentVersions,
  deployments,
  eventListeners,
  getDb,
  tenants,
  workflows,
  workflowVersions,
} from "@agentic/db";
import { makeId } from "@agentic/shared";
import { ManifestUploadBody } from "@agentic/contracts";
import { requireAuth } from "../../plugins/auth";
import { writeAudit } from "../../plugins/audit";
import { getAgentDetail, listAgentRuns, listAgents } from "../../queries/agents";

function hashManifest(m: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(m))
    .digest("hex")
    .slice(0, 8);
}

interface DiffSummary {
  added: string[];
  removed: string[];
  modified: string[];
  prior_version: string | null;
}

function computeDiff(prior: unknown[], next: unknown[]): DiffSummary {
  const priorMap = new Map<string, string>();
  const nextMap = new Map<string, string>();
  for (const a of prior as Array<{ id: string }>) priorMap.set(a.id, JSON.stringify(a));
  for (const a of next as Array<{ id: string }>) nextMap.set(a.id, JSON.stringify(a));
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  for (const [id, json] of nextMap) {
    const oldJson = priorMap.get(id);
    if (!oldJson) added.push(id);
    else if (oldJson !== json) modified.push(id);
  }
  for (const id of priorMap.keys()) {
    if (!nextMap.has(id)) removed.push(id);
  }
  return {
    added,
    removed,
    modified,
    prior_version: prior.length > 0 ? "prior" : null,
  };
}

export async function agentsRoutes(app: FastifyInstance) {
  // GET /v1/agents?kind=code|manifest|all — list (optional kind filter)
  app.get<{ Querystring: { kind?: string; tenant?: string } }>(
    "/agents",
    async (req, reply) => {
      const auth = requireAuth(req);
      const rawKind = req.query.kind;
      const kind: "code" | "manifest" | "all" =
        rawKind === "code" || rawKind === "manifest" ? rawKind : "all";
      // Optional explicit tenant slug override — used for cross-tenant queries
      // against the synthetic __system tenant. Falls back to the auth tenant.
      const tenantSlug = req.query.tenant ?? auth.tenantSlug;
      const tenantsToQuery =
        kind === "code" && !req.query.tenant
          ? ["__system", tenantSlug]
          : [tenantSlug];
      const lists = await Promise.all(
        Array.from(new Set(tenantsToQuery)).map((t) =>
          listAgents(t, { kind }),
        ),
      );
      return reply.ok(lists.flat());
    },
  );

  // GET /v1/agents/:kebab — detail
  app.get<{ Params: { kebab: string } }>(
    "/agents/:kebab",
    async (req, reply) => {
      const auth = requireAuth(req);
      const detail = await getAgentDetail(auth.tenantSlug, req.params.kebab);
      if (!detail) return reply.fail("not_found", "agent not found", 404);
      const recentRuns = await listAgentRuns(auth.tenantSlug, detail.id, 20);
      return reply.ok({ ...detail, recentRuns });
    },
  );

  // POST /v1/agents — Mode 1 manifest upload
  app.post("/agents", async (req, reply) => {
    const auth = requireAuth(req);
    const parsed = ManifestUploadBody.parse(req.body);
    const db = getDb();
    const tenant = db
      .select()
      .from(tenants)
      .where(eq(tenants.id, auth.tenantId))
      .all()[0];
    if (!tenant) return reply.fail("tenant_missing", "tenant missing", 500);

    const slug = parsed.workflowSlug ?? `${auth.tenantSlug}-default`;
    let workflow = db
      .select()
      .from(workflows)
      .where(and(eq(workflows.tenantId, tenant.id), eq(workflows.slug, slug)))
      .all()[0];
    if (!workflow) {
      const wfId = makeId("wf");
      db.insert(workflows)
        .values({ id: wfId, tenantId: tenant.id, slug, name: slug })
        .run();
      workflow = db.select().from(workflows).where(eq(workflows.id, wfId)).all()[0]!;
    }

    const versionStr = `upload-${hashManifest(parsed.manifest)}`;
    let workflowVersion = db
      .select()
      .from(workflowVersions)
      .where(
        and(
          eq(workflowVersions.workflowId, workflow.id),
          eq(workflowVersions.version, versionStr),
        ),
      )
      .all()[0];

    const live = db
      .select({
        version: workflowVersions.version,
        manifestJson: workflowVersions.manifestJson,
      })
      .from(deployments)
      .innerJoin(workflowVersions, eq(workflowVersions.id, deployments.versionId))
      .where(
        and(
          eq(deployments.tenantId, tenant.id),
          eq(deployments.status, "live"),
        ),
      )
      .all()[0];

    const diff = computeDiff(
      (live?.manifestJson as unknown[]) ?? [],
      parsed.manifest,
    );

    if (!workflowVersion) {
      const wfvId = makeId("wfv");
      db.insert(workflowVersions)
        .values({
          id: wfvId,
          workflowId: workflow.id,
          version: versionStr,
          manifestJson: parsed.manifest as unknown as object,
          actionsJson: parsed.actions as unknown as object,
        })
        .run();
      workflowVersion = db
        .select()
        .from(workflowVersions)
        .where(eq(workflowVersions.id, wfvId))
        .all()[0]!;

      for (const a of parsed.manifest) {
        let agentRow = db
          .select()
          .from(agents)
          .where(
            and(eq(agents.workflowId, workflow.id), eq(agents.kebabId, a.id)),
          )
          .all()[0];
        if (!agentRow) {
          const aid = makeId("agt");
          db.insert(agents)
            .values({
              id: aid,
              workflowId: workflow.id,
              kebabId: a.id,
              name: a.name,
              title: a.title ?? a.name,
              actor: a.actor[0] === "Human" ? "Human" : "Agent",
            })
            .run();
          agentRow = db.select().from(agents).where(eq(agents.id, aid)).all()[0]!;
        }
        const existing = db
          .select()
          .from(agentVersions)
          .where(
            and(
              eq(agentVersions.agentId, agentRow.id),
              eq(agentVersions.workflowVersionId, workflowVersion.id),
            ),
          )
          .all()[0];
        if (!existing) {
          db.insert(agentVersions)
            .values({
              id: makeId("agv"),
              agentId: agentRow.id,
              workflowVersionId: workflowVersion.id,
              manifestJson: a as unknown as object,
            })
            .run();
        }
        for (const trig of a.trigger) {
          const exists = db
            .select()
            .from(eventListeners)
            .where(
              and(
                eq(eventListeners.eventName, trig),
                eq(eventListeners.agentId, agentRow.id),
              ),
            )
            .all()[0];
          if (!exists) {
            db.insert(eventListeners)
              .values({ eventName: trig, agentId: agentRow.id })
              .run();
          }
        }
      }
    }

    db.transaction(() => {
      db.update(deployments)
        .set({ status: "rolled_back" })
        .where(
          and(
            eq(deployments.tenantId, tenant.id),
            eq(deployments.status, "live"),
          ),
        )
        .run();
      db.insert(deployments)
        .values({
          id: makeId("dpl"),
          tenantId: tenant.id,
          target: "workflow",
          versionId: workflowVersion.id,
          status: "live",
          note: parsed.note ?? null,
        })
        .run();
    });

    writeAudit({
      tenantId: tenant.id,
      action: "manifest.deploy",
      targetType: "workflow_version",
      targetId: workflowVersion.id,
      meta: { version: versionStr, diff },
    });

    return reply.ok({
      workflow_version_id: workflowVersion.id,
      version: versionStr,
      diff,
      note: "Server restart picks up the new manifest in Inngest runtime.",
    });
  });
}
