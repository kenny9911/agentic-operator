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
