import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneratedAgentSpec } from "@agentic/agent-factory";

vi.mock("@agentic/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agentic/runtime")>()),
  runGeneratedCodeIsolated: vi.fn(),
  runGeneratedModule: vi.fn(),
  runGeneratedModuleProcess: vi.fn(),
  runGeneratedModuleContainer: vi.fn(),
}));

import {
  runGeneratedCodeIsolated,
  runGeneratedModule,
  runGeneratedModuleProcess,
  runGeneratedModuleContainer,
  type CodeActContainerExecutionEvidence,
} from "@agentic/runtime";
import { testGeneratedFunction } from "../src/services/agent-factory/function-tester-run";

// Orchestration tests only. These mocked kernel results are test fixtures,
// never real container execution, signed sandbox, or promotion evidence.
const code = `import { defineAgent } from "@agentic/runtime";
export const agent = defineAgent({
  name: "echo",
  handler: async (input, ctx) => {
    if (typeof input.message !== "string" || !input.message.trim()) throw new Error("[terminal] invalid_input");
    const result = { request_id: input.request_id, echo: input.message };
    ctx.emit("ECHOED", result);
    return result;
  },
});`;
const codeHash = createHash("sha256").update(code, "utf8").digest("hex");
const scope = {
  kind: "sandbox" as const,
  target_domain_id: "unit-domain",
  candidate_fingerprint: "unit-candidate-fingerprint",
  attempt_id: "unit-attempt",
};
const context = {
  tenantId: "ten-unit-sandbox",
  tenantSlug: "unit-echo-sb",
  factoryExecutionScope: scope,
};
type KernelResult = Awaited<ReturnType<typeof runGeneratedCodeIsolated>>;
type FailedKernelResult = Extract<KernelResult, { ok: false }>;

function spec(overrides: Partial<GeneratedAgentSpec> = {}): GeneratedAgentSpec {
  return {
    key: "echo", actionName: "echo", slug: "unit-echo", short: "EchoAgent",
    domainId: "unit-domain", nameZh: "回声", kind: "llm",
    trigger: ["ECHO_REQUESTED"], emit: ["ECHOED"], tools: [],
    unresolvedTools: [], objects: [], systemPrompt: "Return the submitted message.", userPrompt: "",
    steps: [], ruleRefs: [], retries: 1, hitl: false, confidence: 1,
    promptSource: "llm", codeSource: "ai", codeExecuted: true, generatedCode: code,
    ...overrides,
  };
}

function evidence(overrides: Partial<CodeActContainerExecutionEvidence> = {}): CodeActContainerExecutionEvidence {
  return {
    schema: "agentic-codeact-container-execution/v1",
    attemptId: scope.attempt_id,
    containerIdHash: "1".repeat(64), codeSha256: codeHash,
    candidateImageDigest: `sha256:${"2".repeat(64)}`, imageId: `sha256:${"2".repeat(64)}`,
    policyHash: "3".repeat(64), isolation: "isolated_container",
    startedAt: "2026-09-10T00:00:00.000Z", completedAt: "2026-09-10T00:00:00.010Z",
    removedAt: "2026-09-10T00:00:00.020Z", exitCode: 1, oomKilled: false, rpcCount: 0,
    removed: true, absenceVerified: true,
    ...overrides,
  };
}

function failed(overrides: Partial<FailedKernelResult> = {}): FailedKernelResult {
  return {
    ok: false, failure: "candidate_failed", failureStage: "handler", error: "[terminal] invalid_input",
    // The real kernel exits 1 for a handled candidate_failed response.
    crashed: true, isolation: "isolated_container", codeSha256: codeHash,
    durationMs: 20, productionAttested: false, executorStarted: true,
    handlerStarted: true,
    attestation: "sandbox_not_required", toolDispatches: [], skillAccesses: [],
    containerEvidence: evidence(),
    ...overrides,
  };
}

function succeeded(): KernelResult {
  return {
    ok: true, data: { request_id: "unit-request", echo: "hello" },
    emitted: [{ event: "ECHOED", payload: { request_id: "unit-request", echo: "hello" } }],
    isolation: "isolated_container", codeSha256: codeHash,
    durationMs: 20, productionAttested: false, executorStarted: true,
    handlerStarted: true,
    attestation: "sandbox_not_required", toolDispatches: [], skillAccesses: [],
    containerEvidence: evidence({ exitCode: 0 }),
  };
}

beforeEach(() => vi.clearAllMocks());

