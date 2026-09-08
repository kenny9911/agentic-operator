import { describe, expect, it } from "vitest";
import {
  actorDefaults,
  contextGroups,
  contextInsights,
  contextSummary,
  decisionOptions,
  pickContext,
  formatContextValue,
  prefillFromContext,
} from "./task-context";

/**
 * Shaped after the real ADJUSTMENT_OPTIONS_GENERATED payload the
 * approveAdjustmentOption gate receives, trimmed to what the tests exercise.
 */
const payload = {
  _meta: { correlationId: "cor-1", producedBy: "generateAdjustmentOptions" },
  event_id: "evt-1",
  source_run: "run-766ae04e6308",
  last_result: { options_generated: true },
  alert_id: "ALT-1788246057458-1",
  alert_level: "红色",
  plan_id: "PBP-2026-0873",
  alert_context: {
    alert_id: "ALT-1788246057458-1",
    chain_id: "CHAIN-PBPL-2026-0873-01",
    alert_level: "红色",
    notified_role: "分管领导",
  },
  execution_deviation: [
    {
      chain_id: "CHAIN-PBPL-2026-0873-01",
      stage_node: "定标",
      planned_finish_date: "2026-08-27",
      actual_finish_date: null,
      time_deviation_days: 5,
      cause_tag: "流标重招",
      cause_explanation: "定标节点未启动，链路在定标环节停滞。",
    },
  ],
  options: [
    { option_id: "OPT-A", option_type: "压缩后续周期", arrival_impact_days: -3 },
    { option_id: "OPT-C", option_type: "执行调拨", arrival_impact_days: -12 },
  ],
  planned_dates: [],
  // Seven per-stage rows: evidence behind the decision, not the decision.
  stage_progress_list: Array.from({ length: 7 }, (_, i) => ({
    chain_id: "CHAIN-PBPL-2026-0873-01",
    stage_node: `节点${i + 1}`,
    stage_progress_id: `SP-${i}`,
  })),
  queried_operations: ["queryPr", "queryRfxList"],
};

const preparedContext = {
  option_id: "OPT-GAP-TYA-HAIYAN-001-C",
  option_type: "执行调拨",
  decided_by: "张三",
  is_high_risk: true,
};

const FIELDS = [
  "alert_id",
  "chain_id",
  "option_id",
  "option_type",
  "planner_confirmed_by",
  "remark",
];

describe("prefillFromContext", () => {
  it("fills the identifiers a person could not possibly type", () => {
    const filled = prefillFromContext(FIELDS, [preparedContext, payload]);
    expect(filled.alert_id).toBe("ALT-1788246057458-1");
    expect(filled.chain_id).toBe("CHAIN-PBPL-2026-0873-01");
  });

  it("prefers what an earlier manual step already decided", () => {
    // Both sources carry option_id; the leader's actual choice must win over
    // the first option the agent happened to generate.
    const filled = prefillFromContext(FIELDS, [preparedContext, payload]);
    expect(filled.option_id).toBe("OPT-GAP-TYA-HAIYAN-001-C");
    expect(filled.option_type).toBe("执行调拨");
  });

  it("leaves fields alone when the payload has nothing to offer", () => {
    const filled = prefillFromContext(FIELDS, [preparedContext, payload]);
    expect(filled.planner_confirmed_by).toBeUndefined();
    expect(filled.remark).toBeUndefined();
  });

  it("prefers the shallower of two places holding the same key", () => {
    const filled = prefillFromContext(["alert_id"], [payload]);
    expect(filled.alert_id).toBe("ALT-1788246057458-1");
  });

  it("never puts an object or an essay into a form field", () => {
    const filled = prefillFromContext(["notes", "meta"], [
      { notes: "x".repeat(500), meta: { a: 1 } },
    ]);
    expect(filled.notes).toBeUndefined();
    expect(filled.meta).toBeUndefined();
  });

  it("does not mine the runtime envelope for values", () => {
    expect(prefillFromContext(["correlationId"], [payload])).toEqual({});
  });
});

