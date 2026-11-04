import { describe, expect, it } from "vitest";
import type { OntoCodeConfigurationTaskTarget } from "@agentic/contracts";
import { configurationTaskDestination } from "./configuration-task-destination";
const id = `ocfg-${"a".repeat(32)}`;
const destination = (target: OntoCodeConfigurationTaskTarget) => configurationTaskDestination("acme", "purchasing", { id, target });

describe("configuration handoff stays in the owning Domain", () => {
  it("opens the exact tool profile with a verification return reference", () => {
    const path = destination({ kind: "tool_profile", toolName: "purchase.submit", environment: "sandbox", profileKey: "acceptance" })!;
    const url = new URL(path, "http://test");
    expect(url.pathname).toBe("/portal/acme/domains/purchasing/tools");
    expect(Object.fromEntries(url.searchParams)).toEqual({ tool: "purchase.submit", configTask: id });
  });
  it("derives the destination from the persisted target and leaves credential provider resolution to settings", () => {
    const path = destination({ kind: "integration", provider: "purchase-api", system: "procurement" })!;
    expect(path).toContain("/portal/acme/domains/purchasing/settings?");
    expect(path).toContain("section=integrations");
    expect(path).not.toContain("purchase-api");
    expect(destination({ kind: "llm_gateway", provider: null })).toContain("section=ai");
  });
  it("does not invent a browser form for deployment environment variables", () => {
    expect(destination({ kind: "environment", provider: null, envRefs: ["PURCHASE_API_KEY"] })).toBeNull();
  });
});
