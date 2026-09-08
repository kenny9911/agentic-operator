import {
  MAX_CANVAS_H,
  MAX_CANVAS_W,
  clampCanvasPosition,
  type CanvasPoint,
} from "./layout";

/** Browser layout preferences never change a workflow's execution graph. */
export interface CanvasLayout {
  nodes: Record<string, CanvasPoint>;
  /** Edge routes are offsets from the midpoint of their attached endpoints. */
  edges: Record<string, CanvasPoint>;
}

function emptyPoints(): Record<string, CanvasPoint> {
  return Object.create(null) as Record<string, CanvasPoint>;
}

export function emptyCanvasLayout(): CanvasLayout {
  return { nodes: emptyPoints(), edges: emptyPoints() };
}

export function canvasLayoutStorageKey(
  tenant: string,
  workflow: string,
  version: string,
): string {
  return `agentic:workflow-canvas-layout:v1:${JSON.stringify([
    tenant,
    workflow,
    version,
  ])}`;
}

export function workflowEdgeKey(
  source: string,
  target: string,
  event: string,
): string {
  return JSON.stringify([source, target, event]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPoints(
  value: unknown,
  clamp: (point: CanvasPoint) => CanvasPoint,
): Record<string, CanvasPoint> {
  const points = emptyPoints();
  if (!isRecord(value)) return points;
  for (const [id, point] of Object.entries(value)) {
    if (
      !isRecord(point) ||
      typeof point.x !== "number" ||
      typeof point.y !== "number" ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y)
    ) {
      continue;
    }
    points[id] = clamp({ x: point.x, y: point.y });
  }
  return points;
}

/** Ignore stale or malformed storage entries without losing valid siblings. */
export function deserializeCanvasLayout(
  serialized: string | null,
): CanvasLayout {
  if (!serialized) return emptyCanvasLayout();
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!isRecord(parsed)) return emptyCanvasLayout();
    return {
      nodes: readPoints(parsed.nodes, clampCanvasPosition),
      edges: readPoints(parsed.edges, (point) => ({
        x: Math.max(-MAX_CANVAS_W, Math.min(MAX_CANVAS_W, point.x)),
        y: Math.max(-MAX_CANVAS_H, Math.min(MAX_CANVAS_H, point.y)),
      })),
    };
  } catch {
    return emptyCanvasLayout();
  }
}