describe("contextGroups", () => {
  const groups = contextGroups(payload);
  const byKey = (key: string) => groups.find((group) => group.key === key);

  it("puts the records the decision is about first", () => {
    expect(groups[0]!.relevant).toBe(true);
    const relevantKeys = groups.filter((g) => g.relevant).map((g) => g.key);
    expect(relevantKeys).toContain("alert_context");
    expect(relevantKeys).toContain("execution_deviation[0]");
    expect(relevantKeys).toContain("options[0]");
  });

  // `chain_id` is a required form field AND sits in almost every record here,
  // so matching on it promoted all seven stage rows and buried the decision.
  it("keeps a long reference list out of the way", () => {
    const relevantKeys = groups.filter((g) => g.relevant).map((g) => g.key);
    // Even though every stage row carries `chain_id`, a required form field.
    expect(relevantKeys.some((k) => k.startsWith("stage_progress_list"))).toBe(
      false,
    );
    // Demoted, not dropped — it is still evidence an approver may want.
    expect(groups.some((g) => g.key === "stage_progress_list[0]")).toBe(true);
  });

  it("caps how many cards can open at once", () => {
    expect(groups.filter((g) => g.relevant).length).toBeLessThanOrEqual(8);
  });

  it("surfaces what actually went wrong, so approve/reject is answerable", () => {
    const deviation = byKey("execution_deviation[0]");
    const facts = Object.fromEntries(
      (deviation?.facts ?? []).map((f) => [f.key, f.value]),
    );
    expect(facts.stage_node).toBe("定标");
    expect(facts.time_deviation_days).toBe("5");
    expect(facts.planned_finish_date).toBe("2026-08-27");
    expect(facts.cause_tag).toBe("流标重招");
    // A null actual date is an absent fact, not an empty row.
    expect(facts.actual_finish_date).toBeUndefined();
  });

  it("gives each option in a list its own card", () => {
    expect(byKey("options[0]")?.title).toBe("options #1");
    expect(byKey("options[1]")?.title).toBe("options #2");
  });

  // A payload's key order is an accident of how the agent wrote its JSON. On a
  // real approval it put the three options sixth through eighth of eight cards,
  // so the thing the approver is choosing between was the last thing they'd
  // find — and with the panel's sticky header it looked like the top.
  it("leads with the alternatives, not with the context around them", () => {
    const relevant = groups.filter((group) => group.relevant);
    expect(relevant.slice(0, 2).map((group) => group.key)).toEqual([
      "options[0]",
      "options[1]",
    ]);
  });

  it("does not call a lone record an alternative", () => {
    // execution_deviation is a one-element list: context, not a choice.
    expect(byKey("execution_deviation[0]")?.alternatives).toBe(false);
    expect(byKey("alert_context")?.alternatives).toBe(false);
    expect(byKey("options[0]")?.alternatives).toBe(true);
  });

  it("keeps a single-element list unnumbered", () => {
    expect(byKey("execution_deviation[0]")?.title).toBe("execution_deviation");
  });

  it("drops the runtime envelope rather than showing it to an approver", () => {
    const keys = groups.map((group) => group.key);
    expect(keys).not.toContain("_meta");
    expect(keys).not.toContain("last_result");
    const root = byKey("__root__");
    const rootKeys = (root?.facts ?? []).map((f) => f.key);
    expect(rootKeys).toContain("alert_level");
    expect(rootKeys).not.toContain("event_id");
    expect(rootKeys).not.toContain("source_run");
    expect(rootKeys).not.toContain("queried_operations");
  });

  it("skips empty records instead of rendering blank cards", () => {
    expect(byKey("planned_dates")).toBeUndefined();
    expect(byKey("planned_dates[0]")).toBeUndefined();
  });

  it("returns nothing for a payload that is not a record", () => {
    expect(contextGroups(null)).toEqual([]);
    expect(contextGroups(["a"])).toEqual([]);
  });
});

