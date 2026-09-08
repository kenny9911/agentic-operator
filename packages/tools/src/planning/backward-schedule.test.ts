import { describe, expect, it } from "vitest";
import { computeBackwardSchedule } from "./backward-schedule";

/** The seven HC-采购 nodes, in the SCREAMING_CASE the ERP config table returns. */
const HC_ROWS = [
  ["立项", 1, 10],
  ["组包", 2, 15],
  ["询价", 3, 20],
  ["定标", 4, 15],
  ["合同", 5, 15],
  ["订单", 6, 10],
  ["到货", 7, 70],
].map(([node, seq, days]) => ({
  BUSINESS_TYPE: "物品采购",
  STAGE_NODE: node,
  STAGE_SEQUENCE: seq,
  STANDARD_CYCLE_DAYS: days,
}));

describe("computeBackwardSchedule", () => {
  it("anchors the last node on the arrival date and subtracts only later cycles", () => {
    const result = computeBackwardSchedule({
      required_arrival_date: "2026-09-10",
      business_type: "物品采购",
      stages: HC_ROWS,
    });
    expect(
      Object.fromEntries(
        result.planned_dates.map((s) => [s.stage_node, s.planned_finish_date]),
      ),
    ).toEqual({
      立项: "2026-04-18",
      组包: "2026-05-03",
      询价: "2026-05-23",
      定标: "2026-06-07",
      合同: "2026-06-22",
      订单: "2026-07-02",
      到货: "2026-09-10",
    });
    expect(result.total_cycle_days).toBe(155);
    expect(result.earliest_start_date).toBe("2026-04-08");
  });

  it("keeps the schedule monotonic — the defect that shipped a 订单 date after 到货", () => {
    const { planned_dates } = computeBackwardSchedule({
      required_arrival_date: "2026-09-10",
      stages: HC_ROWS,
    });
    for (let i = 1; i < planned_dates.length; i += 1) {
      expect(
        Date.parse(planned_dates[i]!.planned_finish_date),
      ).toBeGreaterThanOrEqual(Date.parse(planned_dates[i - 1]!.planned_finish_date));
    }
  });

  it("accepts snake_case rows as well as the ERP's SCREAMING_CASE", () => {
    const snake = HC_ROWS.map((row) => ({
      business_type: row.BUSINESS_TYPE,
      stage_node: row.STAGE_NODE,
      stage_sequence: row.STAGE_SEQUENCE,
      standard_cycle_days: row.STANDARD_CYCLE_DAYS,
    }));
    expect(
      computeBackwardSchedule({ required_arrival_date: "2026-09-10", stages: snake })
        .planned_dates,
    ).toEqual(
      computeBackwardSchedule({ required_arrival_date: "2026-09-10", stages: HC_ROWS })
        .planned_dates,
    );
  });

  it("accepts rows the caller already filtered, rather than burning a retry", () => {
    // The live run passed business_type plus hand-retyped rows carrying no
    // BUSINESS_TYPE. There is no near match to guard against, so schedule them.
    const stripped = HC_ROWS.map(({ BUSINESS_TYPE: _drop, ...rest }) => rest);
    const result = computeBackwardSchedule({
      required_arrival_date: "2026-09-10",
      business_type: "物品采购",
      stages: stripped,
    });
    expect(result.business_type_filtered).toBe(false);
    expect(result.planned_dates.at(-1)!.planned_finish_date).toBe("2026-09-10");
    expect(
      computeBackwardSchedule({
        required_arrival_date: "2026-09-10",
        business_type: "物品采购",
        stages: HC_ROWS,
      }).business_type_filtered,
    ).toBe(true);
  });

  it("names the configured business types instead of falling back to a near match", () => {
    expect(() =>
      computeBackwardSchedule({
        required_arrival_date: "2026-09-10",
        business_type: "物品采购",
        stages: HC_ROWS.map((row) => ({ ...row, BUSINESS_TYPE: "物资" })),
      }),
    ).toThrow(/「物资」/);
  });

  it("rejects a gap in the node sequence rather than scheduling around it", () => {
    expect(() =>
      computeBackwardSchedule({
        required_arrival_date: "2026-09-10",
        stages: HC_ROWS.filter((row) => row.STAGE_SEQUENCE !== 3),
      }),
    ).toThrow(/连续序号/);
  });

  it("rejects a missing or malformed cycle value, naming the node", () => {
    expect(() =>
      computeBackwardSchedule({
        required_arrival_date: "2026-09-10",
        stages: HC_ROWS.map((row) =>
          row.STAGE_NODE === "合同" ? { ...row, STANDARD_CYCLE_DAYS: null } : row,
        ),
      }),
    ).toThrow(/合同/);
  });

  it("rejects a non-date arrival value", () => {
    expect(() =>
      computeBackwardSchedule({ required_arrival_date: "2026-9-10", stages: HC_ROWS }),
    ).toThrow(/YYYY-MM-DD/);
    expect(() =>
      computeBackwardSchedule({ required_arrival_date: "2026-02-30", stages: HC_ROWS }),
    ).toThrow(/有效的日历日期/);
  });

  it("rejects an empty stage list", () => {
    expect(() =>
      computeBackwardSchedule({ required_arrival_date: "2026-09-10", stages: [] }),
    ).toThrow(/非空数组/);
  });
});
