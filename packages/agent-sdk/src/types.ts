/**
 * Shared types for agent-authoring primitives.
 *
 * These describe what a tenant author sees when writing custom tools and
 * prompts. The runtime (packages/runtime) consumes the same types via the
 * resolver chain so action.name in a manifest can map to a tenant-defined
 * implementation.
 */

import type { z } from "zod";

/**
 * Per-invocation context passed to every tool handler and prompt template.
 * Tools/prompts pluck what they need from here instead of declaring inputs
 * separately — keeps the manifest action shape simple (just `name + type`).
 */
export interface ToolContext {
  /** Agent that owns the step currently executing. */
  agentName: string;
  /** The action's `name` field from the manifest (matches the tool/prompt name). */
  actionName: string;
  /** The subject this run is operating on (e.g. a candidate id, requisition id). */
  subject?: string;
  /** Correlation id threaded through every step in this run. */
  correlationId: string;
  /** Tenant slug (e.g. "raas"). */
  tenantSlug: string;
  /** The trigger event that fired this run, if any. */
  event?: {
    name: string;
    data: Record<string, unknown>;
  };
  /**
   * Output of the previous step in the same run, if any. Lets a tool/prompt
   * pipe data forward without explicit wiring in the manifest.
   */
  lastResult?: unknown;
}

/**
 * What a tool handler returns. The runtime takes `data` as the step's output
 * (becomes the next step's `lastResult`), and surfaces `tokensIn`/`tokensOut`
 * on the run row for the tokens KPI.
 */
export interface ToolResult<T = unknown> {
  data: T;
  tokensIn?: number;
  tokensOut?: number;
  /** Free-form metadata for logs / debug surfaces. */
  meta?: Record<string, unknown>;
}

/**
 * A tool descriptor produced by `defineTool()`. The runtime calls
 * `descriptor.handler(ctx)` and (optionally) validates the output against
 * `descriptor.output` before storing it.
 */
export interface ToolDescriptor<TOutput = unknown> {
  readonly kind: "tool";
  readonly name: string;
  readonly description?: string;
  /** Optional Zod schema — runtime validates handler output if present. */
  readonly output?: z.ZodType<TOutput>;
  handler(ctx: ToolContext): Promise<ToolResult<TOutput>>;
}

/**
 * A prompt descriptor produced by `definePrompt()`. The runtime renders the
 * template against the live context to get a string, hands that to the LLM
 * caller, and (optionally) validates the LLM's structured output against
 * `descriptor.output`.
 */
export interface PromptDescriptor<TOutput = unknown> {
  readonly kind: "prompt";
  readonly name: string;
  readonly description?: string;
  readonly model?: string;
  readonly system?: string;
  template(ctx: ToolContext): string;
  /**
   * Optional Zod schema for structured output. When set, the runtime asks
   * the LLM for JSON matching this shape and validates the response.
   */
  readonly output?: z.ZodType<TOutput>;
}

/**
 * A tenant package's default export. Bootstrap auto-discovers `@tenants/<slug>`
 * and merges these registries with the generic tool/prompt set so manifest
 * actions can reference tenant-specific names without further wiring.
 */
export interface TenantRegistry {
  tools?: Record<string, ToolDescriptor>;
  prompts?: Record<string, PromptDescriptor>;
}
