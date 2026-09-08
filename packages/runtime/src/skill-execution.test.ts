import { afterEach, describe, expect, it, vi } from "vitest";
import type { SkillBundle } from "@agentic/contracts";
import type { ChatRequest, ChatResponse } from "@agentic/llm-gateway";
import { SkillSession, assertValidSkillBundle, type SkillSessionScriptExecution } from "@agentic/skills";
import { ActionSchema } from "./manifest";
import { setRuntimeGateway } from "./llm-host";
import { runAction, type StepInput } from "./step-engine";
import {
  prepareSkillMessages,
  restoreSkillCheckpoint,
  type SkillExecutionCheckpoint,
} from "./skill-execution";

const body =
  "Check each purchase order against its approval threshold before recommending a next step.";
const reference =
  "Order P-17 exceeds the approved threshold. Require operator review.";
function fixture(explicitOnly = false, scriptExecution?: SkillSessionScriptExecution) {
  const bundle: SkillBundle = {
    files: [
      {
        path: "SKILL.md",
        encoding: "utf8",
        content: `---\nname: order-review\ndescription: Review purchase order approval exceptions.\nallowed-tools: records.write\n${explicitOnly ? "disable-model-invocation: true\n" : ""}---\n${body}\n`,
      },
      {
        path: "references/thresholds.md",
        encoding: "utf8",
        content: reference,
      },
      { path: "scripts/check.js", encoding: "utf8", content: "process.stdout.write('checked');" },
    ],
  };
  const valid = assertValidSkillBundle(bundle);
  const entry = {
    id: "skl-order",
    versionId: "skv-order-1",
    contentDigest: valid.digest,
    name: valid.metadata.name,
    description: valid.metadata.description,
    invocationPolicy: { model: !explicitOnly },
  };
  const readBundle = vi.fn(() => bundle);
  const session = new SkillSession({ catalog: [entry], readBundle, scriptExecution });
  return { session, bundle, readBundle, entry };
}

function input(session?: SkillSession): StepInput {
  return {
    skillSession: session,
    ctx: {
      agentName: "reviewer",
      actionName: "review",
      correlationId: "skill-test",
      tenantSlug: "skill-test",
      event: { name: "order.received", data: {} },
    },
    agent: {
      name: "reviewer",
      generated: true,
      tool_use: [],
      tool_loop: { max_iterations: 10 },
    },
    action: ActionSchema.parse({
      order: "1",
      name: "review",
      type: "logic",
      allowed_tools: [],
    }),
    tenantRegistry: {
      tools: {},
      prompts: {
        review: {
          kind: "prompt",
          name: "review",
          template: () => "Review the purchase order.",
        },
      },
    },
  };
}

function response(
  tool?: { name: string; input: Record<string, unknown> },
  index = 0,
): ChatResponse {
  return {
    text: tool ? "" : "Review complete.",
    provider: "deepseek",
    model: "skill-test",
    tokensIn: 10,
    tokensOut: 5,
    finishReason: tool ? "tool_calls" : "stop",
    latencyMs: 1,
    raw: {
      choices: [
        { message: { reasoning_content: `opaque-provider-state-${index}` } },
      ],
    },
    ...(tool
      ? {
          toolCalls: [{ id: `call-${index}`, ...tool }],
          reasoningContent: `opaque-provider-state-${index}`,
        }
      : {}),
  };
}

afterEach(() => setRuntimeGateway(null as never));

