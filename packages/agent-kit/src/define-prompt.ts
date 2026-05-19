/**
 * `definePrompt` — typed builder for tenant-specific LLM prompts.
 *
 * Example:
 * ```ts
 * import { definePrompt } from "@agentic/agent-kit";
 * import { z } from "zod";
 *
 * export const rankCandidates = definePrompt({
 *   name: "rankCandidates",
 *   model: "claude-opus-4-7",
 *   system: "You are a senior recruiter.",
 *   template: (ctx) => `Candidates: ${JSON.stringify(ctx.lastResult)}\n\nReturn ranked JSON.`,
 *   output: z.object({
 *     ranked: z.array(z.object({ candidate_id: z.string(), rank: z.number() })),
 *   }),
 * });
 * ```
 *
 * When `output` is set, the runtime asks the model for JSON matching the
 * schema and validates the response. Without it, the raw string is returned.
 */

import type { z } from "zod";
import type { PromptDescriptor, ToolContext } from "./types";

export interface DefinePromptInput<TOutput> {
  name: string;
  description?: string;
  model?: string;
  system?: string;
  template(ctx: ToolContext): string;
  output?: z.ZodType<TOutput>;
}

export function definePrompt<TOutput>(
  input: DefinePromptInput<TOutput>,
): PromptDescriptor<TOutput> {
  return {
    kind: "prompt",
    name: input.name,
    description: input.description,
    model: input.model,
    system: input.system,
    template: input.template,
    output: input.output,
  };
}