describe("formatContextValue", () => {
  it("renders the leaves worth reading and skips the rest", () => {
    expect(formatContextValue("  定标  ")).toBe("定标");
    expect(formatContextValue(5)).toBe("5");
    expect(formatContextValue(0)).toBe("0");
    expect(formatContextValue(false)).toBe("false");
    expect(formatContextValue(["a", "b"])).toBe("a、b");
    expect(formatContextValue(null)).toBeNull();
    expect(formatContextValue("")).toBeNull();
    expect(formatContextValue({ a: 1 })).toBeNull();
    expect(formatContextValue([{ a: 1 }])).toBeNull();
  });

  it("clips an essay rather than letting it own the panel", () => {
    const rendered = formatContextValue("x".repeat(900)) ?? "";
    expect(rendered.length).toBeLessThan(420);
    expect(rendered.endsWith("…")).toBe(true);
  });
});

describe("the three things an approver needs", () => {
  const rich = {
    ...payload,
    probability_assessment: [
      {
        chain_id: "CHAIN-PBPL-2026-0873-01",
        on_time_probability: 0.18,
        probability_grade: "红色",
        explanation:
          "定标停滞已 5 天，剩余标准周期不足以覆盖到货前的合同与订单环节，按期概率显著偏低。",
      },
    ],
  };

  // The panel used to show every record as its own card — the whole scan. None
  // of it answered the only question being asked: which option, and why.
  it("summarises in facts a person can scan, not in paragraphs", () => {
    const summary = contextSummary(rich);
    expect(summary.length).toBeLessThanOrEqual(8);
    const keys = summary.map((fact) => fact.key);
    expect(keys).toContain("stage_node");
    expect(keys).toContain("time_deviation_days");
    // The explanations belong in the insight section, not the fact strip.
    expect(keys).not.toContain("explanation");
    expect(keys).not.toContain("cause_explanation");
  });

  it("shows each fact once, however many records repeat it", () => {
    const keys = contextSummary(rich).map((fact) => fact.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("surfaces the reasoning the agents already wrote", () => {
    const insights = contextInsights(rich);
    const keys = insights.map((fact) => fact.key);
    expect(keys).toContain("cause_explanation");
    expect(keys).toContain("explanation");
    expect(insights.length).toBeLessThanOrEqual(4);
    // An id is never prose, however long it runs.
    expect(keys).not.toContain("chain_id");
  });

  it("offers the alternatives as something to pick, with values attached", () => {
    const options = decisionOptions(rich, ["option_id", "option_type"]);
    expect(options).toHaveLength(2);
    // Named by the readable fact, not by the identifier.
    expect(options[0]!.title).toBe("压缩后续周期");
    expect(options[1]!.title).toBe("执行调拨");
    // Choosing fills the form, so nobody types an identifier.
    expect(options[0]!.values).toEqual({
      option_id: "OPT-A",
      option_type: "压缩后续周期",
    });
    // The naming fact is not repeated in the body.
    expect(options[0]!.facts.map((f) => f.key)).not.toContain("option_type");
  });

  // Every option carried `decision_role: 分管领导` and `option_status: 待决策`,
  // and the label was whichever short readable fact came first — so all three
  // radios were labelled 分管领导. What tells the options apart is what names
  // them, and the data says which key that is.
  it("names an option by what distinguishes it, not by what they share", () => {
    const shared = {
      options: [
        { decision_role: "分管领导", option_status: "待决策", option_type: "压缩后续周期", option_id: "OPT-A" },
        { decision_role: "分管领导", option_status: "待决策", option_type: "执行调拨", option_id: "OPT-C" },
      ],
    };
    const options = decisionOptions(shared, ["option_id"]);
    expect(options.map((option) => option.title)).toEqual([
      "压缩后续周期",
      "执行调拨",
    ]);
    // A fact identical on every option cannot help anyone choose; it belongs
    // in the summary, not repeated on each card.
    const keys = options[0]!.facts.map((fact) => fact.key);
    expect(keys).not.toContain("decision_role");
    expect(keys).not.toContain("option_status");
    expect(keys).toContain("option_id");
  });

  // 场景二 split gate: the payload carries two approved demand plans and two
  // merge suggestions. Shape alone made all four look like options, so the
  // planner was offered radios reading 「检修一部」 and 「01,01,03」 — neither of
  // which the form could record, so picking one changed nothing on submit.
  it("ignores sibling records the form has no field for", () => {
    const splitGate = {
      demand_plan: [
        { demand_organization: "检修一部", plan_id: "PBP-2027-0101", planner: "张计划" },
        { demand_organization: "检修二部", plan_id: "PBP-2027-0102", planner: "赵计划" },
      ],
      merge_suggestion: [
        {
          split_option_label: "M-BRK-126 三行合并",
          plan_line_id: "PBPL-2027-0101-01",
          material_code: "M-BRK-126",
          merge_reason: "同物料、同标准采购类型，需求日期跨度12天在30天合并窗口内。",
        },
        {
          split_option_label: "M-CAB-240 跨期拆分",
          plan_line_id: "PBPL-2027-0102-01",
          material_code: "M-CAB-240",
          merge_reason: "需求日期跨度超出合并窗口，建议拆分为两条计划行。",
        },
      ],
    };
    const options = decisionOptions(splitGate, ["plan_line_id", "split_reason"]);
    // Only the group whose pick the form can record survives.
    expect(options).toHaveLength(2);
    expect(options.map((option) => option.title)).toEqual([
      "M-BRK-126 三行合并",
      "M-CAB-240 跨期拆分",
    ]);
    // And choosing one answers the required field, so nobody types a line id.
    expect(options[0]!.values).toEqual({ plan_line_id: "PBPL-2027-0101-01" });
  });

  it("prefers a key that says it is the display name over whatever sorts first", () => {
    const payloadWithLabel = {
      options: [
        { detail: "跨期拆分", option_label: "M-CAB-240 跨期拆分", option_id: "OPT-A" },
        { detail: "三行合并", option_label: "M-BRK-126 三行合并", option_id: "OPT-B" },
      ],
    };
    // `detail` also varies and is short enough to name a card; the key that
    // declares itself a label wins so the choice is not left to key order.
    expect(decisionOptions(payloadWithLabel, ["option_id"]).map((o) => o.title)).toEqual([
      "M-CAB-240 跨期拆分",
      "M-BRK-126 三行合并",
    ]);
  });

  // API 对运行载荷有 24KB 上限，真实链路一超限就整个塌成 {_truncated} 标记，
  // 「采购概况」「判断依据」两栏因此空着——审批人没有任何依据可看。
  it("falls back to the task's own brief when the run payload was truncated", () => {
    const truncated = { _truncated: true, _bytes: 49443, _preview: "{...}" };
    const brief = { alert_level: "红色", chain_id: "C-1", cause_explanation: "定标节点停滞 46 天，后续周期已赶不上到货日。" };
    expect(pickContext(truncated, brief)).toBe(brief);
    expect(contextSummary(pickContext(truncated, brief)).length).toBeGreaterThan(0);
    // 载荷完整时仍优先用它——信息更全。
    expect(pickContext(brief, truncated)).toBe(brief);
  });

  it("keeps the facts when the options differ in nothing", () => {
    const identical = {
      options: [
        { note: "同样的说明", stage: "定标" },
        { note: "同样的说明", stage: "定标" },
      ],
    };
    // Showing something the reader can compare beats showing an empty card.
    expect(decisionOptions(identical, ["stage"])[0]!.facts.length).toBeGreaterThan(0);
  });

  it("offers nothing to pick when the payload holds no alternatives", () => {
    expect(decisionOptions({ alert_context: { alert_id: "A" } }, ["alert_id"])).toEqual([]);
    expect(decisionOptions(null)).toEqual([]);
  });
});

describe("actorDefaults", () => {
  // Asking an approver to type their own name invites a typo at best and
  // someone else's name at worst.
  it("signs the who-did-this fields with the person doing it", () => {
    expect(
      actorDefaults(
        ["decided_by", "planner_confirmed_by", "high_risk_confirmed_by", "option_id", "remark"],
        "张三",
      ),
    ).toEqual({
      decided_by: "张三",
      planner_confirmed_by: "张三",
      high_risk_confirmed_by: "张三",
    });
  });

  it("signs nothing when there is nobody to sign as", () => {
    expect(actorDefaults(["decided_by"], null)).toEqual({});
    expect(actorDefaults(["decided_by"], "   ")).toEqual({});
  });
});
