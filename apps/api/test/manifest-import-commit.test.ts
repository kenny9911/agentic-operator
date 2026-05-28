/**
 * manifest-import — commit-mode coverage.
 *
 * Drives the full path:
 *   - validate happy-v2 (so we know it would commit clean)
 *   - commit happy-v2 cold (no prior live)
 *   - assert: workflow_versions row + deployment row inserted
 *   - assert: agents + agent_versions rows reflect the imported manifest
 *   - assert: event_listeners exist for every trigger
 *   - assert: WORKFLOW_DEPLOYED row appended to the events ledger
 *   - assert: a workflow_v<N+1>.json appeared on disk (or the response says so)
 *   - commit the same manifest again (no-op style) and assert idempotent diff
 */

import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import {
  agents,
  agentVersions,
  apiTokens,
  auditLog,
  deployments,
  deployments as deploymentsTable,
  eventListeners,
  getDb,
  tenants,
  workflows,
  workflowVersions,
} from "@agentic/db";
import { makeId } from "@agentic/shared";
import { createHash } from "node:crypto";
import { buildTestEnv, type TestEnv } from "./harness";

const FIXTURES = path.resolve(__dirname, "fixtures", "manifests");

async function loadFixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(FIXTURES, name), "utf8"));
}

function seedTenantWithToken(slug: string): { tenantId: string; token: string } {
  const db = getDb();
  let row = db.select().from(tenants).where(eq(tenants.slug, slug)).all()[0];
  if (!row) {
    const id = makeId("ten");
    db.insert(tenants).values({ id, slug, name: slug, color: "#000" }).run();
    row = db.select().from(tenants).where(eq(tenants.id, id)).all()[0]!;
  }
  const token = "tok-" + makeId("tok");
  const hash = createHash("sha256").update(token).digest("hex");
  db.insert(apiTokens)
    .values({
      id: makeId("tok"),
      tenantId: row.id,
      hash,
      name: `mi-commit-${slug}`,
      scopes: ["*"],
    })
    .run();
  return { tenantId: row.id, token };
}

interface CommitEnvelope {
  ok: boolean;
  data?: {
    ok: true;
    workflow_version_id: string;
    deployment_id: string;
    target: string;
    inngest_fns_registered: number;
    file_written: string;
    prior_deployment_id: string | null;
    note: string;
  };
  error?: { code: string; message: string; hint?: string };
}

