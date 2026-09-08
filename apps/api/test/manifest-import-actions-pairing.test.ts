/**
 * manifest-import — version identity must cover the actions the RUNTIME pairs,
 * not the actions the request happened to carry.
 *
 * Regression guard for "the first publish of a manifest 500s". The runtime
 * resolves `workflow_v*.json` and `actions_v*.json` independently (highest
 * version per family), so a publish that carries no actions leaves the pair
 * (new manifest, pre-existing actions_v<N-1>.json) on disk. Hashing the
 * request's actions (undefined) produced an identity for a pair that exists
 * nowhere: the re-registration inside that same commit then saw a brand-new
 * version, inserted its own live deployment, and assertDeploymentOwnsLiveLane
 * threw `manifest import deployment no longer owns the live lane` — while the
 * recovery path, asserting the same invariant, could not restore either. The
 * identical second publish succeeded, which made it look flaky.
 *
 * Every other manifest-import suite commits into a models dir with no actions
 * file at all, so none of them exercises this pairing. This one plants one.
 *
 * It also pins the storage half: `workflow_versions.actions_json` keeps meaning
 * "what this publish AUTHORED" (null here). Recording the carried-forward disk
 * actions instead would feed `saveWorkflowDraft`'s inheritance +
 * `assertWorkflowPersistencePolicy`, and `getWorkflowPublishSnapshot`'s
 * republish, with actions the operator never authored.
 */

import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { and, eq } from "drizzle-orm";
import { deployments, getDb, tenants, workflowVersions } from "@agentic/db";
import { canonicalWorkflowVersionId } from "@agentic/runtime";
import { buildTestEnv, type TestEnv } from "./harness";

const FIXTURES = path.resolve(__dirname, "fixtures", "manifests");

/** A minimal, valid actions manifest — the shape bootstrap loads from disk. */
const DISK_ACTIONS = [
  {
    id: "ACT-PAIRING-1",
    name: "carriedForwardAction",
    description: "Pre-existing action the publish does not re-send.",
  },
];

describe("manifest-import: identity pairs with the on-disk actions", () => {
  let env: TestEnv;
  let workflow: unknown;
  // The dev tenant, like the other commit suites: a brand-new tenant cannot
  // complete Inngest activation in the test process, and this suite is about
  // version identity, not registration.
  const slug = "__system";
  let tenantId: string;
  let modelsDir: string;

  beforeAll(async () => {
    env = await buildTestEnv();
    workflow = JSON.parse(
      await readFile(path.join(FIXTURES, "happy-v2.json"), "utf8"),
    );
    const db = getDb();
    tenantId = db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .all()[0]!.id;

    // An isolated models tree holding the state that triggers the bug: a
    // workflow file AND an actions file the next publish will not re-send.
    const root = await mkdtemp(path.join(tmpdir(), "agentic-actions-pairing-"));
    modelsDir = path.join(root, "models");
    const tenantDir = path.join(modelsDir, `${slug}-v1`);
    await mkdir(tenantDir, { recursive: true });
    await writeFile(
      path.join(tenantDir, "workflow_v1.json"),
      JSON.stringify([], null, 2) + "\n",
      "utf8",
    );
    await writeFile(
      path.join(tenantDir, "actions_v1.json"),
      JSON.stringify(DISK_ACTIONS, null, 2) + "\n",
      "utf8",
    );
  });

  it("hashes the carried-forward actions and still records none as authored", async () => {
    const previousModelsDir = process.env.AGENTIC_MODELS_DIR;
    const previousImportsDir = process.env.AGENTIC_IMPORTS_DIR;
    process.env.AGENTIC_MODELS_DIR = modelsDir;
    process.env.AGENTIC_IMPORTS_DIR = path.join(modelsDir, ".imports");
    let response: Response;
    try {
      response = await env.fetch(`/v1/tenants/${slug}/manifest-import`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-agentic-tenant": slug,
        },
        // No `actions` key: the publish carries a manifest only, which is what
        // the portal's save button and `agentic deploy` send by default.
        body: JSON.stringify({
          mode: "commit",
          workflow,
          confirm_overwrite: true,
        }),
      });
    } finally {
      if (previousModelsDir === undefined) delete process.env.AGENTIC_MODELS_DIR;
      else process.env.AGENTIC_MODELS_DIR = previousModelsDir;
      if (previousImportsDir === undefined)
        delete process.env.AGENTIC_IMPORTS_DIR;
      else process.env.AGENTIC_IMPORTS_DIR = previousImportsDir;
    }

    // The FIRST publish must succeed. Before the fix this was a 500 with
    // `recovery_complete: false`.
    const body = (await response!.json()) as {
      ok: boolean;
      data?: { workflow_version_id: string; deployment_id: string };
      error?: { code: string; message: string };
    };
    expect(
      response!.status,
      `commit failed: ${body.error?.code} — ${body.error?.message}`,
    ).toBe(200);
    expect(body.ok).toBe(true);

    const db = getDb();
    const row = db
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.id, body.data!.workflow_version_id))
      .all()[0]!;
    expect(row).toBeDefined();

    // Identity covers the pair the runtime will load: manifest + the actions
    // already on disk. This is the assertion bootstrap re-derives; if it drifts,
    // bootstrap supersedes this deployment and the route 500s.
    expect(row.version).toBe(
      canonicalWorkflowVersionId(row.manifestJson, DISK_ACTIONS),
    );
    // ...and is therefore NOT the actions-free identity the request alone implies.
    expect(row.version).not.toBe(
      canonicalWorkflowVersionId(row.manifestJson, undefined),
    );

    // Storage keeps its authoring meaning: this publish authored no actions.
    expect(row.actionsJson ?? null).toBeNull();

    // The import — not a bootstrap-inserted row — owns the tenant's live lane.
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
    expect(live.map((d) => d.id)).toEqual([body.data!.deployment_id]);
  });
});
