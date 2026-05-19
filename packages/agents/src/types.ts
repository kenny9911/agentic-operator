/**
 * BaseAgent + RunEngine public types.
 *
 * AgentContext is what gets passed into buildMessages() / parseOutput().
 * AgentResult is what run() returns to the caller.
 */

import type { ProviderId } from "@agentic/contracts";

export type AgentKind = "manifest" | "code";

export interface AgentContext {
  /** Tenant slug; defaults to `__system` for code-only agents with no tenant binding. */
  tenantSlug: string;
  /** Correlation id propagated across chained runs. */
  correlationId: string;
  /** Caller-provided invocation id (e.g. the API request id) for tracing. */
  invocationId?: string;
  /** Optional override of provider/model for this invocation. */
  provider?: ProviderId;
  model?: string;
}

export interface AgentResult<TOutput> {
  runId: string;
  status: "ok" | "failed";
  output: TOutput | null;
  provider: ProviderId;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  durationMs: number;
  error?: string;
}
