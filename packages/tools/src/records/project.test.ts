import { describe, expect, it } from "vitest";
import { projectRecords } from "./project";

/** The shape queryPr actually returns, trimmed to what the collector reads. */
const PR_RESPONSE = {
  totalRecords: "4",
  records: [
    {
      prNumber: "100020260902000001",
      prDescription: "电子设备采购",
      prLineList: [
        { prLineNumber: "10", prLineId: "2033239140312421456", itemCode: "10000008", prLineDescription: "电阻", quantity: "10", uomCode: "EA" },
        { prLineNumber: "20", prLineId: "2033239140312552528", itemCode: "10000008", prLineDescription: "电阻", quantity: "10", uomCode: "EA" },
        { prLineNumber: "30", prLineId: "2033239140312683600", itemCode: "10000007", prLineDescription: "电容", quantity: "10", uomCode: "EA" },
        { prLineNumber: "40", prLineId: "2033239140312814672", itemCode: "10000009", prLineDescription: "电感", quantity: "10", uomCode: "EA" },
      ],
    },
  ],
};

const FIELDS = {
  plan_id: "$root.records[0].prNumber",
  plan_line_id: "prLineId",
  material_code: "itemCode",
  material_name: "prLineDescription",
  quantity: "quantity",
  unit: "uomCode",
};

describe("projectRecords", () => {
  it("keeps each line's own material — the collector reported three of these wrong", () => {
    const { rows, row_count } = projectRecords(PR_RESPONSE, {
      source: "records[0].prLineList",
      fields: FIELDS,
    });
    expect(row_count).toBe(4);
    expect(rows.map((r) => [r.plan_line_id, r.material_code, r.material_name])).toEqual([
      ["2033239140312421456", "10000008", "电阻"],
      ["2033239140312552528", "10000008", "电阻"],
      ["2033239140312683600", "10000007", "电容"],
      ["2033239140312814672", "10000009", "电感"],
    ]);
    // header value stamped on every row, never retyped
    expect(new Set(rows.map((r) => r.plan_id))).toEqual(new Set(["100020260902000001"]));
  });

  it("treats the previous result as the rows when no source path is given", () => {
    const { rows } = projectRecords(PR_RESPONSE.records[0]!.prLineList, {
      fields: { id: "prLineId", item: "itemCode" },
    });
    expect(rows).toHaveLength(4);
    expect(rows[2]).toEqual({ id: "2033239140312683600", item: "10000007" });
  });

  it("says what the previous result actually looked like when the path misses", () => {
    expect(() => projectRecords(PR_RESPONSE, { source: "records[0].lines", fields: FIELDS }))
      .toThrow(/不是数组[\s\S]*totalRecords, records/);
  });

  it("names the row and key when a line lacks a mapped field", () => {
    const broken = {
      records: [{ prNumber: "P1", prLineList: [{ prLineId: "1", itemCode: "a" }, { prLineId: "2" }] }],
    };
    expect(() =>
      projectRecords(broken, {
        source: "records[0].prLineList",
        fields: { id: "prLineId", item: "itemCode" },
      }),
    ).toThrow(/第 1 行没有字段 "itemCode"/);
  });

  it("refuses to run without a previous tool result", () => {
    expect(() => projectRecords(undefined, { fields: FIELDS })).toThrow(/ctx\.lastResult/);
  });

  it("requires a non-empty field map", () => {
    expect(() => projectRecords(PR_RESPONSE, { source: "records", fields: {} })).toThrow(/fields/);
  });
});
