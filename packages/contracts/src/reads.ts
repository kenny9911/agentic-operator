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
});
export type HealthReport = z.infer<typeof HealthReport>;
