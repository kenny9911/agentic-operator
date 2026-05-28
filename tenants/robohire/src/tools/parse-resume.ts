/**
 * Back-compat shim — the canonical implementation lives in @agentic/tools.
 * Kept so any external code that still imports from this path keeps working
 * through the global-registry migration (2026-05-27). New code should
 * import from `@agentic/tools/robohire` or rely on the global registry
 * lookup in the runtime.
 */
export { parseResumeApi } from "@agentic/tools/robohire";
