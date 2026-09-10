import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadApprovedFunctionTestCassette, testGeneratedFunction } from "../src/services/agent-factory/function-tester-run";
import { preliminaryFunctionExpectedEvent } from "../src/services/agent-factory/sandbox-deployer";
import type { GeneratedAgentSpec } from "@agentic/agent-factory";
import { makeToolCassetteEntry } from "@agentic/shared/cassette";

// #P2.5-Tester — 端到端证明:一个生成的 ts_function_module 的 handler 能在 P0a worker 隔离里【真执行】
// 并发出期望事件。这是"生成→真跑→验收"闭环的实证(不是编译过就算,而是真跑 handler)。

function spec(over: Partial<GeneratedAgentSpec> = {}): GeneratedAgentSpec {
  return {
    key: "x", actionName: "processResume", slug: "raas-process-resume", short: "ResumeAgent", domainId: "raas-v1",
    nameZh: "简历处理", kind: "llm", trigger: ["RESUME_DOWNLOADED"], emit: ["RESUME_PROCESSED"], tools: ["parseResumeApi"],
    unresolvedTools: [], objects: ["Candidate"], systemPrompt: "解析简历原文，产出结构化候选人信息。", userPrompt: "",
    steps: [], ruleRefs: [], retries: 3, hitl: false, confidence: 0.9, promptSource: "llm" as GeneratedAgentSpec["promptSource"], ...over,
  } as GeneratedAgentSpec;
}

describe("preliminary function test rejection expectations", () => {
  it("requires an explicit event for multiple unique rejection outcomes unless terminal suppression is authored", () => {
    const candidate = spec({ tools: [], emit: ["REJECTED", "DENIED", "DONE"] });
    expect(() => preliminaryFunctionExpectedEvent(candidate, { kind: "reject" })).toThrow(/expectedEvent/);
    expect(preliminaryFunctionExpectedEvent(candidate, { kind: "reject", expectedEvent: "DENIED" })).toBe("DENIED");
    expect(preliminaryFunctionExpectedEvent({ ...candidate, emit: ["REJECTED", "REJECTED", "DONE"] }, { kind: "reject" })).toBe("REJECTED");
    candidate.plan = [{ stepId: "validate", kind: "logic", errorPolicy: [{ default: "terminal", suppressEmit: true }] }];
    expect(preliminaryFunctionExpectedEvent(candidate, { kind: "reject" })).toBeUndefined();
  });
  it("preserves declared rejection events but never infers rejection from a sole success event", () => {
    const rejection = spec({ tools: [], emit: ["MESSAGE_ACKNOWLEDGED", "MESSAGE_REJECTED"] });
    expect(preliminaryFunctionExpectedEvent(rejection, { kind: "reject" })).toBe("MESSAGE_REJECTED");
    expect(preliminaryFunctionExpectedEvent(spec({ tools: [], emit: ["MESSAGE_ACKNOWLEDGED"] }), { kind: "reject" })).toBeUndefined();
    rejection.plan = [{ stepId: "validate", kind: "logic", errorPolicy: [{ default: "terminal", suppressEmit: true }] }];
    expect(preliminaryFunctionExpectedEvent(rejection, { kind: "reject" })).toBeUndefined();
    expect(preliminaryFunctionExpectedEvent(rejection, { kind: "reject", expectedEvent: "MESSAGE_REJECTED" })).toBe("MESSAGE_REJECTED");
  });

  function module(body: string): string {
    return [
      'import { inngest } from "@/server/inngest/client";',
      'import { NonRetriableError } from "inngest";',
      'export const candidate = inngest.createFunction({ id: "local-rejection" }, { event: "START" }, async ({ event, step }) => {',
      body,
      '});',
    ].join("\n");
  }

  it.each([
    ['throw new Error("[terminal] invalid_input");', true],
    ['throw new NonRetriableError("invalid_input");', true],
    ['throw new Error("unexpected failure");', false],
    ['throw new Error("[park] temporary failure");', false],
    ['return { ok: true };', false],
    ['await step.sendEvent("done", { name: "DONE", data: {} }); return { ok: true };', false],
    ['await step.sendEvent("done", { name: "DONE", data: {} }); throw new Error("[terminal] too late");', false],
  ])("executes the handler and grades reject/no-event correctly: %s", async (body, pass) => {
    const result = await testGeneratedFunction(spec({ tools: [] }), {
      code: module(body),
      tier: "worker",
      caseKind: "reject",
      testEvent: { name: "START", data: { message: "   " } },
    });
    expect(result.verdict.pass).toBe(pass);
    if (pass) {
      expect(result.verdict.ran).toBe(true);
      expect(result.verdict.emitNames).toEqual([]);
      expect(result.verdict.error).toContain("invalid_input");
    }
  });

  it.each(["pass", "edge", "fault"] as const)("keeps terminal handler errors failing for %s cases", async (caseKind) => {
    const result = await testGeneratedFunction(spec({ tools: [] }), {
      code: module('throw new Error("[terminal] invalid_input");'),
      tier: "worker",
      caseKind,
    });
    expect(result.verdict.pass).toBe(false);
    expect(result.verdict.error).toBe("[terminal] invalid_input");
  });

  it("preserves an authored rejection-event expectation instead of accepting a silent throw", async () => {
    const candidate = spec({ tools: [], emit: ["DONE", "REJECTED"] });
    const emitted = await testGeneratedFunction(candidate, {
      code: module('await step.sendEvent("reject", { name: "REJECTED", data: { reason: "invalid_input" } }); return { rejected: true };'),
      tier: "worker",
      caseKind: "reject",
      expectEmits: ["REJECTED"],
    });
    expect(emitted.verdict.pass).toBe(true);
    const silent = await testGeneratedFunction(candidate, {
      code: module('throw new Error("[terminal] invalid_input");'),
      tier: "worker",
      caseKind: "reject",
      expectEmits: ["REJECTED"],
    });
    expect(silent.verdict.pass).toBe(false);
  });

  it("does not turn missing tool evidence into a terminal business rejection", async () => {
    const result = await testGeneratedFunction(spec({ tools: [] }), {
      code: module('try { await globalThis.__agentTool("unconfigured.tool", {}); } catch { throw new Error("[terminal] invalid_input"); }'),
      tier: "worker",
      caseKind: "reject",
    });
    expect(result.verdict.pass).toBe(false);
    expect(result.verdict.fixtureErrors.join(" ")).toContain("missing approved cassette");
  });
});

