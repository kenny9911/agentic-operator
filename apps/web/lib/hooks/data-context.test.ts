/**
 * Smoke tests for `data-context.tsx` exports — guards the Phase 2 light-view
 * port (P2-FE-07 through P2-FE-14) against breaking changes to the
 * narrowed shape of bootstrap data the views consume.
 *
 * If this file's expectations drift you'll silently break dashboard.tsx,
 * runs/[id]/page.tsx, events/page.tsx etc.
 */
import { describe, expect, it } from "vitest";
import type { RaasData, SpaRunShape } from "./data-context";

describe("data-context — type contract", () => {
  it("RaasData has the keys the light views read", () => {
    // Compile-time check: this would fail to parse if RaasData lost any
    // of the keys our views destructure.
    const empty: RaasData = {
      agents: [],
      events: [],
      stages: [],
      reqs: [],
      candidates: [],
      runs: [],
      eventStream: [],
      tasks: [],
      sampleLog: "",
      deployments: [],
      tenants: [],
      loadedAt: null,
      source: "json",
    };
    expect(empty.source).toBe("json");
    expect(Array.isArray(empty.agents)).toBe(true);
    expect(Array.isArray(empty.eventStream)).toBe(true);
    expect(Array.isArray(empty.deployments)).toBe(true);
    expect(Array.isArray(empty.tasks)).toBe(true);
    expect(empty.sampleLog).toBe("");
  });

  it("SpaRunShape carries the fields used by dashboard + runs detail", () => {
    // testRun is the Phase 0 delta D-8 marker; if it ever leaves the shape
    // the TEST badge in dashboard.tsx + runs/page.tsx silently breaks.
    const r: SpaRunShape = {
      id: "run-001",
      agentId: "agt-1",
      agentName: "matchResume",
      status: "running",
      startedAt: 1000,
      testRun: true,
    };
    expect(r.testRun).toBe(true);
    expect(r.status).toBe("running");
  });
});
