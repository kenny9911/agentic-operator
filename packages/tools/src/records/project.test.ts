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

  it("reports a cell that only some rows carry, rather than failing the batch", () => {
    const partial = {
      records: [{ prNumber: "P1", prLineList: [{ prLineId: "1", itemCode: "a" }, { prLineId: "2" }] }],
    };
    const out = projectRecords(partial, {
      source: "records[0].prLineList",
      fields: { id: "prLineId", item: "itemCode" },
    });
    expect(out.rows).toEqual([
      { id: "1", item: "a" },
      { id: "2", item: null },
    ]);
    // 「哪一列有缺」必须说出来，否则 null 分不清是「没有」还是「映射写错了」。
    expect(out.missing_fields).toEqual(["item"]);
  });

  it("refuses to run without a previous tool result", () => {
    expect(() => projectRecords(undefined, { fields: FIELDS })).toThrow(/ctx\.lastResult/);
  });

  it("requires a non-empty field map", () => {
    expect(() => projectRecords(PR_RESPONSE, { source: "records", fields: {} })).toThrow(/fields/);
  });
});

describe("部分行缺字段不该毁掉整批投影", () => {
  /** 三份计划头，其中一份是草稿——草稿没有审批时间。 */
  const HEADERS = {
    rows: [
      { PBP_HEADER_ID: "PBP-2027-0101", PLAN_NO: "PBP-2027-0101", STATUS: "已批准", APPROVED_AT: "2026-11-28T16:30:00+08:00" },
      { PBP_HEADER_ID: "PBP-2027-0102", PLAN_NO: "PBP-2027-0102", STATUS: "已批准", APPROVED_AT: "2026-11-29T10:10:00+08:00" },
      { PBP_HEADER_ID: "PBP-2027-0199", PLAN_NO: "PBP-2027-0199", STATUS: "草稿" },
    ],
  };
  const FIELDS = { plan_id: "PBP_HEADER_ID", plan_no: "PLAN_NO", status: "STATUS", approved_at: "APPROVED_AT" };

  it("fills the absent cell with null and names the field, instead of throwing", () => {
    // 实跑里这一条让整批投影失败，模型原样重试了 8 次。
    const out = projectRecords(HEADERS, { source: "rows", fields: FIELDS });
    expect(out.row_count).toBe(3);
    expect(out.rows[2]).toEqual({
      plan_id: "PBP-2027-0199",
      plan_no: "PBP-2027-0199",
      status: "草稿",
      approved_at: null,
    });
    expect(out.missing_fields).toEqual(["approved_at"]);
  });

  it("still fails closed when a column is absent from every row", () => {
    // 整列缺失是映射写错了——静默返回一列 null 比报错糟得多。
    expect(() =>
      projectRecords(HEADERS, { source: "rows", fields: { planner: "PLANNER" } }),
    ).toThrow(/没有任何一行带这些字段[\s\S]*PLANNER/);
  });

  it("tells the model to re-query instead of retrying, when the previous call failed", () => {
    // 上一次调用失败时，它的错误信封就是这一次的 lastResult；原来的报错让模型
    // 原样重试了 11 次。
    expect(() =>
      projectRecords({ error: "metaerp.invoke: ... 返回 status=ERROR" }, { fields: FIELDS }),
    ).toThrow(/请先重新调用对应的 query 操作/);
  });
});
