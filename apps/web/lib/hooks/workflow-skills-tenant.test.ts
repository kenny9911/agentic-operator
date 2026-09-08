import { afterEach, expect, it, vi } from "vitest";
const route = vi.hoisted(() => ({ pathname: "/portal/alpha/workflows" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("@tanstack/react-query", async (original) => ({ ...(await original<object>()), useQuery: (options: unknown) => options }));
import { useWorkflowDetail } from "./useWorkflowAuthoring";

type Options = { queryKey: unknown[]; enabled: boolean; queryFn: (ctx: { signal: AbortSignal }) => Promise<unknown> };
const options = () => useWorkflowDetail("same-slug") as unknown as Options;
afterEach(() => vi.unstubAllGlobals());

it("separates workflow envelopes with the same slug across active tenants", () => {
  route.pathname = "/portal/alpha/workflows"; const alpha = options();
  route.pathname = "/portal/beta/workflows"; const beta = options();
  expect(alpha.queryKey).not.toEqual(beta.queryKey);
  expect(alpha.queryKey).toContain("alpha"); expect(beta.queryKey).toContain("beta");
  route.pathname = "/"; expect(options().enabled).toBe(false);
});

it("pins the workflow read header to the query's tenant even after route navigation", async () => {
  route.pathname = "/portal/alpha/workflows";
  const query = options();
  route.pathname = "/portal/beta/workflows";
  const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: {
    id: "wf-alpha", slug: "same-slug", name: "Alpha", description: "", status: "draft", latestVersionId: "v-alpha", latestVersion: "1",
    liveVersionId: null, hasUnpublishedChanges: true, agentCount: 0, createdAt: 1, updatedAt: 1,
    manifest: { $schemaVersion: 2, agents: [], skills: { mode: "disabled" } }, actions: null, versions: [],
  } }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  const signal = new AbortController().signal;
  const result = await query.queryFn({ signal });
  expect(result).toMatchObject({ manifest: { skills: { mode: "disabled" } } });
  const init = (fetch.mock.calls as unknown as Array<[string, RequestInit]>)[0]![1];
  expect(init.headers).toMatchObject({ "x-agentic-tenant": "alpha" });
  expect(init.signal).toBe(signal);
});
