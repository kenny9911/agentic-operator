import { describe, it, expect } from "vitest";
import { systemPrompt, rankLessons } from "./system-prompt";
import type { ReflectionLite } from "./brain-types";
import {
  FACTORY_SCOPE_INQUIRY_SYSTEM_PROMPT,
  FACTORY_SCOPE_SINGLE_CALL_SYSTEM_PROMPT,
  FACTORY_SCOPE_REQUEST_INTERPRETATION_RULES,
  buildFactoryScopeInquiryToolSchemas,
  recommendFactoryActionScope,
  type FactoryScopeTurnFn,
} from "./action-recommendation";
import type { DomainOntology } from "./ontology-types";

// Phase 0(b): the brain carries zero production-discipline knowledge today. Inject a
// "production patterns" module (durability, failure taxonomy, timezone, vendor-envelope
// quirks) + a multi-step plan exemplar, in BOTH languages.

describe("system prompt carries production-discipline knowledge (Phase 0b)", () => {
  for (const lang of ["zh", "en"] as const) {
    describe(lang, () => {
      const p = systemPrompt("recruitment", [], lang);
      it("teaches per-write durability (step.run)", () => {
        expect(p).toContain("step.run");
      });
      it("teaches the vendor failure taxonomy (UNPARSEABLE vs server)", () => {
        expect(p).toContain("UNPARSEABLE");
      });
      it("teaches timezone discipline (Asia/Shanghai)", () => {
        expect(p).toContain("Asia/Shanghai");
      });
      it("includes a multi-step plan exemplar (not a single decision)", () => {
        // the exemplar lists several ordered steps for one agent
        expect(p.toLowerCase()).toContain("idempot");
      });
      it("never treats a recommendation or timeout as human authorization", () => {
        expect(p).toContain(
          lang === "zh"
            ? "recommended 只是你的建议，不是用户授权"
            : "A recommendation is advice, never authorization",
        );
        expect(p).toContain(
          lang === "zh" ? "不许替用户自动选择" : "must not auto-select",
        );
      });
      it("keeps the FDE experience concise and uses isolated synthetic test data", () => {
        expect(p).toContain("supply_test_data.synthetic_resumes");
        expect(p).toContain(
          lang === "zh" ? "不展开思考" : "not chain-of-thought",
        );
        expect(p).toContain(
          lang === "zh"
            ? "不要为普通沙箱测试索要真实邮箱"
            : "Never put API keys",
        );
      });
      it("keeps Ontology logic routers intact and prose conditions non-executable", () => {
        expect(p).toContain(
          lang === "zh"
            ? "源 kind=logic 的路由选择步保持 logic"
            : "A source kind=logic route selector stays logic",
        );
        expect(p).toContain(
          lang === "zh"
            ? "自然语言，只作证据并省略 plan.condition"
            : "natural-language source condition is evidence only",
        );
      });
    });
  }
});

describe("rankLessons (Phase 5 — dedup + relevance ranking for the lessons block)", () => {
  const r = (kind: ReflectionLite["kind"], lesson: string): ReflectionLite => ({
    kind,
    summary: lesson,
    lesson,
    createdAt: "2026-06-30",
  });
  it("dedupes identical lessons", () => {
    const out = rankLessons([
      r("failure", "wire the real tool"),
      r("failure", "wire the real tool"),
      r("success", "reuse this set"),
    ]);
    expect(out).toHaveLength(2);
  });
  it("ranks failures above caveats above successes (most actionable first)", () => {
    const out = rankLessons([
      r("success", "s"),
      r("caveat", "c"),
      r("failure", "f"),
    ]);
    expect(out.map((x) => x.kind)).toEqual(["failure", "caveat", "success"]);
  });
  it("preserves input (newest-first) order within the same kind", () => {
    const out = rankLessons([r("failure", "newer"), r("failure", "older")]);
    expect(out.map((x) => x.lesson)).toEqual(["newer", "older"]);
  });
  it("caps to the limit", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      r("failure", `lesson ${i}`),
    );
    expect(rankLessons(many, 5)).toHaveLength(5);
  });
});

