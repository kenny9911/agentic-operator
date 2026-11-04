import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BrainCtx, BrainEvent } from "./brain-types";
import type { DomainOntology } from "./ontology-types";

// G3 critique_plan 三视角分治：计划够大（≥4 agent 或规则>60）时派三位视角专家
// （链路完整/规则合规/IO 契约）并行评审，按 problem 去重合并；<2 位成功则诚实降级单跳。

vi.mock("./specialists", async (importOriginal) => {
  const real = await importOriginal<typeof import("./specialists")>();
  return { ...real, runSpecialists: vi.fn() };
});
vi.mock("./stream-gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./stream-gateway")>()),
  chatJson: vi.fn(),
}));

import { FACTORY_TOOLS } from "./tools";
import { runSpecialists } from "./specialists";
import { chatJson } from "./stream-gateway";

const critique = FACTORY_TOOLS.find((t) => t.name === "critique_plan")!;

function bigPlanCtx(): { ctx: BrainCtx; events: BrainEvent[] } {
  const events: BrainEvent[] = [];
  const actions = ["a1", "a2", "a3", "a4"].map((n) => ({ id: n, name: n, actor: ["Agent"], trigger: [`${n}_IN`], triggered_event: [`${n}_OUT`], target_objects: [], tool_use: [], system_prompt: "", user_prompt: "" }));
  const ctx = {
    domain: "rec",
    ontology: { domainId: "rec", objects: [], rules: [], actions, events: [], workflow: [], source: "snapshot" } as unknown as DomainOntology,
    currentPlan: { version: 1, summary: "s", agents: actions.map((a) => ({ actionName: a.name, role: "", triggerEvents: a.trigger, emitEvents: a.triggered_event, toolCandidates: [] })) },
    specs: [],
    humanDirectives: [],
    emit: (e: BrainEvent) => events.push(e),
    ports: {},
  } as unknown as BrainCtx;
  return { ctx, events };
}

beforeEach(() => {
  process.env.CUSTOM_LLM_API_KEY = "test-key"; // gateway configured → deep review reachable
  process.env.FACTORY_AI_MODEL = "test/real-model";
  // Keep the intentional fallback failure local and deterministic. Hitting
  // api.openai.com with a fake key made the full monorepo suite timing-sensitive.
  process.env.FACTORY_GATEWAY_BASE_URL = "http://127.0.0.1:1";
  vi.mocked(runSpecialists).mockReset();
  vi.mocked(chatJson).mockReset();
  vi.mocked(chatJson).mockResolvedValue(null);
});
afterEach(() => {
  delete process.env.CUSTOM_LLM_API_KEY;
  delete process.env.FACTORY_AI_MODEL;
  delete process.env.FACTORY_GATEWAY_BASE_URL;
  delete process.env.FACTORY_PERSPECTIVES;
});

const PERSPECTIVES_CTX = {
  selected: [
    { id: "operation", label: "运营视角", focus: "…", adapted: true },
    { id: "backoffice", label: "后台对账视角", focus: "…", adapted: false },
  ],
  okCount: 2,
  total: 2,
  source: "llm" as const,
};

