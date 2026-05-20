/**
 * TC-9 — P0-RT-05 acceptance: `action.condition` evaluator.
 *
 * Cases:
 *   - Truthy boolean comparison runs (returns true).
 *   - Falsy boolean comparison skips (returns false).
 *   - Logical chain (&& / ||) evaluates.
 *   - `event.data.X` reads from the event payload.
 *   - Missing condition returns true (default-run).
 *   - Malformed condition fails OPEN (returns true + logs a warning).
 *   - Forbidden syntax (function expr, assignment, indexing) is rejected
 *     pre-eval (fails open + logs).
 */

import { describe, it, expect, vi } from "vitest";
import { evaluateCondition, type ConditionContext } from "@agentic/runtime";

function ctx(
  lastResult: unknown,
  data: Record<string, unknown> = {},
): ConditionContext {
  return {
    lastResult,
    event: { name: "TEST_EVENT", data },
  };
}

describe("TC-9: condition evaluator (P0-RT-05)", () => {
  it("returns true when no condition is set", () => {
    expect(evaluateCondition(undefined, ctx({}))).toBe(true);
    expect(evaluateCondition("", ctx({}))).toBe(true);
    expect(evaluateCondition("   ", ctx({}))).toBe(true);
  });

  it("evaluates simple numeric comparison against lastResult", () => {
    expect(evaluateCondition("lastResult.score > 0.5", ctx({ score: 0.8 }))).toBe(
      true,
    );
    expect(evaluateCondition("lastResult.score > 0.5", ctx({ score: 0.2 }))).toBe(
      false,
    );
  });

  it("evaluates equality + inequality", () => {
    expect(evaluateCondition("lastResult.status == 'ok'", ctx({ status: "ok" }))).toBe(
      true,
    );
    expect(
      evaluateCondition("lastResult.status != 'ok'", ctx({ status: "ok" })),
    ).toBe(false);
  });

  it("reads from event.data", () => {
    expect(
      evaluateCondition(
        "event.data.subject != null",
        ctx({}, { subject: "candidate-7" }),
      ),
    ).toBe(true);
    expect(
      evaluateCondition("event.data.subject != null", ctx({}, {})),
    ).toBe(false);
  });

  it("supports logical chains", () => {
    expect(
      evaluateCondition(
        "lastResult.ok == true && lastResult.score > 0.5",
        ctx({ ok: true, score: 0.7 }),
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        "lastResult.ok == true || lastResult.score > 0.5",
        ctx({ ok: false, score: 0.2 }),
      ),
    ).toBe(false);
  });

  it("supports negation", () => {
    expect(evaluateCondition("!lastResult.dirty", ctx({ dirty: false }))).toBe(
      true,
    );
    expect(evaluateCondition("!lastResult.dirty", ctx({ dirty: true }))).toBe(
      false,
    );
  });

  it("fails OPEN on malformed expressions (returns true, logs)", () => {
    const log = vi.fn();
    expect(evaluateCondition("lastResult.a +++ b", ctx({}), log)).toBe(true);
    expect(log).toHaveBeenCalled();
  });

  it("rejects forbidden syntax pre-eval (fail-open)", () => {
    const log = vi.fn();
    // assignment, semicolons, function decl, indexing — all banned
    expect(evaluateCondition("lastResult.a = 1", ctx({}), log)).toBe(true);
    expect(evaluateCondition("(function(){})()", ctx({}), log)).toBe(true);
    expect(evaluateCondition("lastResult['evil']", ctx({}), log)).toBe(true);
    expect(evaluateCondition("eval('1')", ctx({}), log)).toBe(true);
    // every call should have logged a warning
    expect(log.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("rejects identifiers outside the allowed top-level set", () => {
    const log = vi.fn();
    // `process` is not a permitted top-level identifier
    expect(evaluateCondition("process.env.FOO == 'bar'", ctx({}), log)).toBe(true);
    expect(log).toHaveBeenCalled();
  });

  it("undefined deep chain throws → fail-open returns true", () => {
    // Deep access on undefined throws → caught → fails open.
    const log = vi.fn();
    expect(
      evaluateCondition("lastResult.does.not.exist > 5", ctx({}), log),
    ).toBe(true);
    expect(log).toHaveBeenCalled();
  });

  it("shallow undefined field compares as expected (no throw)", () => {
    // `lastResult.missing > 5` => `undefined > 5` => false
    expect(evaluateCondition("lastResult.missing > 5", ctx({}))).toBe(false);
  });
});
