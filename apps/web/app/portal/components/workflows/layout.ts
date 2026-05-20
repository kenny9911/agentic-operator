/**
 * Workflow canvas layout constants + the hand-tuned LAYOUT map.
 *
 * Ported verbatim from `agentic-operator_v1_1/views/workflows.jsx:5-37`.
 * **DO NOT** replace this with auto-packing — every value here was hand-tuned
 * to match the design prototype (audit 01 §4.2 acceptance criterion).
 */

export const NODE_W = 184;
export const NODE_H = 64;
export const COL_W = 220;
export const ROW_H = 90;
export const PAD_X = 30;
export const PAD_Y = 30;

/**
 * Maps node kebab-id → (stage column, lane row). Every node in the RAAS
 * workflow has an explicit position.
 */
export const LAYOUT: Record<string, { stage: number; lane: number }> = {
  "1-1": { stage: 0, lane: 0 },
  "1-2": { stage: 0, lane: 1 },
  "2": { stage: 1, lane: 0 },
  "3": { stage: 1, lane: 1 },
  "3-2": { stage: 1, lane: 2 },
  "4": { stage: 2, lane: 0 },
  "5": { stage: 2, lane: 1 },
  "6": { stage: 3, lane: 0 },
  "7-1": { stage: 3, lane: 1 },
  "7-2": { stage: 3, lane: 2 },
  "8": { stage: 4, lane: 0 },
  "9-1": { stage: 4, lane: 1 },
  "9-2": { stage: 4, lane: 2 },
  "10-1": { stage: 5, lane: 0 },
  "10-2": { stage: 5, lane: 1 },
  "11-1": { stage: 5, lane: 2 },
  "11-2": { stage: 5, lane: 3 },
  "12": { stage: 5, lane: 4 },
  "13": { stage: 6, lane: 0 },
  "14-1": { stage: 6, lane: 1 },
  "14-2": { stage: 6, lane: 2 },
  "15": { stage: 6, lane: 3 },
  "16": { stage: 7, lane: 1 },
};

export function nodePos(id: string): { x: number; y: number } {
  const p = LAYOUT[id];
  if (!p) return { x: 0, y: 0 };
  return {
    x: PAD_X + p.stage * COL_W,
    y: PAD_Y + p.lane * ROW_H,
  };
}

export function colorVar(c: string | undefined | null): string {
  const map: Record<string, string> = {
    green: "var(--green)",
    blue: "var(--blue)",
    amber: "var(--amber)",
    red: "var(--red)",
    muted: "var(--text-3)",
  };
  return map[c ?? ""] ?? "var(--text-3)";
}

/** Maximum stage/lane in the LAYOUT map — drives canvas size. */
export const MAX_STAGE = 7;
export const MAX_LANE = 4;

export const CANVAS_W = PAD_X * 2 + (MAX_STAGE + 1) * COL_W;
export const CANVAS_H = PAD_Y * 2 + (MAX_LANE + 1) * ROW_H;
