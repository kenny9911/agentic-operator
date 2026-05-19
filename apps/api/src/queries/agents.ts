import { and, desc, eq, sql } from "drizzle-orm";
import {
  agents,
  agentVersions,
  getDb,
  runs,
  tenants,
  workflows,
  workflowVersions,
} from "@agentic/db";
import type { ListAgentRow, AgentDetail } from "@agentic/contracts";

async function resolveTenantId(slug: string): Promise<string | null> {
  const db = getDb();
  return db.select().from(tenants).where(eq(tenants.slug, slug)).all()[0]?.id ?? null;
}

export async function listAgents(
  tenantSlug: string,
  opts: { kind?: "manifest" | "code" | "all" } = {},
): Promise<ListAgentRow[]> {
  const db = getDb();
  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return [];

  const kindFilter = opts.kind ?? "all";
  const whereClause =
    kindFilter === "all"
      ? eq(workflows.tenantId, tenantId)
      : and(eq(workflows.tenantId, tenantId), eq(agents.kind, kindFilter));

  const rows = db
    .select({
      id: agents.id,
      kebabId: agents.kebabId,
      name: agents.name,
      title: agents.title,
      actor: agents.actor,
      kind: agents.kind,
      enabled: agents.enabled,
      runCount: sql<number>`count(${runs.id})`,
      errorCount: sql<number>`sum(case when ${runs.status} = 'failed' then 1 else 0 end)`,
      lastRunAt: sql<number | null>`max(${runs.startedAt})`,
    })
    .from(agents)
    .innerJoin(workflows, eq(workflows.id, agents.workflowId))
    .leftJoin(runs, eq(runs.agentId, agents.id))
    .where(whereClause)
    .groupBy(agents.id)
    .all();

  // Pull descriptions from the most-recent agent_version manifest per agent
  const versionRows = db
    .select({
      agentId: agentVersions.agentId,
      manifestJson: agentVersions.manifestJson,
    })
    .from(agentVersions)
    .innerJoin(agents, eq(agents.id, agentVersions.agentId))
    .innerJoin(workflows, eq(workflows.id, agents.workflowId))
    .innerJoin(
      workflowVersions,
      eq(workflowVersions.id, agentVersions.workflowVersionId),
    )
    .where(eq(workflows.tenantId, tenantId))
    .orderBy(desc(workflowVersions.createdAt))
    .all();
  const descByAgent = new Map<string, string>();
  for (const v of versionRows) {
    if (descByAgent.has(v.agentId)) continue;
    const desc = (v.manifestJson as { description?: string } | null)?.description;
    if (desc) descByAgent.set(v.agentId, desc);
  }

  return rows.map((r) => ({
    id: r.id,
    kebabId: r.kebabId,
    name: r.name,
    title: r.title,
    description: descByAgent.get(r.id) ?? null,
    actor: r.actor,
    kind: r.kind,
    enabled: r.enabled,
    runCount: Number(r.runCount),
    errorCount: Number(r.errorCount ?? 0),
    lastRunAt: r.lastRunAt ? new Date(r.lastRunAt) : null,
  }));
}

interface ManifestShape {
  trigger?: string[];
  triggered_event?: string[];
  actions?: AgentDetail["actions"];
}

export async function getAgentDetail(
  tenantSlug: string,
  kebabId: string,
): Promise<AgentDetail | null> {
  const db = getDb();
  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return null;

  const row = db
    .select({
      id: agents.id,
      kebabId: agents.kebabId,
      name: agents.name,
      title: agents.title,
      actor: agents.actor,
      workflowSlug: workflows.slug,
      workflowVersion: workflowVersions.version,
      manifestJson: agentVersions.manifestJson,
    })
    .from(agents)
    .innerJoin(workflows, eq(workflows.id, agents.workflowId))
    .innerJoin(agentVersions, eq(agentVersions.agentId, agents.id))
    .innerJoin(
      workflowVersions,
      eq(workflowVersions.id, agentVersions.workflowVersionId),
    )
    .where(and(eq(workflows.tenantId, tenantId), eq(agents.kebabId, kebabId)))
    .orderBy(desc(workflowVersions.createdAt))
    .all()[0];
  if (!row) return null;

  const m = (row.manifestJson ?? {}) as ManifestShape;
  return {
    id: row.id,
    kebabId: row.kebabId,
    name: row.name,
    title: row.title,
    actor: row.actor,
    triggers: m.trigger ?? [],
    triggeredEvents: m.triggered_event ?? [],
    actions: m.actions ?? [],
    workflowSlug: row.workflowSlug,
    workflowVersion: row.workflowVersion,
  };
}

export async function listAgentRuns(
  tenantSlug: string,
  agentDbId: string,
  limit = 30,
) {
  const db = getDb();
  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return [];
  return db
    .select({
      id: runs.id,
      status: runs.status,
      subject: runs.subject,
      startedAt: runs.startedAt,
      durationMs: runs.durationMs,
    })
    .from(runs)
    .where(and(eq(runs.tenantId, tenantId), eq(runs.agentId, agentDbId)))
    .orderBy(desc(runs.startedAt))
    .limit(limit)
    .all();
}
