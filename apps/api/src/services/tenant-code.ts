/**
 * Tenant-code path resolver.
 *
 * Scope (AR-GAP-02 / UC-V11-18 / UC-V11-28 / PF-GAP-02):
 *
 * When a tenant has a live `deployments(target='tenant_code', status='live')`
 * row, ANY caller that wants to load the tenant's compiled / source bundle
 * must look up the on-disk path through this service, not by hand-rolling
 * `path.join("data", "tenants", slug, "dist", "index.cjs")`. The V1 bug was
 * the latter — the path-builder forgot the version segment between `slug`
 * and `dist`, so dynamic `import()` blew up with
 * `Cannot find module '@tenants/raas/dist'` the moment a tenant landed a
 * second `tenant_code` deploy.
 *
 * On-disk layout (planted by `apps/api/src/routes/v1/tenant-code.ts`):
 *   data/tenants/<slug>/<version>/agentic.json   # required (sentinel)
 *   data/tenants/<slug>/<version>/src/index.ts   # tsx + ESM source path
 *   data/tenants/<slug>/<version>/dist/index.cjs # esbuild bundle (CLI deploy)
 *
 * The version segment IS `deployments.versionId → workflow_versions.version`
 * (the CLI passes a free-form string like `0.1.0`; the tenant-code upload
 * route stores it verbatim).
 *
 * Failure modes:
 *   - No live tenant_code deployment → returns null. Caller should fall
 *     through to whatever's wired in `apps/api/src/bootstrap.ts` (the
 *     legacy static `@tenants/<slug>` workspace import).
 *   - Live row but the on-disk dir was manually deleted → returns null and
 *     emits a console.warn — `reconcileImports` will not repair this case
 *     (it only repairs manifest-import staging files). Caller still falls
 *     through to the static registry. Operators get a 200 with stale code.
 *
 * Used from:
 *   - `apps/api/src/routes/v1/agents.ts` — manifest-upload route. Before
 *     touching `deployments`, the route resolves the tenant-code path to
 *     surface a clear 503 instead of letting Inngest re-register blow up.
 *   - (Future) the bootstrap merge of static `TENANT_REGISTRIES` with the
 *     dynamic `loadLiveTenants()` set — once the runtime hot-loader lands.
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import {
  deployments,
  getDb,
  tenants,
  workflowVersions,
} from "@agentic/db";

/** What `resolveTenantCodePath` returns when a live tenant_code exists. */
export interface TenantCodeLocation {
  /** `deployments.id` of the live row (`dpl-…`). */
  deploymentId: string;
  /** Tenant slug (mirror of `tenants.slug`). */
  slug: string;
  /** Free-form version string (e.g. `0.1.0`). Mirror of `workflow_versions.version`. */
  version: string;
  /** Absolute path to `data/tenants/<slug>/<version>/`. Existence verified. */
  dir: string;
  /**
   * Absolute path to `<dir>/dist/index.cjs` IF it exists (esbuild bundle the
   * CLI produces). Falls back to the source entry when the bundle is absent.
   */
  cjsEntry: string | null;
  /** Absolute path to `<dir>/src/index.ts` IF it exists. */
  srcEntry: string | null;
}

/**
 * Resolve where the live tenant_code lives on disk, by tenant id.
 *
 * Returns null when:
 *   - The tenant has no live `target='tenant_code'` deployment, OR
 *   - The deployment row exists but the on-disk dir was deleted.
 *
 * Throws only on DB driver failures (unreachable in normal flow).
 */
export async function resolveTenantCodePath(
  tenantId: string,
): Promise<TenantCodeLocation | null> {
  const db = getDb();

  // Look up tenant slug + live tenant_code deployment + version in one go.
  const row = db
    .select({
      slug: tenants.slug,
      deploymentId: deployments.id,
      version: workflowVersions.version,
    })
    .from(deployments)
    .innerJoin(tenants, eq(tenants.id, deployments.tenantId))
    .innerJoin(
      workflowVersions,
      eq(workflowVersions.id, deployments.versionId),
    )
    .where(
      and(
        eq(deployments.tenantId, tenantId),
        eq(deployments.target, "tenant_code"),
        eq(deployments.status, "live"),
      ),
    )
    .all()[0];

  if (!row) return null;

  const dir = path.join(dataTenantsRoot(), row.slug, row.version);
  if (!existsSync(dir)) {
    console.warn(
      `[tenant-code] live deployment ${row.deploymentId} points at ${dir} but the dir was deleted`,
    );
    return null;
  }

  const cjsEntry = path.join(dir, "dist", "index.cjs");
  const srcEntry = path.join(dir, "src", "index.ts");
  return {
    deploymentId: row.deploymentId,
    slug: row.slug,
    version: row.version,
    dir,
    cjsEntry: existsSync(cjsEntry) ? cjsEntry : null,
    srcEntry: existsSync(srcEntry) ? srcEntry : null,
  };
}

/**
 * Local mirror of `@agentic/runtime#dataTenantsRoot`. Mirrored (rather than
 * imported) because pulling it from the runtime package creates a circular
 * import surface — the api already imports a thin slice of the runtime, and
 * the tenant-code service is consumed by routes that import the api's own
 * services barrel. Keeping the env-var lookup here avoids that loop.
 *
 * Keep in lock-step with `packages/runtime/src/tenant-loader.ts#dataTenantsRoot`.
 */
function dataTenantsRoot(): string {
  const raw = process.env.AGENTIC_TENANTS_DIR;
  if (raw && raw.trim() !== "") {
    return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  }
  return path.resolve(process.cwd(), "data", "tenants");
}
