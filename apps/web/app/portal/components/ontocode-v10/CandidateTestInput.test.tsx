import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostOntoCodeTurnRequestSchema } from "@agentic/contracts";
import { translate } from "@/lib/i18n";
import type { Language } from "@/lib/i18n/types";

const state = vi.hoisted(() => ({ language: "en" as Language }));
vi.mock("@/app/portal/lib/preferences-context", () => ({
  useI18n: () => ({ language: state.language, t: (key: string, vars?: Record<string, string | number>) => translate(state.language, key, vars) }),
}));
import { CandidateTestInput, candidateTestTurn, parseCandidateTestDrafts, type CandidateTestDraft } from "./CandidateTestInput";

const draft = (patch: Partial<CandidateTestDraft> = {}): CandidateTestDraft => ({
  id: "case-1", entryEvent: "DiagnosticRequested", payload: '{"request_id":"request-7","message":"  user text  ","nested":{"values":[0,false,null]}}', kind: "pass", expectedEvent: "DiagnosticAcknowledged", ...patch,
});

beforeEach(() => { state.language = "en"; });

describe("Candidate test input to supported execution turn", () => {
  it("submits the exact authored event payload and all outcome classes as durable testCases", () => {
    const parsed = parseCandidateTestDrafts((["pass", "reject", "edge", "fault"] as const).map((kind, index) => draft({ id: `case-${index + 1}`, kind })));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected valid input");
    const request = candidateTestTurn(parsed.cases, "Run tests");
    expect(PostOntoCodeTurnRequestSchema.parse(JSON.parse(JSON.stringify(request)))).toEqual(request);
    expect(request).toMatchObject({ behavior: "execute", action: "run_tests", arguments: { source: "ontocode-candidate-test-input" } });
    expect(request.arguments.testCases).toEqual(parsed.cases);
    expect(parsed.cases[0]!.payload).toEqual({ request_id: "request-7", message: "  user text  ", nested: { values: [0, false, null] } });
    expect(parsed.cases.map((item) => item.kind)).toEqual(["pass", "reject", "edge", "fault"]);
    expect(request).not.toHaveProperty("riskClass");
    expect(request).not.toHaveProperty("candidatePackageVersionId");
    expect(request.arguments).not.toHaveProperty("resumeWaitingUserJobId");
  });

  it.each(["", "{", "[]", "null", '"text"', "42"])("rejects non-object/absent payload %s without inventing empty input", (payload) => {
    expect(parseCandidateTestDrafts([draft({ payload })])).toEqual({ ok: false, key: "invalidPayload", number: 1 });
  });

  it("allows an explicitly authored empty-object edge case and does not invent an expected event", () => {
    const parsed = parseCandidateTestDrafts([draft({ payload: "{}", kind: "edge", expectedEvent: "  " })]);
    expect(parsed).toEqual({ ok: true, cases: [{ id: "case-1", entryEvent: "DiagnosticRequested", payload: {}, kind: "edge" }] });
  });

  it("requires a real case and event identity and reports the affected row", () => {
    expect(parseCandidateTestDrafts([])).toMatchObject({ ok: false, key: "noCases" });
    expect(parseCandidateTestDrafts([draft(), draft({ id: "case-2", entryEvent: " " })])).toEqual({ ok: false, key: "invalidCase", number: 2 });
    expect(parseCandidateTestDrafts([draft({ expectedEvent: "x".repeat(241) })])).toMatchObject({ ok: false, key: "invalidCase" });
  });
});

describe("native Candidate test form", () => {
  it("starts with empty user input and shows the current Candidate without running anything", () => {
    const submit = vi.fn();
    const html = renderToStaticMarkup(<CandidateTestInput candidateRevision={3} onSubmit={submit} />);
    expect(html).toContain("Candidate revision 3");
    expect(html).toContain("Entry event");
    expect(html).toContain("Event payload (JSON object)");
    expect(html).toContain("Add case");
    expect(html).not.toContain("request-7");
    expect(html).not.toMatch(/[\u3400-\u9fff]/);
    expect(submit).not.toHaveBeenCalled();
  });

  it("keeps the submit control disabled until a Candidate and execution permission are available", () => {
    for (const [candidateRevision, disabledReason] of [[null, null], [1, "Read only"], [1, "Job active"]] as const) {
      const html = renderToStaticMarkup(<CandidateTestInput candidateRevision={candidateRevision} disabledReason={disabledReason} onSubmit={async () => "queued"} />);
      expect(html).toMatch(/type="submit" disabled=""/);
      expect(html).toContain(disabledReason ?? "Build a Candidate before running tests.");
    }
  });

  it("localizes input, outcomes, submission feedback, and validation errors", () => {
    state.language = "zh";
    const html = renderToStaticMarkup(<CandidateTestInput candidateRevision={2} onSubmit={async () => "queued"} />);
    expect(html).toContain("运行候选版本测试");
    expect(html).toContain("事件载荷（JSON 对象）");
    expect(html).toContain("故障");
    expect(translate("zh", "candidateTests.invalidPayload", { number: 2 })).toContain("用例 2");
    expect(translate("en", "candidateTests.approval")).toContain("Approve it");
  });
});
