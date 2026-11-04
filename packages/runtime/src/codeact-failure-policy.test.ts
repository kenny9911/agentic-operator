import { describe, expect, it } from "vitest";
import { codeActFailureResolution, usesGeneratedCodeActFailurePolicy } from "./codeact-failure-policy";

const policy = [
  { when: "meta.codeExecutionError.includes('[terminal]')", do: "terminal", suppress_emit: true },
  { when: "meta.codeExecutionError.includes('[park]')", do: "park", suppress_emit: true },
  { when: "meta.codeExecutionError.includes('[retry]')", do: "retry", suppress_emit: true },
  { default: "retry", suppress_emit: true },
];

describe("generated CodeAct failure boundary", () => {
  it("recognizes only the exact generated policy or no policy", () => {
    expect(usesGeneratedCodeActFailurePolicy(undefined)).toBe(true);
    expect(usesGeneratedCodeActFailurePolicy(policy)).toBe(true);
    expect(usesGeneratedCodeActFailurePolicy("terminal")).toBe(false);
    expect(usesGeneratedCodeActFailurePolicy(policy.slice(0, 3))).toBe(false);
    expect(usesGeneratedCodeActFailurePolicy([{ ...policy[0], emit_event: "DONE" }, ...policy.slice(1)])).toBe(false);
    expect(usesGeneratedCodeActFailurePolicy([{ ...policy[0], suppress_emit: false }, ...policy.slice(1)])).toBe(false);
  });

  it.each([undefined, "setup", "result"])("does not interpret terminal text from failure stage %s", (failureStage) => {
    expect(codeActFailureResolution({ failure: "candidate_failed", error: "[terminal] invalid_input", handlerStarted: true, failureStage })).toMatchObject({ disposition: "retry" });
  });

  it("requires actual handler start and an anchored terminal tag", () => {
    expect(codeActFailureResolution({ failure: "candidate_failed", error: "[terminal] invalid_input", handlerStarted: false, failureStage: "handler" }).disposition).toBe("retry");
    expect(codeActFailureResolution({ failure: "candidate_failed", error: "unexpected [terminal] tag", handlerStarted: true, failureStage: "handler" }).disposition).toBe("retry");
    expect(codeActFailureResolution({ failure: "candidate_failed", error: "[terminal] invalid_input", handlerStarted: true, failureStage: "handler" })).toMatchObject({ disposition: "terminal", suppressEmit: true, facts: { message: "[terminal] invalid_input" } });
  });

  it.each(["[park] blocked", "[retry] blocked", "untyped error"])("stops invalid-input failure %s without policy effects", (error) => {
    const resolution = codeActFailureResolution({ failure: "candidate_failed", error, handlerStarted: true, failureStage: "handler", inputValidationPending: true });
    expect(resolution).toMatchObject({ disposition: "terminal", suppressEmit: true });
    expect(resolution.emitEvent).toBeUndefined();
    expect(resolution.facts.message).toMatch(/^invalid declared input blocked CodeAct/);
  });
});
