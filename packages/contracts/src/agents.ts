import { z } from "zod";

export const ActorEnum = z.enum(["Agent", "Human"]);

export const AgentKindEnum = z.enum(["manifest", "code"]);
export type AgentKindValue = z.infer<typeof AgentKindEnum>;

export const ListAgentRow = z.object({
  id: z.string(),
  kebabId: z.string(),
  name: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  actor: ActorEnum,
  kind: AgentKindEnum,
  enabled: z.boolean(),
  runCount: z.number(),
  errorCount: z.number(),
  lastRunAt: z.coerce.date().nullable(),
});
export type ListAgentRow = z.infer<typeof ListAgentRow>;

export const ActionSpec = z.object({
  order: z.string(),
  name: z.string(),
  description: z.string().optional().default(""),
  type: z.enum(["tool", "logic", "manual"]),
  condition: z.string().optional(),
  task_type: z.string().optional(),
});
export type ActionSpec = z.infer<typeof ActionSpec>;

export const AgentSpec = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional().default(""),
  actor: z.array(ActorEnum).min(1),
  trigger: z.array(z.string()),
  actions: z.array(ActionSpec),
  triggered_event: z.array(z.string()),
});
export type AgentSpec = z.infer<typeof AgentSpec>;

export const WorkflowManifest = z.array(AgentSpec);
export type WorkflowManifest = z.infer<typeof WorkflowManifest>;

export const ManifestUploadBody = z.object({
  manifest: WorkflowManifest,
  actions: z.array(z.record(z.string(), z.unknown())).optional(),
  note: z.string().max(500).optional(),
  workflowSlug: z.string().optional(),
});
export type ManifestUploadBody = z.infer<typeof ManifestUploadBody>;

export const ManifestDiff = z.object({
  added: z.array(z.string()),
  removed: z.array(z.string()),
  modified: z.array(z.string()),
  prior_version: z.string().nullable(),
});
export type ManifestDiff = z.infer<typeof ManifestDiff>;

export const ManifestUploadResponse = z.object({
  workflow_version_id: z.string(),
  version: z.string(),
  diff: ManifestDiff,
  note: z.string(),
});

export const AgentDetail = z.object({
  id: z.string(),
  kebabId: z.string(),
  name: z.string(),
  title: z.string().nullable(),
  actor: ActorEnum,
  triggers: z.array(z.string()),
  triggeredEvents: z.array(z.string()),
  actions: z.array(ActionSpec),
  workflowSlug: z.string(),
  workflowVersion: z.string(),
});
export type AgentDetail = z.infer<typeof AgentDetail>;
