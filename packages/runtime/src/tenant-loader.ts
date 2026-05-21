/**
 * tenant-loader — P3-RT-08.
 *
 * Reads `data/tenants/<slug>/<version>/agentic.json` at boot and dynamically
 * `import()`s the tenant's `src/index.ts` (the `TenantRegistry` default
 * export). This is what makes "ship a new tenant without monorepo edits"
 * actually work: the api process no longer needs `@tenants/<slug>` declared in
 * its package.json — anything under `data/tenants/` is discovered + loaded at
 * runtime.
 *
 * Live version selection:
 *   1. If `deployments` has a `target='tenant_code'` row with status='live'
 *      for this tenant, use that version.
 *   2. Else, fall back to the highest-numbered `<version>/` dir on disk
 *      (semver-ish lexical sort works for our `0.1.0` style).
 *   3. Else, return null and the runtime falls back to whatever's wired up in
 *      `apps/api/src/bootstrap.ts#TENANT_REGISTRIES` (the legacy `tenants/`
 *      workspace path).
 *
 * Atomic switch model:
 *   - A new deployment row flips the live pointer.
 *   - `dataTenantsRoot()/<slug>/<version>/agentic.json` MUST exist.
 *   - On rollback, the prior version dir is still on disk; we just point at
 *     it again. We never delete a previous version's files automatically.
 *
 * Hot-reload concern:
 *   - Node caches modules by absolute URL. To pick up a new version of a
 *     tenant package on the same path, we append `?v=<version>&t=<mtime>` to
 *     the dynamic import URL so each load is a unique cache key. tsx supports
 *     query-string URLs for .ts modules.
 */

import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { and, eq } from "drizzle-orm";
import {
  deployments,
  getDb,
  tenants,
  workflowVersions,
} from "@agentic/db";
import type { TenantRegistry } from "@agentic/agent-sdk";

/**
 * `agentic.json` shape per DESIGN.md §11.2.
 *
 * Loose-validated so a tenant author can ship forward-compatible extras
 * without us bumping the schema version every minor release.
 */
export interface TenantManifest {
  slug: string;
  name?: string;
  schemaVersion?: number;
  manifests?: string[];
  code?: { registry?: string };
  createdAt?: string;
}

export interface LoadedTenant {
  slug: string;
  version: string;
  dir: string;
  manifest: TenantManifest;
  registry: TenantRegistry | null;
}

/**
 * Resolve the data/tenants root. Override via AGENTIC_TENANTS_DIR for
 * packaged builds; defaults to `<cwd>/data/tenants`.
 */
export function dataTenantsRoot(): string {
  const raw = process.env.AGENTIC_TENANTS_DIR;
  if (raw && raw.trim() !== "") {
    return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  }
  return path.resolve(process.cwd(), "data", "tenants");
}

/**
 * List every `<slug>/<version>` pair found under `data/tenants/`.
 *
 * Skips:
 *   - Hidden dirs (`.git`, `.DS_Store`).
 *   - Slugs with no `<version>/agentic.json` file.
 *
 * The result is sorted by `(slug, version)` so callers iterate
 * deterministically.
 */
export async function listTenantVersions(): Promise<
  Array<{ slug: string; version: string; dir: string }>
