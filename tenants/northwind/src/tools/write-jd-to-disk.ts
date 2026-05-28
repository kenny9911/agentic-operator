/**
 * Back-compat shim — canonical implementation is `fs.writeMarkdownToArchive`
 * in @agentic/tools. The Northwind manifest still references this under
 * the `writeJdToDisk` name; alias it.
 *
 * Behavioural note: the new tool reads `subdir`/`id_prefix` from
 * `ctx.config` (manifest's tool_use[].config). If none provided, defaults
 * are "archive" / "doc" — DIFFERENT from the original "jd-archive"/"jd".
 * Northwind's existing manifest will need to set:
 *   "config": { "subdir": "jd-archive", "id_prefix": "jd" }
 * to preserve the legacy on-disk layout. The migration of the manifest
 * happens in models/northwind-v1/workflow_v1.json (see Phase E commit).
 */
export { writeMarkdownToArchive as writeJdToDisk } from "@agentic/tools/fs";