describe("critique_plan — 三视角分治评审", () => {
  it.each([false, true])("preserves full plan and selected source contracts for deep=%s without unrelated Action evidence", async (deep) => {
    vi.mocked(chatJson).mockResolvedValue({ verdict: "ok", issues: [] });
    vi.mocked(runSpecialists).mockResolvedValue(
      ["chain", "rules", "contract"].map((id) => ({
        id, role: id, ok: true, output: { issues: [] }, summary: "",
      })),
    );
    const { ctx } = bigPlanCtx();
    ctx.generationDirective = {
      schema: "agent-factory-generation-directive/v1",
      mode: "action_selection",
      requestedActionIds: ["a1"], requestedActionNames: ["a1"],
      requestedActions: [{ id: "a1", name: "a1" }], sourceOntologyHash: "scope-hash",
    };
    Object.assign(ctx.ontology!.actions[0]!, {
      // Contracts after a long procedure must not disappear behind a digest cutoff.
      instruction: "SOURCE_PROCEDURE ".repeat(600),
      inputs: [{ name: "request_id", type: "string", required: true }],
      outputs: [{ name: "ack", type: "string", description: "SOURCE_EXACT_ACK_FROM_INPUT_MESSAGE" }],
      action_steps: [{ stepId: "ping", kind: "tool", tool: "meta.ping", toolArguments: {}, rules: ["R1"] }],
      on_failure: "SOURCE_TERMINAL_WITHOUT_SUCCESS_EVENT",
      target_objects: ["Request"],
      system_prompt: "SOURCE_REQUIRED_CORRELATION",
    });
    ctx.ontology!.actions[1]!.instruction = "EXCLUDED_ACTION_CONTRACT";
    ctx.ontology!.events = [
      {
        name: "a1_IN", payload: { source_action: null, state_mutations: [], event_data: [
          { name: "request_id", type: "string", target_object: "Request", required: true },
          { name: "message", type: "string", target_object: "Request", description: "SELECTED_EVENT_INPUT_DESCRIPTION" },
        ] },
      },
      {
        name: "a1_OUT", payload: { source_action: "a1", state_mutations: [], event_data: [
          { name: "ack", type: "string", target_object: "Request", description: "SELECTED_EVENT_OUTPUT_DESCRIPTION" },
        ] },
      },
      { name: "a2_IN", description: "EXCLUDED_EVENT_CONTRACT", payload: { source_action: null, state_mutations: [], event_data: [] } },
    ];
    ctx.ontology!.objects = [
      { id: "Request", name: "Request", properties: [{ name: "request_id", description: "SELECTED_OBJECT_CONTRACT" }] },
      { id: "Other", name: "EXCLUDED_OBJECT_CONTRACT" },
    ];
    ctx.ontology!.rules = [
      { id: "R1", name: "AcknowledgementRule", description: "Rule context ".repeat(30) + "SELECTED_RULE_CONTRACT" },
      { id: "R2", name: "EXCLUDED_RULE_CONTRACT" },
    ];
    ctx.ontologyUnderstanding = "EXCLUDED_FULL_DOMAIN_UNDERSTANDING";
    ctx.currentPlan = {
      version: 3, summary: "PLAN_SUMMARY_EXACT_ACK", scope: "full",
      scopeReason: "SERVER_SELECTED_SCOPE_REASON",
      notes: ["PLAN_NOTE_REQUEST_ID_PASSTHROUGH", "PLAN_NOTE_MANDATORY_META_PING"],
      agents: [{ actionName: "a1", role: "readiness", triggerEvents: ["a1_IN"], emitEvents: ["a1_OUT"], toolCandidates: ["meta.ping"], edgeCases: ["PLAN_EDGE_CASE_TERMINAL_ON_TOOL_FAILURE", "PLAN_EDGE_CASE_EMPTY_MESSAGE"] }],
    };
    const before = structuredClone({ ontology: ctx.ontology, plan: ctx.currentPlan });

    const result = await critique.execute({ deep }, ctx);

    expect(result.ok).toBe(true);
    const prompts = deep
      ? vi.mocked(runSpecialists).mock.calls[0]![1].map((task) => [task.system, task.user])
      : [vi.mocked(chatJson).mock.calls[0]!.slice(0, 2) as string[]];
    expect(prompts).toHaveLength(deep ? 3 : 1);
    for (const [system, user] of prompts) {
      expect(system).toContain("notes 和每个 agent 的 edgeCases");
      expect(system).toContain("真实缺失或矛盾仍须指出");
      expect(system).toContain("本次唯一允许评审、生成和验收的 Action 是：a1");
      expect(user).toContain(JSON.stringify(ctx.currentPlan));
      expect(user).toContain(JSON.stringify(ctx.ontology!.actions[0]));
      for (const marker of ["SELECTED_EVENT_INPUT_DESCRIPTION", "SELECTED_EVENT_OUTPUT_DESCRIPTION", "SELECTED_OBJECT_CONTRACT", "SELECTED_RULE_CONTRACT"]) expect(user).toContain(marker);
      for (const marker of ["EXCLUDED_ACTION_CONTRACT", "EXCLUDED_EVENT_CONTRACT", "EXCLUDED_OBJECT_CONTRACT", "EXCLUDED_RULE_CONTRACT", "EXCLUDED_FULL_DOMAIN_UNDERSTANDING"]) expect(user).not.toContain(marker);
    }
    expect({ ontology: ctx.ontology, plan: ctx.currentPlan }).toEqual(before);
  });

  it("keeps a genuine blocking single-review finding despite plan notes", async () => {
    const { ctx } = bigPlanCtx();
    ctx.currentPlan!.notes = ["The plan claims all output fields are covered."];
    const issue = { severity: "high", problem: "a1_OUT request_id is missing from the proposed output mapping", fix: "Preserve a1_IN request_id exactly" };
    vi.mocked(chatJson).mockResolvedValue({ verdict: "revise", issues: [issue] });
    const result = await critique.execute({}, ctx);
    expect(result).toMatchObject({ ok: false, output: { verdict: "revise", issues: [issue] } });
    expect(vi.mocked(chatJson).mock.calls[0]![1]).toContain(ctx.currentPlan!.notes[0]);
  });

  it("三视角 issues 去重合并，含高危 → verdict=revise", async () => {
    vi.mocked(runSpecialists).mockResolvedValue([
      { id: "chain", role: "链路完整视角", ok: true, output: { issues: [{ severity: "high", problem: "a2 的产出无人消费", fix: "补衔接" }] }, summary: "" },
      { id: "rules", role: "规则合规视角", ok: true, output: { issues: [{ severity: "med", problem: "a3 未识别为规则闸", fix: "标记闸口" }, { severity: "high", problem: "a2 的产出无人消费", fix: "重复项应去重" }] }, summary: "" },
      { id: "contract", role: "IO 契约视角", ok: true, output: { issues: [] }, summary: "" },
    ] as never);
    const { ctx } = bigPlanCtx();
    const r = await critique.execute({ deep: true }, ctx);
    expect(r.ok).toBe(false); // revise
    const out = r.output as { verdict: string; issues: Array<{ problem: string; perspective: string }> };
    expect(out.verdict).toBe("revise");
    expect(out.issues).toHaveLength(2); // 跨视角同 problem 去重
    expect(out.issues.some((i) => i.perspective === "链路完整视角")).toBe(true);
    expect(vi.mocked(runSpecialists)).toHaveBeenCalledTimes(1);
    const tasks = vi.mocked(runSpecialists).mock.calls[0]![1] as Array<{ id: string }>;
    expect(tasks.map((t) => t.id)).toEqual(["chain", "rules", "contract"]);
  });

  // #PERSPECTIVES P2 — 理解阶段有镜头结论时，深评追加一个「业务视角」挑战者：只提计划层面的
  // 新问题（agent 边界/合并/交接承接），明令禁止复述理解层发现；无镜头数据或开关关闭时保持三件套。
  it("ctx 有镜头结论 → 追加第 4 个 stakeholder 挑战任务（含标签与不复述禁令）", async () => {
    vi.mocked(runSpecialists).mockResolvedValue([
      { id: "chain", role: "链路完整视角", ok: true, output: { issues: [] }, summary: "" },
      { id: "rules", role: "规则合规视角", ok: true, output: { issues: [] }, summary: "" },
      { id: "contract", role: "IO 契约视角", ok: true, output: { issues: [] }, summary: "" },
      { id: "stakeholder", role: "业务视角", ok: true, output: { issues: [{ severity: "high", problem: "候选人拒绝后的交接点没有 agent 承接", fix: "补一个承接 agent" }] }, summary: "" },
    ] as never);
    const { ctx } = bigPlanCtx();
    ctx.ontologyPerspectives = PERSPECTIVES_CTX;
    ctx.ontologyUnderstanding = "深读理解（含业务视角结论）";
    const r = await critique.execute({ deep: true }, ctx);
    const tasks = vi.mocked(runSpecialists).mock.calls[0]![1] as Array<{ id: string; role: string; system: string; user: string }>;
    expect(tasks.map((t) => t.id)).toEqual(["chain", "rules", "contract", "stakeholder"]);
    const st = tasks[3]!;
    expect(st.role).toBe("业务视角");
    expect(st.system).toContain("运营视角、后台对账视角"); // 带上理解阶段实际选配的镜头标签
    expect(st.user).toContain("不要复述"); // 只提计划层新问题
    const out = r.output as { issues: Array<{ perspective: string }> };
    expect(out.issues.some((i) => i.perspective === "业务视角")).toBe(true);
  });

  it("镜头全败（okCount=0）或开关关闭 → 保持三件套", async () => {
    vi.mocked(runSpecialists).mockResolvedValue([
      { id: "chain", role: "链路完整视角", ok: true, output: { issues: [] }, summary: "" },
      { id: "rules", role: "规则合规视角", ok: true, output: { issues: [] }, summary: "" },
      { id: "contract", role: "IO 契约视角", ok: true, output: { issues: [] }, summary: "" },
    ] as never);
    const { ctx } = bigPlanCtx();
    ctx.ontologyPerspectives = { ...PERSPECTIVES_CTX, okCount: 0 };
    await critique.execute({ deep: true }, ctx);
    let tasks = vi.mocked(runSpecialists).mock.calls[0]![1] as Array<{ id: string }>;
    expect(tasks.map((t) => t.id)).toEqual(["chain", "rules", "contract"]);

    vi.mocked(runSpecialists).mockClear();
    vi.mocked(runSpecialists).mockResolvedValue([
      { id: "chain", role: "链路完整视角", ok: true, output: { issues: [] }, summary: "" },
      { id: "rules", role: "规则合规视角", ok: true, output: { issues: [] }, summary: "" },
      { id: "contract", role: "IO 契约视角", ok: true, output: { issues: [] }, summary: "" },
    ] as never);
    process.env.FACTORY_PERSPECTIVES = "0";
    const { ctx: c2 } = bigPlanCtx();
    c2.ontologyPerspectives = PERSPECTIVES_CTX;
    await critique.execute({ deep: true }, c2);
    tasks = vi.mocked(runSpecialists).mock.calls[0]![1] as Array<{ id: string }>;
    expect(tasks.map((t) => t.id)).toEqual(["chain", "rules", "contract"]);
  });

  it("零问题 → 三视角通过、verdict=ok", async () => {
    vi.mocked(runSpecialists).mockResolvedValue([
      { id: "chain", role: "链路完整视角", ok: true, output: { issues: [] }, summary: "" },
      { id: "rules", role: "规则合规视角", ok: true, output: { issues: [] }, summary: "" },
      { id: "contract", role: "IO 契约视角", ok: true, output: { issues: [] }, summary: "" },
    ] as never);
    const { ctx } = bigPlanCtx();
    const r = await critique.execute({ deep: true }, ctx);
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("三视角评审通过");
  });

  it("服务端 Action scope 不把全域理解包泄漏给评审，也明确禁止补未选 Action", async () => {
    vi.mocked(runSpecialists).mockResolvedValue([
      { id: "chain", role: "链路完整视角", ok: true, output: { issues: [] }, summary: "" },
      { id: "rules", role: "规则合规视角", ok: true, output: { issues: [] }, summary: "" },
      { id: "contract", role: "IO 契约视角", ok: true, output: { issues: [] }, summary: "" },
    ] as never);
    const { ctx } = bigPlanCtx();
    ctx.generationDirective = {
      schema: "agent-factory-generation-directive/v1",
      mode: "action_selection",
      requestedActionIds: ["a1"],
      requestedActionNames: ["a1"],
      requestedActions: [{ id: "a1", name: "a1" }],
      sourceOntologyHash: "scope-hash",
    };
    ctx.currentPlan = {
      version: 1,
      summary: "only a1",
      notes: [],
      agents: [
        {
          actionName: "a1",
          role: "selected",
          triggerEvents: ["a1_IN"],
          emitEvents: ["a1_OUT"],
          toolCandidates: [],
          edgeCases: [],
        },
      ],
    };
    ctx.ontologyUnderstanding =
      "全域历史理解：必须生成 a2、a3、a4 才算完整。";

    const result = await critique.execute({ deep: true }, ctx);

    expect(result.ok).toBe(true);
    const tasks = vi.mocked(runSpecialists).mock.calls[0]![1] as Array<{
      system: string;
      user: string;
    }>;
    expect(tasks).toHaveLength(3);
    for (const task of tasks) {
      expect(task.system).toContain("本次唯一允许评审、生成和验收的 Action 是：a1");
      expect(task.system).toContain("不能因为没有出现在计划里而判为漏项");
      expect(task.user).not.toContain("必须生成 a2、a3、a4");
    }
  });

  it("专家 <2 成功 → 诚实降级（发降级 reflect，走单跳路径）", async () => {
    vi.mocked(runSpecialists).mockResolvedValue([
      { id: "chain", role: "链路完整视角", ok: false, output: null, summary: "挂了" },
      { id: "rules", role: "规则合规视角", ok: false, output: null, summary: "挂了" },
      { id: "contract", role: "IO 契约视角", ok: true, output: { issues: [] }, summary: "" },
    ] as never);
    const { ctx, events } = bigPlanCtx();
    const r = await critique.execute({ deep: true }, ctx);
    expect(events.some((e) => e.t === "reflect" && String((e as { lesson: string }).lesson).includes("降级"))).toBe(true);
    // 单跳 chatJson 返回不可解析结果 → 明确阻断，不能伪装成 issues:[] 通过。
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("阻断");
  });
});
