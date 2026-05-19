/**
 * Log rotation — compresses run + event log files older than 7 days.
 *
 * Per PRD §5.2: "Log rotation (daily), compression for >7d files".
 *
 * Run manually or schedule via cron:
 *   pnpm --filter @agentic/runtime exec tsx src/log-rotate.ts
 *
 * Production: register a daily Inngest cron function that calls this.
 */

import { readdir, stat, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { createGzip } from "node:zlib";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

async function gzipFile(src: string): Promise<void> {
  const dst = `${src}.gz`;
  await pipeline(createReadStream(src), createGzip(), createWriteStream(dst));
  await unlink(src);
}

async function safeReaddir(p: string): Promise<string[]> {
  try {
    return await readdir(p);
  } catch {
    return [];
  }
}

async function walkAndRotate(root: string): Promise<{ rotated: number; skipped: number }> {
  const cutoff = Date.now() - SEVEN_DAYS_MS;
  let rotated = 0;
  let skipped = 0;

  const tenants = await safeReaddir(root);
  for (const tenant of tenants) {
    const runsRoot = path.join(root, tenant, "runs");
    const eventsRoot = path.join(root, tenant, "events");

    for (const subRoot of [runsRoot, eventsRoot]) {
      const dates = await safeReaddir(subRoot);
      for (const d of dates) {
        const dPath = path.join(subRoot, d);
        try {
          const stDir = await stat(dPath);
          if (!stDir.isDirectory()) {
            // .ndjson file at events root (per-day file)
            if (d.endsWith(".ndjson") && stDir.mtimeMs < cutoff) {
              await gzipFile(dPath);
              rotated++;
            } else skipped++;
            continue;
          }
          const files = await safeReaddir(dPath);
          for (const f of files) {
            const full = path.join(dPath, f);
            const stFile = await stat(full);
            if (stFile.mtimeMs >= cutoff) {
              skipped++;
              continue;
            }
            if (f.endsWith(".gz")) {
              skipped++;
              continue;
            }
            if (f.endsWith(".log") || f.endsWith(".ndjson")) {
              await gzipFile(full);
              rotated++;
            }
          }
        } catch {
          // skip permission errors
        }
      }
    }
  }
  return { rotated, skipped };
}

const logRoot = process.env.AGENTIC_LOGS_DIR ?? "./logs";
walkAndRotate(logRoot)
  .then((r) =>
    console.log(
      `[log-rotate] done — rotated ${r.rotated} file(s), skipped ${r.skipped}`,
    ),
  )
  .catch((err) => {
    console.error("[log-rotate] failed", err);
    process.exit(1);
  });
