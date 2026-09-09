/**
 * planning.backwardSchedule — deterministic backward scheduling.
 *
 * Given a required arrival date and the per-node standard cycle days,
 * derive each node's planned finish date:
 *
 *   planned_finish(k) = required_arrival_date − Σ standard_cycle_days(j), j > k
 *
 * so the LAST node's planned finish IS the required arrival date, and every
 * earlier node is the arrival date minus the cycles of everything after it
 * (its own cycle excluded).
 *
 * WHY THIS IS A TOOL AND NOT PROMPT TEXT
 * --------------------------------------
 * This arithmetic used to live in an agent's output contract as a formula
 * plus a worked numeric example. On 2026-09-08 a live procurement run copied
 * six of the example's seven dates verbatim and substituted only the last
 * one, producing a schedule where 订单 (2026-09-21) finished AFTER 到货
 * (2026-09-10) — while still asserting the forward/backward cross-check had
 * passed. The deviation came out as "3 days early" and the whole alert branch
 * was skipped. A model that is shown a concrete answer will reach for it.
 * Date math is pure arithmetic; it belongs in code, and the contract now says
 * to copy this tool's output rather than derive anything.
 *
 * Fail-closed by design: a missing cycle row, a non-contiguous sequence, or a
 * business type with no configuration all throw. "Cannot compute" must never
 * be silently indistinguishable from "computed, no deviation".
 */

import { defineTool } from "@agentic/agent-kit";
import { z } from "zod";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function parseDate(value: unknown, label: string): number {
  const text = typeof value === "string" ? value.trim() : "";
  const match = DATE_RE.exec(text);
  if (!match) {
    throw new Error(
      `${label} 必须是 YYYY-MM-DD 格式的日期字符串，收到 ${JSON.stringify(value)}`,
    );
  }
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (formatDate(ms) !== text) {
    throw new Error(`${label} 不是有效的日历日期：${text}`);
  }
  return ms;
}

/** ERP config rows come back SCREAMING_CASE; hand-built rows come back
 * snake_case. Accept both rather than making the caller transliterate — a
 * transliteration step is another place for a model to invent values. */
function pick(row: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

const NODE_KEYS = ["stage_node", "STAGE_NODE", "stageNode"] as const;
const SEQUENCE_KEYS = ["stage_sequence", "STAGE_SEQUENCE", "stageSequence"] as const;
const CYCLE_KEYS = [
  "standard_cycle_days",
  "STANDARD_CYCLE_DAYS",
  "standardCycleDays",
  "cycle_days",
  "CYCLE_DAYS",
] as const;
const BUSINESS_TYPE_KEYS = ["business_type", "BUSINESS_TYPE", "businessType"] as const;

function toInteger(value: unknown, label: string): number {
  const numeric = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric) || !Number.isInteger(numeric)) {
    throw new Error(`${label} 必须是整数，收到 ${JSON.stringify(value)}`);
  }
  return numeric;
}

export interface BackwardScheduleStage {
  stage_node: string;
  stage_sequence: number;
  standard_cycle_days: number;
  planned_finish_date: string;
  planned_date_derived: true;
}

export interface BackwardScheduleResult {
  required_arrival_date: string;
  business_type: string | null;
  /** false when the rows carried no business type at all, i.e. the caller had
   * already filtered them and this tool matched nothing on its own. */
  business_type_filtered: boolean;
  stage_count: number;
  total_cycle_days: number;
  earliest_start_date: string;
  planned_dates: BackwardScheduleStage[];
  /**
   * Set when the caller passed `reference_date` (the scan's business date):
   * `slack_days` = earliest_start_date − reference_date. Negative means the
   * chain cannot fit — it should already have started. `time_conflict` is
   * that same comparison as a boolean so the caller copies rather than judges.
   */
  reference_date: string | null;
  slack_days: number | null;
  time_conflict: boolean | null;
}

