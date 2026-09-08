import { afterEach, expect, it, vi } from "vitest";
import type { SkillBundle, SkillDetail } from "@agentic/contracts";
import { submitSkillCreateRequest } from "./create-request";

const bundle: SkillBundle = {
  files: [
    {
      path: "SKILL.md",
      encoding: "utf8",
      content:
        "---\nname: invoice-check\ndescription: Check invoices.\n---\nPreserve identifiers.\n",
    },
  ],
};
const saved: SkillDetail = {
  skill: {
    id: "skl-new",
    tenantId: "tenant-alpha",
    name: "invoice-check",
    description: "Check invoices.",
    visibility: "tenant",
    latestVersionId: null,
    latestVersionNo: null,
    archivedAt: null,
    createdAt: 1,
    updatedAt: 1,
    canEdit: true,
    draftRevision: 1,
  },
  draft: {
    revision: 1,
    bundle,
    diagnostics: [],
    creatorNotes: null,
    provenance: null,
    updatedAt: 1,
    updatedBy: "user",
  },
  latestVersion: null,
  versions: [],
};
function request() {
  return {
    tenant: "alpha",
    mode: "import" as const,
    purpose: "Check invoices.",
    name: "invoice-check",
    examples: "",
    modelRoute: "",
    visibility: "tenant" as const,
    bundle,
  };
}
const response = (data: unknown) =>
  new Response(JSON.stringify({ ok: true, data }), {
    headers: { "Content-Type": "application/json" },
  });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => vi.unstubAllGlobals());

it("keeps validation and import in the starting tenant when navigation changes between requests", async () => {
  const validation = deferred<Response>();
  const fetch = vi
    .fn()
    .mockReturnValueOnce(validation.promise)
    .mockResolvedValueOnce(response(saved));
  vi.stubGlobal("fetch", fetch);
  const window = { location: { pathname: "/portal/alpha/skills" } };
  vi.stubGlobal("window", window);
  const input = request();
  const onValidation = vi.fn();
  const operation = submitSkillCreateRequest(
    input,
    new AbortController().signal,
    onValidation,
  );
  window.location.pathname = "/portal/beta/skills";
  input.tenant = "beta";
  validation.resolve(response({ valid: true, diagnostics: [] }));
  expect(await operation).toEqual(saved);
  expect(fetch).toHaveBeenCalledTimes(2);
  for (const [, init] of fetch.mock.calls as Array<[string, RequestInit]>)
    expect(init.headers).toMatchObject({ "x-agentic-tenant": "alpha" });
  expect(fetch.mock.calls[1]![0]).toBe("/v1/skills/import");
  expect(fetch.mock.calls[1]![1].signal).toBeUndefined();
  expect(onValidation).toHaveBeenCalledWith({ bundle, diagnostics: [] });
});

it("does not import or update validation after the dialog closes during validation", async () => {
  const validation = deferred<Response>();
  const fetch = vi.fn().mockReturnValueOnce(validation.promise);
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController(),
    onValidation = vi.fn();
  const operation = submitSkillCreateRequest(
    request(),
    controller.signal,
    onValidation,
  );
  controller.abort();
  validation.resolve(response({ valid: true, diagnostics: [] }));
  expect(await operation).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]![1].signal).toBe(controller.signal);
  expect(onValidation).not.toHaveBeenCalled();
});

it.each(["import", "blank"] as const)(
  "allows an atomic %s commit to finish but does not return a stale result to the closed dialog",
  async (mode) => {
    const commit = deferred<Response>(),
      started = deferred<void>();
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/validate"))
        return response({ valid: true, diagnostics: [] });
      started.resolve();
      return commit.promise;
    });
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const operation = submitSkillCreateRequest(
      { ...request(), mode },
      controller.signal,
      () => {},
    );
    await started.promise;
    controller.abort();
    commit.resolve(response(saved));
    expect(await operation).toBeNull();
    const init = (
      fetch.mock.calls as unknown as Array<[string, RequestInit]>
    ).at(-1)![1];
    expect(init.signal).toBeUndefined();
    expect(init.headers).toMatchObject({ "x-agentic-tenant": "alpha" });
  },
);

it("preserves invalid drafts for review and makes no commit", async () => {
  const diagnostics = [
    {
      severity: "error",
      code: "FRONTMATTER_INVALID",
      message: "Missing description",
      path: "SKILL.md",
    },
  ];
  const fetch = vi
    .fn()
    .mockResolvedValue(response({ valid: false, diagnostics }));
  vi.stubGlobal("fetch", fetch);
  const validation = vi.fn();
  expect(
    await submitSkillCreateRequest(
      request(),
      new AbortController().signal,
      validation,
    ),
  ).toBeNull();
  expect(validation).toHaveBeenCalledWith({ bundle, diagnostics });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("propagates real import failure instead of completing or recreating the Skill", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response({ valid: true, diagnostics: [] }))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "SKILL_NAME_CONFLICT",
            message: "That name already exists",
          },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
  vi.stubGlobal("fetch", fetch);
  await expect(
    submitSkillCreateRequest(request(), new AbortController().signal, () => {}),
  ).rejects.toMatchObject({ status: 409, code: "SKILL_NAME_CONFLICT" });
  expect(fetch).toHaveBeenCalledTimes(2);
});
