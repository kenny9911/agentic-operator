/**
 * RunStreamEvent — the discriminated union published over SSE
 * `GET /v1/stream` by the runtime's broadcast channel (P1-RT-05).
 *
 * Variants:
 *   - run.started        — a new run row was inserted
 *   - run.step.started   — a step row went `running`
 *   - run.step.completed — a step row was finalized (ok / failed / skipped)
 *   - run.completed      — the run row was finalized successfully
 *   - run.failed         — the run row was finalized with an error
 *   - event.emitted      — a downstream event row was created
 *   - task.created       — a human-gated task row was opened
 *   - task.resolved      — a human-gated task row was resolved
 *
 * `tenantId` is the platform-internal tenant id (NOT the slug); the SSE
 * handler tags subscribers by tenantId so cross-tenant leakage is
 * structurally impossible.
 *
 * All payloads include `at` (unix-ms) so consumers can render relative
 * timestamps. Optional fields collapse to `null` rather than `undefined`
 * to keep the wire shape stable across providers.
 */

import { z } from "zod";

const Base = {
  tenantId: z.string(),
  at: z.number(),
};

export const RunStartedEvent = z.object({
  type: z.literal("run.started"),
  ...Base,
  runId: z.string(),
  agentName: z.string(),
  triggerEvent: z.string().nullable(),
  subject: z.string().nullable(),
  correlationId: z.string(),
  // P2-FE-18 — surfaced so the portal can render the TEST badge instantly.
  testRun: z.boolean().optional(),
});

export const RunStepStartedEvent = z.object({
  type: z.literal("run.step.started"),
  ...Base,
  runId: z.string(),
  stepId: z.string(),
  ord: z.number(),
  name: z.string(),
  stepType: z.string(),
});

export const RunStepCompletedEvent = z.object({
  type: z.literal("run.step.completed"),
  ...Base,
  runId: z.string(),
  stepId: z.string(),
  ord: z.number(),
  name: z.string(),
  stepType: z.string(),
  status: z.string(),
  durationMs: z.number(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  tokensIn: z.number().nullable(),
  tokensOut: z.number().nullable(),
  error: z.string().nullable(),
});

export const RunCompletedEvent = z.object({
  type: z.literal("run.completed"),
  ...Base,
  runId: z.string(),
  durationMs: z.number(),
  tokensIn: z.number().nullable(),
  tokensOut: z.number().nullable(),
  emittedEventId: z.string().nullable(),
});

export const RunFailedEvent = z.object({
  type: z.literal("run.failed"),
  ...Base,
  runId: z.string(),
  errorMessage: z.string(),
});

export const EventEmittedEvent = z.object({
  type: z.literal("event.emitted"),
  ...Base,
  eventId: z.string(),
  name: z.string(),
  subject: z.string().nullable(),
  sourceRunId: z.string(),
});

export const TaskCreatedEvent = z.object({
  type: z.literal("task.created"),
  ...Base,
  taskId: z.string(),
  runId: z.string(),
  taskType: z.string(),
  title: z.string(),
});

export const TaskResolvedEvent = z.object({
  type: z.literal("task.resolved"),
  ...Base,
  taskId: z.string(),
  decision: z.string(),
});

export const RunStreamEvent = z.discriminatedUnion("type", [
  RunStartedEvent,
  RunStepStartedEvent,
  RunStepCompletedEvent,
  RunCompletedEvent,
  RunFailedEvent,
  EventEmittedEvent,
  TaskCreatedEvent,
  TaskResolvedEvent,
]);
export type RunStreamEvent = z.infer<typeof RunStreamEvent>;
