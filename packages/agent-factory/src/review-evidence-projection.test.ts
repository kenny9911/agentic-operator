import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrainCtx } from "./brain-types";
import type { GeneratedAgentSpec } from "./spec-types";

vi.mock("./stream-gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./stream-gateway")>()),
  chatJson: vi.fn(),
  isGatewayConfigured: vi.fn(() => true),
}));

import { chatJson } from "./stream-gateway";
import { FACTORY_TOOLS } from "./tools";

function selectedSpec(): GeneratedAgentSpec {
  return {
    key: "EchoMessage", actionName: "EchoMessage", slug: "echo-message", short: "EchoMessageAgent",
    domainId: "selected", nameZh: "确认消息", kind: "llm",
    trigger: ["MESSAGE_REQUESTED"], emit: ["MESSAGE_ACKNOWLEDGED"], tools: [],
    unresolvedTools: [], objects: ["SelectedInput", "SelectedOutput"],
    systemPrompt: `${"完整校验输入且原样保留消息。".repeat(150)}非法输入在任何 emit 前抛出 [terminal] invalid_input。`,
    userPrompt: "只处理事件输入，不推断额外字段。",
    decisionLogic: `${"逐项验证类型、长度和非空约束。".repeat(50)}若宿主 ctx.emit 抛出基础设施异常，直接传播原异常，禁止将其伪装为业务成功。`,
    inputSchema: [{ field: "request_id", type: "string", description: "COMPLETE_INPUT_CONTRACT", required: true }],
    outputSchema: [{ field: "acknowledgment", type: "string", description: "COMPLETE_OUTPUT_CONTRACT", event: "MESSAGE_ACKNOWLEDGED", from: "input.message" }],
    inputBindings: [],
    steps: [], plan: [], ruleRefs: [], retries: 0, hitl: false, confidence: 1, promptSource: "llm",
    codeSource: "ai", codeExecuted: true,
    generatedCode: `import { defineAgent } from "@agentic/runtime";\n${"// Preserve exact input fields.\n".repeat(70)}export const agent = defineAgent({ async handler(input, ctx) {\nif (!input.message) throw new Error("[terminal] invalid_input");\nconst output = { acknowledgment: input.message };\nawait ctx.emit("MESSAGE_ACKNOWLEDGED", output);\nreturn output;\n} });\n// COMPLETE_CODE_TAIL`,
    // Runtime configuration is irrelevant to a prose/code coverage judgment.
    toolConfigs: { unused: { endpoint: "RUNTIME_CONFIGURATION_NOT_REVIEW_MATERIAL" } },
  };
}

function context(): BrainCtx {
  return {
    domain: "selected", specs: [selectedSpec()], emit: () => {}, attemptHistory: {}, realTools: [],
    ontologyUnderstanding: "UNSELECTED_FULL_DOMAIN_UNDERSTANDING",
    generationDirective: {
      schema: "agent-factory-generation-directive/v1", mode: "action_selection",
      requestedActionIds: ["selected-action"], requestedActionNames: ["EchoMessage"],
      requestedActions: [{ id: "selected-action", name: "EchoMessage" }], sourceOntologyHash: "a".repeat(64),
    },
    ontology: {
      domainId: "selected", source: "allmeta",
      actions: [
        { id: "selected-action", name: "EchoMessage", description: "SELECTED_ACTION_CONTRACT", actor: ["Agent"], trigger: ["MESSAGE_REQUESTED"], triggered_event: ["MESSAGE_ACKNOWLEDGED"], target_objects: ["SelectedInput", "SelectedOutput"], tool_use: [], inputs: [], outputs: [] },
        { id: "excluded-action", name: "ExcludedAction", description: "UNSELECTED_ACTION_CONTRACT", actor: ["Agent"], trigger: ["EXCLUDED_REQUEST"], triggered_event: ["EXCLUDED_RESULT"], target_objects: ["ExcludedObject"], tool_use: [] },
      ],
      events: [{ name: "MESSAGE_REQUESTED" }, { name: "MESSAGE_ACKNOWLEDGED" }, { name: "EXCLUDED_REQUEST", description: "UNSELECTED_EVENT_CONTRACT" }],
      objects: [{ id: "SelectedInput", name: "SelectedInput", properties: [] }, { id: "SelectedOutput", name: "SelectedOutput", properties: [] }, { id: "ExcludedObject", name: "ExcludedObject", description: "UNSELECTED_OBJECT_CONTRACT", properties: [] }],
      rules: [{ id: "excluded-rule", name: "ExcludedRule", description: "UNSELECTED_RULE_CONTRACT" }],
    },
  } as unknown as BrainCtx;
}

beforeEach(() => {
  vi.stubEnv("FACTORY_AI_MODEL", "test/review-model");
  vi.mocked(chatJson).mockReset().mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe("review evidence projection", () => {
  // These tests inspect the exact model input, not the quality of a simulated
  // LLM verdict. In production the same review and fail-closed gates still run.
  it.each(["review_agent", "review_context", "review_completeness"])("gives %s the complete designed contract without unselected source material", async (name) => {
    const ctx = context();
    await FACTORY_TOOLS.find((tool) => tool.name === name)!.execute({}, ctx);
    expect(vi.mocked(chatJson).mock.calls.length).toBe(name === "review_agent" ? 2 : 1);
    for (const [, digest] of vi.mocked(chatJson).mock.calls) {
      const spec = ctx.specs[0]!;
      expect(digest).toContain(spec.systemPrompt);
      expect(digest).toContain(spec.userPrompt);
      expect(digest).toContain(spec.decisionLogic);
      expect(digest).toContain(spec.generatedCode);
      expect(digest).toContain("COMPLETE_INPUT_CONTRACT");
      expect(digest).toContain("COMPLETE_OUTPUT_CONTRACT");
      expect(digest).toContain('"codeExecuted": true');
      expect(digest).not.toContain("UNSELECTED_");
      expect(digest).not.toContain("RUNTIME_CONFIGURATION_NOT_REVIEW_MATERIAL");
    }
    if (name !== "review_agent") {
      expect(vi.mocked(chatJson).mock.calls[0]![1]).toContain("SELECTED_ACTION_CONTRACT");
    }
  });

  it("keeps complete designed fields even when an oversized source contract is explicitly marked as truncated", async () => {
    const ctx = context();
    ctx.ontology!.actions[0]!.description = "selected source ".repeat(700);
    await FACTORY_TOOLS.find((tool) => tool.name === "review_completeness")!.execute({}, ctx);
    const digest = vi.mocked(chatJson).mock.calls[0]![1];
    expect(digest).toContain("契约材料已按边界截断");
    expect(digest).toContain(ctx.specs[0]!.systemPrompt);
    expect(digest).toContain(ctx.specs[0]!.decisionLogic);
    expect(digest).toContain(ctx.specs[0]!.generatedCode);
  });

  it("still blocks a valid high-severity reviewer finding after enriching its evidence", async () => {
    vi.mocked(chatJson).mockResolvedValue([{ gap: "authored boundary is inconsistent", severity: "high" }]);
    const result = await FACTORY_TOOLS.find((tool) => tool.name === "review_completeness")!.execute({}, context());
    expect(result).toMatchObject({ ok: false, output: { verdict: "issues" } });
    expect(result.summary).toContain("authored boundary is inconsistent");
  });
});
