/**
 * @agentic/mcp — Model Context Protocol client integration.
 *
 * Tenants declare MCP servers via the `mcpServers` slot on their
 * `TenantRegistry`. The runtime connects each at boot, lists the tools
 * the server advertises, and registers a `defineTool` shim per tool
 * under the qualified name `<serverName>.<toolName>`. Manifest agents
 * reference the shimmed tools the same way they reference native ones
 * — `agent.tool_use[*].name`.
 *
 * Public API:
 *   - `McpServerConfig` / `McpServerConfigSchema` — declarative server spec
 *   - `McpManager` — lifecycle owner; usually accessed via the singleton
 *   - `getMcpManager()` — process-wide singleton
 */

export {
  McpServerConfigSchema,
  type McpServerConfig,
  type McpServerStatus,
} from "./types";

export {
  McpManager,
  getMcpManager,
  __resetMcpManagerForTest,
} from "./manager";
