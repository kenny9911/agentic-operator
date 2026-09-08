import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SkillBindingsSchema,
  type SkillDetail,
  type ManagedSkillSummary,
} from "@agentic/contracts";
import { PreferencesProvider } from "@/app/portal/lib/preferences-context";
import { SkillBindingsEditor } from "./SkillBindingsEditor";
import { ApiResponseError } from "@/lib/api-response";

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  details: {} as Record<string, unknown>,
  pins: {} as Record<
    string,
    { data?: unknown; isError?: boolean; error?: unknown }
  >,
  error: false,
}));
vi.mock("@/lib/hooks/useSkills", () => ({
  useSkills: () => ({
    data: { pages: [{ skills: state.rows }] },
    isLoading: false,
    isError: state.error,
    hasNextPage: false,
  }),
  useSkill: (id: string) => ({
    data: state.details[id],
    isLoading: false,
    isError: !state.details[id],
  }),
  useSkillVersion: (_id: string, versionId: string) => ({
    ...state.pins[versionId],
    refetch: vi.fn(),
  }),
}));

function skill(
  id: string,
  extra: Partial<ManagedSkillSummary> = {},
): ManagedSkillSummary {
  return {
    id,
    tenantId: "tenant",
    name: id,
    description: `Use ${id}.`,
    visibility: "tenant",
    latestVersionId: `v-${id}`,
    latestVersionNo: 1,
    archivedAt: null,
    createdAt: 1,
    updatedAt: 1,
    canEdit: true,
    draftRevision: 1,
    ...extra,
  };
}
function detail(summary: ManagedSkillSummary): SkillDetail {
  return {
    skill: summary,
    draft: null,
    latestVersion: null,
    versions: [
      {
        id: `v-${summary.id}`,
        skillId: summary.id,
        versionNo: 1,
        name: summary.name,
        description: summary.description,
        contentDigest: "a".repeat(64),
        draftRevision: 1,
        createdAt: 1,
        createdBy: null,
      },
    ],
  };
}
function render(value?: unknown, disabled = false) {
  return renderToStaticMarkup(
    <PreferencesProvider>
      <SkillBindingsEditor
        tenant="tenant"
        scope="agent"
        value={value}
        disabled={disabled}
        onChange={() => {}}
      />
    </PreferencesProvider>,
  );
}

beforeEach(() => {
  state.rows = [];
  state.details = {};
  state.pins = {};
  state.error = false;
});

describe("Skill assignment controls", () => {
  it("defaults to inheritance and links to tenant-scoped help without granting tools", () => {
    const html = render();
    expect(html).toContain('value="inherit" selected=""');
    expect(html).toContain("/portal/tenant/skills/help");
    expect(html).toContain("They do not grant business tools");
  });

  it("offers only published active Skills, including shared sources", () => {
    state.rows = [
      skill("own"),
      skill("shared", { visibility: "shared" }),
      skill("draft", { latestVersionId: null }),
      skill("archived", { archivedAt: 4 }),
    ];
    const html = render({ mode: "selected", skills: [] });
    expect(html).toContain('value="own"');
    expect(html).toContain('value="shared"');
    expect(html).not.toContain('value="draft"');
    expect(html).not.toContain('value="archived"');
    expect(html).toContain("Shared library");
  });

  it("keeps missing, archived, and unavailable pinned assignments visible with recovery actions", () => {
    state.details = {
      old: detail(skill("old", { archivedAt: 3 })),
      valid: detail(skill("valid")),
    };
    state.pins.gone = {
      isError: true,
      error: new ApiResponseError(
        "/version/gone",
        404,
        "NOT_FOUND",
        "Missing version",
      ),
    };
    const html = render({
      mode: "selected",
      skills: [
        { id: "missing" },
        { id: "old" },
        { id: "valid", versionId: "gone", activate: true },
      ],
    });
    expect(html).toContain("Skill unavailable");
    expect(html).toContain("This Skill is archived");
    expect(html).toContain("Pinned version unavailable");
    expect(html).toContain('value="gone" selected=""');
    expect(html).toContain('aria-label="Remove missing"');
    expect(html).toContain('checked=""');
  });

  it("preserves dormant selections in valid inherit/disabled configurations", () => {
    const selections = [{ id: "one", versionId: "old", activate: true }];
    for (const mode of ["inherit", "disabled"] as const) {
      expect(
        SkillBindingsSchema.parse({ mode, skills: selections }).skills,
      ).toEqual(selections);
      expect(render({ mode, skills: selections })).toContain(
        "Stored selections are preserved",
      );
    }
  });

  it("shows malformed bindings and library failures rather than silently clearing them", () => {
    expect(
      render({ mode: "selected", skills: [{ id: "one" }, { id: "one" }] }),
    ).toContain("stored Skill bindings are invalid");
    state.error = true;
    expect(render({ mode: "selected", skills: [{ id: "one" }] })).toContain(
      "Existing assignments are preserved",
    );
  });

  it("renders read-only controls as disabled", () => {
    state.details = { own: detail(skill("own")) };
    const html = render({ mode: "selected", skills: [{ id: "own" }] }, true);
    expect(html).toContain('disabled=""');
    expect(html).not.toContain("Find a published Skill");
  });

  it("resolves an older immutable pin outside the 100 recent summaries without declaring it unavailable", () => {
    const data = detail(skill("long-history", { latestVersionNo: 101 }));
    data.versions = Array.from({ length: 100 }, (_, index) => ({
      ...data.versions[0]!,
      id: `version-${101 - index}`,
      versionNo: 101 - index,
    }));
    state.details["long-history"] = data;
    state.pins["version-1"] = {
      data: {
        ...data.versions[0]!,
        id: "version-1",
        versionNo: 1,
        bundle: { files: [] },
      },
    };
    const html = render({
      mode: "selected",
      skills: [{ id: "long-history", versionId: "version-1" }],
    });
    expect(html).toContain('value="version-1" selected="">Version 1</option>');
    expect(html).not.toContain("Pinned version unavailable");
    expect(html).not.toContain("Unavailable version");
  });

  it("preserves an unresolved pin while loading or retrying a transport error", () => {
    state.details.valid = detail(skill("valid"));
    const binding = {
      mode: "selected",
      skills: [{ id: "valid", versionId: "older" }],
    };
    const loading = render(binding);
    expect(loading).toContain('value="older" selected=""');
    expect(loading).toContain("Loading Skills");
    expect(loading).not.toContain("Pinned version unavailable");
    state.pins.older = {
      isError: true,
      error: new Error("Network unavailable"),
    };
    const failed = render(binding);
    expect(failed).toContain("Existing assignments are preserved");
    expect(failed).toContain("Try again");
    expect(failed).not.toContain("Pinned version unavailable");
  });
});
