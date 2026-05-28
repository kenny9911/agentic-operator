/**
 * @agentic/tools/http — generic HTTP clients.
 *
 * Tenants that talk to a vendor REST API typically don't need a
 * bespoke wrapper — `http.fetch` covers the common case. Bind the
 * base URL + auth + allow-lists per tenant via the manifest's
 * `tool_use[].config` block.
 */
export { httpFetchTool } from "./fetch";
