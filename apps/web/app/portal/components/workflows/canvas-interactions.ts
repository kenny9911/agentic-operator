import {
  clampCanvasPosition,
  MAX_CANVAS_H,
  MAX_CANVAS_W,
  type CanvasPoint,
} from "@/app/portal/components/workflows/layout";

export const WORKFLOW_AGENT_DRAG_TYPE = "application/x-agentic-workflow-agent";

export interface CanvasViewportMetrics {
  rectLeft: number;
  rectTop: number;
  scrollLeft: number;
  scrollTop: number;
  zoom: number;
}

export interface ClientPoint {
  clientX: number;
  clientY: number;
}

/**
 * Convert a browser pointer coordinate into the unscaled workflow plane.
 * `contentTop` accounts for the stage-header strip above the SVG/node layer.
 */
export function clientPointToCanvas(
  point: ClientPoint,
  viewport: CanvasViewportMetrics,
  contentTop = 30,
): CanvasPoint {
  const zoom =
    Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1;
  return {
    x: (viewport.scrollLeft + point.clientX - viewport.rectLeft) / zoom,
    y:
      (viewport.scrollTop + point.clientY - viewport.rectTop) / zoom -
      contentTop,
  };
}

/** Move a node by the pointer delta while preserving where it was grabbed. */
export function nodePositionFromPointer(
  origin: CanvasPoint,
  start: ClientPoint,
  current: ClientPoint,
  zoom: number,
): CanvasPoint {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return clampCanvasPosition({
    x: origin.x + (current.clientX - start.clientX) / scale,
    y: origin.y + (current.clientY - start.clientY) / scale,
  });
}

export function connectionEventName(
  sourceId: string,
  targetId: string,
): string {
  const eventPart = (value: string) =>
    value
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toUpperCase();
  return `${eventPart(sourceId)}_TO_${eventPart(targetId)}`.slice(0, 160);
}

/** Shared path geometry for persisted edges and the live drag preview. */
export function workflowEdgePath(
  source: CanvasPoint,
  target: CanvasPoint,
  offset: CanvasPoint = { x: 0, y: 0 },
): string {
  const distance = Math.max(40, Math.abs(target.x - source.x) * 0.5);
  // Both control points have a weight of 3/8 at t=1/2. Moving them
  // together by 4/3 of the offset moves the midpoint by exactly the offset.
  const controlX = (offset.x * 4) / 3;
  const controlY = (offset.y * 4) / 3;
  return `M ${source.x} ${source.y} C ${source.x + distance + controlX} ${source.y + controlY}, ${
    target.x - distance + controlX
  } ${target.y + controlY}, ${target.x} ${target.y}`;
}

export interface CanvasBounds {
  width: number;
  height: number;
}

export function workflowEdgeMidpoint(
  source: CanvasPoint,
  target: CanvasPoint,
  offset: CanvasPoint = { x: 0, y: 0 },
): CanvasPoint {
  return {
    x: (source.x + target.x) / 2 + offset.x,
    y: (source.y + target.y) / 2 + offset.y,
  };
}

/** Keep the routing handle inside the canvas, including its pointer target. */
export function clampEdgeOffset(
  source: CanvasPoint,
  target: CanvasPoint,
  offset: CanvasPoint,
  bounds: CanvasBounds = { width: MAX_CANVAS_W, height: MAX_CANVAS_H },
): CanvasPoint {
  const midpoint = workflowEdgeMidpoint(source, target);
  const clampAxis = (
    origin: number,
    value: number,
    extent: number,
    max: number,
  ) => {
    const size = Number.isFinite(extent)
      ? Math.max(0, Math.min(max, extent))
      : max;
    const margin = Math.min(14, size / 2);
    const finiteOffset = Number.isFinite(value) ? value : 0;
    return (
      Math.max(margin, Math.min(size - margin, origin + finiteOffset)) - origin
    );
  };
  return {
    x: clampAxis(midpoint.x, offset.x, bounds.width, MAX_CANVAS_W),
    y: clampAxis(midpoint.y, offset.y, bounds.height, MAX_CANVAS_H),
  };
}

/** Route movement uses screen-space deltas so zoom does not change the grab. */
export function edgeOffsetFromPointer(
  source: CanvasPoint,
  target: CanvasPoint,
  origin: CanvasPoint,
  start: ClientPoint,
  current: ClientPoint,
  zoom: number,
  bounds?: CanvasBounds,
  scrollDelta: CanvasPoint = { x: 0, y: 0 },
): CanvasPoint {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return clampEdgeOffset(
    source,
    target,
    {
      x: origin.x + (current.clientX - start.clientX + scrollDelta.x) / scale,
      y: origin.y + (current.clientY - start.clientY + scrollDelta.y) / scale,
    },
    bounds,
  );
}
