/**
 * Back-compat shim — canonical implementation is `fs.writeHtmlToArchive`
 * in @agentic/tools. The InsightLab manifest still references this under
 * the `writeBriefToDisk` name; alias it.
 *
 * Behavioural note: the new tool defaults to subdir="reports" / id_prefix="report".
 * To preserve the original on-disk layout (`data/briefs/<tenant>/brief-*.html`),
 * the InsightLab manifest binds:
 *   "config": { "subdir": "briefs", "id_prefix": "brief", "lang": "en" }
 */
export { writeHtmlToArchive as writeBriefToDisk } from "@agentic/tools/fs";
