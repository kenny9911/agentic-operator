"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  clampEdgeOffset,
  edgeOffsetFromPointer,
  workflowEdgeMidpoint,
  workflowEdgePath,
  type CanvasBounds,
  type ClientPoint,
} from "./canvas-interactions";
import type { CanvasPoint } from "./layout";
import styles from "./WorkflowEdge.module.css";

export interface WorkflowEdgeProps {
  edgeKey: string;
  eventName: string;
  source: CanvasPoint;
  target: CanvasPoint;
  offset: CanvasPoint;
  color: string;
  markerEnd: string;
  highlighted: boolean;
  opacity: number;
  animate: boolean;
  animationIndex: number;
  zoom: number;
  enabled: boolean;
  ariaLabel: string;
  moveHint: string;
  onSelect: () => void;
  onHover: (hovered: boolean) => void;
  onOffsetChange: (offset: CanvasPoint) => void;
  contextKey: string;
  bounds?: CanvasBounds;
  getScrollPosition?: () => { left: number; top: number };
}

interface EdgeDrag {
  pointerId: number;
  start: ClientPoint;
  origin: CanvasPoint;
  captureTarget: SVGGElement;
  moved: boolean;
  contextKey: string;
  startScroll: { left: number; top: number };
}

/** A routing adjustment changes presentation only; endpoints remain attached. */
export function WorkflowEdge({
  edgeKey,
  eventName,
  source,
  target,
  offset,
  color,
  markerEnd,
  highlighted,
  opacity,
  animate,
  animationIndex,
  zoom,
  enabled,
  ariaLabel,
  moveHint,
  onSelect,
  onHover,
  onOffsetChange,
  contextKey,
  bounds,
  getScrollPosition,
}: WorkflowEdgeProps) {
  const drag = useRef<EdgeDrag | null>(null);
  const suppressClick = useRef(false);
  const [preview, setPreview] = useState<{
    contextKey: string;
    offset: CanvasPoint;
  } | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const currentOffset = clampEdgeOffset(
    source,
    target,
    preview?.contextKey === contextKey ? preview.offset : offset,
    bounds,
  );
  const path = workflowEdgePath(source, target, currentOffset);
  const midpoint = workflowEdgeMidpoint(source, target, currentOffset);
  const isDragging = preview?.contextKey === contextKey;
  const showHandle =
    enabled && (hovered || focused || highlighted || isDragging);

  const releaseDrag = useCallback(() => {
    const current = drag.current;
    // Clear before release: lostpointercapture is also wired to cancellation.
    drag.current = null;
    if (current?.captureTarget.hasPointerCapture(current.pointerId)) {
      current.captureTarget.releasePointerCapture(current.pointerId);
    }
    setPreview(null);
  }, []);

  const cancelDrag = useCallback(() => {
    if (drag.current) suppressClick.current = true;
    releaseDrag();
  }, [releaseDrag]);

  useEffect(() => () => cancelDrag(), [contextKey, enabled, cancelDrag]);

  function offsetAt(event: ReactPointerEvent<SVGGElement>, current: EdgeDrag) {
    const scroll = getScrollPosition?.() ?? current.startScroll;
    return edgeOffsetFromPointer(
      source,
      target,
      current.origin,
      current.start,
      event,
      zoom,
      bounds,
      {
        x: scroll.left - current.startScroll.left,
        y: scroll.top - current.startScroll.top,
      },
    );
  }

  function crossedThreshold(
    event: ReactPointerEvent<SVGGElement>,
    current: EdgeDrag,
  ) {
    return (
      Math.hypot(
        event.clientX - current.start.clientX,
        event.clientY - current.start.clientY,
      ) >= 5
    );
  }

  return (
    <g
      className={styles.edge}
      role="button"
      tabIndex={0}
      aria-label={enabled ? `${ariaLabel}. ${moveHint}` : ariaLabel}
      data-workflow-edge={edgeKey}
      data-edge-event={eventName}
      style={{ touchAction: enabled ? "none" : undefined }}
      onPointerEnter={() => {
        setHovered(true);
        onHover(true);
      }}
      onPointerLeave={() => {
        setHovered(false);
        onHover(focused);
      }}
      onFocus={() => {
        setFocused(true);
        onHover(true);
      }}
      onBlur={() => {
        setFocused(false);
        onHover(hovered);
        cancelDrag();
      }}
      onPointerDown={(event) => {
        if (!enabled || !event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        suppressClick.current = false;
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          pointerId: event.pointerId,
          start: { clientX: event.clientX, clientY: event.clientY },
          origin: currentOffset,
          captureTarget: event.currentTarget,
          moved: false,
          contextKey,
          startScroll: getScrollPosition?.() ?? { left: 0, top: 0 },
        };
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        event.stopPropagation();
        if (current.contextKey !== contextKey || !enabled) {
          cancelDrag();
          return;
        }
        if (!current.moved && !crossedThreshold(event, current)) return;
        current.moved = true;
        setPreview({ contextKey, offset: offsetAt(event, current) });
      }}
      onPointerUp={(event) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        event.stopPropagation();
        if (current.contextKey !== contextKey || !enabled) {
          cancelDrag();
          return;
        }
        const moved = current.moved || crossedThreshold(event, current);
        // Pointerup may be newer than the last pointermove (including touch).
        const nextOffset = moved ? offsetAt(event, current) : null;
        suppressClick.current = moved;
        releaseDrag();
        if (nextOffset) onOffsetChange(nextOffset);
      }}
      onPointerCancel={(event) => {
        if (drag.current?.pointerId === event.pointerId) cancelDrag();
      }}
      onLostPointerCapture={(event) => {
        if (drag.current?.pointerId === event.pointerId) cancelDrag();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        onSelect();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && drag.current) {
          event.preventDefault();
          event.stopPropagation();
          cancelDrag();
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          onSelect();
          return;
        }
        if (!enabled || event.altKey || event.ctrlKey || event.metaKey) return;
        const amount = event.shiftKey ? 24 : 8;
        let nextOffset: CanvasPoint;
        switch (event.key) {
          case "ArrowLeft":
            nextOffset = { x: currentOffset.x - amount, y: currentOffset.y };
            break;
          case "ArrowRight":
            nextOffset = { x: currentOffset.x + amount, y: currentOffset.y };
            break;
          case "ArrowUp":
            nextOffset = { x: currentOffset.x, y: currentOffset.y - amount };
            break;
          case "ArrowDown":
            nextOffset = { x: currentOffset.x, y: currentOffset.y + amount };
            break;
          case "Home":
            nextOffset = { x: 0, y: 0 };
            break;
          default:
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        cancelDrag();
        onOffsetChange(clampEdgeOffset(source, target, nextOffset, bounds));
      }}
    >
      <title>{enabled ? `${eventName} — ${moveHint}` : eventName}</title>
      <path
        className={styles.hitArea}
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        style={{
          cursor: enabled ? (isDragging ? "grabbing" : "grab") : "pointer",
        }}
        aria-hidden="true"
      />
      <path
        className={styles.route}
        d={path}
        stroke={color}
        strokeWidth={highlighted ? 2 : 1.25}
        fill="none"
        opacity={opacity}
        markerEnd={markerEnd}
        aria-hidden="true"
      />
      {showHandle && (
        <circle
          cx={midpoint.x}
          cy={midpoint.y}
          r={14}
          fill="transparent"
          style={{
            pointerEvents: "all",
            cursor: isDragging ? "grabbing" : "grab",
          }}
          aria-hidden="true"
        />
      )}
      <circle
        className={styles.handle}
        data-edge-handle={edgeKey}
        cx={midpoint.x}
        cy={midpoint.y}
        r={6}
        fill="var(--panel)"
        stroke={color}
        strokeWidth={2}
        opacity={showHandle ? 1 : 0}
        aria-hidden="true"
      />
      {animate && (
        <circle
          className={styles.animatedDot}
          r={3}
          fill={color}
          opacity={highlighted ? 1 : 0.85}
          aria-hidden="true"
        >
          <animateMotion
            dur={`${2.5 + (animationIndex % 5) * 0.4}s`}
            repeatCount="indefinite"
            begin={`${(animationIndex * 0.13) % 2}s`}
            path={path}
          />
        </circle>
      )}
    </g>
  );
}
