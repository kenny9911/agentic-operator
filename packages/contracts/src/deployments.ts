import { z } from "zod";

export const DeploymentStatus = z.enum(["live", "rolled_back", "pending"]);
export type DeploymentStatus = z.infer<typeof DeploymentStatus>;

export const DeploymentRow = z.object({
  id: z.string(),
  versionId: z.string(),
  versionString: z.string(),
  status: DeploymentStatus,
  deployedAt: z.coerce.date().nullable(),
  deployedBy: z.string().nullable(),
  note: z.string().nullable(),
  workflowSlug: z.string(),
  agentCount: z.number(),
});
export type DeploymentRow = z.infer<typeof DeploymentRow>;

export const RollbackResponse = z.object({
  deployment_id: z.string(),
  status: z.literal("live"),
  note: z.string(),
});
