import { z } from "zod";

/** Aggregate counts for the sidebar + dashboard KPI strip. */
export const TenantCounts = z.object({
  agents: z.number(),
  runningRuns: z.number(),
  okRuns24h: z.number(),
  failedRuns24h: z.number(),
  events24h: z.number(),
  openTasks: z.number(),
  totalRuns: z.number(),
});
export type TenantCounts = z.infer<typeof TenantCounts>;

/** Health endpoint — unauthenticated, used by load balancers / `/api/health`. */
export const HealthReport = z.object({
  ok: z.boolean(),
  /** Server wall-clock timestamp at the moment the report was generated (ms). */
  ts: z.number().optional(),
  /** Process uptime in seconds. */
  uptime: z.number().optional(),
  /** apps/api package.json version. Surfaces on the Settings → System pane. */
  version: z.string().optional(),
  /**
   * Current workflow-manifest schema version this api understands. Bumped
   * in lockstep with `@agentic/runtime`'s `CURRENT_SCHEMA_VERSION` so the
   * manifest-import wizard can detect a forward-incompat manifest.
   */
  schemaVersion: z.string().optional(),
  inngest: z.object({
    ok: z.boolean(),
    reachable: z.boolean().optional(),
    note: z.string().optional(),
  }),
  sqlite: z.object({
    ok: z.boolean(),
    sizeBytes: z.number().optional(),
    journalMode: z.string().optional(),
  }),
  disk: z.object({
    ok: z.boolean(),
    logsDir: z.string().optional(),
    freeBytes: z.number().optional(),
  }),
  /**
   * LLM gateway subsystem — exposes the default provider/model so support
   * can confirm a hot-deploy actually picked up the env override (P4-API-04).
   */
  llmGateway: z
    .object({
      ok: z.boolean(),
      defaultProvider: z.string().optional(),
      defaultModel: z.string().optional(),
      providers: z.number().optional(),
    })
    .optional(),
  /**
   * AGENTIC_DEMO_MODE flag (locked 2026-05-26). Surfaced on /health so the
   * sidebar can render a "DEMO" badge in the UI without depending on the
   * env reaching the browser. Optional so older api builds (without this
   * field) still parse cleanly on a newer web client; the web treats
   * undefined as `false`.
   */
  demoMode: z.boolean().optional(),
});
export type HealthReport = z.infer<typeof HealthReport>;
