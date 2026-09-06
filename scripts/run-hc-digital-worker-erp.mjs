#!/usr/bin/env node
/**
 * Run a second mock Meta ERP against the 场景二「数字化员工」package.
 *
 *   node scripts/run-hc-digital-worker-erp.mjs      # or: pnpm dw:erp
 *
 * WHY A SECOND INSTANCE
 * ---------------------
 * The mock ERP serves ONE package's data plane: its `_index.json` decides which
 * query ops exist and which table backs each. 场景一 and 场景二 declare
 * different objects, so one instance cannot answer for both — and pointing
 * 场景二 at 场景一's data dir would 404 on every new read.
 *
 * So this runs on its own port and its own data dir, and the two coexist:
 *
 *   :3620  hc-procurement   (pnpm hc:erp)
 *   :3621  hc-digital-worker (this script)
 *
 * The tenant's `metaerp.invoke` binding picks the right one through
 * `base_url_env` — see METAERP_DIGITAL_WORKER_BASE_URL in .env.example.
 *
 * START ORDER MATTERS: bring this up AFTER the api, for the same reason
 * scripts/run-hc-procurement-erp.mjs documents — `stop-dev.sh` kills anything
 * matching `tsx.*src/server\.ts`, which is exactly this service's argv.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_DIR = path.join(ROOT, "ontology-packages", "hc-digital-worker", "package");
const dataDir = path.join(PACKAGE_DIR, "mock-erp");
const transformMaps = path.join(PACKAGE_DIR, "transform-maps", "transform-maps.json");
const PORT = process.env.MOCK_ERP_DIGITAL_WORKER_PORT ?? "3621";
// apps/mock-erp reads MOCK_ERP_PORT, not PORT.

for (const required of [path.join(dataDir, "_index.json"), transformMaps]) {
  if (!existsSync(required)) {
    console.error(
      `[dw-erp] missing ${path.relative(ROOT, required)} — run \`pnpm dw:compile\` first`,
    );
    process.exit(1);
  }
}

const child = spawn(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  ["--filter", "@agentic/mock-erp", "run", "start"],
  {
    cwd: ROOT,
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      MOCK_ERP_DATA_DIR: dataDir,
      MOCK_ERP_TRANSFORM_MAPS: transformMaps,
      MOCK_ERP_PORT: PORT,
    },
  },
);
child.on("exit", (code) => process.exit(code ?? 0));