describe("scope prompts distinguish business requirements from build instructions", () => {
  const ontology: DomainOntology = {
    domainId: "scope-prompt-test",
    source: "snapshot",
    objects: [],
    rules: [],
    events: [],
    workflow: [],
    actions: [
      {
        id: "checkReadiness",
        name: "checkReadiness",
        actor: ["Agent"],
        category: "logic",
        description: "Check service readiness",
        target_objects: [],
        trigger: [],
        triggered_event: [],
        tool_use: [],
        system_prompt: "",
        user_prompt: "",
      },
    ],
  };
  const scenario =
    "Generate the checkReadiness Agent. Build a candidate for local validation and review.";
  const decision = (unresolved: string[] = []) => ({
    actionIds: ["checkReadiness"],
    reasons: {
      checkReadiness:
        "The declared readiness check covers the requested business capability.",
    },
    reasoningSummary:
      "Select the declared readiness check; local validation and review constrain the build process.",
    confidence: 1,
    unresolved,
    requiresVirtualAction: false,
  });

  it("applies the same narrow distinction to both model paths and the decision tool", () => {
    for (const prompt of [
      FACTORY_SCOPE_SINGLE_CALL_SYSTEM_PROMPT,
      FACTORY_SCOPE_INQUIRY_SYSTEM_PROMPT,
    ]) {
      for (const rule of FACTORY_SCOPE_REQUEST_INTERPRETATION_RULES)
        expect(prompt).toContain(rule);
      expect(prompt).toContain("真实业务要求必须写入 unresolved");
      expect(prompt).toContain("不授予生产执行");
    }
    const submit = buildFactoryScopeInquiryToolSchemas().find(
      (tool) => tool.function.name === "submit_scope",
    )!;
    const properties = submit.function.parameters.properties as Record<
      string,
      { description: string }
    >;
    expect(properties.unresolved!.description).toContain("业务能力或契约要求");
    expect(properties.unresolved!.description).toContain(
      "构建流程指令不算业务缺口",
    );
  });

  it("sends the full natural request through inquiry and preserves real business gaps for the downstream gate", async () => {
    const businessGap =
      "The request also needs invoice review, but no invoice review Action is declared.";
    const businessScenario = `${scenario} Also perform business invoice review.`;
    let calls = 0;
    const turnFn: FactoryScopeTurnFn = async function* (messages) {
      calls += 1;
      expect(messages[0]!.content).toContain(
        FACTORY_SCOPE_REQUEST_INTERPRETATION_RULES[0],
      );
      expect(messages[1]!.content).toContain(businessScenario);
      if (calls === 1) {
        yield {
          t: "tool_calls",
          content: "Read the authoritative Action contract.",
          calls: [
            {
              id: "read",
              name: "read_action",
              args: JSON.stringify({
                reasoning: "Verify the named business capability.",
                id: "checkReadiness",
              }),
            },
          ],
        };
      } else {
        expect(
          messages.some(
            (message) =>
              message.role === "tool" &&
              message.content?.includes("checkReadiness"),
          ),
        ).toBe(true);
        yield {
          t: "tool_calls",
          content: "Submit the grounded scope.",
          calls: [
            {
              id: "submit",
              name: "submit_scope",
              args: JSON.stringify({
                reasoning:
                  "Keep the unsupported business requirement explicit.",
                ...decision([businessGap]),
              }),
            },
          ],
        };
      }
    };
    const result = await recommendFactoryActionScope({
      ontology,
      scenario: businessScenario,
      scopeKey: "inquiry-process-scope",
      turnFn,
      budget: { maxModelCalls: 4, maxToolCalls: 8, maxWallClockMs: 10_000 },
    });
    expect(calls).toBe(2);
    expect(result.actionIds).toEqual(["checkReadiness"]);
    expect(result.unresolved).toEqual([businessGap]);
    expect(result.scenario).toBe(businessScenario);
  });

  it("retains exact Action validation in the single-call path", async () => {
    await expect(
      recommendFactoryActionScope({
        ontology,
        scenario,
        scopeKey: "invalid-action",
        callFn: async (system) => {
          expect(system).toContain(
            FACTORY_SCOPE_REQUEST_INTERPRETATION_RULES[0],
          );
          return JSON.stringify({
            ...decision(),
            actionIds: ["inventedAction"],
          });
        },
      }),
    ).rejects.toMatchObject({ code: "scope_recommendation_invalid" });
  });
});
