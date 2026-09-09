/**
 * Workflow canvas layout constants + the hand-tuned LAYOUT map.
 *
 * Ported verbatim from `agentic-operator_v1_1/views/workflows.jsx:5-37`.
 * **DO NOT** replace this with auto-packing for the RAAS workflow — every
 * value here was hand-tuned to match the design prototype (audit 01 §4.2
 * acceptance criterion). The auto-packer below is ONLY consulted as a
 * fallback for tenant kebab-ids that LAYOUT doesn't cover (e.g. robohire's
 * `matcher-agent` / `inviter-agent`); existing LAYOUT entries always win.
 */

export const NODE_W = 184;
/** 76 = the card's measured content budget (see `.nodeTitle` in
 * workflow.module.css): 2px border + 11px padding + 20.7px actor pill row +
 * 3px gap + a two-line 18px title (+1px) = 73.7, or a one-line title plus
 * the 14px kebab-id row = 69.7. 64 clipped the glyphs of every title; 72
 * still shrank two-line English titles by 2px. */
export const NODE_H = 76;
export const COL_W = 220;
/** Keeps the inter-row gap at 28px after the node grew from 64 to 76. */
export const ROW_H = 104;
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

/**
 * Auto-pack a set of agents into the (stage, lane) grid for tenants that
 * don't have a hand-tuned LAYOUT entry. Used as a fallback by `getLayout()`.
 *
 * Strategy — bucket by stage, then assign lanes within each bucket:
 *   1. If every agent shares the same stage (the api uses 99 as the
 *      "unknown stage" sentinel when a manifest doesn't declare staging),
 *      derive stages from the event topology instead: agents with no
 *      incoming triggers from this tenant land at stage 0; downstream
 *      listeners land at stage = 1 + max(stage of upstream emitters).
 *      This gives `matcher-agent → MATCH_COMPLETED → inviter-agent` the
 *      natural left-to-right layout (matcher in col 0, inviter in col 1).
 *   2. Otherwise pass the manifest-declared stage through unchanged so a
 *      tenant that DOES declare stages keeps them.
 *   3. Sort agent ids inside each bucket by string compare so the same
 *      input always produces the same lane assignment (deterministic).
 *
 * Stable: same input array → identical output. The function never mutates
 * input.
 */
