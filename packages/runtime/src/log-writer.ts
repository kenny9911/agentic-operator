/**
 * Per-run log writer — appends structured lines to
 * `logs/<tenant>/runs/<YYYY-MM-DD>/<run-id>.log`.
 *
 * Line format (DESIGN.md §8):
 *   2026-05-16T08:14:02.001Z  INFO   run.start  run_id=run-01000 ...
 *
 * Writes are append-only with O_APPEND so concurrent writers from different
 * steps interleave safely.
 */

import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";

const LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"] as const;
export type LogLevel = (typeof LEVELS)[number];

function logRoot() {
  return process.env.AGENTIC_LOGS_DIR ?? "./logs";
}

function dateDir(at: Date = new Date()): string {
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, "0");
  const d = String(at.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export interface RunLogContext {
  tenantSlug: string;
  runId: string;
  correlationId: string;
}

export function logPathFor(ctx: RunLogContext, at: Date = new Date()): string {
  return path.join(
    logRoot(),
    ctx.tenantSlug,
    "runs",
    dateDir(at),
    `${ctx.runId}.log`,
  );
}

function fmtFields(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
}

export async function writeRunLog(
  ctx: RunLogContext,
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): Promise<void> {
  const ts = new Date().toISOString();
  const allFields = {
    run_id: ctx.runId,
    correlation_id: ctx.correlationId,
    ...fields,
  };
  const line = `${ts}  ${level.padEnd(6)} ${event.padEnd(10)} ${fmtFields(allFields)}\n`;
  const filePath = logPathFor(ctx);
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, line, "utf8");
}
