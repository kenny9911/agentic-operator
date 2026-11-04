import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { clearPortalQueryCaches, PortalQueryCache } from "./portal-query-cache";

const owners: PortalQueryCache[] = [];
function createCache(limit?: number) {
  const cache = new PortalQueryCache(limit);
  owners.push(cache);
  return cache;
}

afterEach(() => {
  for (const cache of owners.splice(0)) cache.clear();
  vi.useRealTimers();
});

describe("portal tenant query caches", () => {
  it("reuses fresh results when returning to a tenant", async () => {
    const cache = createCache();
    const first = cache.get("alpha");
    cache.activate("alpha");
    const queryFn = vi.fn(async () => ["alpha-run"]);
    await first.fetchQuery({ queryKey: ["runs"], queryFn });
    cache.activate("beta");
    cache.activate("alpha");
    expect(cache.get("alpha")).toBe(first);
    expect(await cache.get("alpha").fetchQuery({ queryKey: ["runs"], queryFn }))
      .toEqual(["alpha-run"]);
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it("isolates legacy identical query keys between tenants and portal instances", () => {
    const cache = createCache();
    cache.get("alpha").setQueryData(["runs"], ["alpha-run"]);
    expect(cache.get("beta").getQueryData(["runs"])).toBeUndefined();
    cache.get("beta").setQueryData(["runs"], ["beta-run"]);
    expect(cache.get("alpha").getQueryData(["runs"])).toEqual(["alpha-run"]);
    expect(createCache().get("alpha").getQueryData(["runs"])).toBeUndefined();
    cache.get("alpha/domains/sales").setQueryData(["runs"], ["sales-run"]);
    expect(cache.get("alpha/domains/support").getQueryData(["runs"])).toBeUndefined();
  });

  it("evicts the least recently activated tenant after a committed switch", () => {
    const cache = createCache(2);
    const alpha = cache.get("alpha");
    alpha.setQueryData(["runs"], ["alpha-run"]);
    cache.activate("alpha");
    const beta = cache.get("beta");
    beta.setQueryData(["runs"], ["beta-run"]);
    cache.activate("beta");
    cache.activate("alpha");
    cache.get("gamma");
    // Rendering a new route must not clear data while the old route is visible.
    expect(beta.getQueryData(["runs"])).toEqual(["beta-run"]);
    cache.activate("gamma");
    expect(beta.getQueryData(["runs"])).toBeUndefined();
    expect(cache.get("alpha")).toBe(alpha);
    expect(cache.get("beta")).not.toBe(beta);
  });

  it("cancels requests and pending retries when their tenant becomes inactive", async () => {
    vi.useFakeTimers();
    const cache = createCache();
    const alpha = cache.get("alpha");
    cache.activate("alpha");
    const abort = vi.fn();
    const pending = alpha.fetchQuery({
      queryKey: ["pending"],
      queryFn: ({ signal }) => new Promise(() => signal.addEventListener("abort", abort)),
    }).catch((error: unknown) => error);
    const retryFn = vi.fn(async () => { throw new Error("offline"); });
    const retry = alpha.fetchQuery({
      queryKey: ["retry"], queryFn: retryFn, retry: 3, retryDelay: 10,
    }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    cache.activate("beta");
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all([pending, retry]);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(retryFn).toHaveBeenCalledTimes(1);
  });

  it("logout clears every retained tenant, including mutation state", () => {
    const cache = createCache();
    const alpha = cache.get("alpha");
    const beta = cache.get("beta");
    alpha.setQueryData(["runs"], ["alpha-run"]);
    beta.setQueryData(["runs"], ["beta-run"]);
    beta.getMutationCache().build(beta, { mutationKey: ["private-draft"] });
    clearPortalQueryCaches(alpha);
    for (const client of [alpha, beta]) {
      expect(client.getQueryCache().getAll()).toEqual([]);
      expect(client.getMutationCache().getAll()).toEqual([]);
    }
    // Stable identities also make development StrictMode cleanup/replay safe.
    expect(cache.get("alpha")).toBe(alpha);
  });

  it("logout from an evicted client still clears the mounted portal", () => {
    const cache = createCache(1);
    const alpha = cache.get("alpha");
    cache.activate("alpha");
    cache.activate("beta");
    cache.get("beta").setQueryData(["runs"], ["beta-run"]);
    clearPortalQueryCaches(alpha);
    expect(cache.get("beta").getQueryData(["runs"])).toBeUndefined();
  });

  it("clears clients used outside PortalProviders as well", () => {
    const client = new QueryClient();
    client.setQueryData(["me"], { name: "private" });
    clearPortalQueryCaches(client);
    expect(client.getQueryCache().getAll()).toEqual([]);
  });
});
