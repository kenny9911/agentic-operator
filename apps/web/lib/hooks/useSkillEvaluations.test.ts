import { afterEach, expect, it, vi } from "vitest";
const route = vi.hoisted(() => ({ pathname: "/portal/alpha/skills/skill-a" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("@tanstack/react-query", () => ({
  useInfiniteQuery: (options: unknown) => options,
}));
import { useSkillEvaluations } from "./useSkillEvaluations";
type Options = {
  queryKey: unknown[];
  enabled: boolean;
  queryFn: (ctx: {
    signal: AbortSignal;
    pageParam: number;
  }) => Promise<unknown>;
};
afterEach(() => vi.unstubAllGlobals());
it("keeps deferred evaluation requests and history cache keys bound to the original tenant", async () => {
  route.pathname = "/portal/alpha/skills/same-id";
  const alpha = useSkillEvaluations("same-id") as unknown as Options;
  route.pathname = "/portal/beta/skills/same-id";
  const beta = useSkillEvaluations("same-id") as unknown as Options;
  expect(alpha.queryKey).not.toEqual(beta.queryKey);
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          ok: true,
          data: { evaluations: [], nextOffset: null },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const signal = new AbortController().signal;
  await alpha.queryFn({ signal, pageParam: 20 });
  const [url, init] = (
    fetch.mock.calls as unknown as Array<[string, RequestInit]>
  )[0]!;
  expect(url).toContain("offset=20");
  expect(init.headers).toMatchObject({ "x-agentic-tenant": "alpha" });
  expect(init.signal).toBe(signal);
  route.pathname = "/";
  expect((useSkillEvaluations("same-id") as unknown as Options).enabled).toBe(
    false,
  );
});
