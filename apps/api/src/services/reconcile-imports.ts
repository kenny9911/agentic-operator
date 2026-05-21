/**
 * Boot-time crash recovery for the manifest-import wizard.
 *
 * Three failure modes the commit transaction may leave behind, per
 * `docs/design/import-workflow-manifest.md` §"Commit transaction sequence":
 *
 *   1. EXPIRED PENDING — `status='pending' AND expires_at < now()`. The
 *      operator abandoned a validate; the row + its workflow_version + the
 *      `data/imports/<deployment_id>/` tmp dir should all be removed.
 *
 *   2. CRASHED RENAME — `status='live' AND file_path LIKE 'data/imports/%'`.
 *      Phase 3 (DB commit) succeeded but phase 4 (rename + re-register) did
 *      not. The DB says the new version is live; the runtime would load
 *      the OLD manifest from disk because the new one is still under
 *      `data/imports/<deployment_id>/workflow.json`. Complete the rename,
 *      then `reregisterInngest`.
 *
 *   3. MISSING ON-DISK FILE — `status='live' AND file_path NOT NULL AND
 *      file_path missing on disk`. Someone manually deleted the file. The
 *      DB still has `workflow_versions.manifest_json` (it's the durable
 *      source of truth for in-flight replays per `migrations/index.ts:13`),
 *      so we re-emit the file from there.
 *
 * Idempotent. Safe to re-run.
 */

