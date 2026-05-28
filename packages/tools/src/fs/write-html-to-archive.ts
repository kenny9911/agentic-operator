/**
 * fs.writeHtmlToArchive — persist an HTML document to
 * `data/<subdir>/<tenant>/<id>.html` and return the absolute path.
 *
 * Per-tenant configuration (manifest `tool_use[].config`):
 *   {
 *     subdir?:     string,   // default "reports" → data/reports/<tenant>/
 *     id_prefix?:  string,   // default "report"
 *     lang?:       string,   // default "zh-CN" — used in the auto-wrap <html lang>
 *   }
 *
 * LLM-provided args:
 *   { html: string, title?: string }
 *
 * If the supplied `html` doesn't start with `<!DOCTYPE`, the tool wraps it
 * in a minimal document shell so the file still renders in a browser. This
 * is a guardrail, not enforcement — the LLM is free to send a complete
 * doctyped document and the wrap is skipped.
 *
 * Common alias: `writeReportToDisk`. Registered as such in the global
 * registry for back-compat.
 */

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { defineTool } from "@agentic/agent-kit";
import { z } from "zod";

import { tenantSubdir, escapeHtml } from "./_shared";

function timestamp(): string {
  return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

export const writeHtmlToArchive = defineTool({
  name: "fs.writeHtmlToArchive",
  description:
    "Persist an HTML document to data/<subdir>/<tenant>/<id>.html. " +
    "REQUIRED: { html: string }. Optional: { title: string }. " +
    "Returns { id, path, bytesWritten }. " +
    "Configure via tool_use[].config: { subdir?, id_prefix?, lang? }.",
  output: z.object({
    id: z.string(),
    path: z.string(),
    bytesWritten: z.number(),
  }),
  async handler(ctx) {
    const args = (ctx.event?.data ?? {}) as Record<string, unknown>;
    const cfg = (ctx.config ?? {}) as Record<string, unknown>;

    const html =
      (typeof args.html === "string" && args.html) ||
      (typeof args.body === "string" && args.body) ||
      (typeof args.report === "string" && args.report) ||
      "";
    if (!html) {
      throw new Error(
        "fs.writeHtmlToArchive: required string arg `html` missing or empty.",
      );
    }
    const title =
      (typeof args.title === "string" && args.title) ||
      (typeof args.report_title === "string" && args.report_title) ||
      (typeof cfg.default_title === "string" && cfg.default_title) ||
      "Report";

    const subdir =
      typeof cfg.subdir === "string" && cfg.subdir.length > 0
        ? cfg.subdir
        : "reports";
    const idPrefix =
      typeof cfg.id_prefix === "string" && cfg.id_prefix.length > 0
        ? cfg.id_prefix
        : "report";
    const lang =
      typeof cfg.lang === "string" && cfg.lang.length > 0 ? cfg.lang : "zh-CN";

    const id = `${idPrefix}-${timestamp()}-${randomBytes(3).toString("hex")}`;
    const root = tenantSubdir(ctx.tenantSlug, subdir);
    fs.mkdirSync(root, { recursive: true });
    const filePath = path.join(root, `${id}.html`);

    const wrapped = html.trim().startsWith("<!DOCTYPE")
      ? html
      : `<!DOCTYPE html>\n<html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>\n${html}\n</body></html>\n`;
    fs.writeFileSync(filePath, wrapped);

    try {
      fs.appendFileSync(
        path.join(root, "_archive.log"),
        `${new Date().toISOString()}  id=${id}  bytes=${Buffer.byteLength(wrapped, "utf8")}  title=${JSON.stringify(title)}\n`,
      );
    } catch {
      /* ignore */
    }

    return {
      data: {
        id,
        path: filePath,
        bytesWritten: Buffer.byteLength(wrapped, "utf8"),
      },
      meta: { tenant: ctx.tenantSlug, archive: root, subdir },
    };
  },
});
