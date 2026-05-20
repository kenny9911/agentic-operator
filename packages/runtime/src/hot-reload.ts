/**
 * hot-reload — P3-RT-09.
 *
 * Dev-only file watcher for `data/tenants/*` and `models/*`. On any change
 * (add / change / delete), debounces 250ms and fires the registered callback
 * with `{ tenantSlug?, kind: "tenant_code" | "manifest" }` so the caller can
 * re-register Inngest functions for the affected slug.
 *
 * Why `node:fs.watch` and not chokidar:
 *   - chokidar isn't a workspace dep. Adding it for one dev-only feature isn't
 *     worth the audit cost.
 *   - `fs.watch` with `{ recursive: true }` works on macOS + Linux. On Linux
 *     w/ kernels <6.x it's flaky; the workaround (re-walking) is acceptable
 *     because dev-only.
 *
 * Lifecycle:
 *   - `startHotReload({ onChange, modelsDir, tenantsDir })` returns a `stop()`
 *     fn.
 *   - The watcher is a NO-OP when `NODE_ENV === "production"`.
 *
 * Coordination with the loader:
 *   - This file only fires the callback. The caller decides whether to
 *     re-bootstrap the affected tenant. See `apps/api/src/bootstrap.ts`
 *     glue for the wiring.
 */

import { watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import path from "node:path";
import { existsSync } from "node:fs";
import { dataTenantsRoot } from "./tenant-loader";

export type HotReloadKind = "tenant_code" | "manifest";

export interface HotReloadChange {
  kind: HotReloadKind;
  tenantSlug?: string;
  filePath: string;
}

export interface HotReloadOptions {
  /** Where `models/` lives. Defaults to `process.env.AGENTIC_MODELS_DIR`. */
  modelsDir?: string;
  /** Where `data/tenants/` lives. Defaults to `dataTenantsRoot()`. */
  tenantsDir?: string;
  /**
   * Called once per debounced burst. Implementations should re-run bootstrap
   * for the affected slug; the watcher itself stays naive.
   */
  onChange: (change: HotReloadChange) => void;
  /** ms to debounce successive events (default 250). */
  debounceMs?: number;
}

/**
 * Public handle. `stop()` unwatches everything; subsequent calls are no-ops.
 */
export interface HotReloadHandle {
  stop: () => void;
  /** True when at least one watcher is active. False in production. */
  readonly active: boolean;
}

/**
 * Derive a slug from a path under `data/tenants/<slug>/...` or
 * `models/<folder>/...`. Returns undefined if neither prefix matches.
 */
function deriveSlug(
  filePath: string,
  modelsDir: string,
  tenantsDir: string,
): { kind: HotReloadKind; slug?: string } | null {
  const norm = path.resolve(filePath);
  if (norm.startsWith(path.resolve(tenantsDir) + path.sep)) {
    const rel = path.relative(tenantsDir, norm);
    const slug = rel.split(path.sep)[0];
    return { kind: "tenant_code", slug };
  }
  if (norm.startsWith(path.resolve(modelsDir) + path.sep)) {
    const rel = path.relative(modelsDir, norm);
    const folder = rel.split(path.sep)[0];
    if (!folder) return null;
    // Same slug derivation the runtime uses for folder→tenant.
    const slug = folder.toLowerCase().replace(/-v\d+(\.\d+)*$/i, "");
    return { kind: "manifest", slug };
  }
  return null;
}

/**
 * Start watching `data/tenants/*` and `models/*` for changes.
 *
 * No-op when NODE_ENV=production. Returns a handle whose `stop()` releases
 * every watcher and any in-flight debounce timer.
 */
export function startHotReload(opts: HotReloadOptions): HotReloadHandle {
  if (process.env.NODE_ENV === "production") {
    return { stop: () => {}, active: false };
  }

  const modelsDir =
    opts.modelsDir ?? process.env.AGENTIC_MODELS_DIR ?? "models";
  const tenantsDir = opts.tenantsDir ?? dataTenantsRoot();
  const debounceMs = opts.debounceMs ?? 250;

  const watchers: FSWatcher[] = [];
  // One pending change per slug+kind so multiple file events collapse.
  const pending = new Map<string, HotReloadChange>();
  let timer: NodeJS.Timeout | null = null;

  function fire() {
    for (const change of pending.values()) {
      try {
        opts.onChange(change);
      } catch (err) {
        console.error("[hot-reload] onChange threw", err);
      }
    }
    pending.clear();
    timer = null;
  }

  function enqueue(filePath: string) {
    const derived = deriveSlug(filePath, modelsDir, tenantsDir);
    if (!derived) return;
    const key = `${derived.kind}:${derived.slug ?? ""}`;
    pending.set(key, {
      kind: derived.kind,
      tenantSlug: derived.slug,
      filePath,
    });
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, debounceMs);
  }

  function watchDir(dir: string) {
    if (!existsSync(dir)) return;
    try {
      const w = watch(dir, { recursive: true }, (_event, name) => {
        if (!name) return;
        enqueue(path.join(dir, name.toString()));
      });
      w.on("error", (err) => {
        console.warn(`[hot-reload] watch error on ${dir}`, err);
      });
      watchers.push(w);
    } catch (err) {
      console.warn(`[hot-reload] failed to watch ${dir}`, err);
    }
  }

  watchDir(modelsDir);
  watchDir(tenantsDir);

  return {
    stop() {
      if (timer) clearTimeout(timer);
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          // ignore
        }
      }
      watchers.length = 0;
      pending.clear();
    },
    get active() {
      return watchers.length > 0;
    },
  };
}
