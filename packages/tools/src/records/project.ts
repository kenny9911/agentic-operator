/**
 * records.project — copy fields out of the PREVIOUS tool result, verbatim.
 *
 * The runtime hands every tool the prior tool's output as `ctx.lastResult`
 * (step-engine.ts). This tool projects rows out of that value server-side, so
 * identifiers never make the round trip through the model's text.
 *
 * WHY
 * ---
 * On 2026-09-08 the procurement collector read a real purchase requisition
 * whose four lines were 电阻/电阻/电容/电感 (10000008, 10000008, 10000007,
 * 10000009) and reported them as 二极管/电阻/电阻/电阻 — inventing item
 * 10000011, which is not on that requisition at all, and mistyping one line id
 * (…683600 → …683792). Three of the four materials were wrong. The workflow
 * faithfully carried that all the way into a real ERP transfer order, whose
 * three lines came out as the same item. Nothing downstream could have caught
 * it: every value looked plausible.
 *
 * Models paraphrase repeated rows. Copying is the platform's job — same
 * lesson as planning.backwardSchedule for date arithmetic.
 *
 * Fails closed: an unresolvable path, a non-array source, or a row missing a
 * requested key all throw, naming the row and key. A silently short or empty
 * projection would just be the transcription bug wearing a different hat.
 */

import { defineTool } from "@agentic/agent-kit";
import { z } from "zod";

const ROOT_PREFIX = "$root.";

/** `a.b[0].c` → ["a","b","0","c"]. */
function parsePath(path: string): string[] {
  const segments: string[] = [];
  for (const part of path.split(".")) {
    if (part === "") continue;
    const match = /^([^[\]]*)((?:\[\d+\])*)$/.exec(part);
    if (!match) throw new Error(`路径片段 "${part}" 无法解析（支持 a.b[0].c 形式）`);
    if (match[1]) segments.push(match[1]);
    for (const index of match[2]!.matchAll(/\[(\d+)\]/g)) segments.push(index[1]!);
  }
  return segments;
}