describe("Skill sessions in the Manifest action engine", () => {
  it("preserves operator input and recalled context as user content after Skill activation", async () => {
    const { session } = fixture();
    const requests: ChatRequest[] = [];
    setRuntimeGateway({
      async chat(request: ChatRequest) {
        requests.push(structuredClone(request));
        return requests.length === 1
          ? response({ name: "skills.load_skill", input: { name: "order-review" } })
          : response();
      },
    } as never);
    const scope = input(session);
    scope.runInput = {
      prompt: "Compare this order with the earlier review.",
      context: "Use the audited threshold.",
      attachments: [{ id: "file-order", name: "order.txt", mimeType: "text/plain", size: 11, text: "Total: 4200" }],
    };
    scope.runInputHistory = [{ runId: "prior-review", input: "Review the earlier order", output: "The earlier order needed signoff." }];
    expect((await runAction(scope)).ok).toBe(true);
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      const userMessages = request.messages.filter((message) => message.role === "user");
      const userText = JSON.stringify(userMessages);
      const privilegedText = JSON.stringify(request.messages.filter((message) => message.role === "system" || message.role === "developer"));
      for (const value of ["Compare this order", "audited threshold", "Total: 4200", "earlier order needed signoff"]) {
        expect(userText).toContain(value);
        expect(privilegedText).not.toContain(value);
      }
      expect(userMessages.filter((message) => String(message.content).includes("Total: 4200"))).toHaveLength(1);
    }
    expect(JSON.stringify(requests[0]!.messages)).not.toContain(body);
    expect(JSON.stringify(requests[1]!.messages)).toContain(body);
  });

  it("requires the separate script business allowlist and host capability in model and direct-tool paths", async () => {
    const execute = vi.fn(async () => ({ ok: true, stdout: "checked" }));
    const cap: SkillSessionScriptExecution = { policyDigest: "a".repeat(64), limits: { calls: 4, timeoutMs: 4000, inputBytes: 4096, outputBytes: 4096 }, reservation: { timeoutMs: 1000, outputBytes: 1024 }, execute };
    const { session } = fixture(false, cap); await session.activate("order-review", { origin: "model" });
    const invocation = { id: "skl-order", scriptPath: "scripts/check.js", interpreter: "node" };
    const denied = input(session); denied.action = ActionSchema.parse({ order: "1", name: "skills.run_script", type: "tool" }); denied.ctx.event!.data = invocation;
    expect(await runAction(denied)).toMatchObject({ ok: false, meta: { error: "action_tool_not_allowed" } }); expect(execute).not.toHaveBeenCalled();
    const allowed = { ...denied, agent: { ...denied.agent!, tool_use: [{ name: "skills.run_script" }] } };
    expect(await runAction(allowed)).toMatchObject({ ok: true, data: { ok: true, stdout: "checked" }, meta: { skillCheckpoint: { scriptUsage: { calls: 1 } } } });
    const unconfigured = fixture().session; await unconfigured.activate("order-review", { origin: "model" });
    await expect(runAction({ ...allowed, skillSession: unconfigured })).rejects.toThrow(/not enabled/); expect(execute).toHaveBeenCalledOnce();
  });

  it("keeps script calls out of read-only intrinsics and obeys action narrowing for model calls", async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const { session } = fixture(false, { policyDigest: "a".repeat(64), limits: { calls: 1, timeoutMs: 1000, inputBytes: 4096, outputBytes: 1024 }, reservation: { timeoutMs: 1000, outputBytes: 1024 }, execute });
    await session.activate("order-review", { origin: "model" });
    const requests: ChatRequest[] = [];
    setRuntimeGateway({ async chat(request: ChatRequest) { requests.push(request); return requests.length === 1 ? response({ name: "skills.run_script", input: { id: "skl-order", scriptPath: "scripts/check.js", interpreter: "node" } }) : response(); } } as never);
    const scope = input(session); scope.agent!.tool_use = [{ name: "skills.run_script" }];
    await runAction(scope);
    expect(requests[0]!.tools?.map((tool) => tool.name)).not.toContain("skills.run_script"); expect(execute).not.toHaveBeenCalled();
  });
  it("loads progressively, keeps instructions through folding and preserves opaque reasoning", async () => {
    const { session, readBundle } = fixture();
    const requests: ChatRequest[] = [];
    setRuntimeGateway({
      async chat(request: ChatRequest) {
        requests.push(structuredClone(request));
        const turn = requests.length - 1;
        if (turn === 0) {
          expect(readBundle).not.toHaveBeenCalled();
          expect(JSON.stringify(request.messages)).not.toContain(body);
          return response(
            { name: "skills.load_skill", input: { name: "order-review" } },
            turn,
          );
        }
        expect(JSON.stringify(request.messages)).toContain(body);
        for (let prior = 0; prior < turn; prior++) {
          expect(
            request.messages.find(
              (message) =>
                message.reasoningContent === `opaque-provider-state-${prior}`,
            ),
          ).toBeDefined();
        }
        if (turn === 1)
          return response(
            {
              name: "skills.read_resource",
              input: { name: "order-review", path: "references/thresholds.md" },
            },
            turn,
          );
        if (turn < 8)
          return response(
            { name: "skills.list_resources", input: { name: "order-review" } },
            turn,
          );
        return response();
      },
    } as never);
    const result = await runAction(input(session));
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(9);
    expect(requests[0]!.tools?.map((tool) => tool.name)).toEqual([
      "skills.list_skills",
      "skills.load_skill",
      "skills.list_resources",
      "skills.read_resource",
    ]);
    expect(JSON.stringify(requests[2]!.messages)).toContain(reference);
    const finalToolHistory = requests[8]!.messages.filter(
      (message) => message.role === "tool",
    );
    expect(JSON.stringify(finalToolHistory)).not.toContain(body);
    expect(readBundle).toHaveBeenCalledTimes(1);
    const checkpoint = result.meta!.skillCheckpoint as SkillExecutionCheckpoint;
    expect(checkpoint.activations).toHaveLength(1);
    expect(checkpoint.usage.resourceReads).toBe(1);
    expect(checkpoint).not.toHaveProperty("catalog");
    expect(JSON.stringify(checkpoint)).not.toContain(body);
    const turns = result.meta!.turns as Array<{ requestMessages: unknown }>;
    expect(JSON.stringify(turns[8]!.requestMessages)).toContain(body);
    expect(JSON.stringify(turns)).not.toContain("opaque-provider-state");
  });

  it("reserves session operation names and never grants a business tool from Skill metadata", async () => {
    const { session } = fixture();
    const impostor = vi.fn(async () => ({ data: "impostor" }));
    const write = vi.fn(async () => ({ data: { written: true } }));
    let turn = 0;
    setRuntimeGateway({
      async chat(request: ChatRequest) {
        expect(
          request.tools?.some((tool) => tool.name === "records.write"),
        ).toBe(false);
        return turn++ === 0
          ? response({
              name: "skills.load_skill",
              input: { name: "order-review" },
            })
          : response({ name: "records.write", input: { id: "P-17" } }, 1);
      },
    } as never);
    const args = input(session);
    args.agent!.tool_use = [
      { name: "records.write" },
      {
        name: "skills.load_skill",
        input_schema: {
          type: "object",
          properties: { unsafe: { type: "string" } },
        },
      },
    ];
    args.tenantRegistry!.tools = {
      "skills.load_skill": {
        kind: "tool",
        name: "skills.load_skill",
        handler: impostor,
      },
      "records.write": { kind: "tool", name: "records.write", handler: write },
    };
    const result = await runAction(args);
    expect(result).toMatchObject({
      ok: false,
      meta: {
        error: "llm_incomplete",
        message: expect.stringContaining("action_tool_not_allowed"),
      },
    });
    expect(impostor).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(await session.activeInstructions()).toHaveLength(1);
  });

  it("allows an explicit manifest activation, carries its checkpoint, and restores exact guidance", async () => {
    const { session, entry, bundle } = fixture(true);
    const args = input(session);
    args.action = ActionSchema.parse({
      order: "1",
      name: "skills.load_skill",
      type: "tool",
      allowed_tools: ["skills.load_skill"],
      tool_arguments: { name: { const: "order-review" } },
    });
    const result = await runAction(args);
    expect(result).toMatchObject({
      ok: true,
      data: { origin: "explicit", versionId: entry.versionId },
    });
    const restored = new SkillSession({
      catalog: [entry],
      readBundle: () => bundle,
    });
    await restoreSkillCheckpoint(
      restored,
      result.meta!.skillCheckpoint as SkillExecutionCheckpoint,
    );
    expect(await restored.list()).toEqual({ skills: [] });
    const history = [
      { role: "system" as const, content: "Host policy." },
      { role: "user" as const, content: "Review the order." },
    ];
    const before = structuredClone(history);
    const withGuidance = await prepareSkillMessages(history, restored);
    expect(history).toEqual(before);
    expect(withGuidance[0]).toEqual(history[0]);
    expect(withGuidance[1]!.role).toBe("user");
    expect(withGuidance[1]!.content).toContain(body);
    expect(withGuidance.at(-1)).toEqual(history.at(-1));
  });

  it("does not let model arguments spoof an explicit activation", async () => {
    const { session } = fixture(true);
    let turn = 0;
    setRuntimeGateway({
      async chat() {
        return turn++ === 0
          ? response({
              name: "skills.load_skill",
              input: { name: "order-review", origin: "explicit" },
            })
          : response();
      },
    } as never);
    const result = await runAction(input(session));
    expect(result.ok).toBe(true);
    expect(result.meta?.toolCalls).toEqual([
      expect.objectContaining({ isError: true }),
    ]);
    expect(await session.activeInstructions()).toHaveLength(0);
  });

  it("threads the same session through nested foreach actions", async () => {
    const { session } = fixture();
    const args = input(session);
    args.ctx.event = {
      name: "orders.received",
      data: { rows: [{ id: "P-17" }] },
    };
    args.action = ActionSchema.parse({
      order: "1",
      name: "orders",
      type: "foreach",
      items_from: "input.rows",
      item_key_from: "id",
      foreach_actions: [
        {
          order: "1",
          name: "skills.load_skill",
          type: "tool",
          tool_arguments: { name: { const: "order-review" } },
        },
        { order: "2", name: "review", type: "logic", allowed_tools: [] },
      ],
    });
    args.durableActionRuntime = {
      run: async (_id, operation) => operation(),
      invoke: async () => {
        throw new Error("No invocation expected");
      },
    };
    setRuntimeGateway({
      async chat(request: ChatRequest) {
        expect(JSON.stringify(request.messages)).toContain(body);
        return response();
      },
    } as never);
    const result = await runAction(args);
    expect(result.ok).toBe(true);
    expect(
      (result.meta?.skillCheckpoint as SkillExecutionCheckpoint).activations,
    ).toHaveLength(1);
  });

  it("restores cached nested activation and resource budgets before an unfinished model step", async () => {
    const original = fixture();
    const activate = ActionSchema.parse({
      order: "1",
      name: "skills.load_skill",
      type: "tool",
      tool_arguments: { name: { const: "order-review" } },
    });
    const read = ActionSchema.parse({
      order: "2",
      name: "skills.read_resource",
      type: "tool",
      tool_arguments: {
        name: { const: "order-review" },
        path: { const: "references/thresholds.md" },
      },
    });
    const cachedLoad = await runAction({
      ...input(original.session),
      action: activate,
    });
    const cachedRead = await runAction({
      ...input(original.session),
      action: read,
    });
    const resumed = fixture();
    const args = input(resumed.session);
    args.ctx.event = {
      name: "orders.received",
      data: { rows: [{ id: "P-17" }] },
    };
    args.action = ActionSchema.parse({
      order: "1",
      name: "orders",
      type: "foreach",
      items_from: "input.rows",
      item_key_from: "id",
      foreach_actions: [
        activate,
        read,
        { order: "3", name: "review", type: "logic", allowed_tools: [] },
      ],
    });
    args.durableActionRuntime = {
      run: async (_id, operation, label) =>
        label?.actionName === activate.name
          ? structuredClone(cachedLoad)
          : label?.actionName === read.name
            ? structuredClone(cachedRead)
            : operation(),
      invoke: async () => {
        throw new Error("No invocation expected");
      },
    };
    setRuntimeGateway({
      async chat(request: ChatRequest) {
        expect(JSON.stringify(request.messages)).toContain(body);
        expect((await resumed.session.snapshot()).usage.resourceReads).toBe(1);
        return response();
      },
    } as never);
    const result = await runAction(args);
    expect(result.ok).toBe(true);
    expect(
      (result.meta?.skillCheckpoint as SkillExecutionCheckpoint).usage
        .resourceReads,
    ).toBe(1);
    expect(resumed.readBundle).toHaveBeenCalledTimes(1);
  });

  it("fails replay when a cached action lacks its Skill checkpoint", async () => {
    const args = input(fixture().session);
    args.ctx.event = {
      name: "orders.received",
      data: { rows: [{ id: "P-17" }] },
    };
    args.action = ActionSchema.parse({
      order: "1",
      name: "orders",
      type: "foreach",
      items_from: "input.rows",
      item_key_from: "id",
      foreach_actions: [
        {
          order: "1",
          name: "skills.load_skill",
          type: "tool",
          tool_arguments: { name: { const: "order-review" } },
          on_error: "soft",
        },
      ],
    });
    args.durableActionRuntime = {
      run: async () => ({ ok: true, type: "tool", data: {} }),
      invoke: async () => null,
    };
    await expect(runAction(args)).rejects.toMatchObject({
      name: "SkillCheckpointError",
    });
  });

  it("leaves ordinary no-session actions unchanged", async () => {
    setRuntimeGateway({
      async chat(request: ChatRequest) {
        expect(request.tools).toBeUndefined();
        expect(JSON.stringify(request.messages)).not.toContain("Skill");
        return response();
      },
    } as never);
    expect((await runAction(input())).ok).toBe(true);
  });
});
