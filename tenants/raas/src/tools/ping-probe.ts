/**
 * Back-compat shim — canonical implementation is `meta.ping` in
 * @agentic/tools. The RAAS manifest references this tool under the
 * action name `monitorAndFetchRequirement`; that name is registered
 * as a global alias for `meta.ping`, so the manifest keeps working
 * without further changes.
 *
 * Kept here so any external code that still imports `pingProbe` from
 * @tenants/raas resolves to the same descriptor.
 */
export { ping as pingProbe } from "@agentic/tools/meta";