describe("exact CodeAct preliminary orchestration", () => {
  it("forwards exact bytes, input and active tenant/attempt to the container kernel", async () => {
    vi.mocked(runGeneratedCodeIsolated).mockResolvedValueOnce(succeeded());
    const input = { request_id: "unit-request", message: "hello" };
    const result = await testGeneratedFunction(spec(), {
      ...context, tier: "worker", caseKind: "pass",
      testEvent: { name: "ECHO_REQUESTED", data: input }, expectEmits: ["ECHOED"],
    });

    expect(runGeneratedCodeIsolated).toHaveBeenCalledExactlyOnceWith(code, input, expect.objectContaining({
      ...context, agentName: "EchoAgent", correlationId: "function-test:unit-echo",
      allowedTools: [], hostRuntimeKind: "fixture",
    }));
    expect(result).toMatchObject({ code, tier: "container", verdict: { pass: true, ran: true, emitNames: ["ECHOED"] } });
    expect(runGeneratedModule).not.toHaveBeenCalled();
    expect(runGeneratedModuleProcess).not.toHaveBeenCalled();
    expect(runGeneratedModuleContainer).not.toHaveBeenCalled();
  });

  it("accepts only an explicit no-event terminal rejection with exact execution and cleanup evidence", async () => {
    vi.mocked(runGeneratedCodeIsolated).mockResolvedValueOnce(failed());
    const result = await testGeneratedFunction(spec(), { ...context, caseKind: "reject", testEvent: { data: { message: " " } } });
    expect(result.verdict).toMatchObject({ pass: true, ran: true, emitNames: [], error: "[terminal] invalid_input" });
  });

  it.each(["pass", "edge", "fault"] as const)("keeps terminal failure red for a %s case", async (caseKind) => {
    vi.mocked(runGeneratedCodeIsolated).mockResolvedValueOnce(failed());
    expect((await testGeneratedFunction(spec(), { ...context, caseKind })).verdict.pass).toBe(false);
  });

  it("retains an explicit rejection-event requirement", async () => {
    vi.mocked(runGeneratedCodeIsolated).mockResolvedValueOnce(failed());
    expect((await testGeneratedFunction(spec(), { ...context, caseKind: "reject", expectEmits: ["REJECTED"] })).verdict.pass).toBe(false);
  });

  it("does not accept a success emission as a no-event rejection", async () => {
    vi.mocked(runGeneratedCodeIsolated).mockResolvedValueOnce(succeeded());
    expect((await testGeneratedFunction(spec(), { ...context, caseKind: "reject" })).verdict.pass).toBe(false);
  });

  it.each([
    ["wrong code hash", () => failed({ codeSha256: "4".repeat(64) })],
    ["wrong evidence hash", () => failed({ containerEvidence: evidence({ codeSha256: "4".repeat(64) }) })],
    ["missing cleanup evidence", () => failed({ containerEvidence: undefined })],
    ["wrong attempt", () => failed({ containerEvidence: evidence({ attemptId: "another-attempt" }) })],
    ["container crash", () => failed({ failure: "container_crashed" })],
    ["timeout", () => failed({ failure: "container_timeout", timedOut: true })],
    ["protocol failure", () => failed({ failure: "protocol_failed" })],
    ["RPC failure", () => failed({ failure: "rpc_failed" })],
    ["executor never started", () => failed({ executorStarted: false })],
    ["module-load terminal failure", () => failed({ handlerStarted: false })],
    ["missing legacy handler-stage evidence", () => failed({ handlerStarted: undefined })],
    ["missing failure stage", () => failed({ failureStage: undefined })],
    ["setup-stage terminal failure", () => failed({ failureStage: "setup" })],
    ["result-serialization terminal failure", () => failed({ failureStage: "result" })],
    ["ordinary handler failure", () => failed({ error: "invalid_input" })],
    ["unanchored terminal text", () => failed({ error: "wrapped failure [terminal] invalid_input" })],
  ] as const)("rejects %s instead of treating it as a business rejection", async (_label, response) => {
    vi.mocked(runGeneratedCodeIsolated).mockResolvedValueOnce(response());
    expect((await testGeneratedFunction(spec(), { ...context, caseKind: "reject" })).verdict.pass).toBe(false);
  });

  it("denies every supplied host capability and keeps a caught RPC attempt failing", async () => {
    vi.mocked(runGeneratedCodeIsolated).mockImplementationOnce(async (_code, _input, options) => {
      const operations = [
        () => options!.hostRuntime!.reason!("prompt", {}),
        () => options!.hostRuntime!.tool!("meta.ping", {}),
        () => options!.hostRuntime!.invoke!("another-agent", {}),
        () => options!.hostRuntime!.spawn!("task", {}),
        () => options!.memory!.get("secret"),
        () => options!.memory!.put("secret", "value"),
        () => options!.memory!.delete("secret"),
        () => options!.memory!.search("secret"),
      ];
      for (const operation of operations) await expect(operation()).rejects.toThrow("undeclared runtime capability");
      return succeeded();
    });
    const result = await testGeneratedFunction(spec(), { ...context, caseKind: "pass", expectEmits: ["ECHOED"] });
    expect(result.verdict.pass).toBe(false);
    expect(result.verdict.fixtureErrors).toHaveLength(8);
  });

  it("refuses a reference-code override and never starts an executor", async () => {
    await expect(testGeneratedFunction(spec(), { ...context, code: "export const substitute = {};" })).rejects.toThrow("exact reviewed generatedCode");
    expect(runGeneratedCodeIsolated).not.toHaveBeenCalled();
  });

  it("requires an active sandbox scope and rejects unsupported CodeAct ownership", async () => {
    await expect(testGeneratedFunction(spec(), { tenantSlug: context.tenantSlug })).rejects.toThrow("active sandbox tenant and attempt");
    await expect(testGeneratedFunction(spec({ tools: ["meta.ping"] }), context)).rejects.toThrow("requires declarative-plan");
    expect(runGeneratedCodeIsolated).not.toHaveBeenCalled();
  });
});
