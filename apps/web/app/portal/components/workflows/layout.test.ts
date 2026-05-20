/**
 * Tests for the hand-tuned LAYOUT map (audit 01 §4.2 acceptance criterion).
 *
 * The pixel positions of every node in the RAAS workflow are fixed; any
 * regression here is a visual regression. Run these in CI to prevent
 * accidental auto-packing of the canvas.
 */
import { describe, expect, it } from "vitest";
import {
  CANVAS_H,
  CANVAS_W,
  COL_W,
  LAYOUT,
  MAX_LANE,
  MAX_STAGE,
  NODE_H,
  NODE_W,
  PAD_X,
  PAD_Y,
  ROW_H,
  colorVar,
  nodePos,
} from "./layout";

describe("workflows/layout LAYOUT map", () => {
  it("matches the canonical v1_1 dimensions", () => {
    expect(NODE_W).toBe(184);
    expect(NODE_H).toBe(64);
    expect(COL_W).toBe(220);
    expect(ROW_H).toBe(90);
    expect(PAD_X).toBe(30);
    expect(PAD_Y).toBe(30);
  });

  it("places every of the 23 RAAS agents into a stage+lane", () => {
    const expectedIds = [
      "1-1",
      "1-2",
      "2",
      "3",
      "3-2",
      "4",
      "5",
      "6",
      "7-1",
      "7-2",
      "8",
      "9-1",
      "9-2",
      "10-1",
      "10-2",
      "11-1",
      "11-2",
      "12",
      "13",
      "14-1",
      "14-2",
      "15",
      "16",
    ];
    expect(Object.keys(LAYOUT).sort()).toEqual(expectedIds.sort());
  });

  it("computes pixel positions deterministically", () => {
    expect(nodePos("1-1")).toEqual({ x: 30, y: 30 });
    expect(nodePos("16")).toEqual({ x: PAD_X + 7 * COL_W, y: PAD_Y + 1 * ROW_H });
    // Bottom-right of the layout
    expect(nodePos("12")).toEqual({ x: PAD_X + 5 * COL_W, y: PAD_Y + 4 * ROW_H });
  });

  it("returns origin for unknown ids", () => {
    expect(nodePos("does-not-exist")).toEqual({ x: 0, y: 0 });
  });

  it("derives canvas size from the largest stage/lane", () => {
    // Validate every layout entry is inside the canvas bounds.
    for (const id of Object.keys(LAYOUT)) {
      const p = nodePos(id);
      expect(p.x + NODE_W).toBeLessThanOrEqual(CANVAS_W);
      expect(p.y + NODE_H).toBeLessThanOrEqual(CANVAS_H);
    }
    expect(MAX_STAGE).toBe(7);
    expect(MAX_LANE).toBe(4);
  });

  it("groups by stage to produce 8 columns", () => {
    const byStage = new Map<number, string[]>();
    for (const [id, p] of Object.entries(LAYOUT)) {
      const arr = byStage.get(p.stage) ?? [];
      arr.push(id);
      byStage.set(p.stage, arr);
    }
    // 8 columns total (0..7); stage 0 has 2, stage 7 has 1.
    expect(byStage.size).toBe(8);
    expect(byStage.get(0)?.sort()).toEqual(["1-1", "1-2"]);
    expect(byStage.get(7)).toEqual(["16"]);
    // Stage 5 has the widest fan-out — 5 lanes.
    expect(byStage.get(5)?.length).toBe(5);
  });

  it("colorVar maps event color tokens to CSS vars", () => {
    expect(colorVar("green")).toBe("var(--green)");
    expect(colorVar("blue")).toBe("var(--blue)");
    expect(colorVar("amber")).toBe("var(--amber)");
    expect(colorVar("red")).toBe("var(--red)");
    expect(colorVar("muted")).toBe("var(--text-3)");
    expect(colorVar(undefined)).toBe("var(--text-3)");
    expect(colorVar("unknown-color")).toBe("var(--text-3)");
  });
});
