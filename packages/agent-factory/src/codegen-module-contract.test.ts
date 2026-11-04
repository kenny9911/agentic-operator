import { describe, expect, it } from "vitest";
import type { BrainCtx } from "./brain-types";
import { brainToolSchemas } from "./conductor";
import { lintGeneratedToolCode } from "./code-lint";
import { probeAgentModule, validateAgentCode } from "./codegen";
import {
  CODEGEN_AGENT_MODULE_CONTRACT,
  CODEGEN_AGENT_MODULE_EXAMPLE,
} from "./codegen-module-contract";
import { FACTORY_TOOLS } from "./tools";
import type { GeneratedAgentSpec } from "./spec-types";

const codegenAgent = FACTORY_TOOLS.find((tool) => tool.name === "codegen_agent")!;
const readSpec = FACTORY_TOOLS.find((tool) => tool.name === "read_spec")!;

function spec(): GeneratedAgentSpec {
  return {
    key: "example",
    actionName: "exampleAction",
    slug: "EXAMPLE_ACTION_SLUG",
    short: "EXAMPLE_ACTION_NAME",
    domainId: "local-test",
    nameZh: "模块契约",
    kind: "llm",
    trigger: ["EXAMPLE_REQUESTED"],
    emit: ["EXAMPLE_COMPLETED"],
    tools: [],
    unresolvedTools: [],
    objects: [],
    systemPrompt: "Test the module wrapper contract.",
    userPrompt: "",
    steps: [],
    ruleRefs: [],
    retries: 0,
    hitl: false,
    confidence: 1,
    promptSource: "llm",
  };
}

function context(candidate: GeneratedAgentSpec): BrainCtx {
  return { specs: [candidate], emit: () => undefined, lastSandbox: null, attemptHistory: {} } as unknown as BrainCtx;
}

describe("codegen_agent's model-facing module contract", () => {
  it("sends the supported wrapper and source-metadata instructions through the actual gateway schema", () => {
    const schema = brainToolSchemas([codegenAgent])[0]!.function;
    expect(schema.description).toContain(CODEGEN_AGENT_MODULE_CONTRACT);
    expect(schema.description).toContain(CODEGEN_AGENT_MODULE_EXAMPLE);
    expect(schema.description).toContain("Read the selected AgentSpec with read_spec");
    expect(schema.description).toContain("never add an example event, field or tool");
    const parameters = schema.parameters as { properties: { code: { description: string } } };
    expect(parameters.properties.code.description).toContain('import { defineAgent } from "@agentic/runtime"');
    expect(parameters.properties.code.description).toContain("导出的是含 handler 方法的对象");
  });

  it("compiles, AST-lints and load-probes the exact advertised example, then accepts its pure CodeAct owner", async () => {
    expect(await validateAgentCode(CODEGEN_AGENT_MODULE_EXAMPLE)).toEqual({ ok: true, errors: [] });
    expect(lintGeneratedToolCode(CODEGEN_AGENT_MODULE_EXAMPLE).ok).toBe(true);
    expect(await probeAgentModule(CODEGEN_AGENT_MODULE_EXAMPLE)).toEqual({ loads: true });
    const candidate = spec();
    const result = await codegenAgent.execute({ action: candidate.actionName, code: CODEGEN_AGENT_MODULE_EXAMPLE }, context(candidate));
    expect(result).toMatchObject({ ok: true, output: { codeSource: "ai", codeExecuted: true, executionOwner: "codeact-container" } });
    expect(candidate.generatedCode).toBe(CODEGEN_AGENT_MODULE_EXAMPLE);
  });

  it.each([
    'export async function handler(input: Record<string, unknown>) { return input; }\nexport default handler;',
    'export async function handler(input: Record<string, unknown>) { return input; }\nexport const defineAgent = handler;\nexport default handler;',
  ])("keeps rejecting a bare function export and returns an actionable descriptor contract: %s", async (code) => {
    const candidate = spec();
    candidate.slug = "real-source-action";
    candidate.short = "RealSourceAction";
    candidate.trigger = ["REAL_INPUT"];
    candidate.emit = ["REAL_OUTPUT"];
    const before = structuredClone(candidate);
    const read = await readSpec.execute({ action: candidate.actionName }, context(candidate));
    const result = await codegenAgent.execute({ action: candidate.actionName, code }, context(candidate));

    expect(result).toMatchObject({
      ok: false,
      output: {
        probeReason: expect.stringContaining("含可调用 .handler 的 Agent 对象"),
        moduleContract: CODEGEN_AGENT_MODULE_CONTRACT,
        expectedMetadata: {
          id: "real-source-action", name: "RealSourceAction", actor: ["Agent"],
          trigger: ["REAL_INPUT"], emit: ["REAL_OUTPUT"], tools: [],
        },
      },
    });
    expect(result.summary).not.toContain("defineAgent 未导出");
    expect(read).toMatchObject({ ok: true, output: { moduleMetadata: (result.output as { expectedMetadata: unknown }).expectedMetadata } });
    expect(candidate).toEqual(before);
  });
});