export function autoPackLayout(
  agents: Array<{
    id: string;
    stage: number;
    triggers?: string[];
    emits?: string[];
  }>,
): Record<string, { stage: number; lane: number }> {
  if (agents.length === 0) return {};

  // Step 1: decide effective stage per agent.
  //   - Mixed manifest stages → pass through.
  //   - All-same stage (typical: every agent at stage 99) → topo-sort.
  const declared = new Set(agents.map((a) => a.stage));
  const effectiveStage = new Map<string, number>();

  // event → agent ids that emit it. Needed by both the topo-sort below and the
  // lane barycenter at the end, so it is built once here.
  const emitterOf = new Map<string, string[]>();
  for (const a of agents) {
    for (const e of a.emits ?? []) {
      const arr = emitterOf.get(e) ?? [];
      arr.push(a.id);
      emitterOf.set(e, arr);
    }
  }

  if (declared.size === 1) {
    // 分层 = 事件图上的最长路径，但事件图有环：审核 ⇄ 退回整改、组包 ⇄ 合规预警、
    // 计划确认驳回后退回重排。所以先确定性地剥掉回边，再在剩下的 DAG 上求最长路径。
    //
    // 早先的写法是带记忆化的递归 depthOf，撞到正在访问的节点就返回 0。问题在于
    // 这个「环打断值」也被缓存了下来：环里谁先被计算，另一个就永久停在第 0 列。
    // 实测场景二因此把最后一个节点 submitPlanForApproval 排到第 3 列，接近结尾的
    // annotateFrameAndCentralPurchase 排到第 1 列，连线满屏往回跳。
    const childrenOf = new Map<string, string[]>();
    const parentCount = new Map<string, number>();
    for (const a of agents) {
      childrenOf.set(a.id, []);
      parentCount.set(a.id, 0);
    }
    const edges: Array<[string, string]> = [];
    for (const a of agents) {
      for (const t of a.triggers ?? []) {
        for (const parent of emitterOf.get(t) ?? []) {
          if (parent !== a.id) edges.push([parent, a.id]);
        }
      }
    }

    // 回边判定：从根节点（无父节点者）按清单顺序做一次深度优先遍历，指向仍在栈上的
    // 节点的边就是回边。遍历顺序固定，判定结果因而与「谁先被查询」无关。
    const forward = new Map<string, string[]>();
    for (const a of agents) forward.set(a.id, []);
    for (const [from, to] of edges) forward.get(from)!.push(to);
    const parentsById = new Map<string, string[]>();
    for (const a of agents) parentsById.set(a.id, []);
    for (const [from, to] of edges) parentsById.get(to)!.push(from);

    const backEdges = new Set<string>();
    const visited = new Set<string>();
    const onStack = new Set<string>();
    const walk = (id: string): void => {
      visited.add(id);
      onStack.add(id);
      for (const child of forward.get(id) ?? []) {
        if (onStack.has(child)) {
          backEdges.add(`${id}->${child}`);
          continue;
        }
        if (!visited.has(child)) walk(child);
      }
      onStack.delete(id);
    };
    const roots = agents.filter((a) => (parentsById.get(a.id) ?? []).length === 0);
    for (const root of roots) if (!visited.has(root.id)) walk(root.id);
    // 整张图都在环里时没有根节点；按清单顺序补齐，仍然是确定性的。
    for (const a of agents) if (!visited.has(a.id)) walk(a.id);

    for (const [from, to] of edges) {
      if (backEdges.has(`${from}->${to}`)) continue;
      childrenOf.get(from)!.push(to);
      parentCount.set(to, (parentCount.get(to) ?? 0) + 1);
    }

    // 剩下的是 DAG，Kahn 拓扑序上求最长路径：节点列号 = 所有前驱列号最大值 + 1。
    const depth = new Map<string, number>(agents.map((a) => [a.id, 0]));
    const queue = agents.filter((a) => (parentCount.get(a.id) ?? 0) === 0).map((a) => a.id);
    const pending = new Map(parentCount);
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const child of childrenOf.get(id) ?? []) {
        depth.set(child, Math.max(depth.get(child) ?? 0, (depth.get(id) ?? 0) + 1));
        const left = (pending.get(child) ?? 0) - 1;
        pending.set(child, left);
        if (left === 0) queue.push(child);
      }
    }
    for (const a of agents) effectiveStage.set(a.id, depth.get(a.id) ?? 0);
  } else {
    for (const a of agents) effectiveStage.set(a.id, a.stage);
  }

  // Step 2: bucket by stage, sort ids stably, assign lanes.
  const byStage = new Map<number, string[]>();
  for (const a of agents) {
    const s = effectiveStage.get(a.id) ?? 0;
    const arr = byStage.get(s) ?? [];
    arr.push(a.id);
    byStage.set(s, arr);
  }
  // Step 3: lanes. Alphabetical order put siblings wherever their names fell,
  // so a straight chain zig-zagged across rows. Order each column by its
  // parents' rows instead (barycenter): the main line stays on one row and
  // branches settle underneath it. Ties keep the manifest's own order, so the
  // result is still deterministic.
  const parentsOf = new Map<string, string[]>();
  for (const agent of agents) {
    const parents: string[] = [];
    for (const trigger of agent.triggers ?? []) {
      for (const emitter of emitterOf.get(trigger) ?? []) {
        if (emitter !== agent.id) parents.push(emitter);
      }
    }
    parentsOf.set(agent.id, parents);
  }

  const out: Record<string, { stage: number; lane: number }> = {};
  for (const stage of [...byStage.keys()].sort((a, b) => a - b)) {
    const ids = byStage.get(stage)!;
    const barycenter = (id: string): number => {
      // Only parents already placed (a lower column) can pull a row.
      const lanes = (parentsOf.get(id) ?? [])
        .map((parent) => out[parent]?.lane)
        .filter((lane): lane is number => lane !== undefined);
      if (lanes.length === 0) return Number.POSITIVE_INFINITY;
      return lanes.reduce((sum, lane) => sum + lane, 0) / lanes.length;
    };
    // 平局（都没有已放置的父节点，例如第 0 列）仍按 id 字母序——保持既有的确定性
    // 约定；重心排序只影响真正有父节点可参照的那些列，那才是锯齿的来源。
    const sorted = [...ids].sort((a, b) => {
      const diff = barycenter(a) - barycenter(b);
      if (diff !== 0 && Number.isFinite(diff)) return diff;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    sorted.forEach((id, lane) => {
      out[id] = { stage, lane };
    });
  }
  return out;
}

/**
 * Resolve a position for an agent. Hand-tuned LAYOUT entry wins; falls back
 * to the auto-packed map (typically the output of `autoPackLayout` for the
 * current tenant). Returns null when neither has an entry — caller decides
 * whether to skip rendering or render at origin.
 */
export function getLayout(
  id: string,
  fallback?: Record<string, { stage: number; lane: number }>,
): { stage: number; lane: number } | null {
  return LAYOUT[id] ?? fallback?.[id] ?? null;
}

export function nodePos(
  id: string,
  fallback?: Record<string, { stage: number; lane: number }>,
): { x: number; y: number } {
  const p = getLayout(id, fallback);
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

/**
 * Authoring supports at most 100 agents. These caps cover both pathological
 * shapes for that limit (a 100-step chain or 100 agents in one lane) while
 * preventing an imported coordinate such as `Number.MAX_VALUE` from creating
 * an unusably large browser layer.
 */
export const MAX_CANVAS_W = PAD_X * 2 + 101 * COL_W;
export const MAX_CANVAS_H = PAD_Y * 2 + 100 * ROW_H;

export interface CanvasPoint {
  x: number;
  y: number;
}

export function clampCanvasPosition(position: CanvasPoint): CanvasPoint {
  const x = Number.isFinite(position.x) ? position.x : 0;
  const y = Number.isFinite(position.y) ? position.y : 0;
  return {
    x: Math.max(0, Math.min(MAX_CANVAS_W - NODE_W, x)),
    y: Math.max(0, Math.min(MAX_CANVAS_H - NODE_H, y)),
  };
}

/**
 * Grow the canvas to contain every node plus one padding gutter. The legacy
 * canvas remains the minimum so existing RAAS screenshots do not move.
 */
export function dynamicCanvasSize(positions: Iterable<CanvasPoint>): {
  width: number;
  height: number;
} {
  let width = CANVAS_W;
  let height = CANVAS_H;
  for (const raw of positions) {
    const position = clampCanvasPosition(raw);
    width = Math.max(width, position.x + NODE_W + PAD_X);
    height = Math.max(height, position.y + NODE_H + PAD_Y);
  }
  return {
    width: Math.min(MAX_CANVAS_W, Math.ceil(width)),
    height: Math.min(MAX_CANVAS_H, Math.ceil(height)),
  };
}