import { mkdir, readdir, rm, stat, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import {
  deployments,
  workflowVersions,
  workflows,
  tenants,
  getDb,
} from "@agentic/db";
import { and, eq, isNotNull, like, lt } from "drizzle-orm";
import { tenantSlugFromFolder, publishStreamEvent } from "@agentic/runtime";

type Db = ReturnType<typeof getDb>;

function importsRoot(): string {
  return process.env.AGENTIC_IMPORTS_DIR
    ? process.env.AGENTIC_IMPORTS_DIR
    : path.join(process.env.AGENTIC_DATA_DIR ?? "./data", "imports");
}

function modelsRoot(): string {
  const env = process.env.AGENTIC_MODELS_DIR;
  if (!env) return path.resolve(process.cwd(), "models");
  return path.isAbsolute(env) ? env : path.resolve(process.cwd(), env);
}

/** Return the tenant model dirs sorted by version desc (mirrors workflowRoutes). */
async function findTenantDirs(
  slug: string,
): Promise<Array<{ folder: string; version: number; absDir: string }>> {
  const root = modelsRoot();
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const matches: Array<{ folder: string; version: number; absDir: string }> = [];
  for (const folder of entries) {
    if (folder.startsWith(".")) continue;
    const abs = path.join(root, folder);
    let isDir = false;
    try {
      isDir = (await stat(abs)).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    if (tenantSlugFromFolder(folder) !== slug) continue;
    const m = folder.match(/-v(\d+)$/i);
    const version = m ? Number(m[1]) : 1;
    matches.push({ folder, version, absDir: abs });
  }
  matches.sort((a, b) => b.version - a.version);
  return matches;
}

async function nextWorkflowVN(targetDir: string): Promise<string> {
  let files: string[] = [];
  try {
    files = await readdir(targetDir);
  } catch {
    files = [];
  }
  let max = 0;
  const re = /^workflow(?:_v(\d+))?\.json$/i;
  for (const f of files) {
    const m = f.match(re);
    if (!m) continue;
    const v = m[1] ? Number(m[1]) : 1;
    if (v > max) max = v;
  }
  return `workflow_v${max + 1}.json`;
}

interface ReconcileSummary {
  expired_pruned: number;
  rename_completed: number;
  missing_file_repaired: number;
  failures: number;
}

/** Look up tenant slug for a deployment row via the workflow_version → workflow → tenant chain. */
function tenantSlugForDeployment(
  db: Db,
  deploymentId: string,
): { slug: string; tenantId: string } | null {
  const row = db
    .select({
      tenantId: tenants.id,
      slug: tenants.slug,
    })
    .from(deployments)
    .innerJoin(workflowVersions, eq(workflowVersions.id, deployments.versionId))
    .innerJoin(workflows, eq(workflows.id, workflowVersions.workflowId))
    .innerJoin(tenants, eq(tenants.id, workflows.tenantId))
    .where(eq(deployments.id, deploymentId))
    .all()[0];
  return row ? { slug: row.slug, tenantId: row.tenantId } : null;
}

/**
 * Run the three recovery sweeps. Returns a summary; never throws.
 *
 * @param db - the database connection. Pass `getDb()`.
 * @param opts.reregister - optional callback to re-register Inngest functions
 *                          for a tenant after a crashed-rename repair.
 *                          When undefined the repair still completes the
 *                          rename + updates `file_path`; the runtime picks
 *                          up the new manifest the next time `bootstrapAll`
 *                          runs (typically the same boot, immediately).
 */
export async function reconcileImports(
  db: Db,
  opts: {
    reregister?: (tenantSlug: string) => Promise<void>;
  } = {},
): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = {
    expired_pruned: 0,
    rename_completed: 0,
    missing_file_repaired: 0,
    failures: 0,
  };

  // ── 1. EXPIRED PENDING ────────────────────────────────────────────────
  const now = new Date();
  const expired = db
    .select()
    .from(deployments)
    .where(
      and(
        eq(deployments.status, "pending"),
        lt(deployments.expiresAt, now),
      ),
    )
    .all();
  for (const row of expired) {
    try {
      db.transaction(() => {
        db.delete(deployments).where(eq(deployments.id, row.id)).run();
        db.delete(workflowVersions)
          .where(eq(workflowVersions.id, row.versionId))
          .run();
      });
      await rm(path.join(importsRoot(), row.id), {
        recursive: true,
        force: true,
      });
      summary.expired_pruned += 1;
    } catch {
      summary.failures += 1;
    }
  }

  // ── 2. CRASHED RENAME ─────────────────────────────────────────────────
  // Live rows whose file_path still points at the tmp staging dir. Phase 4
  // never finished. Complete the rename and re-register.
  const stranded = db
    .select()
    .from(deployments)
    .where(
      and(
        eq(deployments.status, "live"),
        like(deployments.filePath, `%data/imports/%`),
      ),
    )
    .all();
  // Some platforms may have absolute paths; the LIKE above also catches
  // `/abs/path/.../data/imports/...`. Filter again on path segment to be safe.
  for (const row of stranded.filter((r) => r.filePath?.includes("data/imports/") ?? false)) {
    try {
      const tenantRow = tenantSlugForDeployment(db, row.id);
      if (!tenantRow) {
        summary.failures += 1;
        continue;
      }
      // Verify the tmp file actually exists; if not, fall through to the
      // missing-file branch below.
      const tmpPath = row.filePath!;
      let tmpExists = false;
      try {
        await stat(tmpPath);
        tmpExists = true;
      } catch {
        tmpExists = false;
      }
      if (!tmpExists) continue; // handled below
      // Pick / reserve the final filename in the tenant's models folder.
      const dirs = await findTenantDirs(tenantRow.slug);
      let targetDir: string;
      if (dirs.length === 0) {
        targetDir = path.join(modelsRoot(), `${tenantRow.slug}-v1`);
        await mkdir(targetDir, { recursive: true });
      } else {
        targetDir = dirs[0]!.absDir;
      }
      const nextName = await nextWorkflowVN(targetDir);
      const finalPath = path.join(targetDir, nextName);
      await rename(tmpPath, finalPath);
      // Best-effort: rename actions.json too if present.
      const tmpDir = path.dirname(tmpPath);
      const tmpActions = path.join(tmpDir, "actions.json");
      try {
        await stat(tmpActions);
        const versionMatch = nextName.match(/v(\d+)/);
        const v = versionMatch ? versionMatch[1] : "1";
        const finalActions = path.join(targetDir, `actions_v${v}.json`);
        await rename(tmpActions, finalActions);
      } catch {
        /* no actions file */
      }
      db.update(deployments)
        .set({ filePath: finalPath })
        .where(eq(deployments.id, row.id))
        .run();
      // Clean up the now-empty tmp dir.
      try {
        await rm(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      if (opts.reregister) {
        await opts.reregister(tenantRow.slug);
      }
      // UC-V11-06 — emit `deployment.created` so any portal session that
      // re-establishes its SSE stream after the crash sees the recovered
      // deployment in its toast / list. Best-effort: a publish failure does
      // not roll back the rename. (`workflow_versions.version` is the
      // canonical version label; fall back to the row id if absent.)
      try {
        const wfv = db
          .select({ version: workflowVersions.version })
          .from(workflowVersions)
          .where(eq(workflowVersions.id, row.versionId))
          .all()[0];
        publishStreamEvent({
          type: "deployment.created",
          tenantId: tenantRow.tenantId,
          at: Date.now(),
          deploymentId: row.id,
          kind: "manifest",
          version: wfv?.version ?? row.id,
          workflowSlug: tenantRow.slug,
        });
      } catch {
        /* publish best-effort */
      }
      summary.rename_completed += 1;
    } catch {
      summary.failures += 1;
    }
  }

  // ── 3. MISSING ON-DISK FILE ───────────────────────────────────────────
  // Live rows whose file_path is set but the file doesn't exist on disk.
  // The DB is the source of truth (workflow_versions.manifest_json); re-emit.
  const liveWithFile = db
    .select()
    .from(deployments)
    .where(
      and(
        eq(deployments.status, "live"),
        isNotNull(deployments.filePath),
      ),
    )
    .all();
  for (const row of liveWithFile) {
    try {
      if (!row.filePath) continue;
      // Skip stranded-tmp survivors (handled above).
      if (row.filePath.includes("data/imports/")) continue;
      let exists = true;
      try {
        await stat(row.filePath);
      } catch {
        exists = false;
      }
      if (exists) continue;
      // Re-emit from the workflow_versions row.
      const wfv = db
        .select()
        .from(workflowVersions)
        .where(eq(workflowVersions.id, row.versionId))
        .all()[0];
      if (!wfv) {
        summary.failures += 1;
        continue;
      }
      await mkdir(path.dirname(row.filePath), { recursive: true });
      await writeFile(
        row.filePath,
        JSON.stringify(wfv.manifestJson, null, 2) + "\n",
        "utf8",
      );
      summary.missing_file_repaired += 1;
    } catch {
      summary.failures += 1;
    }
  }

  return summary;
}
