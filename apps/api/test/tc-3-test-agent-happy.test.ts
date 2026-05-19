/**
 * TC-3 — testAgent happy path against the mock provider.
 *
 * Invokes the agent, asserts:
 *   - HTTP envelope (ok=true, runId, output, tokens, provider, model)
 *   - DB: runs row exists with status='ok' and agent kind='code'
 *   - DB: steps row exists with provider='mock' and model='mock-model-v1'
 *   - File log: the run's log file contains 'run.start' and 'run.ok'
 */

import path from "node:path";
import fs from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { agents, getDb, runs, steps, tenants } from "@agentic/db";
import { buildTestEnv, type TestEnv } from "./harness";

interface InvokeBody {
  ok: boolean;
  data: {
    runId: string;
    status: string;
    output: string;
    provider: string;
    model: string;
    tokensIn: number | null;
    tokensOut: number | null;
    durationMs: number;
  };
}

describe("TC-3: testAgent happy path", () => {
  let env: TestEnv;
  let runId: string;
  let body: InvokeBody;

  beforeAll(async () => {
    env = await buildTestEnv();
    const res = await env.fetch("/v1/agents/testAgent/invoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    body = (await res.json()) as InvokeBody;
    runId = body.data.runId;
  });

  it("returns ok envelope with required fields", () => {
    expect(body.ok).toBe(true);
    expect(typeof body.data.runId).toBe("string");
    expect(body.data.runId.length).toBeGreaterThan(0);
    expect(body.data.runId.startsWith("run-")).toBe(true);
    expect(body.data.status).toBe("ok");
    expect(typeof body.data.output).toBe("string");
    expect(body.data.output.length).toBeGreaterThan(0);
  });

  it("output mentions 'Agentic Operator' (mock provider embeds prompt noun)", () => {
    expect(body.data.output.toLowerCase()).toContain("agentic operator");
  });

  it("response carries tokensIn/tokensOut/provider/model", () => {
    expect(body.data.tokensIn).toBeGreaterThan(0);
    expect(body.data.tokensOut).toBeGreaterThan(0);
    expect(body.data.provider).toBe("mock");
    expect(body.data.model).toBe("mock-model-v1");
    expect(body.data.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("runs row exists with status='ok' and tenant=__system", () => {
    const db = getDb();
    const runRow = db.select().from(runs).where(eq(runs.id, runId)).all()[0];
    expect(runRow).toBeDefined();
    expect(runRow!.status).toBe("ok");
    expect(runRow!.tokensIn ?? 0).toBeGreaterThan(0);
    expect(runRow!.tokensOut ?? 0).toBeGreaterThan(0);
    expect(runRow!.model).toBe("mock-model-v1");

    const tenantRow = db
      .select()
      .from(tenants)
      .where(eq(tenants.id, runRow!.tenantId))
      .all()[0];
    expect(tenantRow?.slug).toBe("__system");

    const agentRow = db
      .select()
      .from(agents)
      .where(eq(agents.id, runRow!.agentId))
      .all()[0];
    expect(agentRow?.kebabId).toBe("testAgent");
    expect(agentRow?.kind).toBe("code");
  });

  it("steps row carries provider+model+tokens", () => {
    const db = getDb();
    const stepRows = db.select().from(steps).where(eq(steps.runId, runId)).all();
    expect(stepRows.length).toBeGreaterThanOrEqual(1);
    const s = stepRows[0]!;
    expect(s.type).toBe("logic");
    expect(s.status).toBe("ok");
    expect(s.provider).toBe("mock");
    expect(s.model).toBe("mock-model-v1");
    expect(s.tokensIn ?? 0).toBeGreaterThan(0);
    expect(s.tokensOut ?? 0).toBeGreaterThan(0);
    expect(s.inputRef).toBeTruthy();
    expect(s.outputRef).toBeTruthy();
  });

  it("file log contains run.start and run.ok markers", () => {
    const logsDir = process.env.AGENTIC_LOGS_DIR ?? "./logs";
    const today = new Date().toISOString().slice(0, 10);
    const filePath = path.join(logsDir, "__system", "runs", today, `${runId}.log`);
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toContain("run.start");
    expect(content).toContain("run.ok");
  });
});
