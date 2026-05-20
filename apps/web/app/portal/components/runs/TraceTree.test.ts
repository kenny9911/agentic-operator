import { describe, it, expect } from "vitest";
import { composeTrace, type TraceEntry } from "./TraceTree";
import type { RunListRow, StepRow } from "@/lib/hooks/useRuns";

function step(ord: number, name = `step-${ord}`): StepRow {
  return {
    id: `stp-${ord}`,
    ord,
    name,
    type: "logic",
    status: "ok",
    startedAt: null,
    endedAt: null,
    durationMs: 120,
    error: null,
    provider: null,
    model: null,
    tokensIn: null,
    tokensOut: null,
  };
}

function child(id: string, parentRunId: string): RunListRow {
  return {
    id,
    status: "ok",
    agentName: "sub",
    agentTitle: "Sub agent",
    subject: null,
    triggerEvent: null,
    startedAt: null,
    endedAt: null,
    durationMs: 800,
    tokensIn: null,
    tokensOut: null,
    model: null,
    currentStepName: null,
    currentStepOrd: null,
    stepCount: null,
    parentRunId,
  };
}

describe("composeTrace", () => {
  it("sorts steps by ord and appends children", () => {
    const out = composeTrace(
      [step(3), step(1), step(2)],
      [child("run-a", "root"), child("run-b", "root")],
    );

    expect(out.map((e) => entryKey(e))).toEqual([
      "step:1",
      "step:2",
      "step:3",
      "child:run-a",
      "child:run-b",
    ]);
  });

  it("returns empty when both lists are empty", () => {
    expect(composeTrace([], [])).toEqual([]);
  });

  it("handles steps without children", () => {
    const out = composeTrace([step(1), step(2)], []);
    expect(out.filter((e) => e.kind === "step")).toHaveLength(2);
    expect(out.filter((e) => e.kind === "child")).toHaveLength(0);
  });

  it("handles children without steps", () => {
    const out = composeTrace(
      [],
      [child("a", "root"), child("b", "root")],
    );
    expect(out).toHaveLength(2);
    expect(out.every((e) => e.kind === "child")).toBe(true);
  });
});

function entryKey(e: TraceEntry): string {
  if (e.kind === "step" && e.step) return `step:${e.step.ord}`;
  if (e.kind === "child" && e.child) return `child:${e.child.id}`;
  return "unknown";
}
