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
