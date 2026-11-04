import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { tenantHeaderFor } from "./tenant-header";
import { ontocodeRequestHeaders } from "./useOntoCodeWorkspace";
import { queueInvalidate, resetInvalidationQueue } from "./useStream";

afterEach(() => { vi.unstubAllGlobals(); resetInvalidationQueue(); vi.useRealTimers(); });

describe("Domain transport and late stream invalidation", () => {
  it("keeps Domain context for explicit OntoCode and import parent selectors", () => {
    vi.stubGlobal("window", { location: { pathname: "/portal/acme/domains/hiring/ontocode-workspace/session-1" } });
    expect(tenantHeaderFor("acme")).toEqual({ "x-agentic-tenant": "acme", "x-agentic-domain": "hiring" });
    expect(ontocodeRequestHeaders("acme")).toMatchObject({ "x-agentic-tenant": "acme", "x-agentic-domain": "hiring" });
    expect(ontocodeRequestHeaders("acme")).not.toHaveProperty("Content-Type");
    expect(tenantHeaderFor("other")).toEqual({ "x-agentic-tenant": "other" });
  });
  it("does not route newly selected Domain events into the previous Domain cache", () => {
    vi.useFakeTimers();
    const previous = new QueryClient();
    const selected = new QueryClient();
    const previousInvalidate = vi.spyOn(previous, "invalidateQueries");
    const selectedInvalidate = vi.spyOn(selected, "invalidateQueries");
    queueInvalidate(previous, ["runs"]);
    queueInvalidate(selected, ["agents"]);
    vi.advanceTimersByTime(220);
    expect(previousInvalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: ["runs"] });
    expect(selectedInvalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: ["agents"] });
    previous.clear(); selected.clear();
  });
});
