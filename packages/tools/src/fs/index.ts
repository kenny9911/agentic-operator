/**
 * @agentic/tools/fs — generic filesystem operations.
 *
 * All paths resolve under `data/<subdir>/<tenant>/...`. The `subdir` is
 * configurable per-tenant via the manifest's `tool_use[].config.subdir`;
 * each tool documents its default.
 */

export { readFromInbox } from "./read-from-inbox";
export { writeMarkdownToArchive } from "./write-markdown-to-archive";
export { writeHtmlToArchive } from "./write-html-to-archive";
export { appendToLog } from "./append-to-log";
export { tenantSubdir, resolveDataRoot, findRepoRoot } from "./_shared";
