import { afterEach, expect, it, vi } from "vitest";
const route = vi.hoisted(() => ({ pathname: "/portal/alpha/skills" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => options,
  useInfiniteQuery: (options: unknown) => options,
}));
import { useSkill, useSkills, useSkillVersion, skillApi } from "./useSkills";

type Options = {
  queryKey: unknown[];
  enabled: boolean;
  queryFn: (context: {
    signal: AbortSignal;
    pageParam?: number;
  }) => Promise<unknown>;
};
afterEach(() => vi.unstubAllGlobals());
const unavailable = () =>
  new Response(
    JSON.stringify({
      ok: false,
      error: { code: "NOT_FOUND", message: "Unavailable" },
    }),
    { status: 404, headers: { "Content-Type": "application/json" } },
  );

it("binds deferred list and detail reads to their cache tenant after navigation", async () => {
  route.pathname = "/portal/alpha/skills";
  const list = useSkills() as unknown as Options;
  const detail = useSkill("same-id") as unknown as Options;
  route.pathname = "/portal/beta/skills";
  expect((useSkill("same-id") as unknown as Options).queryKey).not.toEqual(
    detail.queryKey,
  );
  const fetch = vi.fn().mockImplementation(async () => unavailable());
  vi.stubGlobal("fetch", fetch);
  const signal = new AbortController().signal;
  await Promise.allSettled([
    list.queryFn({ signal, pageParam: 50 }),
    detail.queryFn({ signal }),
  ]);
  expect(fetch).toHaveBeenCalledTimes(2);
  for (const [, init] of fetch.mock.calls as Array<[string, RequestInit]>) {
    expect(init.headers).toMatchObject({ "x-agentic-tenant": "alpha" });
    expect(init.signal).toBe(signal);
  }
});

it("refreshes an externally changed catalog on focus despite the portal's disabled focus default", async () => {
  const { QueryClient, InfiniteQueryObserver, focusManager } =
    await vi.importActual<typeof import("@tanstack/react-query")>(
      "@tanstack/react-query",
    );
  route.pathname = "/portal/alpha/skills";
  const options = useSkills() as unknown as ConstructorParameters<
    typeof InfiniteQueryObserver
  >[1];
  const summary = (index: number) => ({
    id: `skl-${index}`,
    tenantId: "tnt-system",
    name: `shared-skill-${index}`,
    description: "Shared instructions",
    visibility: "shared",
    latestVersionId: `skv-${index}`,
    latestVersionNo: 1,
    archivedAt: null,
    createdAt: 1,
    updatedAt: 1,
    canEdit: false,
    draftRevision: null,
  });
  const initial = {
    pages: [
      {
        skills: Array.from({ length: 6 }, (_, index) => summary(index)),
        nextOffset: null,
      },
    ],
    pageParams: [0],
  };
  const refreshed = {
    skills: Array.from({ length: 7 }, (_, index) => summary(index)),
    nextOffset: null,
  };
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true, data: refreshed }), {
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetch);
  vi.useFakeTimers();
  const client = new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } },
  });
  client.mount();
  focusManager.setFocused(false);
  client.setQueryData(options.queryKey!, initial);
  const observer = new InfiniteQueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  try {
    await vi.advanceTimersByTimeAsync(10_001);
    expect(fetch).not.toHaveBeenCalled();
    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(observer.getCurrentResult().data).toMatchObject({
      pages: [{ skills: refreshed.skills }],
    });
    expect(fetch.mock.calls[0]![1]).toMatchObject({
      headers: { "x-agentic-tenant": "alpha" },
    });
  } finally {
    unsubscribe();
    client.unmount();
    client.clear();
    focusManager.setFocused(undefined);
    vi.useRealTimers();
  }
});

it("fetches the exact older pin in the binding tenant and keeps version cache keys distinct", async () => {
  route.pathname = "/portal/beta/workflows";
  const query = useSkillVersion(
    "same-id",
    "version-1",
    true,
    "alpha",
  ) as unknown as Options;
  expect(query.queryKey).toContain("alpha");
  expect(query.queryKey).toContain("version-1");
  expect(query.queryKey).not.toEqual(
    (
      useSkillVersion(
        "same-id",
        "version-2",
        true,
        "alpha",
      ) as unknown as Options
    ).queryKey,
  );
  expect(query.queryKey).not.toEqual(
    (
      useSkillVersion(
        "same-id",
        "version-1",
        true,
        "beta",
      ) as unknown as Options
    ).queryKey,
  );
  const version = {
    id: "version-1",
    skillId: "same-id",
    versionNo: 1,
    name: "invoice-check",
    description: "Check invoices",
    contentDigest: "a".repeat(64),
    draftRevision: 1,
    createdAt: 1,
    createdBy: null,
    bundle: {
      files: [{ path: "SKILL.md", content: "instructions", encoding: "utf8" }],
    },
  };
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: version }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  vi.stubGlobal("fetch", fetch);
  const signal = new AbortController().signal;
  expect(await query.queryFn({ signal })).toEqual(version);
  expect(fetch.mock.calls[0]![0]).toBe("/v1/skills/same-id/versions/version-1");
  expect(fetch.mock.calls[0]![1]).toMatchObject({
    signal,
    headers: { "x-agentic-tenant": "alpha" },
  });
  expect(
    (useSkillVersion("same-id", undefined) as unknown as Options).enabled,
  ).toBe(false);
  expect(
    (useSkillVersion("same-id", "version-1", false) as unknown as Options)
      .enabled,
  ).toBe(false);
});

it("keeps generation, revision, and import preview request attribution explicit", async () => {
  const fetch = vi.fn().mockImplementation(async () => unavailable());
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("window", { location: { pathname: "/portal/beta/skills" } });
  const signal = new AbortController().signal;
  await Promise.allSettled([
    skillApi.generate({ purpose: "Check invoices" }, signal, "alpha"),
    skillApi.revise(
      "same-id",
      { purpose: "Check dates", expectedRevision: 3 },
      signal,
      "alpha",
    ),
    skillApi.preview(
      { format: "markdown", content: "instructions" },
      signal,
      "alpha",
    ),
  ]);
  expect(fetch).toHaveBeenCalledTimes(3);
  for (const [, init] of fetch.mock.calls as Array<[string, RequestInit]>)
    expect(init).toMatchObject({
      signal,
      headers: { "x-agentic-tenant": "alpha" },
    });
});
