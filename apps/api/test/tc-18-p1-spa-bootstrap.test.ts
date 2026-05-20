/**
 * TC-18 — Phase 1 SPA bootstrap rewrite (P1-FE-01).
 *
 * Verifies `/api/spa/bootstrap` (the route in apps/web) and the underlying
 * `loadBootstrapFromApi` helper:
 *   1. Fans out to the expected `/v1/*` paths with the forwarded auth headers.
 *   2. Assembles the SpaBootstrap shape from the captured fixtures.
 *   3. No JSON synthesis paths — empty inputs map to empty arrays.
 *
 * The test mocks `globalThis.fetch` so the helper exercises its branching
 * without needing the apps/api process up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadBootstrapFromApi } from "../../web/lib/spa/source-json";

interface FetchCall {
  url: string;
  init: RequestInit;
}

function ok<T>(data: T): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("TC-18: P1-FE-01 SPA bootstrap rewrite", () => {
  const calls: FetchCall[] = [];
  let originalFetch: typeof fetch;

  beforeEach(() => {
    calls.length = 0;
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const FIXTURES = {
    counts: {
      agents: 22,
      runningRuns: 3,
      okRuns24h: 41,
      failedRuns24h: 1,
      events24h: 187,
      openTasks: 6,
      totalRuns: 1842,
    },
    dag: {
      agents: [
        {
          id: "agt-match",
          kebabId: "9-1",
          name: "matchResume",
          title: "Match resume",
          actor: "Agent",
          triggers: ["RESUME_PROCESSED"],
          emits: ["MATCH_PASSED_NEED_INTERVIEW", "MATCH_FAILED"],
          stage: 4,
          recentRunCount: 12,
          isLive: true,
        },
        {
          id: "agt-review",
          kebabId: "5",
          name: "reviewJD",
          title: "Review JD",
          actor: "Human",
          triggers: ["JD_GENERATED"],
          emits: ["JD_APPROVED"],
          stage: 2,
          recentRunCount: 0,
          isLive: false,
        },
      ],
      edges: [],
      workflowVersion: "raas@2026.05.16-a",
    },
    runs: [
      {
        id: "run-01000",
        status: "running",
        agentName: "matchResume",
        agentTitle: "Match resume",
        subject: "CAN-88412",
        triggerEvent: "RESUME_PROCESSED",
        startedAt: "2026-05-19T08:00:00.000Z",
        endedAt: null,
        durationMs: 1820,
        tokensIn: 4128,
        tokensOut: 612,
        model: "claude-sonnet-4-5",
        correlationId: "corr_001",
        errorMessage: null,
        logPath: null,
        currentStepName: "matchHardRequirements",
        currentStepOrd: 2,
        stepCount: 4,
      },
    ],
    events: [
      {
        id: "evt-01000",
        name: "RESUME_PROCESSED",
        subject: "CAN-88412",
        category: "agent",
        color: "green",
        receivedAt: "2026-05-19T07:59:58.000Z",
        sourceAgentName: "processResume",
        sourceAgentTitle: "Process resume",
        payloadRef: null,
      },
    ],
    tasks: [
      {
        id: "TASK-9012",
        type: "jdReview",
        title: "Review JD: …",
        priority: "high",
        status: "open",
        createdAt: "2026-05-19T07:00:00.000Z",
        resolvedAt: null,
        runId: "run-00999",
        awaitingRole: "delivery_manager",
        payloadJson: { foo: "bar" },
        resolutionJson: null,
      },
    ],
    agents: [
      {
        id: "agt-match",
        kebabId: "9-1",
        name: "matchResume",
        title: "Match resume",
        description: "scores a candidate against a JD",
        actor: "Agent",
        kind: "manifest",
        enabled: true,
        runCount: 1842,
        errorCount: 6,
        lastRunAt: "2026-05-19T07:55:00.000Z",
      },
    ],
    eventTypes: [
      { name: "RESUME_PROCESSED", category: "agent", color: "green", description: null },
      { name: "JD_GENERATED", category: "agent", color: "green", description: null },
    ],
    entityTypes: [],
  };

  function installMockFetch() {
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, init: init ?? {} });
      const u = new URL(url);
      const path = u.pathname;
      if (path === "/v1/counts") return ok(FIXTURES.counts);
      if (path === "/v1/runs") return ok(FIXTURES.runs);
      if (path === "/v1/events") return ok(FIXTURES.events);
      if (path === "/v1/tasks") return ok(FIXTURES.tasks);
      if (path === "/v1/agents") return ok(FIXTURES.agents);
      if (path === "/v1/workflows/dag") return ok(FIXTURES.dag);
      if (path === "/v1/event-types") return ok(FIXTURES.eventTypes);
      if (path === "/v1/entity-types") return ok(FIXTURES.entityTypes);
      return new Response(JSON.stringify({ ok: false, error: { code: "not_found", message: path } }), {
        status: 404,
      });
    }) as unknown as typeof fetch;
  }

  it("fans out to exactly the 8 expected /v1/* paths", async () => {
    installMockFetch();
    await loadBootstrapFromApi({ cookie: null, authorization: "Bearer test" });
    const paths = calls
      .map((c) => new URL(c.url).pathname + new URL(c.url).search)
      .sort();
    // /v1/runs and /v1/events carry a `limit` query param; /v1/agents carries kind=all.
    expect(paths).toEqual([
      "/v1/agents?kind=all",
      "/v1/counts",
      "/v1/entity-types",
      "/v1/event-types",
      "/v1/events?limit=140",
      "/v1/runs?limit=100",
      "/v1/tasks",
      "/v1/workflows/dag",
    ]);
  });

  it("forwards the Authorization header on every call", async () => {
    installMockFetch();
    await loadBootstrapFromApi({ cookie: null, authorization: "Bearer test-tok" });
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      const h = (c.init.headers ?? {}) as Record<string, string>;
      expect(h["authorization"]).toBe("Bearer test-tok");
    }
  });

  it("forwards Cookie headers when authorization is absent", async () => {
    installMockFetch();
    await loadBootstrapFromApi({
      cookie: "session=abc123",
      authorization: null,
    });
    for (const c of calls) {
      const h = (c.init.headers ?? {}) as Record<string, string>;
      expect(h["cookie"]).toBe("session=abc123");
    }
  });

  it("returns the expected SpaBootstrap shape with mapped real rows", async () => {
    installMockFetch();
    const payload = await loadBootstrapFromApi({ cookie: null, authorization: "Bearer x" });

    expect(payload.source).toBe("json");
    expect(payload.loadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Agents: from /v1/workflows/dag, hydrated with description from /v1/agents
    expect(payload.agents).toHaveLength(2);
    const match = payload.agents.find((a) => a.name === "matchResume")!;
    expect(match.actor).toBe("Agent");
    expect(match.triggers).toEqual(["RESUME_PROCESSED"]);
    expect(match.emits).toContain("MATCH_PASSED_NEED_INTERVIEW");
    expect(match.description).toBe("scores a candidate against a JD");

    // Events: union of event-types + agent-referenced names. The synthetic
    // MATCH_FAILED appears via the emits side even though /v1/event-types
    // didn't declare it.
    const evNames = payload.events.map((e) => e.name).sort();
    expect(evNames).toContain("MATCH_FAILED");
    expect(evNames).toContain("RESUME_PROCESSED");

    // Runs: must be mapped, not synthesized.
    expect(payload.runs).toHaveLength(1);
    const run = payload.runs[0] as Record<string, unknown>;
    expect(run.id).toBe("run-01000");
    expect(run.agentName).toBe("matchResume");
    // Numeric timestamp (ms-since-epoch), since the SPA renders via `new Date(run.startedAt)`.
    expect(typeof run.startedAt).toBe("number");

    // Event stream: mapped from /v1/events; downstream resolved from DAG.
    expect(payload.eventStream).toHaveLength(1);
    const ev = payload.eventStream[0] as Record<string, unknown>;
    expect(ev.id).toBe("evt-01000");
    // matchResume listens for RESUME_PROCESSED → downstream contains its dag id
    expect(ev.downstream).toEqual(["agt-match"]);

    // Tasks
    expect(payload.tasks).toHaveLength(1);
    const task = payload.tasks[0] as Record<string, unknown>;
    expect(task.id).toBe("TASK-9012");

    // Tenant table: counts.agents propagates into the active tenant slot.
    expect(payload.tenants[0]?.agentCount).toBe(22);
    expect(payload.tenants[0]?.runs24h).toBe(1842);

    // Deployments deferred to /v1/deployments (P1-FE-02 hooks fetch it).
    expect(payload.deployments).toEqual([]);

    // Static seed tables remain.
    expect(payload.stages.length).toBeGreaterThan(0);
    expect(payload.reqs.length).toBeGreaterThan(0);
    expect(payload.candidates.length).toBeGreaterThan(0);
    expect(payload.sampleLog).toContain("run.start");
  });

  it("empty DB → empty arrays (no synthesized rows)", async () => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      const path = new URL(url).pathname;
      if (path === "/v1/counts") {
        return ok({
          agents: 0,
          runningRuns: 0,
          okRuns24h: 0,
          failedRuns24h: 0,
          events24h: 0,
          openTasks: 0,
          totalRuns: 0,
        });
      }
      if (path === "/v1/workflows/dag") {
        return ok({ agents: [], edges: [], workflowVersion: "—" });
      }
      return ok([]);
    }) as unknown as typeof fetch;

    const payload = await loadBootstrapFromApi({ cookie: null, authorization: "Bearer x" });
    expect(payload.agents).toEqual([]);
    expect(payload.events).toEqual([]);
    expect(payload.runs).toEqual([]);
    expect(payload.eventStream).toEqual([]);
    expect(payload.tasks).toEqual([]);
    expect(payload.deployments).toEqual([]);
  });

  it("API failures degrade gracefully (route still serves a payload)", async () => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      const path = new URL(url).pathname;
      // Counts succeeds, everything else 500s
      if (path === "/v1/counts") {
        return ok({
          agents: 0,
          runningRuns: 0,
          okRuns24h: 0,
          failedRuns24h: 0,
          events24h: 0,
          openTasks: 0,
          totalRuns: 0,
        });
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "boom", message: "x" } }), {
        status: 500,
      });
    }) as unknown as typeof fetch;

    const payload = await loadBootstrapFromApi({ cookie: null, authorization: "Bearer x" });
    expect(payload.agents).toEqual([]);
    expect(payload.runs).toEqual([]);
  });
});
