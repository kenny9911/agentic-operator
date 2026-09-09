import { describe, expect, it } from "vitest";
import {
  agentDescriptionText,
  agentDisplayTitle,
  agentNodeTooltip,
} from "./agent-title";

const compiled = {
  name: "verifyInventoryAvailability",
  title: "库存校验",
  titleI18n: { zh: "库存校验", en: "Verify Inventory Availability" },
};

describe("agentDisplayTitle", () => {
  it("picks the portal language from title_i18n", () => {
    expect(agentDisplayTitle(compiled, "zh")).toBe("库存校验");
    expect(agentDisplayTitle(compiled, "en")).toBe("Verify Inventory Availability");
  });

  it("falls back from a regional tag to its base language", () => {
    expect(agentDisplayTitle(compiled, "zh-CN")).toBe("库存校验");
    expect(agentDisplayTitle(compiled, "en-US")).toBe("Verify Inventory Availability");
  });

  it("falls back to the manifest title, then the technical name", () => {
    expect(agentDisplayTitle({ name: "x", title: "手写标题", titleI18n: null }, "en")).toBe("手写标题");
    expect(agentDisplayTitle({ name: "matcher-agent", title: "  " }, "zh")).toBe("matcher-agent");
    expect(agentDisplayTitle(compiled, "fr")).toBe("库存校验");
  });
});

// A real compiled description: human prose, then blank-line-separated model
// instructions that must never reach a tooltip.
const compiledDescription = [
  "【析】按「物料编码 + 计划行类型编码」聚类已审批需求计划行，算出可合并簇(R2-01)。",
  "",
  "【判定步骤】",
  "",
  "第 1 步：按 `物料编码 + 计划行类型编码` 聚类，同组内两两比较需求到货日期。",
].join("\n");

describe("agentDescriptionText", () => {
  it("keeps the human paragraph and drops the embedded model instructions", () => {
    expect(agentDescriptionText(compiledDescription)).toBe(
      "【析】按「物料编码 + 计划行类型编码」聚类已审批需求计划行，算出可合并簇(R2-01)。",
    );
  });

  it("joins a wrapped paragraph onto one line", () => {
    expect(agentDescriptionText("第一句，\n第二句。")).toBe("第一句， 第二句。");
  });

  it("caps a runaway paragraph rather than returning a wall", () => {
    const text = agentDescriptionText("啊".repeat(400)) ?? "";
    expect(text).toHaveLength(241);
    expect(text.endsWith("…")).toBe(true);
  });

  it("returns null when there is nothing to show", () => {
    expect(agentDescriptionText(undefined)).toBeNull();
    expect(agentDescriptionText("   ")).toBeNull();
  });
});

describe("agentNodeTooltip", () => {
  it("stacks identity, description and hint in three blocks", () => {
    expect(
      agentNodeTooltip({
        identity: ["库存校验", "verifyInventoryAvailability"],
        description: compiledDescription,
        hint: "点开处理人工任务",
      }),
    ).toBe(
      "库存校验\nverifyInventoryAvailability\n\n" +
        "【析】按「物料编码 + 计划行类型编码」聚类已审批需求计划行，算出可合并簇(R2-01)。\n\n" +
        "点开处理人工任务",
    );
  });

  it("shows a name once when the title IS the name", () => {
    expect(
      agentNodeTooltip({
        identity: ["analyzeDemandMerge", "analyzeDemandMerge", null, "  "],
      }),
    ).toBe("analyzeDemandMerge");
  });

  it("omits blocks it has nothing for", () => {
    expect(agentNodeTooltip({ identity: ["a"], hint: "点开" })).toBe("a\n\n点开");
    expect(agentNodeTooltip({ identity: [], description: null })).toBe("");
  });
});
