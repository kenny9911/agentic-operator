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
import path from "node:path";
import { promises as fs } from "node:fs";

interface AgentSlots {
  name?: string;
  description?: string;
  ontology_instructions?: string;
}

export interface StepInput {
  ctx: ToolContext;
  action: ActionSpec;
  /**
   * Optional agent-level metadata that influences prompt assembly:
   *   - `description` is concatenated into the runtime prelude
   *   - `ontology_instructions` is appended to the system message
   * Pure-runtime callers (Inngest worker) pass the AgentSpec slice; tests
   * pass an inline shape.
   */
  agent?: AgentSlots;
  /** Tenant-specific tools + prompts; consulted before generic fallbacks. */
  tenantRegistry?: TenantRegistry;
  /**
   * When true (M4), manual steps log + skip rather than wait for task
   * resolution. M8 flips this to false and wires real waitForEvent + task
   * creation.
   */
  autoResolveManual?: boolean;
  /**
   * Per P0-RT-09: when both `runId` and `stepOrd` are set, the engine
   * writes JSON sidecars to AGENTIC_ARTIFACTS_DIR/<runId>/step-<ord>-{input,output}.json
   * so downstream consumers (UI, debug) can reconstruct the call.
   */
  runId?: string;
  stepOrd?: number;
}

export interface StepOutput {
  ok: boolean;
  type: ActionSpec["type"];
  data: unknown;
  tokensIn?: number;
  tokensOut?: number;
  /** Real gateway-returned model id (P0-RT-04). */
  model?: string;
  /** Real gateway-returned provider id (P0-RT-04). */
  provider?: string;
  /** Absolute path to step-<ord>-output.json when artifacts are written. */
  outputArtifact?: string;
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

/**
 * Compose the system message:
 *   1. tenant prompt override (if any) — wins first position so the LLM
 *      reads it before the runtime prelude
 *   2. runtime prelude — generic "you are an agentic workflow step" framing
 *   3. agent description
 *   4. agent ontology_instructions
 * Empty segments are skipped.
 */
function buildSystemMessage(parts: {
  tenantOverride?: string;
  agentDescription?: string;
  ontologyInstructions?: string;
}): string {
  const lines: string[] = [];
  if (parts.tenantOverride) lines.push(parts.tenantOverride);
  lines.push(
    "You are an LLM-driven step inside an agentic workflow. Reply concisely and follow the rubric in the user message.",
  );
  if (parts.agentDescription) lines.push(parts.agentDescription);
  if (parts.ontologyInstructions) lines.push(parts.ontologyInstructions);
  return lines.join("\n\n");
}

async function callLLM(
  rendered: string,
  preferredModel?: string,
  systemOverride?: string,
  agent?: AgentSlots,
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
  const systemContent = buildSystemMessage({
    tenantOverride: systemOverride,
    agentDescription: agent?.description,
    ontologyInstructions: agent?.ontology_instructions,
  });
  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
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
  agent?: AgentSlots,
): Promise<StepOutput> {
  const rendered = prompt.template(ctx);
  const result = await callLLM(rendered, prompt.model, prompt.system, agent);
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
    model: result.model,
    provider: result.provider,
    meta: {
      prompt: prompt.name,
      provider: result.provider,
      model: result.model,
      tenant: true,
    },
  };
}

/**
 * Write per-step input + output sidecars to AGENTIC_ARTIFACTS_DIR. No-op
 * if runId/stepOrd weren't provided. Failures are logged + swallowed —
 * artifact write is a debugging aid, not a correctness gate.
 */
async function writeStepArtifacts(
  runId: string,
  stepOrd: number,
  payload: { input: unknown; output: unknown },
): Promise<string | undefined> {
  const root = process.env.AGENTIC_ARTIFACTS_DIR ?? "./artifacts";
  const dir = path.resolve(root, runId);
  try {
    await fs.mkdir(dir, { recursive: true });
    const inputPath = path.join(dir, `step-${stepOrd}-input.json`);
    const outputPath = path.join(dir, `step-${stepOrd}-output.json`);
    await fs.writeFile(inputPath, JSON.stringify(payload.input, null, 2), "utf8");
    await fs.writeFile(outputPath, JSON.stringify(payload.output, null, 2), "utf8");
    return outputPath;
  } catch (err) {
    console.warn(
      `[step-engine] failed to write step artifacts for ${runId} step-${stepOrd}:`,
      err,
    );
    return undefined;
  }
}

