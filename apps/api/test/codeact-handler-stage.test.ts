import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runGeneratedCodeIsolated } from "@agentic/runtime";
import { codeActContainerTestOptions } from "./codeact-container-test-transport";

// Runs the real candidate bootstrap and protocol through a test-only process
// transport. This proves stage propagation, not Docker isolation or promotion.
beforeEach(() => vi.stubEnv("FACTORY_EXEC_GENERATED", "1"));
afterEach(() => vi.unstubAllEnvs());

async function execute(code: string) {
  return runGeneratedCodeIsolated(code, { handlerStarted: true }, {
    ...codeActContainerTestOptions(),
    tenantSlug: "handler-stage-sb",
    tenantId: "ten-handler-stage-test",
    allowedTools: [],
    timeoutMs: 5_000,
  });
}

describe("bootstrap-owned handler stage", () => {
  it.each([
    'ctx.reason("prompt", input)',
    'ctx.tool("meta.ping", {})',
    'ctx.memory.get("key")',
    'ctx.memory.put("key", "value")',
    'ctx.memory.delete("key")',
    'ctx.memory.search("key")',
    'ctx.invoke("child", {})',
    'ctx.spawn("task", {})',
    'ctx.skills.list({})',
  ])("denies %s before host dispatch while declared input validation is pending", async (rpc) => {
    const dispatch = vi.fn(async () => null);
    const result = await runGeneratedCodeIsolated(`defineAgent({ async handler(input, ctx) { await ${rpc}; return {}; } });`, { message: null }, {
      ...codeActContainerTestOptions(), tenantSlug: "handler-stage-sb", tenantId: "ten-handler-stage-test",
      timeoutMs: 5_000, allowedTools: ["meta.ping"], hostRuntimeKind: "fixture", denyHostCapabilities: true,
      hostRuntime: { reason: dispatch, tool: dispatch, invoke: dispatch, spawn: dispatch as never },
      memory: { get: dispatch as never, put: dispatch as never, delete: dispatch as never, search: dispatch as never },
    });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ failure: "rpc_failed", executorStarted: true, containerEvidence: { removed: true, absenceVerified: true } });
    if (!result.ok) expect(result.error).toContain("input validation is pending");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not mistake a module-load terminal error for a started handler", async () => {
    const result = await execute('const candidateClaim = { handlerStarted: true }; throw new Error("[terminal] module_load_failure");');
    expect(result).toMatchObject({
      ok: false, failure: "candidate_failed", executorStarted: true,
      handlerStarted: false, error: "[terminal] module_load_failure",
      failureStage: "setup",
      containerEvidence: { removed: true, absenceVerified: true },
    });
  });

  it("keeps a throwing handler getter in the loading stage", async () => {
    const result = await execute('defineAgent({ get handler() { throw new Error("[terminal] handler_getter_failure"); } });');
    expect(result).toMatchObject({
      ok: false, failure: "candidate_failed", executorStarted: true,
      handlerStarted: false, error: "[terminal] handler_getter_failure",
      failureStage: "setup",
    });
  });

  it("proves a captured handler actually started before its terminal failure", async () => {
    const result = await execute('defineAgent({ handler() { throw new Error("[terminal] invalid_input"); } });');
    expect(result).toMatchObject({
      ok: false, failure: "candidate_failed", executorStarted: true,
      handlerStarted: true, error: "[terminal] invalid_input",
      failureStage: "handler",
      containerEvidence: { exitCode: 1, removed: true, absenceVerified: true },
    });
  });

  it("keeps candidate return fields separate from trusted stage evidence", async () => {
    const result = await execute('defineAgent({ handler() { return { handlerStarted: false }; } });');
    expect(result).toMatchObject({
      ok: true, executorStarted: true, handlerStarted: true,
      data: { handlerStarted: false },
      containerEvidence: { exitCode: 0, removed: true, absenceVerified: true },
    });
  });

  it("distinguishes terminal-looking result serialization failure from a handler rejection", async () => {
    const result = await execute('defineAgent({ handler() { return { toJSON() { throw new Error("[terminal] result_serialization_failure"); } }; } });');
    expect(result).toMatchObject({
      ok: false, failure: "candidate_failed", executorStarted: true,
      handlerStarted: true, failureStage: "result",
      error: "[terminal] result_serialization_failure",
      containerEvidence: { exitCode: 1, removed: true, absenceVerified: true },
    });
  });

  it("invokes the captured handler even when candidate code overrides its call property", async () => {
    const result = await execute(`
      function handler() { return { reached: "actual-handler", receiver: this.name }; }
      handler.call = () => { throw new Error("[terminal] replacement_call"); };
      defineAgent({ name: "captured-definition", handler });
    `);
    expect(result).toMatchObject({
      ok: true, handlerStarted: true,
      data: { reached: "actual-handler", receiver: "captured-definition" },
    });
  });
});
