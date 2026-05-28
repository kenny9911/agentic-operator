/**
 * deployments — partial unique index on (tenant_id, target) WHERE
 * status='live' AND target IN ('workflow','tenant_code').
 *
 * Promotes the "one live deployment per (tenant, target)" invariant from
 * convention to enforcement. The app-level demote in
 * `apps/api/src/services/manifest-import.ts` and
 * `apps/api/src/routes/v1/tenant-code.ts` was the only protection before;
 * any future code path that forgets to demote now hits
 * SQLITE_CONSTRAINT_UNIQUE instead of silently leaving two live rows for
 * `getDag()` to pick from.
 *
 * `code_agent` is INTENTIONALLY allowed to have multiple live rows per
 * tenant (one per registered agent — see packages/agents/src/bootstrap.ts)
 * so the index predicate excludes it.
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  deployments,
  getDb,
  tenants,
  workflowVersions,
  workflows,
} from "@agentic/db";
import { makeId } from "@agentic/shared";
import { buildTestEnv, type TestEnv } from "./harness";

describe("deployments: one live per (tenant, target) constraint", () => {
  let env: TestEnv;
  const slug = "__system";
  let tenantId: string;
  let workflowId: string;
  let aWfvId: string;
  let bWfvId: string;
  // Track rows we insert so afterEach can clean up without touching unrelated state.
  const createdDeploymentIds: string[] = [];
  const createdWfvIds: string[] = [];

  beforeAll(async () => {
    env = await buildTestEnv();
    void env;
    const db = getDb();
    tenantId = db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .all()[0]!.id;
    // Lazy-create a workflow row + two workflow_versions to point at; each
    // test wants distinct version_ids so that a UNIQUE conflict on the
    // partial index is caused by `(tenant_id, target)` rather than
    // `(version_id)` collisions.
    let wf = db
      .select()
      .from(workflows)
      .where(
        and(
          eq(workflows.tenantId, tenantId),
          eq(workflows.slug, `${slug}-live-uniq-fixture`),
        ),
      )
      .all()[0];
    if (!wf) {
      const id = makeId("wf");
      db.insert(workflows)
        .values({
          id,
          tenantId,
          slug: `${slug}-live-uniq-fixture`,
          name: "live-uniq-fixture",
        })
        .run();
      wf = db.select().from(workflows).where(eq(workflows.id, id)).all()[0]!;
    }
    workflowId = wf.id;

    function ensureWfv(version: string): string {
      const existing = db
        .select()
        .from(workflowVersions)
        .where(
          and(
            eq(workflowVersions.workflowId, workflowId),
            eq(workflowVersions.version, version),
          ),
        )
        .all()[0];
      if (existing) return existing.id;
      const id = makeId("wfv");
      db.insert(workflowVersions)
        .values({
          id,
          workflowId,
          version,
          manifestJson: [] as unknown as object,
          actionsJson: null,
        })
        .run();
      createdWfvIds.push(id);
      return id;
    }
    aWfvId = ensureWfv("live-uniq-A");
    bWfvId = ensureWfv("live-uniq-B");
  });

  afterEach(() => {
    const db = getDb();
    // Drop only the rows we inserted in this file's scope so the rest of
    // the test suite's __system fixtures stay intact.
    if (createdDeploymentIds.length > 0) {
      db.delete(deployments)
        .where(inArray(deployments.id, createdDeploymentIds))
        .run();
      createdDeploymentIds.length = 0;
    }
  });

  function insertLive(target: "workflow" | "tenant_code" | "code_agent", versionId: string): string {
    const db = getDb();
    const id = makeId("dpl");
    db.insert(deployments)
      .values({
        id,
        tenantId,
        target,
        versionId,
        status: "live",
        note: "live-uniq test fixture",
      })
      .run();
    createdDeploymentIds.push(id);
    return id;
  }

  /**
   * Stash any pre-existing live rows for (tenant, target) by demoting them
   * to `rolled_back`, run `body`, then restore them. The body's own inserts
   * are removed before the restore so the live slot is free again. Without
   * this dance the restore would itself collide with the partial unique
   * index we're testing.
   */
  function withClearLiveSlot(
    target: "workflow" | "tenant_code",
    body: () => void,
  ): void {
    const db = getDb();
    const existingLive = db
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.tenantId, tenantId),
          eq(deployments.target, target),
          eq(deployments.status, "live"),
        ),
      )
      .all();
    for (const r of existingLive) {
      db.update(deployments)
        .set({ status: "rolled_back" })
        .where(eq(deployments.id, r.id))
        .run();
    }
    try {
      body();
    } finally {
      // Drop anything the body inserted (so the live slot is free) before
      // we restore the prior live rows. afterEach will sweep the remaining
      // tracked ids on top of this — duplicate-safe.
      if (createdDeploymentIds.length > 0) {
        db.delete(deployments)
          .where(inArray(deployments.id, createdDeploymentIds))
          .run();
        createdDeploymentIds.length = 0;
      }
      for (const r of existingLive) {
        db.update(deployments)
          .set({ status: "live" })
          .where(eq(deployments.id, r.id))
          .run();
      }
    }
  }

  it("rejects a second live workflow deployment for the same tenant", () => {
    withClearLiveSlot("workflow", () => {
      insertLive("workflow", aWfvId);
      expect(() => insertLive("workflow", bWfvId)).toThrow(
        /UNIQUE constraint failed/i,
      );
    });
  });

  it("rejects a second live tenant_code deployment for the same tenant", () => {
    withClearLiveSlot("tenant_code", () => {
      insertLive("tenant_code", aWfvId);
      expect(() => insertLive("tenant_code", bWfvId)).toThrow(
        /UNIQUE constraint failed/i,
      );
    });
  });

  it("allows multiple live code_agent deployments for the same tenant (intentional)", () => {
    // Confirms the predicate's `target IN ('workflow', 'tenant_code')`
    // guard — code agents register one live row per (tenant, agent) and
    // must keep doing so.
    insertLive("code_agent", aWfvId);
    insertLive("code_agent", bWfvId);
    // No throw expected. Cross-check by counting.
    const db = getDb();
    const live = db
      .select({ id: deployments.id })
      .from(deployments)
      .where(
        and(
          eq(deployments.tenantId, tenantId),
          eq(deployments.target, "code_agent"),
          eq(deployments.status, "live"),
          // Restrict to rows we created so unrelated registry-bootstrap
          // entries don't perturb the count.
          inArray(deployments.id, createdDeploymentIds),
        ),
      )
      .all();
    expect(live).toHaveLength(2);
  });

  it("allows a non-live row to coexist with a live row on the same (tenant, target)", () => {
    // Sanity: the partial index predicate only fires when status='live'.
    // Rolled-back and pending rows must remain insertable alongside live.
    withClearLiveSlot("workflow", () => {
      const db = getDb();
      insertLive("workflow", aWfvId);
      const rolledBackId = makeId("dpl");
      db.insert(deployments)
        .values({
          id: rolledBackId,
          tenantId,
          target: "workflow",
          versionId: bWfvId,
          status: "rolled_back",
          note: "second non-live row — must be allowed",
        })
        .run();
      createdDeploymentIds.push(rolledBackId);
      const row = db
        .select()
        .from(deployments)
        .where(eq(deployments.id, rolledBackId))
        .all()[0];
      expect(row).toBeDefined();
      expect(row!.status).toBe("rolled_back");
    });
  });
});
