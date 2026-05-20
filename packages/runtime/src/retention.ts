/**
 * Soft-delete + retention sweep (P1-API-04b).
 *
 * Tombstones (sets `deleted_at`) on rows in `events`, `runs`, `tasks` that are
 * older than the configured retention window. Hard-delete is intentionally
 * separate — the sweep keeps rows queryable through their retention window so
 * compliance + audit can read them; a later vacuum-style step (out of scope
 * for v1) can drop tombstoned rows after a grace period.
 *
 * The sweep is exposed two ways:
 *
 *   1. `runRetentionSweep()` — direct invocation. The API server's nightly
 *      Inngest cron calls this; tests call it inline.
 *
 *   2. `retentionSweepFn` — an Inngest scheduled function that the API
 *      bootstrap registers alongside agent functions. Runs at 03:30 UTC daily.
 *
 * Idempotency: only rows with `deleted_at IS NULL` are considered. Re-running
 * the sweep is a no-op for already-tombstoned rows.
 *
 * Configuration: `AGENTIC_RETENTION_DAYS` env (default 30 days). Set to `0`
 * to disable.
 */

import { events, runs, tasks, getDb } from "@agentic/db";
import { and, isNull, lt, sql } from "drizzle-orm";
import { inngest } from "./client";

export interface RetentionResult {
  events: { tombstoned: number };
  runs: { tombstoned: number };
  tasks: { tombstoned: number };
  ranAt: number;
  cutoffAt: number;
  retentionDays: number;
}

function retentionDays(): number {
  const raw = process.env.AGENTIC_RETENTION_DAYS;
  if (raw === undefined || raw === "") return 30;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 30;
}

export async function runRetentionSweep(): Promise<RetentionResult> {
  const days = retentionDays();
  const ranAt = Date.now();
  const cutoffAt = ranAt - days * 24 * 60 * 60 * 1000;

  // Disabled: just report 0 rows touched.
  if (days === 0) {
    return {
      events: { tombstoned: 0 },
      runs: { tombstoned: 0 },
      tasks: { tombstoned: 0 },
      ranAt,
      cutoffAt,
      retentionDays: 0,
    };
  }

  const db = getDb();
  const cutoffDate = new Date(cutoffAt);
  const now = new Date(ranAt);

  // events: tombstone rows where received_at < cutoff AND not yet tombstoned.
  const eventsResult = db
    .update(events)
    .set({ deletedAt: now })
    .where(
      and(
        isNull(events.deletedAt),
        lt(events.receivedAt, cutoffDate),
      ),
    )
    .run();

  // runs: ended_at < cutoff (don't tombstone unfinished runs). When ended_at
  // is NULL the run is still active; skip.
  const runsResult = db
    .update(runs)
    .set({ deletedAt: now })
    .where(
      and(
        isNull(runs.deletedAt),
        sql`${runs.endedAt} IS NOT NULL`,
        lt(runs.endedAt, cutoffDate),
      ),
    )
    .run();

  // tasks: created_at < cutoff AND status != 'open' (don't tombstone open
  // tasks — they're awaiting human action).
  const tasksResult = db
    .update(tasks)
    .set({ deletedAt: now })
    .where(
      and(
        isNull(tasks.deletedAt),
        lt(tasks.createdAt, cutoffDate),
        sql`${tasks.status} != 'open'`,
      ),
    )
    .run();

  // better-sqlite3 `changes` is the number of rows affected.
  return {
    events: { tombstoned: Number(eventsResult.changes ?? 0) },
    runs: { tombstoned: Number(runsResult.changes ?? 0) },
    tasks: { tombstoned: Number(tasksResult.changes ?? 0) },
    ranAt,
    cutoffAt,
    retentionDays: days,
  };
}

/**
 * Inngest scheduled function. Registered alongside agent functions in
 * `apps/api/src/bootstrap.ts` so it ships in the same Inngest worker.
 *
 * Cron: 30 03 * * *  →  every day at 03:30 UTC. Off-peak for typical
 * Western workloads.
 */
import type { InngestFunction } from "inngest";

export const retentionSweepFn: InngestFunction.Any = inngest.createFunction(
  {
    id: "agentic.retention.sweep",
    name: "Retention sweep (P1-API-04b)",
    triggers: [{ cron: "30 3 * * *" }],
  },
  async () => {
    const result = await runRetentionSweep();
    console.log(
      `[retention] sweep: events=${result.events.tombstoned} runs=${result.runs.tombstoned} tasks=${result.tasks.tombstoned} (cutoff ${result.retentionDays}d)`,
    );
    return result;
  },
);