function resolvePath(root: unknown, path: string): unknown {
  let current = root;
  for (const segment of parsePath(path)) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export interface ProjectResult {
  rows: Record<string, unknown>[];
  row_count: number;
  source: string;
  /**
   * Mapped fields that were absent on SOME rows and came back null.
   *
   * A column absent on every row is a wrong mapping and still throws. A column
   * absent on only some rows is ordinary data — a draft plan has no approval
   * time — and killing the whole projection over it is what made a live run
   * retry 37 times.
   */
  missing_fields: string[];
}

export function projectRecords(lastResult: unknown, input: unknown): ProjectResult {
  const args = (input ?? {}) as Record<string, unknown>;
  if (lastResult === undefined || lastResult === null) {
    throw new Error(
      "records.project 读的是上一个工具的返回值（ctx.lastResult），本次没有上一个工具结果。" +
        "请紧接在取数调用之后调用它，不要隔轮。",
    );
  }
  // 上一次调用失败时，它的错误信封就是这一次的 lastResult。原来的报错只说「顶层为
  // [error]」，模型看不出该怎么办，于是原样重试了十一次。说清楚下一步做什么。
  if (
    typeof lastResult === "object" &&
    !Array.isArray(lastResult) &&
    Object.keys(lastResult as Record<string, unknown>).length <= 2 &&
    "error" in (lastResult as Record<string, unknown>)
  ) {
    throw new Error(
      "records.project: 上一个工具调用失败了（它的返回值只有 error），没有可投影的数据。" +
        "重试本工具不会有任何变化——请先重新调用对应的 query 操作，在它成功返回之后" +
        "紧接着调用本工具。",
    );
  }

  const sourcePath = typeof args.source === "string" ? args.source.trim() : "";
  const source = sourcePath ? resolvePath(lastResult, sourcePath) : lastResult;
  if (!Array.isArray(source)) {
    const shape =
      source === undefined
        ? "路径不存在"
        : `解析到 ${Array.isArray(source) ? "数组" : typeof source}`;
    const topKeys =
      typeof lastResult === "object" && lastResult !== null && !Array.isArray(lastResult)
        ? Object.keys(lastResult as Record<string, unknown>).join(", ")
        : Array.isArray(lastResult)
          ? "(上一个结果本身是数组)"
          : typeof lastResult;
    throw new Error(
      `records.project: source "${sourcePath || "(整个上一个结果)"}" 不是数组——${shape}。` +
        `上一个结果的顶层为 [${topKeys}]。`,
    );
  }

  const fieldSpec = args.fields;
  if (
    !fieldSpec ||
    typeof fieldSpec !== "object" ||
    Array.isArray(fieldSpec) ||
    Object.keys(fieldSpec).length === 0
  ) {
    throw new Error(
      'records.project: fields 必须是非空对象，形如 {"plan_line_id":"prLineId","material_code":"itemCode"}',
    );
  }

  const hitCount = new Map<string, number>();
  const rows = source.map((row, index) => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new Error(`records.project: 第 ${index} 行不是对象`);
    }
    const record = row as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [target, spec] of Object.entries(fieldSpec as Record<string, unknown>)) {
      if (typeof spec !== "string") {
        throw new Error(`records.project: fields.${target} 必须是字符串（源字段名或 $root. 路径）`);
      }
      // `$root.` reads a header-level value once and stamps it on every row —
      // so a document number is projected too, never retyped.
      if (spec.startsWith(ROOT_PREFIX)) {
        out[target] = resolvePath(lastResult, spec.slice(ROOT_PREFIX.length)) ?? null;
        hitCount.set(target, (hitCount.get(target) ?? 0) + 1);
        continue;
      }
      if (spec in record) {
        out[target] = record[spec];
        hitCount.set(target, (hitCount.get(target) ?? 0) + 1);
      } else {
        out[target] = null;
      }
    }
    return out;
  });

  // A column absent from EVERY row is a wrong mapping — that must still fail
  // closed, or the projection quietly returns a table of nulls. Absent from
  // only some rows is data (a draft plan has no approval time).
  const targets = Object.keys(fieldSpec as Record<string, unknown>);
  const neverHit = targets.filter((target) => (hitCount.get(target) ?? 0) === 0);
  if (neverHit.length > 0) {
    const columns = [
      ...new Set(
        source.flatMap((row) =>
          typeof row === "object" && row !== null ? Object.keys(row as object) : [],
        ),
      ),
    ];
    throw new Error(
      `records.project: 源里没有任何一行带这些字段 ${neverHit
        .map((target) => `"${(fieldSpec as Record<string, string>)[target]}"（映射到 ${target}）`)
        .join("、")}；源的字段为 [${columns.slice(0, 40).join(", ")}]。` +
        `映射名要照返回里出现的写，不要猜。`,
    );
  }
  const missingFields = targets.filter((target) => {
    const hits = hitCount.get(target) ?? 0;
    return hits > 0 && hits < rows.length;
  });

  return {
    rows,
    row_count: rows.length,
    source: sourcePath || "(整个上一个结果)",
    missing_fields: missingFields,
  };
}

export const recordsProject = defineTool({
  name: "records.project",
  description:
    "从上一个工具的返回值里按字段映射逐行原样取值，标识符不经过模型转写。" +
    "fields 形如 {输出字段: 源字段}；值写成 \"$root.路径\" 表示从上一个结果的根部取一个表头值并盖到每一行。",
  output: z.object({
    rows: z.array(z.record(z.string(), z.unknown())),
    row_count: z.number(),
    source: z.string(),
    missing_fields: z.array(z.string()),
  }),
  async handler(ctx) {
    const data = projectRecords(ctx.lastResult, ctx.event?.data);
    return {
      data,
      meta: { deterministic: true, sideEffects: "none", externalCalls: 0 },
    };
  },
});