> {
  const root = dataTenantsRoot();
  if (!existsSync(root)) return [];
  const slugs = (await fs.readdir(root, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();
  const out: Array<{ slug: string; version: string; dir: string }> = [];
  for (const slug of slugs) {
    const slugDir = path.join(root, slug);
    let versions: string[];
    try {
      versions = (await fs.readdir(slugDir, { withFileTypes: true }))
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map((d) => d.name)
        .sort();
    } catch {
      continue;
    }
    for (const v of versions) {
      const dir = path.join(slugDir, v);
      if (existsSync(path.join(dir, "agentic.json"))) {
        out.push({ slug, version: v, dir });
      }
    }
  }
  return out;
}

/**
 * Resolve the live version for a tenant.
 *
 * Order:
 *   1. `deployments(target='tenant_code', status='live')` row's `version_id`,
 *      which we encode as `workflow_versions.version` set to the tenant code
 *      version string (e.g. "0.1.0"). Joins `workflow_versions` to read it.
 *   2. Highest-sorted version directory on disk for that slug.
 *   3. null.
 */
export async function resolveLiveVersion(
  slug: string,
): Promise<string | null> {
  // ── 1. DB-tracked live pointer ─────────────────────────────────────────
  const db = getDb();
  const tenant = db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .all()[0];
  if (tenant) {
    const live = db
      .select({ version: workflowVersions.version })
      .from(deployments)
      .innerJoin(
        workflowVersions,
        eq(workflowVersions.id, deployments.versionId),
      )
      .where(
        and(
          eq(deployments.tenantId, tenant.id),
          eq(deployments.target, "tenant_code"),
          eq(deployments.status, "live"),
        ),
      )
      .all()[0];
    if (live?.version) {
      const dir = path.join(dataTenantsRoot(), slug, live.version);
      if (existsSync(path.join(dir, "agentic.json"))) return live.version;
      // Pointer is stale (someone deleted the dir manually). Fall through.
    }
  }

  // ── 2. Disk fallback ───────────────────────────────────────────────────
  const all = await listTenantVersions();
  const forSlug = all.filter((x) => x.slug === slug).map((x) => x.version);
  if (forSlug.length === 0) return null;
  return forSlug[forSlug.length - 1] ?? null;
}

/**
 * Load a tenant by slug + version. Reads `agentic.json` and dynamically
 * `import()`s the registry entrypoint.
 *
 * Returns null when the dir is missing or `agentic.json` can't be parsed.
 * Throws when the dir is found but the registry import fails — that's a
 * programmer error worth surfacing.
 */
export async function loadTenant(
  slug: string,
  version: string,
): Promise<LoadedTenant | null> {
  const dir = path.join(dataTenantsRoot(), slug, version);
  const manifestPath = path.join(dir, "agentic.json");
  if (!existsSync(manifestPath)) return null;

  let manifest: TenantManifest;
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    manifest = JSON.parse(raw) as TenantManifest;
  } catch (err) {
    console.warn(
      `[tenant-loader] ${slug}@${version}: agentic.json unreadable`,
      err,
    );
    return null;
  }
  if (manifest.slug && manifest.slug !== slug) {
    console.warn(
      `[tenant-loader] ${slug}@${version}: agentic.json slug=${manifest.slug} mismatch`,
    );
  }

  const registryRel = manifest.code?.registry;
  let registry: TenantRegistry | null = null;
  if (registryRel) {
    const registryAbs = path.join(dir, registryRel);
    if (!existsSync(registryAbs)) {
      // Some authors omit the explicit .ts extension; try that.
      const alt = registryAbs.endsWith(".ts") ? null : `${registryAbs}.ts`;
      if (alt && existsSync(alt)) {
        registry = await importTenantRegistry(alt, version);
      } else {
        console.warn(
          `[tenant-loader] ${slug}@${version}: registry file missing at ${registryRel}`,
        );
      }
    } else {
      registry = await importTenantRegistry(registryAbs, version);
    }
  }

  return { slug, version, dir, manifest, registry };
}

/**
 * Dynamic import with a cache-busting query string. Node caches by URL, so
 * appending `?v=<version>&t=<mtime>` ensures hot-reload picks up a re-saved
 * file. The query string is ignored by the loader (tsx + Node's ESM loader
 * tolerate it).
 */
async function importTenantRegistry(
  absPath: string,
  version: string,
): Promise<TenantRegistry | null> {
  try {
    const st = await fs.stat(absPath);
    const url = `${pathToFileURL(absPath).href}?v=${encodeURIComponent(
      version,
    )}&t=${st.mtimeMs}`;
    const mod = (await import(url)) as { default?: TenantRegistry };
    return mod.default ?? null;
  } catch (err) {
    console.error(
      `[tenant-loader] failed to import tenant registry at ${absPath}`,
      err,
    );
    throw err;
  }
}

/**
 * Convenience: discover + load the LIVE version of every tenant on disk.
 *
 * Returns one entry per slug (only the resolved live version). Used by the
 * runtime bootstrap to compose the legacy hard-wired `TENANT_REGISTRIES`
 * with anything that's been deployed dynamically.
 */
export async function loadLiveTenants(): Promise<Map<string, LoadedTenant>> {
  const out = new Map<string, LoadedTenant>();
  const all = await listTenantVersions();
  const slugs = Array.from(new Set(all.map((x) => x.slug)));
  for (const slug of slugs) {
    const v = await resolveLiveVersion(slug);
    if (!v) continue;
    const loaded = await loadTenant(slug, v);
    if (loaded) out.set(slug, loaded);
  }
  return out;
}

/**
 * Sprint 4 — Prompt-Registry Isolator (F-S3-1 follow-up).
 *
 * Architecture invariant: the tenant prompt registry is NOT a module-level
 * singleton. Each `bootstrapTenant({ tenantRegistry })` call carries its own
 * fresh `TenantRegistry` reference (a plain object whose `.prompts` map is
 * keyed by `action.name`). `definePrompt()` is a pure factory in
 * `@agentic/agent-kit` / `@agentic/agent-sdk` — it returns a descriptor
 * without registering it anywhere global.
 *
 * Sprint 3 verifier filed F-S3-1 hypothesizing that "earlier tests mutate
 * the prompt registry singleton, leaving subsequent tc-11 runs broken." An
 * end-to-end audit confirmed this is not the case: there is no shared
 * mutable state to pollute. Sprint 3's intermittent tc-11 failures traced
 * back to either (a) stale `data/agentic.db` schema where a migration
 * regressed (`archived_at` column missing in worktree DBs), or (b) a
 * Node-binding ABI skew between the test binary and `better-sqlite3.node`.
 * Both were resolved by `pnpm rebuild better-sqlite3` + `pnpm db:migrate`.
 *
 * This export remains as a **documented reset hook** so future contributors
 * who *do* introduce module-level prompt caching have a single, well-known
 * place to wire the invalidation. The current implementation is a no-op by
 * design — calling it should never break a test, and it should never need
 * to be called from production code.
 *
 * To verify the invariant holds at test time, prefer
 * `assertTenantRegistryComplete(slug, registry, requiredActionNames)` in
 * a `beforeEach` rather than reaching for this reset hook.
 */
export function __resetPromptRegistry(): void {
  // No-op. See docblock above. Kept as the named hook for forward
  // compatibility per Sprint 4 partition guidance.
}

/**
 * Sprint 4 — Defensive assert that a tenant registry exposes every prompt a
 * manifest's `logic` actions reference. Throws a single concise diagnostic
 * naming the missing keys; intended for use in test `beforeEach` blocks
 * (and any future hot-reload path) to fail loud and early when a registry
 * has been wired with a partial `prompts` map.
 *
 * This is a strictly stronger statement than `findMissingTenantPrompts` in
 * `register.ts`: that helper walks the manifest to compute missing entries
 * at boot. This helper accepts the expected key list directly so tests can
 * lock down the contract without re-loading manifests.
 *
 * Returns silently when every required key is present. The returned object
 * is only useful for assertions that want to count entries — most callers
 * should just rely on the throw.
 */
export function assertTenantRegistryComplete(
  slug: string,
  registry: { prompts?: Record<string, unknown> } | null | undefined,
  requiredActionNames: ReadonlyArray<string>,
): { matched: number; required: number } {
  const prompts = registry?.prompts ?? {};
  const missing = requiredActionNames.filter((name) => !prompts[name]);
  if (missing.length > 0) {
    throw new Error(
      `[tenant ${slug}] registry missing ${missing.length} prompt(s): ${missing.join(", ")}`,
    );
  }
  return {
    matched: requiredActionNames.length,
    required: requiredActionNames.length,
  };
}
