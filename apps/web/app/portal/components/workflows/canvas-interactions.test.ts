import { describe, expect, it } from "vitest";
import {
  clientPointToCanvas,
  clampEdgeOffset,
  connectionEventName,
  edgeOffsetFromPointer,
  nodePositionFromPointer,
  workflowEdgeMidpoint,
  workflowEdgePath,
} from "./canvas-interactions";

describe("workflow canvas pointer geometry", () => {
  it("converts client coordinates through scroll, zoom, and the stage header", () => {
    expect(
      clientPointToCanvas(
        { clientX: 310, clientY: 250 },
        {
          rectLeft: 10,
          rectTop: 20,
          scrollLeft: 100,
          scrollTop: 50,
          zoom: 2,
        },
      ),
    ).toEqual({ x: 200, y: 110 });
  });

  it("moves from the original grab point and clamps invalid canvas overflow", () => {
    expect(
      nodePositionFromPointer(
        { x: 120, y: 80 },
        { clientX: 200, clientY: 200 },
        { clientX: 260, clientY: 240 },
        2,
      ),
    ).toEqual({ x: 150, y: 100 });

    expect(
      nodePositionFromPointer(
        { x: 2, y: 2 },
        { clientX: 100, clientY: 100 },
        { clientX: -500, clientY: -500 },
        1,
      ),
    ).toEqual({ x: 0, y: 0 });
  });
});

describe("workflow connection interaction", () => {
  it("creates stable readable event names", () => {
    expect(connectionEventName("supportTriage", "human-review")).toBe(
      "SUPPORT_TRIAGE_TO_HUMAN_REVIEW",
    );
  });

  it("uses the same cubic path for live previews and saved edges", () => {
    expect(workflowEdgePath({ x: 100, y: 50 }, { x: 400, y: 150 })).toBe(
      "M 100 50 C 250 50, 250 150, 400 150",
    );
  });

  it("moves the curve midpoint by the offset while keeping both endpoints attached", () => {
    const source = { x: 100, y: 50 };
    const target = { x: 400, y: 150 };
    const offset = { x: 30, y: 60 };
    const path = workflowEdgePath(source, target, offset);
    expect(path).toBe("M 100 50 C 290 130, 290 230, 400 150");
    // Evaluate the cubic itself at t=1/2, independently of the handle helper.
    const points = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const curveMidpoint = {
      x: (points[0]! + 3 * points[2]! + 3 * points[4]! + points[6]!) / 8,
      y: (points[1]! + 3 * points[3]! + 3 * points[5]! + points[7]!) / 8,
    };
    expect(curveMidpoint).toEqual({ x: 280, y: 160 });
    expect(workflowEdgeMidpoint(source, target, offset)).toEqual(curveMidpoint);
    expect(workflowEdgePath(source, target, { x: 0, y: 0 })).toBe(
      workflowEdgePath(source, target),
    );
  });

  it("preserves the grabbed route offset when dragging through zoom", () => {
    expect(
      edgeOffsetFromPointer(
        { x: 100, y: 50 },
        { x: 400, y: 150 },
        { x: -10, y: 15 },
        { clientX: 200, clientY: 200 },
        { clientX: 260, clientY: 240 },
        2,
        { width: 500, height: 300 },
      ),
    ).toEqual({ x: 20, y: 35 });
  });

  it("keeps the handle reachable when moving beyond any canvas boundary", () => {
    const source = { x: 100, y: 50 };
    const target = { x: 400, y: 150 };
    const bounds = { width: 500, height: 300 };
    const first = clampEdgeOffset(
      source,
      target,
      { x: -1000, y: 1000 },
      bounds,
    );
    expect(workflowEdgeMidpoint(source, target, first)).toEqual({
      x: 14,
      y: 286,
    });
    const second = clampEdgeOffset(
      source,
      target,
      { x: 1000, y: -1000 },
      bounds,
    );
    expect(workflowEdgeMidpoint(source, target, second)).toEqual({
      x: 486,
      y: 14,
    });
  });

  it("accounts for scrolling during an edge drag at the active zoom", () => {
    expect(
      edgeOffsetFromPointer(
        { x: 100, y: 50 },
        { x: 400, y: 150 },
        { x: -10, y: 15 },
        { clientX: 200, clientY: 200 },
        { clientX: 260, clientY: 240 },
        2,
        { width: 500, height: 300 },
        { x: 100, y: -20 },
      ),
    ).toEqual({ x: 70, y: 25 });
  });

  it("rejects invalid offsets and falls back to unit scale for invalid zoom", () => {
    const source = { x: 100, y: 50 };
    const target = { x: 400, y: 150 };
    expect(clampEdgeOffset(source, target, { x: Infinity, y: NaN })).toEqual({
      x: 0,
      y: 0,
    });
    expect(
      edgeOffsetFromPointer(
        source,
        target,
        { x: 0, y: 0 },
        { clientX: 200, clientY: 200 },
        { clientX: 210, clientY: 220 },
        0,
      ),
    ).toEqual({ x: 10, y: 20 });
  });
});
