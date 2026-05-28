/**
 * Back-compat shim — canonical implementation is `fs.readFromInbox` in
 * @agentic/tools. Northwind's older code paths still import this symbol
 * under the `readResumeFromDisk` name; alias it to the new descriptor.
 */
export { readFromInbox as readResumeFromDisk } from "@agentic/tools/fs";
