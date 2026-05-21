/**
 * bootstrapCodeAgents — at API startup, ensure every code-defined agent in
 * `agentRegistry` has matching rows in `agents` + `agent_versions`, plus a
 * `deployments` row for audit. Idempotent.
 *
 * Layout:
 *   1. Upsert `__system` tenant (just in case seed didn't run).
 *   2. Upsert `__system` workflow + workflow_version (versionId = SHA of code-agent set).
 *   3. For each registered agent:
 *      a. Upsert `agents` row (kind='code', kebab_id=agent.name).
 *      b. Upsert `agent_versions` row (manifest_json carries the sha).
 *      c. If no live `deployments` row exists for this agent_version, insert one.
 */

import { and, eq } from "drizzle-orm";
import type { InngestFunction } from "inngest";
import {
  agents,
  agentVersions,
  deployments,
  getDb,
  tenants,
  workflows,
  workflowVersions,
} from "@agentic/db";
import { makeId } from "@agentic/shared";

import { agentRegistry } from "./registry";
import { buildCodeAgentFns } from "./code-agent-fn";

const SYSTEM_TENANT_SLUG = "__system";
const SYSTEM_WORKFLOW_SLUG = "__system";

interface BootstrapSummary {
  tenantId: string;
  workflowId: string;
  workflowVersionId: string;
  agentCount: number;
  deploymentsWritten: number;
  /** P1-RT-08 — one Inngest fn per code agent. */
  codeAgentFns: InngestFunction.Any[];
}

export async function bootstrapCodeAgents(): Promise<BootstrapSummary> {
  const db = getDb();
  const sha = process.env.GIT_SHA ?? "dev";

  // 1. Tenant
  let systemTenant = db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, SYSTEM_TENANT_SLUG))
    .all()[0];
  if (!systemTenant) {
    const tid = makeId("ten");
    db.insert(tenants)
      .values({
        id: tid,
        slug: SYSTEM_TENANT_SLUG,
        name: "System",
        subtitle: "Code-defined agents (cross-tenant)",
        color: "#6f7178",
      })
      .run();
    systemTenant = db.select().from(tenants).where(eq(tenants.id, tid)).all()[0]!;
  }
  const tenantId = systemTenant.id;

  // 2. Workflow + Workflow version
  let systemWorkflow = db
    .select()
    .from(workflows)
    .where(and(eq(workflows.tenantId, tenantId), eq(workflows.slug, SYSTEM_WORKFLOW_SLUG)))
    .all()[0];
  if (!systemWorkflow) {
    const wid = makeId("wf");
    db.insert(workflows)
      .values({ id: wid, tenantId, slug: SYSTEM_WORKFLOW_SLUG, name: "System (code agents)" })
      .run();
    systemWorkflow = db.select().from(workflows).where(eq(workflows.id, wid)).all()[0]!;
  }
  const workflowId = systemWorkflow.id;

  const versionStr = `code-${sha}`;
  let systemWorkflowVersion = db
    .select()
    .from(workflowVersions)
    .where(
      and(
        eq(workflowVersions.workflowId, workflowId),
        eq(workflowVersions.version, versionStr),
      ),
    )
    .all()[0];
  if (!systemWorkflowVersion) {
    const wvid = makeId("wfv");
    const manifest = agentRegistry.list().map((a) => ({
      id: a.name,
      name: a.name,
      title: a.name,
      description: a.description,
      actor: ["Agent"],
      trigger: [],
      actions: [],
      triggered_event: [],
      kind: "code",
    }));
    db.insert(workflowVersions)
      .values({
        id: wvid,
        workflowId,
        version: versionStr,
        manifestJson: manifest as unknown as object,
        actionsJson: null,
      })
      .run();
    systemWorkflowVersion = db
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.id, wvid))
      .all()[0]!;
  }
  const workflowVersionId = systemWorkflowVersion.id;

  // 3. Agents + AgentVersions + Deployment
  let deploymentsWritten = 0;
  const registered = agentRegistry.list();
  for (const a of registered) {
    let agentRow = db
      .select()
      .from(agents)
      .where(and(eq(agents.workflowId, workflowId), eq(agents.kebabId, a.name)))
      .all()[0];
    if (!agentRow) {
      const aid = makeId("agt");
      const now = new Date();
      db.insert(agents)
        .values({
          id: aid,
          workflowId,
          kebabId: a.name,
          name: a.name,
          title: a.name,
          actor: "Agent",
          kind: "code",
          enabled: a.enabled,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      agentRow = db.select().from(agents).where(eq(agents.id, aid)).all()[0]!;
    } else {
      // Keep enabled + kind in sync if the in-process agent flipped them.
      db.update(agents)
        .set({ kind: "code", enabled: a.enabled })
        .where(eq(agents.id, agentRow.id))
        .run();
    }

    let avRow = db
      .select()
      .from(agentVersions)
      .where(
        and(
          eq(agentVersions.agentId, agentRow.id),
          eq(agentVersions.workflowVersionId, workflowVersionId),
        ),
      )
      .all()[0];
    if (!avRow) {
      const avid = makeId("agv");
      db.insert(agentVersions)
        .values({
          id: avid,
          agentId: agentRow.id,
          workflowVersionId,
          manifestJson: {
            type: "code",
            sha,
            name: a.name,
            description: a.description,
            defaultProvider: a.defaultProvider ?? null,
            defaultModel: a.defaultModel ?? null,
            maxSteps: a.maxSteps,
          } as unknown as object,
        })
        .run();
      avRow = db.select().from(agentVersions).where(eq(agentVersions.id, avid)).all()[0]!;
    }

    const liveDep = db
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.tenantId, tenantId),
          eq(deployments.target, "code_agent"),
          eq(deployments.versionId, avRow.id),
          eq(deployments.status, "live"),
        ),
      )
      .all()[0];
    if (!liveDep) {
      db.insert(deployments)
        .values({
          id: makeId("dpl"),
          tenantId,
          target: "code_agent",
          versionId: avRow.id,
          status: "live",
          note: `auto-registered at startup (sha=${sha})`,
        })
        .run();
      deploymentsWritten++;
    }
  }

  return {
    tenantId,
    workflowId,
    workflowVersionId,
    agentCount: registered.length,
    deploymentsWritten,
    codeAgentFns: buildCodeAgentFns(registered),
  };
}
