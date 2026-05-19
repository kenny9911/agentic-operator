import type { FastifyInstance } from "fastify";
import path from "node:path";
import { stat, statfs } from "node:fs/promises";
import { getRawSqlite } from "@agentic/db";
import type { HealthReport } from "@agentic/contracts";

/**
 * GET /health — unauthenticated, suitable for load balancers / uptime checks.
 * Per DESIGN.md §12.
 */
export async function healthRoute(app: FastifyInstance) {
  app.get("/health", async (_req, reply) => {
    const [inngest, sqlite, disk] = await Promise.all([
      checkInngest(),
      checkSqlite(),
      checkDisk(),
    ]);
    const report: HealthReport = {
      ok: inngest.ok && sqlite.ok && disk.ok,
      inngest,
      sqlite,
      disk,
    };
    reply.status(report.ok ? 200 : 503).send(report);
  });
}

async function checkInngest(): Promise<HealthReport["inngest"]> {
  if (process.env.INNGEST_DEV === "1" || !process.env.INNGEST_BASE_URL) {
    return { ok: true, note: "dev mode" };
  }
  try {
    const r = await fetch(`${process.env.INNGEST_BASE_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return { ok: r.ok, reachable: true };
  } catch {
    return { ok: false, reachable: false };
  }
}

async function checkSqlite(): Promise<HealthReport["sqlite"]> {
  try {
    const dbPath =
      process.env.DATABASE_URL?.replace(/^file:/, "") ?? "./agentic.db";
    const st = await stat(dbPath);
    const sql = getRawSqlite();
    const mode = sql.pragma("journal_mode", { simple: true }) as string;
    sql.prepare("SELECT 1 as ok").get();
    return { ok: true, sizeBytes: st.size, journalMode: mode };
  } catch {
    return { ok: false };
  }
}

async function checkDisk(): Promise<HealthReport["disk"]> {
  const logsDir = process.env.AGENTIC_LOGS_DIR ?? "./logs";
  try {
    const sfs = await statfs(path.resolve(logsDir));
    return {
      ok: true,
      logsDir,
      freeBytes: Number(sfs.bavail) * sfs.bsize,
    };
  } catch {
    return { ok: false, logsDir };
  }
}
