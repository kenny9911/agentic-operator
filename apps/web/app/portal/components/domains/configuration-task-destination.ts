import type { OntoCodeConfigurationTask } from "@agentic/contracts";
import { domainPortalPath } from "@/lib/portal-scope";

/** Use the server-owned target; never infer a credential provider from a URL. */
export function configurationTaskDestination(tenant: string, domain: string, task: Pick<OntoCodeConfigurationTask, "id" | "target">): string | null {
  const target = task.target;
  if (target.kind === "environment") return null;
  const query = new URLSearchParams({ configTask: task.id });
  if (target.kind === "tool" || target.kind === "tool_profile") {
    const name = target.kind === "tool_profile" ? target.toolName : target.desiredToolName;
    if (name) query.set("tool", name);
    return `${domainPortalPath(tenant, domain, "tools")}?${query}`;
  }
  query.set("section", target.kind === "llm_gateway" ? "ai" : "integrations");
  return `${domainPortalPath(tenant, domain, "settings")}?${query}`;
}
