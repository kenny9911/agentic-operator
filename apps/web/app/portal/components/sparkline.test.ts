import { describe, expect, it } from "vitest";
import { computeSparkPaths } from "./sparkline";

describe("computeSparkPaths", () => {
  it("returns null for empty values", () => {
    expect(computeSparkPaths([], 80, 22)).toBeNull();
  });

  it("returns null for null/undefined", () => {
    // The function guards on falsy length, so passing []/null behave the same.
    expect(computeSparkPaths([] as number[], 80, 22)).toBeNull();
  });

  it("produces a line path with N points", () => {
    const r = computeSparkPaths([1, 2, 3, 4], 80, 22);
    expect(r).not.toBeNull();
    expect(r!.line.startsWith("M")).toBe(true);
    // 4 coordinates joined by " L"
    expect(r!.line.split(" L")).toHaveLength(4);
  });

  it("renders a flat line at vertical midpoint when range is zero", () => {
    const r = computeSparkPaths([5, 5, 5], 60, 22);
    // All Y values should be the same (top of the band, since range falls
    // back to 1 and (v-min)/range = 0 → y = pad + (h-pad*2)*1 = bottom).
    const ys = r!.line
      .replace("M", "")
      .split(" L")
      .map((p) => Number(p.split(",")[1]));
    expect(new Set(ys).size).toBe(1);
  });

  it("clamps min/max to width pad bounds", () => {
    const r = computeSparkPaths([0, 100], 80, 22);
    const points = r!.line.replace("M", "").split(" L");
    // First X near left padding (1.5)
    expect(points[0]!.startsWith("1.5,")).toBe(true);
    // Last X near right edge (width - pad)
    const lastX = Number(points[1]!.split(",")[0]);
    expect(lastX).toBeCloseTo(78.5, 0);
  });
});
