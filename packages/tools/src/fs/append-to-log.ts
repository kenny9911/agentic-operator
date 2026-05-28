/**
 * fs.appendToLog — append a structured line to a tenant-scoped log file
 * at `data/<subdir>/<tenant>/<filename>`.
 *
 * Per-tenant configuration (manifest `tool_use[].config`):
 *   {
 *     subdir?:   string,   // default "logs" → data/logs/<tenant>/<filename>
 *     filename?: string,   // default "workflow.log"
 *     prefix_ts?: boolean, // default true — prepend ISO timestamp + 2 spaces
 *   }
 *
 * LLM-provided args (one of):
 *   { line: string }   // literal line, written verbatim (with optional ts prefix)
 *   { data: unknown }  // auto-stringified into a `k=v` line built from the
 *                      // object's keys; falls back to JSON.stringify for
 *                      // nested values.
 *
 * The auto-stringify path mirrors what a NDJSON-style log line looks like
 * (`field=value  other=value  body=<json>`), so logs are grep-friendly.
 * If a tool wants raw JSON one-per-line, pass `{ line: JSON.stringify(obj) }`
 * explicitly.
 *
 * Common alias: `writeWorkflowLog` (tenant-test1's original tool name).
 */

import fs from "node:fs";
import path from "node:path";

import { defineTool } from "@agentic/agent-kit";
import { z } from "zod";

import { tenantSubdir } from "./_shared";

function formatKv(data: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v == null) {
      parts.push(`${k}=null`);
    } else if (typeof v === "string") {
      // Bare for short alphanumeric, quoted JSON for anything with whitespace.
      if (/^[a-zA-Z0-9_./:@-]+$/.test(v)) {
        parts.push(`${k}=${v}`);
      } else {
        parts.push(`${k}=${JSON.stringify(v)}`);
      }
    } else if (typeof v === "number" || typeof v === "boolean") {
      parts.push(`${k}=${v}`);
    } else {
      parts.push(`${k}=${JSON.stringify(v)}`);
    }
  }
  return parts.join("  ");
}

export const appendToLog = defineTool({
  name: "fs.appendToLog",
  description:
    "Append a line to data/<subdir>/<tenant>/<filename>. " +
    "Pass { line: string } for raw output OR { data: object } to auto-format as " +
    "`key=value  key=value` (grep-friendly). " +
    "Configure via tool_use[].config: { subdir?, filename?, prefix_ts? }.",
  output: z.object({
    logFile: z.string(),
    bytesAppended: z.number(),
    line: z.string(),
  }),
  async handler(ctx) {
    const args = (ctx.event?.data ?? {}) as Record<string, unknown>;
    const cfg = (ctx.config ?? {}) as Record<string, unknown>;

    const subdir =
      typeof cfg.subdir === "string" && cfg.subdir.length > 0
        ? cfg.subdir
        : "logs";
    const filename =
      typeof cfg.filename === "string" && cfg.filename.length > 0
        ? cfg.filename
        : "workflow.log";
    const prefixTs = cfg.prefix_ts === false ? false : true;

    let body: string;
    if (typeof args.line === "string") {
      body = args.line;
    } else if (args.data && typeof args.data === "object") {
      body = formatKv(args.data as Record<string, unknown>);
    } else if (Object.keys(args).length > 0) {
      // Treat the entire arg object as the auto-format payload — common when
      // a `type: "tool"` manifest action passes the upstream event payload
      // straight through (e.g. tenant-test1's writeWorkflowLog pattern).
      body = formatKv(args);
    } else {
      throw new Error(
        "fs.appendToLog: provide either { line: string } or { data: object } " +
          "(or any non-empty argument object for auto-format).",
      );
    }

    const line = prefixTs ? `${new Date().toISOString()}  ${body}\n` : `${body}\n`;
    const root = tenantSubdir(ctx.tenantSlug, subdir);
    fs.mkdirSync(root, { recursive: true });
    const logFile = path.join(root, filename);
    fs.appendFileSync(logFile, line);

    return {
      data: {
        logFile,
        bytesAppended: Buffer.byteLength(line, "utf8"),
        line: line.trimEnd(),
      },
      meta: { tenant: ctx.tenantSlug, subdir },
    };
  },
});
