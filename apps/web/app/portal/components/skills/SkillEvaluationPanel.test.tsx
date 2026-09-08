import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SkillDetail, SkillEvaluation } from "@agentic/contracts";
import {
  skillEvaluationEn,
  skillEvaluationZh,
} from "@/lib/i18n/skill-evaluation";
import {
  SkillEvaluationPanel,
  SkillEvaluationResult,
} from "./SkillEvaluationPanel";
const state = vi.hoisted(() => ({
  language: "en",
  writable: true,
  records: [] as SkillEvaluation[],
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/app/portal/lib/preferences-context", () => ({
  useI18n: () => ({ language: state.language, t: (key: string) => key }),
}));
vi.mock("@/app/portal/lib/use-tenant", () => ({ useTenant: () => "alpha" }));
vi.mock("@/lib/hooks/useMe", () => ({ useCan: () => () => state.writable }));
vi.mock("@/lib/hooks/useSkillEvaluations", () => ({
  useSkillEvaluations: () => ({
    data: { pages: [{ evaluations: state.records }] },
    refetch: vi.fn(),
  }),
  skillEvaluationApi: {},
  skillEvaluationKeys: { list: () => [] },
}));
vi.mock("./SkillModelPicker", () => ({
  SkillModelPicker: () => (
    <label>
      Model
      <select>
        <option>Configured route</option>
      </select>
    </label>
  ),
}));
const detail: SkillDetail = {
  skill: {
    id: "skl-a",
    tenantId: "tnt-a",
    name: "review",
    description: "Review",
    visibility: "tenant",
    latestVersionId: null,
    latestVersionNo: null,
    archivedAt: null,
    createdAt: 1,
    updatedAt: 1,
    canEdit: true,
    draftRevision: 3,
  },
  draft: {
    revision: 3,
    bundle: {
      files: [{ path: "SKILL.md", encoding: "utf8", content: "instructions" }],
    },
    diagnostics: [],
    provenance: null,
    updatedAt: 1,
    updatedBy: "usr-a",
    creatorNotes: {
      generatedRevision: 2,
      evaluationStatus: "unexecuted",
      assumptions: [],
      changeSummary: [],
      suggestedTests: [
        {
          id: "citation-check",
          prompt: "Review",
          shouldTrigger: true,
          expectedCriteria: ["Cites sources"],
        },
      ],
    },
  },
  latestVersion: null,
  versions: [],
};
const record: SkillEvaluation = {
  id: "ske-a",
  skillId: "skl-a",
  status: "completed",
  createdAt: 1,
  completedAt: 2,
  createdBy: "usr-a",
  source: {
    kind: "draft",
    skillId: "skl-a",
    name: "review",
    contentDigest: "a".repeat(64),
    draftRevision: 3,
    versionId: null,
  },
  prompt: "Review claims",
  expectations: ["Cites sources"],
  requestedRoute: null,
  requestDigest: "b".repeat(64),
  baseline: {
    status: "completed",
    provider: "deepseek",
    model: "served-model",
    text: '<script>alert("source")</script>',
    tokensIn: null,
    tokensOut: 0,
    latencyMs: 1,
    providerRequestId: null,
    effectiveRoute: null,
    finishReason: "stop",
    error: null,
  },
  withSkill: null,
  error: null,
  grade: null,
  limitations: [],
};
beforeEach(() => {
  state.language = "en";
  state.writable = true;
  state.records = [];
});
describe("Skill comparison review panel", () => {
  it("shows saved-revision guidance and selectable unexecuted suggestions without invented outcomes", () => {
    const html = renderToStaticMarkup(
      <SkillEvaluationPanel detail={detail} disabled />,
    );
    expect(html).toContain("citation-check");
    expect(html).toContain("Draft revision 3");
    expect(html).toContain("Save your edits");
    expect(html).toContain("No business tools");
    expect(html).toContain("No comparisons yet");
    expect(html).not.toContain("Human review: pass");
  });
  it("renders model text safely and separates completed observations from human pass/fail", () => {
    const html = renderToStaticMarkup(
      <SkillEvaluationResult
        record={record}
        writable
        disabled={false}
        onSaved={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('<script>alert("source")</script>');
    expect(html).toContain("Not reviewed");
    expect(html).not.toContain("Human review: pass");
    expect(html).toContain("Input tokens: Not reported");
    expect(html).toContain("Output tokens: 0");
    expect(html).toContain('value="" selected=""');
  });
  it("disables grading for failed comparisons and read-only reviewers", () => {
    const failed = renderToStaticMarkup(
      <SkillEvaluationResult
        record={{ ...record, status: "failed" }}
        writable
        disabled={false}
        onSaved={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(failed).not.toContain("Save human review");
    const reviewed = renderToStaticMarkup(
      <SkillEvaluationResult
        record={{
          ...record,
          grade: {
            revision: 1,
            verdict: "fail",
            comment: "Missed sources",
            actorId: "usr-a",
            gradedAt: 3,
          },
        }}
        writable={false}
        disabled={false}
        onSaved={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(reviewed).toContain("Human review: fail");
    expect(reviewed).toContain("Missed sources");
    expect(reviewed).not.toContain("Save human review");
  });
  it("keeps English and Chinese copy complete and renders Chinese review labels", () => {
    expect(Object.keys(skillEvaluationEn).sort()).toEqual(
      Object.keys(skillEvaluationZh).sort(),
    );
    state.language = "zh";
    const html = renderToStaticMarkup(
      <SkillEvaluationResult
        record={record}
        writable
        disabled={false}
        onSaved={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(html).toContain("尚未评审");
    expect(html).toContain("保存人工评审");
  });
});