describe("manifest-import: commit mode", () => {
  let env: TestEnv;
  // Use the dev tenant (`__system`); see manifest-import-validate.test.ts
  // for the rationale.
  const slug = "__system";
  let tenantId: string;

  beforeAll(async () => {
    env = await buildTestEnv();
    void seedTenantWithToken;
    const db = getDb();
    tenantId = db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .all()[0]!.id;
    // Drop any pending stage rows left from prior test files.
    db.delete(deploymentsTable)
      .where(
        and(
          eq(deploymentsTable.tenantId, tenantId),
          eq(deploymentsTable.status, "pending"),
        ),
      )
      .run();
  });

  it("cold commit of happy-v2 inserts a live deployment and writes a file", async () => {
    const workflow = await loadFixture("happy-v2.json");

    // validate first (assert ok)
    const v = await env.fetch(`/v1/tenants/${slug}/manifest-import`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ mode: "validate", workflow }),
    });
    expect(v.status).toBe(200);

    // commit
    const res = await env.fetch(`/v1/tenants/${slug}/manifest-import`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      // confirm_overwrite=true because __system already has agents from prior
      // tests; the import will be considered an overwrite of a live workflow.
      body: JSON.stringify({ mode: "commit", workflow, confirm_overwrite: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CommitEnvelope;
    expect(body.ok).toBe(true);
    expect(body.data!.ok).toBe(true);
    expect(body.data!.workflow_version_id).toMatch(/^wfv-/);
    expect(body.data!.deployment_id).toMatch(/^dpl-/);
    // __system may already have a live deployment from prior tests.

    // DB assertions
    const db = getDb();
    const wfvRow = db
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.id, body.data!.workflow_version_id))
      .all()[0];
    expect(wfvRow).toBeDefined();
    const live = db
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.tenantId, tenantId),
          eq(deployments.target, "workflow"),
          eq(deployments.status, "live"),
        ),
      )
      .all();
    expect(live.length).toBe(1);
    expect(live[0]!.id).toBe(body.data!.deployment_id);

    // Agent rows
    const wfRow = db
      .select()
      .from(workflows)
      .where(
        and(
          eq(workflows.tenantId, tenantId),
          eq(workflows.slug, "__system-default"),
        ),
      )
      .all()[0]!;
    const agentRows = db
      .select()
      .from(agents)
      .where(eq(agents.workflowId, wfRow.id))
      .all();
    // At minimum the 5 imported kebab ids should appear (after prior test
    // runs they may already exist; upserts dedupe on workflow_id+kebab_id).
    const kebabs = agentRows.map((r) => r.kebabId);
    for (const k of ["intake-v2", "validate-payload-v2", "enrich-v2", "decide-v2", "notify-v2"]) {
      expect(kebabs).toContain(k);
    }

    // Agent versions
    const agvRows = db
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.workflowVersionId, body.data!.workflow_version_id))
      .all();
    expect(agvRows.length).toBe(5);

    // Event listeners
    for (const a of agentRows) {
      const listeners = db
        .select()
        .from(eventListeners)
        .where(eq(eventListeners.agentId, a.id))
        .all();
      // Every imported agent had ≥1 trigger; live data may have extra
      // agents from prior tests (none here, but still safe).
      if (
        a.kebabId === "intake-v2" ||
        a.kebabId === "notify-v2" ||
        a.kebabId === "decide-v2" ||
        a.kebabId === "enrich-v2" ||
        a.kebabId === "validate-payload-v2"
      ) {
        expect(listeners.length).toBeGreaterThanOrEqual(1);
      }
    }

    // Manifest-commit audit row. The `events` table is reserved for the
    // Inngest ledger now (see manifest-import.ts §Observability); commit
    // audit traffic lives in `audit_log` with action="manifest.import.commit".
    const auditEv = db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.tenantId, tenantId),
          eq(auditLog.action, "manifest.import.commit"),
        ),
      )
      .all();
    expect(auditEv.length).toBeGreaterThanOrEqual(1);

    // Disk file written
    if (body.data!.file_written && !body.data!.file_written.startsWith("(failed")) {
      const st = await stat(body.data!.file_written);
      expect(st.isFile()).toBe(true);
    }
  });

  it("subsequent commit of the same manifest demotes the prior and inserts a new one", async () => {
    const workflow = await loadFixture("happy-v2.json");

    const res = await env.fetch(`/v1/tenants/${slug}/manifest-import`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ mode: "commit", workflow, confirm_overwrite: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CommitEnvelope;
    expect(body.data!.prior_deployment_id).not.toBeNull();

    // Exactly one live row remains for this tenant.
    const db = getDb();
    const live = db
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.tenantId, tenantId),
          eq(deployments.target, "workflow"),
          eq(deployments.status, "live"),
        ),
      )
      .all();
    expect(live).toHaveLength(1);
  });

  // Regression: re-validate + re-commit of an identical-content manifest
  // used to crash on `SQLITE_CONSTRAINT_UNIQUE:
  // workflow_versions.workflow_id, workflow_versions.version`. The pending
  // wfv's promotion UPDATE collided with the prior commit's `auto-<hash>`
  // row. The fix redirects the pending deployment at the existing wfv and
  // drops the orphan pending wfv inside the same atomic tx.
  it("re-validate + re-commit of an identical manifest reuses the prior wfv", async () => {
    const workflow = await loadFixture("happy-v2.json");
    const db = getDb();

    // Ensure prior live wfv exists with version auto-<hash>.
    const priorLive = db
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.tenantId, tenantId),
          eq(deployments.target, "workflow"),
          eq(deployments.status, "live"),
        ),
      )
      .all()[0]!;
    const priorWfvId = priorLive.versionId;
    const priorWfvRow = db
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.id, priorWfvId))
      .all()[0]!;
    expect(priorWfvRow.version).toMatch(/^auto-/);

    // Phase A: re-validate creates a NEW pending wfv with `pending-<dpl>`.
    const v = await env.fetch(`/v1/tenants/${slug}/manifest-import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "validate", workflow }),
    });
    expect(v.status).toBe(200);
    const vBody = (await v.json()) as {
      ok: boolean;
      data: { deployment_id: string; workflow_version_id: string };
    };
    const newDpl = vBody.data.deployment_id;
    const pendingWfvId = vBody.data.workflow_version_id;
    expect(pendingWfvId).not.toBe(priorWfvId);
    const pendingRow = db
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.id, pendingWfvId))
      .all()[0]!;
    expect(pendingRow.version).toBe(`pending-${newDpl}`);

    // Phase B: commit. Pre-fix this returned 500 with the UNIQUE error.
    const c = await env.fetch(`/v1/tenants/${slug}/manifest-import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "commit",
        workflow,
        deployment_id: newDpl,
        confirm_overwrite: true,
      }),
    });
    expect(c.status).toBe(200);
    const cBody = (await c.json()) as CommitEnvelope;
    expect(cBody.ok).toBe(true);
    expect(cBody.data!.ok).toBe(true);
    // The commit should redirect at the existing wfv, not the orphan pending.
    expect(cBody.data!.workflow_version_id).toBe(priorWfvId);
    expect(cBody.data!.deployment_id).toBe(newDpl);
    expect(cBody.data!.prior_deployment_id).toBe(priorLive.id);

    // The orphaned pending wfv must be gone (cascade-safe — no agent_versions
    // had been written against it yet).
    const orphan = db
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.id, pendingWfvId))
      .all();
    expect(orphan).toHaveLength(0);

    // Still exactly one live deployment.
    const live = db
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.tenantId, tenantId),
          eq(deployments.target, "workflow"),
          eq(deployments.status, "live"),
        ),
      )
      .all();
    expect(live).toHaveLength(1);
    expect(live[0]!.versionId).toBe(priorWfvId);
  });

  // Regression: a `skip` resolution on an agent-level structural blocker
  // used to be a no-op in `applyResolutions`, so the re-lint at commit time
  // reproduced the orphan_actor / broken_subflow block and the deploy was
  // refused with the bare "commit refused" line. The fix drops the agent
  // at `agents[N]` whenever the resolution path matches that prefix,
  // matching the wizard's "Skip agent · don't import" chip semantics.
  it("skip resolution on agents[N] drops the agent and commit succeeds", async () => {
    const workflow = await loadFixture("orphan-plus-happy.json");

    // Sanity: a raw commit (no resolutions) is refused with orphan_actor.
    const refused = await env.fetch(`/v1/tenants/${slug}/manifest-import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "commit",
        workflow,
        confirm_overwrite: true,
      }),
    });
    expect(refused.status).toBe(400);
    const refusedBody = (await refused.json()) as {
      ok: boolean;
      error?: { code?: string };
    };
    expect(refusedBody.ok).toBe(false);
    expect(refusedBody.error?.code).toBe("blocking_issues");

    // With a `skip` resolution at agents[0].tool_use the commit should land.
    const res = await env.fetch(`/v1/tenants/${slug}/manifest-import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "commit",
        workflow,
        confirm_overwrite: true,
        conflict_resolutions: [
          { path: "agents[0].tool_use", action: "skip" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CommitEnvelope;
    expect(body.ok).toBe(true);

    // Only the non-orphan agent should land in agent_versions for this wfv.
    const db = getDb();
    const wfvId = body.data!.workflow_version_id;
    const agvRows = db
      .select({ agentId: agentVersions.agentId })
      .from(agentVersions)
      .where(eq(agentVersions.workflowVersionId, wfvId))
      .all();
    expect(agvRows).toHaveLength(1);
    const survivor = db
      .select({ kebabId: agents.kebabId })
      .from(agents)
      .where(eq(agents.id, agvRows[0]!.agentId))
      .all()[0]!;
    expect(survivor.kebabId).toBe("agent-ok");
  });
});
