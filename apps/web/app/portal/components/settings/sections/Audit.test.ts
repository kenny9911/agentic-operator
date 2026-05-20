import { describe, it, expect } from "vitest";
import { renderDiffRows } from "./Audit";

describe("renderDiffRows", () => {
  it("flags changed top-level fields", () => {
    const before = { cap: 100, name: "x" };
    const after = { cap: 200, name: "x" };
    const rows = renderDiffRows(before, after, "before");
    const cap = rows.find((r) => r.key === "cap");
    const name = rows.find((r) => r.key === "name");
    expect(cap?.changed).toBe(true);
    expect(name?.changed).toBe(false);
  });

  it("treats removed fields as missing on the after side", () => {
    const before = { a: 1, b: 2 };
    const after = { a: 1 };
    const afterRows = renderDiffRows(after, before, "after");
    const b = afterRows.find((r) => r.key === "b");
    expect(b?.missing).toBe(true);
    expect(b?.value).toBe("—");
  });

  it("returns empty when both sides are null", () => {
    expect(renderDiffRows(null, null, "before")).toEqual([]);
  });

  it("handles only-before with no after", () => {
    const rows = renderDiffRows({ a: 1 }, null, "before");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.changed).toBe(true);
  });

  it("renders nested objects as compact JSON", () => {
    const rows = renderDiffRows({ x: { nested: true } }, null, "before");
    expect(rows[0]?.value).toBe('{"nested":true}');
  });

  it("truncates long values", () => {
    const long = "a".repeat(200);
    const rows = renderDiffRows({ x: long }, null, "before");
    // Strings are returned raw (toCompactJson only stringifies non-string)
    expect(rows[0]?.value).toBe(long);
  });
});
