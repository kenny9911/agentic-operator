import type { SkillBundle } from "@agentic/contracts";

export type SkillScriptInterpreter = "node" | "python";

export interface SkillScriptReference {
  readonly id: string;
  readonly versionId: string;
  readonly name: string;
  readonly contentDigest: string;
}

export interface SkillScriptIdentity {
  readonly tenantId: string;
  readonly agentId: string;
  readonly runId: string;
}

export interface SkillScriptAuthorizationRequest {
  readonly identity: SkillScriptIdentity;
  readonly skill: SkillScriptReference;
  readonly scriptPath: string;
  readonly interpreter: SkillScriptInterpreter;
}

/** The host resolves the version and supplies capability. Never accept an
 * arbitrary bundle, identity, or invocation capability directly from a model. */
export interface SkillScriptRequest extends SkillScriptAuthorizationRequest {
  readonly bundle: SkillBundle;
  readonly args?: readonly string[];
  readonly stdin?: string;
  readonly signal?: AbortSignal;
}

export interface SkillScriptLimits {
  readonly timeoutMs: number;
  readonly stagingTimeoutMs: number;
  readonly memoryBytes: number;
  readonly cpus: number;
  readonly pids: number;
  readonly scratchBytes: number;
  readonly inputBytes: number;
  readonly outputBytes: number;
  readonly argumentBytes: number;
  readonly argumentCount: number;
  readonly artifactBytes: number;
  readonly artifactFileBytes: number;
  readonly artifactCount: number;
  readonly artifactDepth: number;
}

export const DEFAULT_SKILL_SCRIPT_LIMITS: Readonly<SkillScriptLimits> = Object.freeze({
  timeoutMs: 30_000,
  stagingTimeoutMs: 15_000,
  memoryBytes: 256 * 1024 * 1024,
  cpus: 1,
  pids: 64,
  scratchBytes: 64 * 1024 * 1024,
  inputBytes: 256 * 1024,
  outputBytes: 512 * 1024,
  argumentBytes: 16 * 1024,
  argumentCount: 32,
  artifactBytes: 8 * 1024 * 1024,
  artifactFileBytes: 2 * 1024 * 1024,
  artifactCount: 32,
  artifactDepth: 8,
});

export interface SkillScriptArtifact {
  readonly path: string;
  readonly content: string;
  readonly encoding: "base64";
  readonly bytes: number;
  readonly contentDigest: string;
}

export type SkillScriptFailure =
  | "invalid_request" | "execution_denied" | "image_not_approved"
  | "executor_unavailable" | "isolation_mismatch" | "staging_failed"
  | "cancelled" | "timeout" | "output_limit" | "artifact_limit"
  | "script_failed" | "protocol_failed" | "cleanup_failed";

export interface SkillScriptEvidence {
  readonly schema: "agentic-skill-script-execution/v1";
  readonly identity: SkillScriptIdentity;
  readonly skill: SkillScriptReference;
  readonly scriptPath: string;
  readonly scriptDigest: string;
  readonly interpreter: SkillScriptInterpreter;
  readonly image: string;
  readonly imageId: string | null;
  readonly isolation: "isolated_container";
  readonly policyDigest: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly executorStarted: boolean;
  readonly exitCode: number | null;
  readonly containerExitCode: number | null;
  readonly oomKilled: boolean | null;
  readonly cleanup: {
    readonly stagingContainerAbsent: boolean;
    readonly executionContainerAbsent: boolean;
    readonly volumeAbsent: boolean;
  };
}

export interface SkillScriptResult {
  readonly ok: boolean;
  readonly failure?: SkillScriptFailure;
  readonly error?: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly artifacts: readonly SkillScriptArtifact[];
  readonly evidence?: SkillScriptEvidence;
}