function successfulParseCassette(uploadId: string, body: unknown = { name: "张三" }) {
  return {
    version: 1 as const,
    tool: { name: "parseResumeApi", definitionHash: "def-1" },
    evidence: { recordedAt: new Date(0).toISOString(), mode: "signed-fixture" as const },
    entries: [makeToolCassetteEntry({
      toolName: "parseResumeApi",
      args: { upload_id: uploadId, results: {} },
      status: 200,
      body,
    })],
  };
}

describe("TC-P25: 生成的 function 在隔离里真跑 handler + 发出事件", () => {
  it("单 emit：handler 真跑通并发出 RESUME_PROCESSED", async () => {
    const { verdict } = await testGeneratedFunction(spec(), {
      // Tenant adapters unwrap legacy RAAS envelopes before generic functions.
      // The generated handler therefore receives canonical event.data.
      testEvent: { data: { upload_id: "u1" } },
      expectEmits: ["RESUME_PROCESSED"],
      fixture: { toolCassettes: { parseResumeApi: successfulParseCassette("u1") }, reasonResult: { pass: true, ok: true, emit: "RESUME_PROCESSED" } },
    });
    expect(verdict.ran).toBe(true);
    expect(verdict.pass).toBe(true);
    expect(verdict.emitNames).toContain("RESUME_PROCESSED");
  }, 20000);

  it("多 emit + decision.pass=true 走成功分支", async () => {
    const { verdict } = await testGeneratedFunction(
      spec({ actionName: "createJd", slug: "raas-create-jd", emit: ["JD_GENERATED", "JD_FAILED"], tools: [] }),
      { expectEmits: ["JD_GENERATED"], fixture: { reasonResult: { pass: true, ok: true, emit: "JD_GENERATED" } } },
    );
    expect(verdict.ran).toBe(true);
    expect(verdict.emitNames).toContain("JD_GENERATED");
  }, 20000);

  it("old-ao profile 渲染的 function 同样能在隔离里真跑", async () => {
    const { verdict } = await testGeneratedFunction(spec(), {
      render: { profile: "old-ao", pauseGate: "skipIfRaasV1Paused" },
      testEvent: { data: { upload_id: "u1" } },
      expectEmits: ["RESUME_PROCESSED"],
      fixture: { toolCassettes: { parseResumeApi: successfulParseCassette("u1") }, reasonResult: { pass: true, ok: true, emit: "RESUME_PROCESSED" } },
    });
    expect(verdict.ran).toBe(true);
    expect(verdict.pass).toBe(true);
  }, 20000);

  it("缺少显式 fixture 时 fail-close，不再由 harness 硬编码 pass:true", async () => {
    const { verdict, fixtureMode } = await testGeneratedFunction(spec(), {
      testEvent: { data: { upload_id: "missing.pdf" } },
      expectEmits: ["RESUME_PROCESSED"],
    });
    expect(fixtureMode).toBe("missing");
    expect(verdict.pass).toBe(false);
    expect(verdict.fixtureErrors.join(" ")).toMatch(/fixture/i);
  }, 20000);

  it("静态 toolResults 不能再把外部工具伪造成成功", async () => {
    const { verdict, fixtureMode } = await testGeneratedFunction(spec(), {
      testEvent: { data: { upload_id: "u1" } },
      expectEmits: ["RESUME_PROCESSED"],
      fixture: {
        toolResults: { parseResumeApi: { ok: true, candidate_id: "fake" } },
        reasonResult: { emit: "RESUME_PROCESSED" },
      },
    });
    expect(fixtureMode).toBe("scripted");
    expect(verdict.pass).toBe(false);
    expect(verdict.fixtureErrors.join(" ")).toContain("没有已批准的 cassette/probe/record 证据");
    expect(verdict.fixtureErrors.join(" ")).toContain("不会调用真实外部系统");
  }, 20000);

  it("纯无工具模块仍可做结构真跑，不要求外部 cassette", async () => {
    const { verdict, fixtureMode } = await testGeneratedFunction(spec({ tools: [], plan: [] }), {
      expectEmits: ["RESUME_PROCESSED"],
      fixture: { reasonResult: { emit: "RESUME_PROCESSED", ok: true } },
    });
    expect(fixtureMode).toBe("scripted");
    expect(verdict.pass, verdict.reasons.join("; ")).toBe(true);
  }, 20000);

  it("按实际工具参数匹配 probe cassette，并校验 payload/工具次数/step 结果", async () => {
    const cassette = {
      version: 1 as const,
      tool: { name: "parseResumeApi", definitionHash: "def-1" },
      evidence: { recordedAt: new Date(0).toISOString(), mode: "live-probe" as const },
      entries: [makeToolCassetteEntry({
        toolName: "parseResumeApi",
        args: { upload_id: "u1", results: {} },
        status: 200,
        body: { candidate_id: "c-1" },
      })],
    };
    const { verdict } = await testGeneratedFunction(spec(), {
      testEvent: { data: { upload_id: "u1" } },
      expectEmits: ["RESUME_PROCESSED"],
      assertions: {
        emits: [{ event: "RESUME_PROCESSED", count: 1, payload: { requiredPaths: ["candidate_id", "upload_id"] } }],
        toolCalls: [{ tool: "parseResumeApi", count: 1, args: { partial: { upload_id: "u1" } } }],
        stepResults: [{ stepId: "parseResumeApi-raas-process-resume-parseResumeApi", count: 1, result: { partial: { candidate_id: "c-1" } } }],
      },
      fixture: { toolCassettes: { parseResumeApi: cassette }, reasonResult: { emit: "RESUME_PROCESSED" } },
    });
    expect(verdict.pass, verdict.reasons.join("; ")).toBe(true);
  }, 20000);

  it("cassette 参数不匹配时明确失败，不取同名工具的任意响应", async () => {
    const cassette = {
      version: 1 as const,
      tool: { name: "parseResumeApi", definitionHash: "def-1" },
      evidence: { recordedAt: new Date(0).toISOString(), mode: "live-probe" as const },
      entries: [makeToolCassetteEntry({ toolName: "parseResumeApi", args: { upload_id: "other", results: {} }, status: 200, body: { candidate_id: "wrong" } })],
    };
    const { verdict } = await testGeneratedFunction(spec(), {
      testEvent: { data: { upload_id: "u1" } },
      expectEmits: ["RESUME_PROCESSED"],
      fixture: { toolCassettes: { parseResumeApi: cassette }, reasonResult: { emit: "RESUME_PROCESSED" } },
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.fixtureErrors.join(" ")).toContain("no evidence cassette matches tool arguments");
  }, 20000);

  it("成功用例不能把 cassette 的非 2xx 响应当成成功 fixture", async () => {
    const cassette = {
      version: 1 as const,
      tool: { name: "parseResumeApi", definitionHash: "def-1" },
      evidence: { recordedAt: new Date(0).toISOString(), mode: "live-probe" as const },
      entries: [makeToolCassetteEntry({ toolName: "parseResumeApi", args: { upload_id: "u1", results: {} }, status: 503, body: { error: "unavailable" } })],
    };
    const { verdict } = await testGeneratedFunction(spec(), {
      testEvent: { data: { upload_id: "u1" } },
      expectEmits: ["RESUME_PROCESSED"],
      fixture: { toolCassettes: { parseResumeApi: cassette }, reasonResult: { emit: "RESUME_PROCESSED" } },
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.fixtureErrors.join(" ")).toContain("HTTP 503");
  }, 20000);

  it("已批准 fault 用例仍可回放非 2xx，并验证失败事件分支", async () => {
    const cassette = {
      version: 1 as const,
      tool: { name: "parseResumeApi", definitionHash: "def-1" },
      evidence: { recordedAt: new Date(0).toISOString(), mode: "runtime-record" as const },
      entries: [makeToolCassetteEntry({
        toolName: "parseResumeApi",
        args: { upload_id: "u1", results: {} },
        status: 400,
        body: { error: "invalid resume" },
      })],
    };
    const { verdict } = await testGeneratedFunction(spec({
      emit: ["RESUME_PROCESSED", "RESUME_FAILED"],
      plan: [{
        stepId: "parse",
        kind: "tool",
        tool: "parseResumeApi",
        errorPolicy: [
          { when: "status==400", do: "continue", defaultResult: { accepted: false }, emitEvent: "RESUME_FAILED" },
          { default: "terminal", suppressEmit: true },
        ],
      }, {
        stepId: "accepted",
        kind: "condition",
        condition: "lastResult.accepted == true",
      }, {
        stepId: "success",
        kind: "emit",
        emitEvent: "RESUME_PROCESSED",
        dependsOn: ["accepted"],
      }],
    }), {
      testEvent: { data: { upload_id: "u1" } },
      expectEmits: ["RESUME_FAILED"],
      fixture: {
        toolCassettes: { parseResumeApi: cassette },
        reasonResult: { emit: "RESUME_PROCESSED" },
        allowEvidenceFailures: true,
      },
    });
    expect(verdict.fixtureErrors).toEqual([]);
    expect(verdict.pass, verdict.reasons.join("; ")).toBe(true);
    expect(verdict.emitNames).toEqual(["RESUME_FAILED"]);
  }, 20000);

  it("没有 definition/probe/record 身份的同名 cassette 也会阻断", async () => {
    const unapproved = {
      version: 1 as const,
      tool: { name: "parseResumeApi", definitionHash: "def-1" },
      entries: [makeToolCassetteEntry({
        toolName: "parseResumeApi",
        args: { upload_id: "u1", results: {} },
        status: 200,
        body: { candidate_id: "fake" },
      })],
    };
    const { verdict } = await testGeneratedFunction(spec(), {
      testEvent: { data: { upload_id: "u1" } },
      expectEmits: ["RESUME_PROCESSED"],
      fixture: { toolCassettes: { parseResumeApi: unapproved }, reasonResult: { emit: "RESUME_PROCESSED" } },
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.fixtureErrors.join(" ")).toContain("没有通过 definition/probe/record 证据校验");
  }, 20000);

  it("沙箱证据加载会校验当前 definition/schema，不会仅凭文件名放行", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "function-cassette-"));
    try {
      const cassettePath = path.join(root, "parseResumeApi.json");
      const document = {
        version: 1 as const,
        tool: { name: "parseResumeApi", definitionHash: "def-current", schemaHash: "schema-current" },
        evidence: { recordedAt: new Date(0).toISOString(), mode: "live-probe" as const },
        entries: [makeToolCassetteEntry({ toolName: "parseResumeApi", args: { upload_id: "u1" }, status: 200, body: { ok: true } })],
      };
      await fs.writeFile(cassettePath, JSON.stringify(document), "utf8");
      const approved = loadApprovedFunctionTestCassette({
        toolName: "parseResumeApi",
        cassettePath,
        definitionHash: "def-current",
        schemaHash: "schema-current",
      });
      expect(approved.document).toEqual(document);

      const drifted = loadApprovedFunctionTestCassette({
        toolName: "parseResumeApi",
        cassettePath,
        definitionHash: "def-new",
        schemaHash: "schema-current",
      });
      expect(drifted.document).toBeUndefined();
      expect(drifted.blockedReason).toContain("当前工具定义");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
