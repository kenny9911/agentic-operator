/**
 * TC-24 — P2-FE-18 test-run flag wired through invoke → run row → SSE.
 *
 * `POST /v1/agents/testAgent/invoke?testRun=1` must:
 *   1. Return `ok=true` with `data.testRun === true` in the envelope.
 *   2. Persist `runs.is_test = 1` (Drizzle boolean true) for the created run.
 *   3. Surface `testRun=true` on the broadcast `run.started` event so SSE
 *      subscribers can paint the TEST badge immediately, without a
 *      follow-up `GET /v1/runs/:id` roundtrip.
 *   4. Surface `testRun=true` on `GET /v1/runs/:id` so cold-loaded views
 *      (e.g. deep-link into a run detail page) also see the badge.
 *
 * Also asserts the negative — `POST .../invoke` with no flag persists
 * `is_test = 0` and broadcasts `testRun=false`. Catches both the
 * default-off branch and the contract-default behavior.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, runs } from "@agentic/db";
import {
  publishStreamEvent,
  subscribeStreamEvents,
  __broadcastResetForTest,
} from "@agentic/runtime";
import type { RunStreamEvent } from "@agentic/contracts";
import { buildTestEnv, type TestEnv } from "./harness";

interface InvokeEnvelope {
  ok: boolean;
  data: {
    runId: string;
    status: string;
    output?: string;
    testRun?: boolean;
  };
}

interface RunDetailEnvelope {
  ok: boolean;
  data: {
    run: { id: string; status: string; testRun: boolean; error: string | null; emittedEvent: string | null };
    steps: unknown[];
  };
}

describe("TC-24: P2-FE-18 testRun flag wiring", () => {
  let env: TestEnv;
  // Accumulator for events received on the broadcast channel during the
  // happy-path test. Sized by the time we read it because publishStream
  // delivers synchronously.
  const received: RunStreamEvent[] = [];

  beforeAll(async () => {
    env = await buildTestEnv();
    __broadcastResetForTest();
    // Subscribe to the __system channel — testAgent runs there because
    // it's registered via the system-scoped agents path.
    const db = getDb();
    const sys = db
      .select()
      .from(runs) // type-only import won't help; query tenants instead below
      .limit(0)
      .all();
    void sys; // silence unused-var
    // We can't easily resolve the __system tenant id without an extra
    // query; just listen on every tenant and filter when we assert.
    const tenantRow = await import("@agentic/db").then(async (m) => {
      const r = m
        .getDb()
        .select()
        .from(m.tenants)
        .where(eq(m.tenants.slug, "__system"))
        .all()[0];
      return r;
    });
    if (!tenantRow) throw new Error("__system tenant missing — bootstrap broken");
    subscribeStreamEvents(tenantRow.id, (e) => received.push(e));
  });

  afterAll(() => {
    __broadcastResetForTest();
  });

  describe("?testRun=1 (positive path)", () => {
    let runId: string;
    let body: InvokeEnvelope;

    beforeAll(async () => {
      // Quiet the listener before issuing the invoke so we don't pick up
      // any noise from prior describes.
      received.length = 0;
      const res = await env.fetch("/v1/agents/testAgent/invoke?testRun=1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      body = (await res.json()) as InvokeEnvelope;
      runId = body.data.runId;
    });

    it("response envelope carries testRun=true", () => {
      expect(body.ok).toBe(true);
      expect(body.data.testRun).toBe(true);
      expect(body.data.runId.startsWith("run-")).toBe(true);
    });

    it("runs.is_test is persisted true for this row", () => {
      const row = getDb().select().from(runs).where(eq(runs.id, runId)).all()[0];
      expect(row).toBeDefined();
      // SQLite stores booleans as 0/1; Drizzle decodes to boolean via the
      // schema column mode. Either is acceptable as long as the truthy
      // semantics hold.
      expect(row!.isTest).toBe(true);
    });

    it("SSE run.started event carries testRun=true", () => {
      // publishStreamEvent fires synchronously, so by the time the
      // invoke promise resolves the broadcast has already happened.
      // Locate the run.started event for our run id (other events may
      // have hit the channel from sibling test setup).
      const started = received.find(
        (e) => e.type === "run.started" && e.runId === runId,
      );
      expect(started).toBeDefined();
      expect(started?.type).toBe("run.started");
      if (started?.type === "run.started") {
        expect(started.testRun).toBe(true);
        expect(started.agentName).toBe("testAgent");
      }
    });

    it("GET /v1/runs/:id surfaces testRun=true", async () => {
      // testAgent runs under __system; the runs route gates that with an
      // explicit ?include_system=1 flag and a platform-admin marker (the
      // marker is currently a no-op, so the route 404s). For this test
      // we point the dev tenant at __system (vitest setup does this
      // already) so the same lookup works without the flag.
      const res = await env.fetch(`/v1/runs/${runId}`);
      expect(res.status).toBe(200);
      const j = (await res.json()) as RunDetailEnvelope;
      expect(j.ok).toBe(true);
      expect(j.data.run.id).toBe(runId);
      expect(j.data.run.testRun).toBe(true);
      // P2-FE-18 contract additions surface as well.
      expect(j.data.run).toHaveProperty("error");
      expect(j.data.run).toHaveProperty("emittedEvent");
    });
  });

  describe("no flag (negative path)", () => {
    let runId: string;

    beforeAll(async () => {
      received.length = 0;
      const res = await env.fetch("/v1/agents/testAgent/invoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as InvokeEnvelope;
      runId = body.data.runId;
      // Default omitted (or false) — both are acceptable.
      expect(body.data.testRun ?? false).toBe(false);
    });

    it("runs.is_test is false for this row", () => {
      const row = getDb().select().from(runs).where(eq(runs.id, runId)).all()[0];
      expect(row).toBeDefined();
      expect(row!.isTest).toBe(false);
    });

    it("SSE run.started event carries testRun=false", () => {
      const started = received.find(
        (e) => e.type === "run.started" && e.runId === runId,
      );
      expect(started).toBeDefined();
      if (started?.type === "run.started") {
        // Zod default makes this `false` even if the publisher omits it,
        // but our publisher does emit it explicitly. Either way: not true.
        expect(started.testRun ?? false).toBe(false);
      }
    });
  });

  describe("publish/subscribe contract still parses RunStreamEvent", () => {
    it("publishing a synthetic run.started with testRun=true round-trips through the schema", async () => {
      const { RunStreamEvent: Schema } = await import("@agentic/contracts");
      const sample = {
        type: "run.started" as const,
        tenantId: "ten-x",
        at: Date.now(),
        runId: "run-synth",
        agentName: "demoAgent",
        triggerEvent: null,
        subject: null,
        correlationId: "cor-1",
        testRun: true,
      };
      const parsed = Schema.parse(sample);
      expect(parsed.type).toBe("run.started");
      if (parsed.type === "run.started") {
        expect(parsed.testRun).toBe(true);
      }
      // Round-trip via publish/subscribe.
      __broadcastResetForTest();
      const captured: RunStreamEvent[] = [];
      subscribeStreamEvents("ten-x", (e) => captured.push(e));
      publishStreamEvent(sample);
      expect(captured).toHaveLength(1);
      if (captured[0]?.type === "run.started") {
        expect(captured[0].testRun).toBe(true);
      }
    });
  });
});
