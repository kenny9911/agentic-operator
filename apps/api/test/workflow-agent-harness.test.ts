import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  CreateWorkflowBodySchema,
  SaveWorkflowBodySchema,
  WorkflowTestRunBodySchema,
  connectWorkflowAgents,
  type WorkflowManifestV2,
} from "@agentic/contracts";
import { getDb, tenants } from "@agentic/db";
import { makeId } from "@agentic/shared";
import { LLMGateway, type ChatMessage, type ProviderAdapter } from "@agentic/llm-gateway";
import { setRuntimeGateway } from "@agentic/runtime";
import {
  createWorkflowDraft,
  attachReviewedToolExecutionPolicies,
  getWorkflowDraft,
  saveWorkflowDraft,
  validateWorkflowManifest,
} from "../src/services/workflow-authoring";
import { instantiateBlankWorkflow } from "../src/services/workflow-templates";
import { runWorkflowDraftTest } from "../src/services/workflow-test-runner";
import { _setLLMGatewayForTests } from "../src/services/llm";

const suffix = Date.now().toString(36);
const tenantId = makeId("ten");
const tenantSlug = `wf-harness-${suffix}`;
const ctx = { tenantId, tenantSlug, userId: null } as unknown as Parameters<
  typeof runWorkflowDraftTest
>[2];
let captured: ChatMessage[][] = [];

const report = { invoice_id: "INV-731", total: 731, summary: "Invoice INV-731 totals 731 dollars." };

function installGateway(outputs: unknown[]): void {
  captured = [];
  const adapter: ProviderAdapter = {
    id: "custom",
    name: "Workflow harness test provider",
    hasKey: true,
    defaultModel: "workflow-harness-model",
    async chat(request) {
      captured.push(request.messages as ChatMessage[]);
      return {
        text: JSON.stringify(outputs[captured.length - 1]),
        provider: "custom",
        model: "workflow-harness-model",
        tokensIn: 1,
        tokensOut: 1,
        raw: {},
      } as never;
    },
  };
  const gateway = new LLMGateway({
    defaultProvider: "custom",
    defaultModel: "workflow-harness-model",
    timeoutMs: 5_000,
  });
  gateway.registerProvider(adapter);
  setRuntimeGateway(gateway as never);
  _setLLMGatewayForTests(gateway);
}

function connectedManifest(slug: string): {
  manifest: WorkflowManifestV2;
  handoffEvent: string;
  inputId: string;
} {
  const first = instantiateBlankWorkflow({ slug: `${slug}-source` }).agents[0]!;
  const second = instantiateBlankWorkflow({ slug: `${slug}-receiver` }).agents[0]!;
  const handoffEvent = first.triggered_event[0]!;
  first.outputs = [{
    id: "report",
    label: "Invoice report",
    required: true,
    schema: {
      type: "object",
      properties: {
        invoice_id: { type: "string" },
        total: { type: "number" },
        summary: { type: "string" },
      },
      required: ["invoice_id", "total", "summary"],
      additionalProperties: false,
    },
    sensitivity: "none",
  }];
  first.output_bindings = { [handoffEvent]: { report: { output: "report" } } };
  first.output_config.strict = true;
  first.output_config.repair_attempts = 0;
  second.trigger = [handoffEvent];
  // A custom prompt template must not hide automatically connected inputs.
  second.user_prompt_template = "Receiver task: {{inputs.prompt}}";
  second.inputs[0]!.default = "Explain the invoice report supplied by the previous agent.";
  const connection = connectWorkflowAgents(first, second, handoffEvent);
  const handoffPort = connection.target.inputs.find((port) => port.workflow_handoff);
  if (!handoffPort) throw new Error("Connection did not generate a receiver input");
  return {
    manifest: { $schemaVersion: 2, agents: [connection.source, connection.target] },
    handoffEvent,
    inputId: handoffPort.id,
  };
}

