import { z } from "zod";

export const RunStatus = z.enum([
  "queued",
  "running",
  "ok",
  "failed",
  "waiting",
  "cancelled",
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const StepType = z.enum(["tool", "logic", "manual"]);
export const StepStatus = z.enum([
  "pending",
  "running",
  "ok",
  "failed",
  "skipped",
]);

export const RunRow = z.object({
  id: z.string(),
  status: RunStatus,
  agentName: z.string(),
  agentTitle: z.string().nullable(),
  subject: z.string().nullable(),
  triggerEvent: z.string().nullable(),
  startedAt: z.coerce.date().nullable(),
  endedAt: z.coerce.date().nullable(),
  durationMs: z.number().nullable(),
  tokensIn: z.number().nullable(),
  tokensOut: z.number().nullable(),
  model: z.string().nullable(),
  correlationId: z.string(),
  errorMessage: z.string().nullable(),
  logPath: z.string().nullable(),
  /** For Active Runs: in-flight step's name + ord + total step count. */
  currentStepName: z.string().nullable(),
  currentStepOrd: z.number().nullable(),
  stepCount: z.number().nullable(),
});
export type RunRow = z.infer<typeof RunRow>;

export const StepRow = z.object({
  id: z.string(),
  ord: z.number(),
  name: z.string(),
  type: StepType,
  status: StepStatus,
  startedAt: z.coerce.date().nullable(),
  endedAt: z.coerce.date().nullable(),
  durationMs: z.number().nullable(),
  error: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  tokensIn: z.number().nullable(),
  tokensOut: z.number().nullable(),
});
export type StepRow = z.infer<typeof StepRow>;

export const ListRunsQuery = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
  status: z.string().optional(),
  agent: z.string().optional(),
  q: z.string().optional(),
});

export const GetRunResponse = z.object({
  run: RunRow,
  steps: z.array(StepRow),
});

export const ReplayRunResponse = z.object({
  replayed_run: z.string(),
  new_event_id: z.string(),
});
