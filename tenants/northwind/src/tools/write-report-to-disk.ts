/**
 * Back-compat shim — canonical implementation is `fs.writeHtmlToArchive`
 * in @agentic/tools. Northwind's manifest still references this under
 * the `writeReportToDisk` name; alias it.
 */
export { writeHtmlToArchive as writeReportToDisk } from "@agentic/tools/fs";
