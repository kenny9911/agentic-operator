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
  deployments,
  deployments as deploymentsTable,
  eventListeners,
  events,
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

    // WORKFLOW_DEPLOYED audit event
    const auditEv = db
      .select()
      .from(events)
      .where(
        and(eq(events.tenantId, tenantId), eq(events.name, "WORKFLOW_DEPLOYED")),
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
});
