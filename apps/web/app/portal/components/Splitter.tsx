"use client";

import { useState } from "react";

/**
 * Splitter — thin drag handle for resizing adjacent panels.
 *
 * Ported verbatim from `apps/web/public/portal/views/agent-code.jsx:141-194`
 * (delta D-5/D-6). Maintains pixel-perfect identity with the prototype: a 6px
 * hit area with a 1px line that goes signal-lime on hover/drag.
 *
 * axis:
 *   "x" — column splitter, dragging moves horizontally
 *   "y" — row splitter, dragging moves vertically
 *
 * invert:
 *   when true, drag direction is reversed. Use for a sidebar on the RIGHT
 *   where dragging LEFT should INCREASE the sidebar width.
 */
export interface SplitterProps {
  axis: "x" | "y";
  getValue: () => number;
  setValue: (v: number) => void;
  min: number;
  max: number;
  invert?: boolean;
  /**
   * P2-FE-24 — accessible label for screen readers. Falls back to a
   * generic "panel splitter" when omitted. Provide context for what's
   * being resized (e.g. "Agent list and detail").
   */
  ariaLabel?: string;
}

export function Splitter({
  axis,
  getValue,
  setValue,
  min,
  max,
  invert,
  ariaLabel,
}: SplitterProps) {
  const [hov, setHov] = useState(false);
  const isX = axis === "x";

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const startPos = isX ? e.clientX : e.clientY;
    const start = getValue();
    function move(ev: MouseEvent) {
      const cur = isX ? ev.clientX : ev.clientY;
      const delta = invert ? start - (cur - startPos) : start + (cur - startPos);
      setValue(Math.max(min, Math.min(max, delta)));
    }
    function up() {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }
    document.body.style.userSelect = "none";
    document.body.style.cursor = isX ? "col-resize" : "row-resize";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  // P2-FE-24 — keyboard-resizable splitter. Arrow keys nudge by 16px,
  // Home/End jump to min/max. Lets keyboard-only users resize panels.
  function onKeyDown(e: React.KeyboardEvent) {
    const step = 16;
    const cur = getValue();
    let next = cur;
    if (isX) {
      if (e.key === "ArrowLeft") next = invert ? cur + step : cur - step;
      else if (e.key === "ArrowRight") next = invert ? cur - step : cur + step;
      else if (e.key === "Home") next = min;
      else if (e.key === "End") next = max;
      else return;
    } else {
      if (e.key === "ArrowUp") next = invert ? cur + step : cur - step;
      else if (e.key === "ArrowDown") next = invert ? cur - step : cur + step;
      else if (e.key === "Home") next = min;
      else if (e.key === "End") next = max;
      else return;
    }
    e.preventDefault();
    setValue(Math.max(min, Math.min(max, next)));
  }

  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onKeyDown={onKeyDown}
      tabIndex={0}
      style={{
        flexShrink: 0,
        cursor: isX ? "col-resize" : "row-resize",
        width: isX ? 6 : "100%",
        height: isX ? "100%" : 6,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        position: "relative",
        // The splitter rides above the panels it divides so the 6px hit
        // area receives mouse events even when the adjacent content is a
        // larger z stack. --z-base bumps it to 0 (still beneath overlays).
        zIndex: "var(--z-base)" as unknown as number,
      }}
      role="separator"
      aria-orientation={isX ? "vertical" : "horizontal"}
      aria-label={ariaLabel ?? "panel splitter"}
      aria-valuenow={getValue()}
      aria-valuemin={min}
      aria-valuemax={max}
    >
      <div
        style={{
          width: isX ? 1 : "100%",
          height: isX ? "100%" : 1,
          background: hov ? "var(--signal)" : "var(--border-2)",
          transition: "background 0.12s",
        }}
      />
    </div>
  );
}
