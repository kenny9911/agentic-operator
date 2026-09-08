import type { SkillBindings } from "@agentic/contracts";
import type { SkillSession } from "@agentic/skills";

export interface RunSkillSnapshotRef { id: string; contentDigest: string }
export interface RunSkillScope { tenantId: string; executionId: string; agentId: string }
export interface CaptureRunSkillsInput extends RunSkillScope {
  tenantSlug: string;
  agentName: string;
  workflowSkills?: SkillBindings;
  agentSkills?: SkillBindings;
  /** Broker envelope identity, never a field copied from event.data. */
  delivery?: { eventId: string; eventName: string };
  /** Only the private internal invocation envelope may supply this receipt. */
  invocationGrant?: string;
  /** Test Lab execution records are separate from production runs. */
  kind?: "run" | "test";
  /** In-process host lineage for Test Lab, never deserialized from event data. */
  parent?: RunSkillSnapshotRef;
}
export interface RuntimeSkillHost {
  /** Synchronous DB write so the run row and Skill snapshot can share a transaction. */
  capture(input: CaptureRunSkillsInput): RunSkillSnapshotRef;
  restore(ref: RunSkillSnapshotRef, scope: RunSkillScope): Promise<SkillSession>;
  issueInvocation(input: RunSkillScope & { stepId: string; recipient: string }): string;
}
let runtimeSkillHost: RuntimeSkillHost | undefined;
export function setRuntimeSkillHost(host: RuntimeSkillHost | undefined): void { runtimeSkillHost = host; }
export function getRuntimeSkillHost(): RuntimeSkillHost | undefined { return runtimeSkillHost; }
