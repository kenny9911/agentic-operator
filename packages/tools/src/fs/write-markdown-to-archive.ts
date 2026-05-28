/**
 * fs.writeMarkdownToArchive — persist a markdown document to
 * `data/<subdir>/<tenant>/<id>.md` and return the absolute path.
 *
 * Per-tenant configuration (manifest `tool_use[].config`):
 *   {
 *     subdir?:     string,   // default "archive" → data/archive/<tenant>/
 *     id_prefix?:  string,   // default "doc" → ids look like doc-yyyymmddHHMMSS-xxxxxx
 *     default_title?: string // appended as `# <title>` when no title arg given
 *   }
 *
 * LLM-provided args:
 *   { text: string, title?: string }
 *
 * Common alias used in older tenants: `writeJdToDisk` (subdir="jd-archive",
 * id_prefix="jd"). Registered as such in the global registry for back-compat.
 */

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { defineTool } from "@agentic/agent-kit";
import { z } from "zod";

import { tenantSubdir } from "./_shared";

function timestamp(): string {
  return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

export const writeMarkdownToArchive = defineTool({
  name: "fs.writeMarkdownToArchive",
  description:
    "Persist a markdown body to data/<subdir>/<tenant>/<id>.md. " +
    "REQUIRED: { text: string }. Optional: { title: string }. " +
    "Returns { id, path, bytesWritten }. " +
    "Configure via tool_use[].config: { subdir?, id_prefix?, default_title? }.",
  output: z.object({
    id: z.string(),
    path: z.string(),
    bytesWritten: z.number(),
  }),
  async handler(ctx) {
    const args = (ctx.event?.data ?? {}) as Record<string, unknown>;
    const cfg = (ctx.config ?? {}) as Record<string, unknown>;

    // Accept the canonical `text`/`title` as well as legacy `jd_text`/`jd_title`
    // so the older writeJdToDisk alias keeps working with existing prompts.
    const text =
      (typeof args.text === "string" && args.text) ||
      (typeof args.jd_text === "string" && args.jd_text) ||
      (typeof args.body === "string" && args.body) ||
      "";
    if (!text) {
      throw new Error(
        "fs.writeMarkdownToArchive: required string arg `text` missing or empty.",
      );
    }
    const title =
      (typeof args.title === "string" && args.title) ||
      (typeof args.jd_title === "string" && args.jd_title) ||
      (typeof cfg.default_title === "string" && cfg.default_title) ||
      "(untitled)";

    const subdir =
      typeof cfg.subdir === "string" && cfg.subdir.length > 0
        ? cfg.subdir
        : "archive";
    const idPrefix =
      typeof cfg.id_prefix === "string" && cfg.id_prefix.length > 0
        ? cfg.id_prefix
        : "doc";

    const id = `${idPrefix}-${timestamp()}-${randomBytes(3).toString("hex")}`;
    const root = tenantSubdir(ctx.tenantSlug, subdir);
    fs.mkdirSync(root, { recursive: true });
    const filePath = path.join(root, `${id}.md`);

    const header =
      `<!-- id: ${id} | tenant: ${ctx.tenantSlug} | authored: ${new Date().toISOString()} -->\n` +
      `# ${title}\n\n`;
    const body = header + text.trim() + "\n";
    fs.writeFileSync(filePath, body);

    // Advisory archive log — never block on its failure.
    try {
      fs.appendFileSync(
        path.join(root, "_archive.log"),
        `${new Date().toISOString()}  id=${id}  bytes=${Buffer.byteLength(body, "utf8")}  title=${JSON.stringify(title)}\n`,
      );
    } catch {
      /* ignore */
    }

    return {
      data: {
        id,
        path: filePath,
        bytesWritten: Buffer.byteLength(body, "utf8"),
      },
      meta: { tenant: ctx.tenantSlug, archive: root, subdir },
    };
  },
});
