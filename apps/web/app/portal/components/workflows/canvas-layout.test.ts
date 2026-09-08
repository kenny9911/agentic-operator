import { describe, expect, it } from "vitest";
import {
  canvasLayoutStorageKey,
  deserializeCanvasLayout,
  emptyCanvasLayout,
  workflowEdgeKey,
} from "./canvas-layout";
import { MAX_CANVAS_H, MAX_CANVAS_W, NODE_H, NODE_W } from "./layout";

describe("workflow canvas layout persistence", () => {
  it("scopes preferences to tenant, workflow, and immutable version", () => {
    const key = canvasLayoutStorageKey("raas", "default", "version-1");
    expect(key).not.toBe(canvasLayoutStorageKey("other", "default", "version-1"));
    expect(key).not.toBe(canvasLayoutStorageKey("raas", "other", "version-1"));
    expect(key).not.toBe(canvasLayoutStorageKey("raas", "default", "version-2"));
    expect(canvasLayoutStorageKey("a:b", "c", "d")).not.toBe(
      canvasLayoutStorageKey("a", "b:c", "d"),
    );
  });

  it("round-trips node positions and signed midpoint offsets", () => {
    const layout = emptyCanvasLayout();
    const edge = workflowEdgeKey("source", "target", "READY");
    layout.nodes.source = { x: 123.5, y: 240 };
    layout.edges[edge] = { x: -75, y: 160.25 };
    expect(deserializeCanvasLayout(JSON.stringify(layout))).toEqual(layout);
  });

  it("recovers empty preferences from unavailable or invalid storage", () => {
    for (const serialized of [null, "", "{broken", "null", "true", "42", "[]"]) {
      expect(deserializeCanvasLayout(serialized)).toEqual(emptyCanvasLayout());
    }
  });

  it("keeps valid entries while ignoring malformed points and sections", () => {
    const restored = deserializeCanvasLayout(`{
      "nodes": {
        "valid": { "x": 100, "y": 200 },
        "numericString": { "x": "100", "y": 200 },
        "missing": { "x": 100 },
        "overflow": { "x": 1e309, "y": 200 },
        "null": null,
        "array": [100, 200]
      },
      "edges": []
    }`);
    expect(restored.nodes).toEqual({ valid: { x: 100, y: 200 } });
    expect(restored.edges).toEqual({});
    expect(
      deserializeCanvasLayout('{"nodes":false,"edges":{"valid":{"x":0,"y":-20}}}'),
    ).toEqual({ nodes: {}, edges: { valid: { x: 0, y: -20 } } });
  });

  it("bounds node coordinates and route offsets to a usable canvas", () => {
    const restored = deserializeCanvasLayout(
      JSON.stringify({
        nodes: {
          first: { x: -100, y: -100 },
          last: { x: Number.MAX_VALUE, y: Number.MAX_VALUE },
        },
        edges: {
          forward: { x: Number.MAX_VALUE, y: Number.MAX_VALUE },
          backward: { x: -Number.MAX_VALUE, y: -Number.MAX_VALUE },
        },
      }),
    );
    expect(restored.nodes.first).toEqual({ x: 0, y: 0 });
    expect(restored.nodes.last).toEqual({
      x: MAX_CANVAS_W - NODE_W,
      y: MAX_CANVAS_H - NODE_H,
    });
    expect(restored.edges.forward).toEqual({ x: MAX_CANVAS_W, y: MAX_CANVAS_H });
    expect(restored.edges.backward).toEqual({ x: -MAX_CANVAS_W, y: -MAX_CANVAS_H });
  });

  it("handles object-like agent IDs as data without prototype lookups", () => {
    const empty = emptyCanvasLayout();
    expect(empty.nodes.constructor).toBeUndefined();
    const restored = deserializeCanvasLayout(
      '{"nodes":{"__proto__":{"x":20,"y":30},"constructor":{"x":40,"y":50}}}',
    );
    expect(restored.nodes.__proto__).toEqual({ x: 20, y: 30 });
    expect(restored.nodes.constructor).toEqual({ x: 40, y: 50 });
    expect(Object.getPrototypeOf(restored.nodes)).toBeNull();
    expect(emptyCanvasLayout().nodes).toEqual({});
  });
});

describe("workflow edge identity", () => {
  it("distinguishes direction, event, and separator-containing identifiers", () => {
    expect(workflowEdgeKey("source", "target", "READY")).not.toBe(
      workflowEdgeKey("target", "source", "READY"),
    );
    expect(workflowEdgeKey("source", "target", "READY")).not.toBe(
      workflowEdgeKey("source", "target", "DONE"),
    );
    expect(workflowEdgeKey("a:b", "c", "d")).not.toBe(
      workflowEdgeKey("a", "b:c", "d"),
    );
    expect(JSON.parse(workflowEdgeKey('a["', "b,c", "d]"))).toEqual([
      'a["',
      "b,c",
      "d]",
    ]);
  });
});