function saveChain(slug: string, manifest: WorkflowManifestV2) {
  return createWorkflowDraft(CreateWorkflowBodySchema.parse({
    slug,
    name: "Connected invoice workflow",
    source: { type: "manifest", manifest },
    model: { provider: "custom", model: "workflow-harness-model" },
  }), ctx);
}

async function runChain(slug: string, manifest: WorkflowManifestV2) {
  return runWorkflowDraftTest(slug, WorkflowTestRunBodySchema.parse({
    manifest,
    triggerEvent: manifest.agents[0]!.trigger[0]!,
    inputs: { prompt: "Analyze invoice INV-731." },
    toolPolicy: "safe",
  }), ctx);
}

beforeAll(() => {
  getDb().insert(tenants).values({ id: tenantId, slug: tenantSlug, name: "Workflow harness" }).run();
});

afterAll(() => {
  _setLLMGatewayForTests(null);
  getDb().delete(tenants).where(eq(tenants.id, tenantId)).run();
});

describe("workflow Agent Harness", () => {
  it("persists automatic typed handoffs and makes the previous result visible to the receiver", async () => {
    installGateway([{ report }, { reply: "Invoice INV-731 totals 731 dollars." }]);
    const slug = `handoff-${suffix}`;
    const { manifest, inputId } = connectedManifest(slug);
    const created = saveChain(slug, manifest);
    const saved = saveWorkflowDraft(slug, SaveWorkflowBodySchema.parse({
      baseVersionId: created.latestVersionId,
      manifest: created.manifest.agents,
    }), ctx);
    const persisted = getWorkflowDraft(slug, ctx).manifest;
    expect(saved.latestVersionId).not.toBe(created.latestVersionId);
    expect(persisted.agents[1]!.trigger_bindings).toEqual(manifest.agents[1]!.trigger_bindings);
    expect(persisted.agents[1]!.inputs.find((port) => port.id === inputId)).toEqual(
      manifest.agents[1]!.inputs.find((port) => port.id === inputId),
    );
    expect(validateWorkflowManifest(persisted).valid).toBe(true);

    const run = await runChain(slug, persisted);
    expect(run.status).toBe("ok");
    expect(run.agentRuns).toHaveLength(2);
    expect(run.agentRuns[1]!.inputs[inputId]).toEqual(report);
    expect(run.agentRuns[1]!.steps[0]!.input).toMatchObject({
      inputs: { [inputId]: report },
      upstream: { [persisted.agents[0]!.id]: { report } },
      lastResult: report,
    });
    const receiverUserText = captured[1]!.filter((message) => message.role === "user")
      .map((message) => message.content).join("\n");
    expect(receiverUserText).toContain("INV-731");
    expect(receiverUserText).toContain("731");
  });

  it("preserves and executes an advanced nested-field binding", async () => {
    installGateway([{ report }, { reply: "The summary was received." }]);
    const slug = `custom-handoff-${suffix}`;
    const { manifest, handoffEvent, inputId } = connectedManifest(slug);
    const target = manifest.agents[1]!;
    target.inputs.find((port) => port.id === inputId)!.schema = { type: "string" };
    target.trigger_bindings![handoffEvent]![inputId] = { path: "$.report.summary" };
    const created = saveChain(slug, manifest);
    const run = await runChain(slug, created.manifest);
    expect(run.status).toBe("ok");
    expect(run.agentRuns[1]!.inputs[inputId]).toBe(report.summary);
    expect(captured[1]!.map((message) => message.content).join("\n")).toContain(report.summary);
    expect(getWorkflowDraft(slug, ctx).manifest.agents[1]!.trigger_bindings![handoffEvent]![inputId])
      .toEqual({ path: "$.report.summary" });
  });

  it("rejects a missing required handoff before calling the receiver model", async () => {
    installGateway([{ report }]);
    const slug = `missing-handoff-${suffix}`;
    const { manifest, handoffEvent, inputId } = connectedManifest(slug);
    const target = manifest.agents[1]!;
    target.trigger_bindings![handoffEvent]![inputId] = { path: "$.report.not_supplied" };
    const created = saveChain(slug, manifest);
    const run = await runChain(slug, created.manifest);
    expect(run.status).toBe("partial");
    expect(run.agentRuns[1]!.status).toBe("failed");
    expect(run.agentRuns[1]!.error?.code).toBe("input_schema_invalid");
    expect(captured).toHaveLength(1);
  });

  it("does not dispatch a strict output that violates its declared schema", async () => {
    installGateway([{ report: { ...report, total: "not a number" } }]);
    const slug = `bad-output-${suffix}`;
    const { manifest } = connectedManifest(slug);
    const created = saveChain(slug, manifest);
    const run = await runChain(slug, created.manifest);
    expect(run.status).toBe("failed");
    expect(run.agentRuns).toHaveLength(1);
    expect(run.agentRuns[0]!.error?.code).toBe("output_schema_invalid");
    expect(run.agentRuns[0]!.emissions).toEqual([]);
    expect(captured).toHaveLength(1);
  });

  it("keeps intermediate tool state out of the strict terminal output in a tool-to-logic chain", async () => {
    installGateway([{ report }, { reply: "The verified report was received." }]);
    const slug = `tool-logic-${suffix}`;
    const { manifest, inputId } = connectedManifest(slug);
    const source = manifest.agents[0]!;
    const terminalAction = source.actions[0]!;
    source.tool_use = [{ name: "meta.ping" }];
    source.actions = [
      { id: "inspect", order: "1", name: "inspect", description: "Inspect the execution context.", type: "tool", tool: "meta.ping" },
      { ...terminalAction, order: "2" },
    ];
    manifest.agents = attachReviewedToolExecutionPolicies(manifest.agents);
    const created = saveChain(slug, manifest);
    const run = await runChain(slug, created.manifest);
    expect(run.status).toBe("ok");
    expect(run.agentRuns[0]!.steps[0]!.output).toMatchObject({ pong: true });
    expect(run.agentRuns[0]!.output).toEqual({ report });
    expect(run.agentRuns[0]!.outputValid).toBe(true);
    expect(run.agentRuns[1]!.inputs[inputId]).toEqual(report);
  });

  it.each([true, false])("validates the mapped terminal output (valid mapping: %s)", async (valid) => {
    installGateway([{ payload: report }, { reply: "Mapped report received." }]);
    const slug = `mapped-${valid ? "ok" : "bad"}-${suffix}`;
    const { manifest, inputId } = connectedManifest(slug);
    manifest.agents[0]!.actions[0]!.output_mapping = {
      report: valid ? "$.result.payload" : "$.result.payload.summary",
    };
    const created = saveChain(slug, manifest);
    const run = await runChain(slug, created.manifest);
    if (valid) {
      expect(run.status).toBe("ok");
      expect(run.agentRuns[0]!.output).toEqual({ report });
      expect(run.agentRuns[1]!.inputs[inputId]).toEqual(report);
    } else {
      expect(run.status).toBe("failed");
      expect(run.agentRuns).toHaveLength(1);
      expect(run.agentRuns[0]!.error?.code).toBe("output_schema_invalid");
      expect(run.agentRuns[0]!.emissions).toEqual([]);
      expect(captured).toHaveLength(1);
    }
  });

  it("preserves a decoded unwrapped string through terminal validation and downstream mapping", async () => {
    installGateway(["123", { reply: "The exact string was received." }]);
    const slug = `string-result-${suffix}`;
    const base = instantiateBlankWorkflow({ slug: `${slug}-source` });
    const source = base.agents[0]!;
    const target = instantiateBlankWorkflow({ slug: `${slug}-receiver` }).agents[0]!;
    const event = source.triggered_event[0]!;
    source.output_config.strict = true;
    source.output_config.unwrap_single_output = true;
    source.output_config.repair_attempts = 0;
    target.trigger = [event];
    const connected = connectWorkflowAgents(source, target, event);
    const inputId = connected.target.inputs.find((port) => port.workflow_handoff)!.id;
    const created = saveChain(slug, { ...base, agents: [connected.source, connected.target] });
    const run = await runChain(slug, created.manifest);
    expect(run.status).toBe("ok");
    expect(run.agentRuns[0]!.output).toBe("123");
    expect(run.agentRuns[1]!.inputs[inputId]).toBe("123");
  });

  it("preserves original legacy event selection and payload carry alongside a new handoff", async () => {
    installGateway([
      { reply: "Received the original legacy event." },
      { reply: "Received the new handoff." },
    ]);
    const slug = `legacy-carry-${suffix}`;
    const source = {
      id: "legacy-ping", name: "legacyPing", actor: ["Agent"],
      generated: true,
      ontology_instructions: "Inspect the supplied execution context and report the result.",
      trigger: ["LEGACY_REQUESTED"],
      triggered_event: ["LEGACY_FIRST", "LEGACY_SECOND"],
      tool_use: [{ name: "meta.ping" }],
      actions: [{ order: "1", name: "inspect", description: "Inspect context", type: "tool", tool: "meta.ping" }],
    };
    const target = instantiateBlankWorkflow({ slug: `${slug}-receiver` }).agents[0]!;
    target.trigger = ["NEW_HANDOFF"];
    const connected = connectWorkflowAgents(source, target, "NEW_HANDOFF");
    const inputId = connected.target.inputs.find((port) => port.workflow_handoff)!.id;
    const oldListener = instantiateBlankWorkflow({ slug: `${slug}-original` }).agents[0]!;
    oldListener.trigger = ["LEGACY_FIRST"];
    oldListener.inputs.push({
      id: "legacy_payload", kind: "value", required: true,
      schema: { type: "object" }, sensitivity: "none",
    });
    oldListener.trigger_bindings = { LEGACY_FIRST: { legacy_payload: { path: "$" } } };
    const manifest: WorkflowManifestV2 = {
      $schemaVersion: 2,
      agents: attachReviewedToolExecutionPolicies([connected.source, oldListener, connected.target]),
    };
    const created = saveChain(slug, manifest);
    const run = await runWorkflowDraftTest(slug, WorkflowTestRunBodySchema.parse({
      manifest: created.manifest,
      triggerEvent: "LEGACY_REQUESTED",
      inputs: { prompt: "Inspect this invoice." },
      payload: { invoice_id: "INV-CARRY" },
      toolPolicy: "safe",
    }), ctx);
    expect(run.status).toBe("ok");
    expect(run.events.some((event) => event.name === "LEGACY_SECOND")).toBe(false);
    expect(run.events.find((event) => event.name === "LEGACY_FIRST")!.payload).toMatchObject({
      invoice_id: "INV-CARRY", last_result: { pong: true },
    });
    expect(run.agentRuns.find((agent) => agent.agentId === oldListener.id)!.inputs.legacy_payload)
      .toMatchObject({ invoice_id: "INV-CARRY", last_result: { pong: true } });
    expect(run.agentRuns.find((agent) => agent.agentId === connected.target.id)!.inputs[inputId])
      .toMatchObject({ pong: true });
  });

  it.each(["source", "output", "binding"])("reports a stale connection whose %s was removed", (removed) => {
    installGateway([]);
    const { manifest, handoffEvent, inputId } = connectedManifest(`invalid-${removed}-${suffix}`);
    if (removed === "source") manifest.agents.shift();
    if (removed === "output") {
      manifest.agents[0]!.outputs = [{
        id: "different_output", required: true, schema: { type: "string" }, sensitivity: "none",
      }];
    }
    if (removed === "binding") delete manifest.agents[1]!.trigger_bindings![handoffEvent]![inputId];
    const result = validateWorkflowManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: `handoff_${removed}_missing`, severity: "error",
    }));
  });
});
