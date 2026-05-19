import { z } from "zod";
import { ActorEnum } from "./agents";

export const DagAgent = z.object({
  id: z.string(),
  kebabId: z.string(),
  name: z.string(),
  title: z.string(),
  actor: ActorEnum,
  triggers: z.array(z.string()),
  emits: z.array(z.string()),
  stage: z.number(),
  recentRunCount: z.number(),
  isLive: z.boolean(),
});
export type DagAgent = z.infer<typeof DagAgent>;

export const DagEdge = z.object({
  fromAgent: z.string(),
  toAgent: z.string(),
  event: z.string(),
  active: z.boolean(),
});
export type DagEdge = z.infer<typeof DagEdge>;

export const DagResponse = z.object({
  agents: z.array(DagAgent),
  edges: z.array(DagEdge),
  workflowVersion: z.string(),
});
