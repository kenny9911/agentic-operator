/**
 * Back-compat shim — canonical implementation is `fs.appendToLog` in
 * @agentic/tools. tenant-test1's manifest references this under the
 * `writeWorkflowLog` name; alias it.
 *
 * The manifest binds `config: { subdir: "logs", filename: "workflow-test1.log" }`
 * to preserve the original on-disk path. The new tool's auto-format mode
 * (any non-empty arg object → grep-friendly `key=value` line) matches the
 * original tool's behaviour for the same payload shape.
 */
export { appendToLog as writeWorkflowLog } from "@agentic/tools/fs";
