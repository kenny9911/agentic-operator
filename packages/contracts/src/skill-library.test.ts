import { describe, expect, it } from "vitest";
import {
  ManagedSkillSummarySchema,
  SetSkillEnabledBodySchema,
} from "./skill-library";

describe("managed Skill enabled contracts", () => {
  it("defaults legacy management summaries to enabled while preserving an explicit disabled state", () => {
    const summary = {
      id: "skl-1",
      tenantId: "tnt-1",
      name: "review",
      description: "Review citations",
      visibility: "tenant",
      latestVersionId: null,
      latestVersionNo: null,
      archivedAt: null,
      createdAt: 1,
      updatedAt: 1,
      canEdit: true,
      draftRevision: 1,
    };
    expect(ManagedSkillSummarySchema.parse(summary).enabled).toBe(true);
    expect(
      ManagedSkillSummarySchema.parse({ ...summary, enabled: false }).enabled,
    ).toBe(false);
  });

  it("requires the observed state, revision and publication for a strict toggle request", () => {
    const request = {
      enabled: false,
      expectedEnabled: true,
      expectedRevision: 1,
      expectedLatestVersionId: null,
    };
    expect(SetSkillEnabledBodySchema.parse(request)).toEqual(request);
    for (const field of Object.keys(request)) {
      const incomplete: Record<string, unknown> = { ...request };
      delete incomplete[field];
      expect(SetSkillEnabledBodySchema.safeParse(incomplete).success).toBe(
        false,
      );
    }
    expect(
      SetSkillEnabledBodySchema.safeParse({
        ...request,
        tenantId: "another-tenant",
      }).success,
    ).toBe(false);
    expect(
      SetSkillEnabledBodySchema.safeParse({ ...request, enabled: "false" })
        .success,
    ).toBe(false);
  });
});