export function computeBackwardSchedule(input: unknown): BackwardScheduleResult {
  const args = (input ?? {}) as Record<string, unknown>;
  const arrivalMs = parseDate(
    pick(args, ["required_arrival_date", "REQUIRED_ARRIVAL_DATE", "requiredArrivalDate"]),
    "required_arrival_date",
  );

  const rawStages = pick(args, ["stages", "stage_cycle_standard", "cycles", "rows"]);
  if (!Array.isArray(rawStages) || rawStages.length === 0) {
    throw new Error(
      "stages 必须是非空数组，每行至少包含 stage_node / stage_sequence / standard_cycle_days（大小写不限）",
    );
  }

  const wantedBusinessType = pick(args, BUSINESS_TYPE_KEYS);
  const businessType =
    typeof wantedBusinessType === "string" && wantedBusinessType.trim() !== ""
      ? wantedBusinessType.trim()
      : null;

  const rows = rawStages.filter(
    (row): row is Record<string, unknown> => typeof row === "object" && row !== null,
  );
  if (rows.length !== rawStages.length) {
    throw new Error("stages 里存在非对象元素");
  }

  // Filtering here rather than in the prompt is deliberate: when the requested
  // business type has no configuration the caller gets the list of types that
  // DO exist, instead of quietly falling back to whichever rows looked close.
  //
  // A caller that already filtered — every row carries no business type at all —
  // is a different case from "this type has no config", and rejecting it wastes
  // a tool-loop iteration on a retry that is not actually a correction. The
  // near-match hazard only exists when OTHER types are present to be mistaken
  // for this one, so accept pre-filtered rows and report that in the result.
  const available = [
    ...new Set(
      rows
        .map((row) => pick(row, BUSINESS_TYPE_KEYS))
        .filter((value): value is string => typeof value === "string"),
    ),
  ].sort();
  const preFiltered = businessType != null && available.length === 0;
  const selected =
    businessType && !preFiltered
      ? rows.filter((row) => pick(row, BUSINESS_TYPE_KEYS) === businessType)
      : rows;
  if (selected.length === 0) {
    throw new Error(
      `业务类型「${businessType}」在周期配置中没有任何行；配置里现有的业务类型为 ${available
        .map((t) => `「${t}」`)
        .join("、")}。请补配置或用真实存在的业务类型重试，不要改用近似的一档。`,
    );
  }

  const stages = selected.map((row, index) => {
    const node = pick(row, NODE_KEYS);
    if (typeof node !== "string" || node.trim() === "") {
      throw new Error(`stages[${index}] 缺少 stage_node`);
    }
    const sequence = toInteger(pick(row, SEQUENCE_KEYS), `stages[${index}].stage_sequence`);
    if (sequence < 1) {
      throw new Error(`stages[${index}].stage_sequence 必须 ≥ 1，收到 ${sequence}`);
    }
    const cycleDays = toInteger(
      pick(row, CYCLE_KEYS),
      `stages[${index}].standard_cycle_days（节点「${node.trim()}」）`,
    );
    if (cycleDays < 0) {
      throw new Error(
        `节点「${node.trim()}」的 standard_cycle_days 为负数（${cycleDays}），周期天数不能为负`,
      );
    }
    return { stage_node: node.trim(), stage_sequence: sequence, standard_cycle_days: cycleDays };
  });

  stages.sort((a, b) => a.stage_sequence - b.stage_sequence);
  stages.forEach((stage, index) => {
    if (stage.stage_sequence !== index + 1) {
      throw new Error(
        `stage_sequence 必须是从 1 开始且不重不漏的连续序号；实际拿到 [${stages
          .map((s) => s.stage_sequence)
          .join(", ")}]`,
      );
    }
  });

  // Suffix sums: planned_finish(k) subtracts the cycles of every node AFTER k,
  // never its own — the last node lands exactly on the arrival date.
  const planned: BackwardScheduleStage[] = new Array(stages.length);
  let daysAfter = 0;
  for (let index = stages.length - 1; index >= 0; index -= 1) {
    const stage = stages[index]!;
    planned[index] = {
      ...stage,
      planned_finish_date: formatDate(arrivalMs - daysAfter * DAY_MS),
      planned_date_derived: true,
    };
    daysAfter += stage.standard_cycle_days;
  }

  const totalCycleDays = stages.reduce((sum, stage) => sum + stage.standard_cycle_days, 0);
  const earliestStartMs = arrivalMs - totalCycleDays * DAY_MS;

  // 「工期够不够」在提示词里曾是「当前日期 + 总周期 − 需求到货日 > 0」这样一句让
  // 模型自己算的话。给了参考日期就在这里算完，模型只负责照抄结论。
  const referenceRaw = pick(args, ["reference_date", "scan_date", "REFERENCE_DATE"]);
  const referenceMs =
    referenceRaw === undefined || referenceRaw === null || referenceRaw === ""
      ? null
      : parseDate(referenceRaw, "reference_date");
  const slackDays =
    referenceMs === null ? null : Math.round((earliestStartMs - referenceMs) / DAY_MS);

  return {
    required_arrival_date: formatDate(arrivalMs),
    business_type: businessType,
    business_type_filtered: businessType != null && !preFiltered,
    stage_count: planned.length,
    total_cycle_days: totalCycleDays,
    earliest_start_date: formatDate(earliestStartMs),
    planned_dates: planned,
    reference_date: referenceMs === null ? null : formatDate(referenceMs),
    slack_days: slackDays,
    time_conflict: slackDays === null ? null : slackDays < 0,
  };
}

export const backwardScheduleOutputSchema = z.object({
  required_arrival_date: z.string(),
  business_type: z.string().nullable(),
  business_type_filtered: z.boolean(),
  stage_count: z.number(),
  total_cycle_days: z.number(),
  earliest_start_date: z.string(),
  reference_date: z.string().nullable(),
  slack_days: z.number().nullable(),
  time_conflict: z.boolean().nullable(),
  planned_dates: z.array(
    z.object({
      stage_node: z.string(),
      stage_sequence: z.number(),
      standard_cycle_days: z.number(),
      planned_finish_date: z.string(),
      planned_date_derived: z.literal(true),
    }),
  ),
});

export const planningBackwardSchedule = defineTool({
  name: "planning.backwardSchedule",
  description:
    "按需求到货日期与各节点标准周期倒排出每个节点的计划完成时间。纯计算、不访问外部系统。" +
    "最后一个节点的计划完成时间等于需求到货日期；其余节点 = 需求到货日期 − 其后所有节点周期之和（不含自身周期）。",
  output: backwardScheduleOutputSchema,
  async handler(ctx) {
    const data = computeBackwardSchedule(ctx.event?.data);
    return {
      data,
      meta: {
        deterministic: true,
        sideEffects: "none",
        externalCalls: 0,
        formula: "planned_finish(k) = required_arrival_date − Σ standard_cycle_days(j>k)",
      },
    };
  },
});
