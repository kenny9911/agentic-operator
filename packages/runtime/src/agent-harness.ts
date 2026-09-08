import type { AgentDefinitionV2 } from "@agentic/contracts";
import {
  activeWorkflowHandoff,
  finalizeAgentExecution,
  normalizeAgentForExecution,
  parseValidateAndRepairOutput,
  prepareAgentExecution,
  resolveAgentEmissions,
  type AgentExecutionEvent,
  type FinalizeAgentExecutionInput,
  type ParseValidateAndRepairOutputInput,
  type PrepareAgentExecutionInput,
  type PreparedAgentExecution,
  type ResolveAgentEmissionsInput,
} from "./agent-execution";
import { mergeStepResults } from "./message-envelope";

export interface WorkflowHandoffReceipt {
  inputId: string;
  sourceAgentId: string;
  sourceAgentName: string;
  sourceOutputId: string;
  event: string;
  sourceRunId: string | null;
}

export interface WorkflowAgentContext {
  inputs: Record<string, unknown>;
  /** Exact, validated values addressed by producer id and output port id. */
  upstream: Record<string, Record<string, unknown>>;
  /** Convenient first-action carry when this delivery has one producer. */
  previousResult?: unknown;
}

export interface PreparedWorkflowAgentExecution extends PreparedAgentExecution {
  context: WorkflowAgentContext;
  handoffs: WorkflowHandoffReceipt[];
}

/** Build references from already validated named inputs. No event lookup,
 * model call, or cross-run data fetch is allowed through this boundary. */
export function workflowAgentContext(
  definition: Pick<AgentDefinitionV2, "inputs">,
  inputs: Record<string, unknown>,
  event: AgentExecutionEvent,
): { context: WorkflowAgentContext; handoffs: WorkflowHandoffReceipt[] } {
  const upstream: Record<string, Record<string, unknown>> = Object.create(null);
  const handoffs: WorkflowHandoffReceipt[] = [];
  for (const port of definition.inputs) {
    const handoff = port.workflow_handoff;
    if (!handoff || !activeWorkflowHandoff(port, event) || inputs[port.id] === undefined) continue;
    const outputs = upstream[handoff.source_agent_id] ??= Object.create(null);
    outputs[handoff.source_output_id] = inputs[port.id];
    handoffs.push({
      inputId: port.id,
      sourceAgentId: handoff.source_agent_id,
      sourceAgentName: handoff.source_agent_name,
      sourceOutputId: handoff.source_output_id,
      event: handoff.event,
      sourceRunId: typeof event.data.source_run === "string" ? event.data.source_run : null,
    });
  }
  const sources = Object.values(upstream);
  // The named upstream map is canonical; the convenience carry is available
  // only when there is no ambiguity about the producer for this delivery.
  const previous = sources.length === 1 ? Object.values(sources[0]!) : [];
  const previousResult = previous.length === 1 ? previous[0] : sources.length === 1 ? sources[0] : undefined;
  return { context: { inputs, upstream, ...(previousResult === undefined ? {} : { previousResult }) }, handoffs };
}

/** The workflow execution boundary shared by durable production runs and
 * draft runs. Inngest remains responsible for retries, waits, cancellation,
 * and durable effects; this harness owns typed inputs, prompt context,
 * structured output validation/repair, and exact authored emissions. */
export class WorkflowAgentHarness {
  readonly normalized: ReturnType<typeof normalizeAgentForExecution>;

  constructor(readonly definition: unknown) {
    this.normalized = normalizeAgentForExecution(definition);
  }

  async prepare(input: Omit<PrepareAgentExecutionInput, "definition">): Promise<PreparedWorkflowAgentExecution> {
    const prepared = await prepareAgentExecution({ ...input, definition: this.definition });
    const references = workflowAgentContext(
      this.normalized.definition,
      prepared.inputs,
      input.event ?? { name: "", data: {} },
    );
    return { ...prepared, ...references };
  }

  validateOutput(input: Omit<ParseValidateAndRepairOutputInput, "definition">) {
    return parseValidateAndRepairOutput({
      ...input, definition: this.definition, candidateIsValue: input.candidateIsValue ?? true,
    });
  }

  /** Intermediate state can carry useful fields across actions. A terminal
   * v2 action owns its exact output contract; earlier tool receipts must not
   * become extra output fields merely because they were useful context. */
  accumulateActionResult(previous: unknown, candidate: unknown, options: { terminal: boolean }): unknown {
    return this.normalized.compatibilityMode === "v2" && options.terminal
      ? candidate
      : mergeStepResults(previous, candidate);
  }

  resolveEmissions(input: Omit<ResolveAgentEmissionsInput, "definition">) {
    return resolveAgentEmissions({ ...input, definition: this.normalized });
  }

  finalize(input: Omit<FinalizeAgentExecutionInput, "definition">) {
    return finalizeAgentExecution({
      ...input, definition: this.definition, candidateIsValue: input.candidateIsValue ?? true,
    });
  }
}
