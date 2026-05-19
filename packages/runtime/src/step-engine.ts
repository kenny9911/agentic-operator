/**
 * Step engine — dispatches a single action by type.
 *
 * Called from inside an Inngest function via step.run(), so each invocation
 * is durable + idempotent (Inngest replays the function with memoized step
 * results on retry).
 *
 * Resolution order for `tool` and `logic` actions:
 *   1. Tenant registry (`@tenants/<slug>`) — typed handler from agent-kit.
 *   2. Generic @agentic/tools — mock implementations for now.
 *
 * Tenant resolution lets a manifest action `{ "name": "rankCandidates", "type": "logic" }`
 * dispatch to a real tenant-defined prompt without editing the runtime.
 */

import { runTool, type ToolContext as GenericToolContext } from "@agentic/tools";
import type {
  PromptDescriptor,
  TenantRegistry,
  ToolContext,
  ToolDescriptor,
} from "@agentic/agent-kit";
import type { ActionSpec } from "./manifest";
import { getRuntimeGateway } from "./llm-host";
import type { ChatMessage } from "@agentic/llm-gateway";

export interface StepInput {
  ctx: ToolContext;
  action: ActionSpec;
  /** Tenant-specific tools + prompts; consulted before generic fallbacks. */
  tenantRegistry?: TenantRegistry;
  /**
   * When true (M4), manual steps log + skip rather than wait for task
   * resolution. M8 flips this to false and wires real waitForEvent + task
   * creation.
   */
  autoResolveManual?: boolean;
}

export interface StepOutput {
  ok: boolean;
  type: ActionSpec["type"];
  data: unknown;
  tokensIn?: number;
  tokensOut?: number;
  /** Set for manual steps that haven't been resolved yet. */
  pendingTaskTitle?: string;
  meta?: Record<string, unknown>;
}

function genericCtx(ctx: ToolContext): GenericToolContext {
  return {
    agentName: ctx.agentName,
    actionName: ctx.actionName,
    subject: ctx.subject,
    correlationId: ctx.correlationId,
  };
}

async function runTenantTool(
  ctx: ToolContext,
  tool: ToolDescriptor,
): Promise<StepOutput> {
  const result = await tool.handler(ctx);
  // Optional structured-output validation
  let validated = result.data;
  if (tool.output) {
    const parsed = tool.output.safeParse(result.data);
    if (parsed.success) {
      validated = parsed.data;
    } else {
      return {
        ok: false,
        type: "tool",
        data: result.data,
        meta: {
          tool: tool.name,
          tenant: true,
          schemaError: parsed.error.issues,
        },
      };
    }
  }
  return {
    ok: true,
    type: "tool",
    data: validated,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    meta: { ...result.meta, tool: tool.name, tenant: true },
  };
}

async function callLLM(
  rendered: string,
  preferredModel?: string,
): Promise<{
  text: string;
  tokensIn: number;
  tokensOut: number;
  provider: string;
  model: string;
}> {
  const gateway = getRuntimeGateway();
  if (!gateway) {
    throw new Error(
      "[step-engine] LLMGateway not initialised — apps/api bootstrap must call setRuntimeGateway()",
    );
  }
  const messages: ChatMessage[] = [
    { role: "system", content: "You are an LLM-driven workflow step. Reply concisely." },
    { role: "user", content: rendered },
  ];
  const response = await gateway.chat({
    messages,
    model: preferredModel,
  });
  return {
    text: response.text,
    tokensIn: response.tokensIn ?? 0,
    tokensOut: response.tokensOut ?? 0,
    provider: response.provider,
    model: response.model,
  };
}

async function runTenantPrompt(
  ctx: ToolContext,
  prompt: PromptDescriptor,
): Promise<StepOutput> {
  const rendered = prompt.template(ctx);
  const result = await callLLM(rendered, prompt.model);
  let validated: unknown = result.text;
  if (prompt.output) {
    try {
      const json = JSON.parse(result.text);
      const parsed = prompt.output.safeParse(json);
      if (parsed.success) validated = parsed.data;
    } catch {
      // Real LLMs may return prose; structured-output enforcement is a v2 hardening.
    }
  }
  return {
    ok: true,
    type: "logic",
    data: validated,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    meta: {
      prompt: prompt.name,
      provider: result.provider,
      model: result.model,
      tenant: true,
    },
  };
}

export async function runAction(input: StepInput): Promise<StepOutput> {
  const { ctx, action, tenantRegistry } = input;

  switch (action.type) {
    case "tool": {
      const tenantTool = tenantRegistry?.tools?.[action.name];
      if (tenantTool) return runTenantTool(ctx, tenantTool);

      const result = await runTool(genericCtx(ctx), action.name);
      return {
        ok: result.ok,
        type: "tool",
        data: result.data,
        meta: result.meta,
      };
    }
    case "logic": {
      const tenantPrompt = tenantRegistry?.prompts?.[action.name];
      if (tenantPrompt) return runTenantPrompt(ctx, tenantPrompt);

      const prompt = `${action.name}: ${action.description}`;
      const result = await callLLM(prompt);
      return {
        ok: true,
        type: "logic",
        data: result.text,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        meta: {
          provider: result.provider,
          model: result.model,
          tool: "llm.call",
        },
      };
    }
    case "manual": {
      // Real HITL flow lives in register.ts (step.waitForEvent + tasks).
      // The engine never reaches this case via the main loop — register.ts
      // short-circuits manual steps before calling runAction. Kept here so
      // ad-hoc callers (tests, replays) get a sensible placeholder.
      return {
        ok: true,
        type: "manual",
        data: {
          autoResolved: true,
          note: "manual step handled by register.ts via waitForEvent",
        },
        pendingTaskTitle: action.name,
      };
    }
  }
}
