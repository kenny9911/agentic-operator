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
}

export function projectRecords(lastResult: unknown, input: unknown): ProjectResult {
  const args = (input ?? {}) as Record<string, unknown>;
  if (lastResult === undefined || lastResult === null) {
    throw new Error(
      "records.project 读的是上一个工具的返回值（ctx.lastResult），本次没有上一个工具结果。" +
        "请紧接在取数调用之后调用它，不要隔轮。",
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
        continue;
      }
      if (!(spec in record)) {
        throw new Error(
          `records.project: 第 ${index} 行没有字段 "${spec}"（映射到 ${target}）；` +
            `该行的字段为 [${Object.keys(record).slice(0, 40).join(", ")}]`,
        );
      }
      out[target] = record[spec];
    }
    return out;
  });

  return { rows, row_count: rows.length, source: sourcePath || "(整个上一个结果)" };
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
  }),
  async handler(ctx) {
    const data = projectRecords(ctx.lastResult, ctx.event?.data);
    return {
      data,
      meta: { deterministic: true, sideEffects: "none", externalCalls: 0 },
    };
  },
});
