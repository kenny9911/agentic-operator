/**
 * GET /v1/runs/executions — agent runs rolled up into the unit the operator
 * watched. The runs list is per-agent: one procurement chain is fifteen rows
 * and no amount of scrolling it answers "how did that execution go".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, getDb, runs, tenants, workflows } from "@agentic/db";
import { eq } from "drizzle-orm";
import { makeId } from "@agentic/shared";
import { listRunExecutions } from "../src/queries/runs";

const slug = `exec-${Date.now().toString(36)}`;
let tenantId = "";
let agentIds: Record<string, string> = {};

function addRun(args: {
  agent: string;
  subject: string | null;
  status: string;
  queuedAt: number;
  endedAt?: number | null;
  deleted?: boolean;
}) {
  getDb()
    .insert(runs)
    .values({
      id: makeId("run"),
      tenantId,
      agentId: agentIds[args.agent]!,
      status: args.status as never,
      subject: args.subject,
      correlationId: makeId("cor"),
      queuedAt: new Date(args.queuedAt),
      startedAt: new Date(args.queuedAt),
      endedAt: args.endedAt == null ? null : new Date(args.endedAt),
      ...(args.deleted ? { deletedAt: new Date(args.queuedAt) } : {}),
    } as never)
    .run();
}

beforeAll(async () => {
  const db = getDb();
  tenantId = makeId("ten");
  db.insert(tenants).values({ id: tenantId, slug, name: slug } as never).run();
  const workflowId = makeId("wf");
  db.insert(workflows)
    .values({ id: workflowId, tenantId, slug: "w", name: "w" } as never)
    .run();
  for (const name of ["collect", "calculate", "alert"]) {
    const id = makeId("agt");
    agentIds[name] = id;
    db.insert(agents)
      .values({
        id,
        workflowId,
        tenantId,
        kebabId: name,
        name,
        actor: "Agent",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never)
      .run();
  }

  const base = Date.parse("2026-09-08T10:00:00Z");
  // WFT-A: three agents, finished clean.
  addRun({ agent: "collect", subject: "WFT-A", status: "ok", queuedAt: base, endedAt: base + 1_000 });
  addRun({ agent: "calculate", subject: "WFT-A", status: "ok", queuedAt: base + 2_000, endedAt: base + 3_000 });
  addRun({ agent: "alert", subject: "WFT-A", status: "ok", queuedAt: base + 4_000, endedAt: base + 5_000 });
  // WFT-B: newer, still waiting on a human — and one failed sibling.
  addRun({ agent: "collect", subject: "WFT-B", status: "failed", queuedAt: base + 10_000, endedAt: base + 11_000 });
  addRun({ agent: "calculate", subject: "WFT-B", status: "waiting", queuedAt: base + 12_000, endedAt: null });
  // Not an execution: no subject. And a tombstoned row that must not count.
  addRun({ agent: "collect", subject: null, status: "ok", queuedAt: base + 20_000, endedAt: base + 21_000 });
  addRun({ agent: "alert", subject: "WFT-A", status: "ok", queuedAt: base + 30_000, endedAt: base + 31_000, deleted: true });
});

afterAll(() => {
  const db = getDb();
  db.delete(runs).where(eq(runs.tenantId, tenantId)).run();
  db.delete(agents).where(eq(agents.tenantId, tenantId)).run();
  db.delete(workflows).where(eq(workflows.tenantId, tenantId)).run();
  db.delete(tenants).where(eq(tenants.id, tenantId)).run();
});

describe("listRunExecutions", () => {
  it("groups agent runs into executions, newest activity first", async () => {
    const { rows, total } = await listRunExecutions(slug);
    expect(total).toBe(2);
    expect(rows.map((row) => row.subject)).toEqual(["WFT-B", "WFT-A"]);

    const a = rows.find((row) => row.subject === "WFT-A")!;
    // The soft-deleted fourth row must not inflate the count — the recycle bin
    // is not part of the execution.
    expect(a.runCount).toBe(3);
    expect(a.agentCount).toBe(3);
    expect(a.status).toBe("ok");
    expect(a.firstAgentName).toBe("collect");
    expect(a.lastAgentName).toBe("alert");
  });

  it("never lets the rollup read healthier than its worst part", async () => {
    const { rows } = await listRunExecutions(slug);
    const b = rows.find((row) => row.subject === "WFT-B")!;
    // A human gate outranks the failed sibling; both outrank the ok ones.
    expect(b.status).toBe("waiting");
    expect(b.failedCount).toBe(1);
    expect(b.waitingCount).toBe(1);
  });

  it("leaves subject-less ad-hoc runs out — they are not executions", async () => {
    const { rows } = await listRunExecutions(slug);
    expect(rows.every((row) => row.subject.startsWith("WFT-"))).toBe(true);
  });

  it("filters by subject or agent name", async () => {
    expect((await listRunExecutions(slug, { query: "WFT-B" })).rows).toHaveLength(1);
    expect((await listRunExecutions(slug, { query: "nope" })).rows).toHaveLength(0);
  });

  it("pages without losing the total", async () => {
    const first = await listRunExecutions(slug, { page: 1, pageSize: 1 });
    expect(first.rows).toHaveLength(1);
    expect(first.total).toBe(2);
    const second = await listRunExecutions(slug, { page: 2, pageSize: 1 });
    expect(second.rows[0]!.subject).not.toBe(first.rows[0]!.subject);
  });
});