export async function runAction(input: StepInput): Promise<StepOutput> {
  const { ctx, action, tenantRegistry, agent, runId, stepOrd } = input;

  let result: StepOutput;
  switch (action.type) {
    case "tool": {
      const tenantTool = tenantRegistry?.tools?.[action.name];
      if (tenantTool) {
        result = await runTenantTool(ctx, tenantTool);
      } else {
        const r = await runTool(genericCtx(ctx), action.name);
        result = {
          ok: r.ok,
          type: "tool",
          data: r.data,
          meta: r.meta,
        };
      }
      break;
    }
    case "logic": {
      const tenantPrompt = tenantRegistry?.prompts?.[action.name];
      if (tenantPrompt) {
        result = await runTenantPrompt(ctx, tenantPrompt, agent);
      } else {
        // UC-V11-25 / AR-GAP-13 — strict mode. Boot-time validation in
        // `packages/runtime/src/bootstrap.ts` refuses to register a tenant
        // whose manifest has logic actions without matching prompts.
        // Reaching this branch means a hot-reload path bypassed validation
        // or a test wired a partial registry. Fail loud instead of
        // shipping `${name}: ${description}` (often non-English text) to
        // the model as a user message.
        result = {
          ok: false,
          type: "logic",
          data: null,
          meta: {
            error: "missing_tenant_prompt",
            actionName: action.name,
            hint:
              "Add a definePrompt to tenants/<slug>/prompts/ and re-export it " +
              "from the TenantRegistry.prompts map.",
          },
        };
      }
      break;
    }
    case "manual": {
      // Real HITL flow lives in register.ts (step.waitForEvent + tasks).
      // The engine never reaches this case via the main loop — register.ts
      // short-circuits manual steps before calling runAction. Kept here so
      // ad-hoc callers (tests, replays) get a sensible placeholder.
      result = {
        ok: true,
        type: "manual",
        data: {
          autoResolved: true,
          note: "manual step handled by register.ts via waitForEvent",
        },
        pendingTaskTitle: action.name,
      };
      break;
    }
    case "condition": {
      // P1-RT-03: lightweight expression evaluator. The real evaluator lives
      // in register.ts where it has access to step/event/agent context; the
      // step-engine version returns the same shape so callers can branch on
      // `data.evaluated` without case analysis on `type`.
      const condition = (action as { condition?: string }).condition ?? "true";
      // Minimal JS-ish evaluator: supports `lastResult == null`, `!= null`,
      // and bare literals. Anything that doesn't parse cleanly is treated
      // as `false` rather than throwing — keeps the engine deterministic.
      let evaluated = false;
      try {
        if (/^true$/i.test(condition.trim())) evaluated = true;
        else if (/lastResult\s*==\s*null/.test(condition)) evaluated = ctx.lastResult == null;
        else if (/lastResult\s*!=\s*null/.test(condition)) evaluated = ctx.lastResult != null;
        else evaluated = Boolean(condition);
      } catch {
        evaluated = false;
      }
      result = {
        ok: true,
        type: "condition",
        data: { evaluated, condition },
      };
      break;
    }
    case "delay": {
      // P1-RT-03: in production this becomes `step.sleep(...)` so Inngest
      // owns the durable timer. The engine version uses setTimeout so
      // ad-hoc callers (tests) get matching wall-clock behavior.
      const ms = (action as { delay_ms?: number }).delay_ms ?? 0;
      if (ms > 0) {
        await new Promise<void>((r) => setTimeout(r, ms));
      }
      result = {
        ok: true,
        type: "delay",
        data: { delay_ms: ms, sleptMs: ms },
      };
      break;
    }
    case "subflow": {
      // P1-RT-03: placeholder. The real fork — emitting an event for the
      // child agent and (optionally) awaiting its terminal event — is in
      // register.ts. The engine version records the intended fanout so
      // ad-hoc callers can inspect it.
      const a = action as {
        subflow?: string;
        subflow_input?: Record<string, unknown>;
      };
      result = {
        ok: true,
        type: "subflow",
        data: {
          subflow: a.subflow ?? null,
          subflow_input: a.subflow_input ?? {},
        },
      };
      break;
    }
  }

  // P0-RT-09: optional artifact sidecars.
  if (runId && typeof stepOrd === "number") {
    const outputArtifact = await writeStepArtifacts(runId, stepOrd, {
      input: {
        action: action.name,
        type: action.type,
        ctx,
        agent: agent ? { name: agent.name, description: agent.description } : undefined,
      },
      output: result,
    });
    if (outputArtifact) result.outputArtifact = outputArtifact;
  }

  return result;
}
