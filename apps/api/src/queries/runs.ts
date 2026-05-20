import { and, desc, eq, isNull, like, or, sql } from "drizzle-orm";
import {
  agents,
  events,
  eventTypes,
  getDb,
  runs,
  steps,
  tenants,
} from "@agentic/db";
import type { RunRow, StepRow, EventRow } from "@agentic/contracts";

async function resolveTenantId(slug: string): Promise<string | null> {
  const db = getDb();
  const row = db.select().from(tenants).where(eq(tenants.slug, slug)).all()[0];
  return row?.id ?? null;
}

/**
 * Hydrate the current-step + step-count fields on a list of runs.
 * Issues two batched queries (1 for step counts per run, 1 for running step
 * name+ord per active run). Much cheaper than N+1 lookups.
 */
function hydrateStepInfo(rows: Array<RunRow & { id: string }>): RunRow[] {
  if (rows.length === 0) return rows;
  const db = getDb();
  const runIds = rows.map((r) => r.id);

  // Total step count per run
  const countMap = new Map<string, number>();
  for (const row of db
    .select({ runId: steps.runId, c: sql<number>`count(*)` })
    .from(steps)
    .where(sql`${steps.runId} IN (${sql.join(runIds.map((id) => sql`${id}`), sql`, `)})`)
    .groupBy(steps.runId)
    .all()) {
    countMap.set(row.runId, Number(row.c));
  }

  // For runs in "running"/"waiting"/"queued" status: find current in-flight step.
  const liveIds = rows
    .filter((r) => r.status === "running" || r.status === "waiting" || r.status === "queued")
    .map((r) => r.id);
  const currentMap = new Map<string, { name: string; ord: number }>();
  if (liveIds.length > 0) {
    // Pick highest ord still in non-terminal state
    for (const row of db
      .select({
        runId: steps.runId,
        name: steps.name,
        ord: steps.ord,
        status: steps.status,
      })
      .from(steps)
      .where(
        sql`${steps.runId} IN (${sql.join(liveIds.map((id) => sql`${id}`), sql`, `)})`,
      )
      .orderBy(steps.runId, desc(steps.ord))
      .all()) {
      if (!currentMap.has(row.runId)) {
        currentMap.set(row.runId, { name: row.name, ord: row.ord });
      }
    }
  }

  return rows.map((r) => {
    const cur = currentMap.get(r.id);
    return {
      ...r,
      currentStepName: cur?.name ?? null,
      currentStepOrd: cur?.ord ?? null,
      stepCount: countMap.get(r.id) ?? null,
    };
  });
}

export async function listRecentRuns(
  tenantSlug: string,
  opts: { limit?: number; status?: string; agentName?: string; query?: string } = {},
): Promise<RunRow[]> {
  const db = getDb();
  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return [];

  const whereParts = [eq(runs.tenantId, tenantId)];
  const VALID_STATUSES = [
    "queued",
    "running",
    "ok",
    "failed",
    "waiting",
    "cancelled",
  ] as const;
  if (
    opts.status &&
    opts.status !== "all" &&
    (VALID_STATUSES as readonly string[]).includes(opts.status)
  ) {
    whereParts.push(eq(runs.status, opts.status as (typeof VALID_STATUSES)[number]));
  }
  if (opts.agentName) {
    whereParts.push(eq(agents.name, opts.agentName));
  }
  if (opts.query) {
    const q = `%${opts.query}%`;
    whereParts.push(
      or(like(runs.id, q), like(runs.subject, q), like(agents.name, q))!,
    );
  }

  const rows = db
    .select({
      id: runs.id,
      status: runs.status,
      agentName: agents.name,
      agentTitle: agents.title,
      subject: runs.subject,
      triggerEvent: events.name,
      startedAt: runs.startedAt,
      endedAt: runs.endedAt,
      durationMs: runs.durationMs,
      tokensIn: runs.tokensIn,
      tokensOut: runs.tokensOut,
      model: runs.model,
      correlationId: runs.correlationId,
      errorMessage: runs.errorMessage,
      logPath: runs.logPath,
    })
    .from(runs)
    .innerJoin(agents, eq(agents.id, runs.agentId))
    .leftJoin(events, eq(events.id, runs.triggerEventId))
    .where(and(...whereParts))
    .orderBy(desc(runs.startedAt))
    .limit(opts.limit ?? 50)
    .all()
    .map((r) => ({
      ...r,
      currentStepName: null,
      currentStepOrd: null,
      stepCount: null,
    })) as RunRow[];

  return hydrateStepInfo(rows);
}

export async function getRun(
  tenantSlug: string,
  runId: string,
): Promise<RunRow | null> {
  const db = getDb();
  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return null;
  const row = db
    .select({
      id: runs.id,
      status: runs.status,
      agentName: agents.name,
      agentTitle: agents.title,
      subject: runs.subject,
      triggerEvent: events.name,
      startedAt: runs.startedAt,
      endedAt: runs.endedAt,
      durationMs: runs.durationMs,
      tokensIn: runs.tokensIn,
      tokensOut: runs.tokensOut,
      model: runs.model,
      correlationId: runs.correlationId,
      errorMessage: runs.errorMessage,
      logPath: runs.logPath,
    })
    .from(runs)
    .innerJoin(agents, eq(agents.id, runs.agentId))
    .leftJoin(events, eq(events.id, runs.triggerEventId))
    .where(and(eq(runs.tenantId, tenantId), eq(runs.id, runId)))
    .all()[0];
  if (!row) return null;
  const hydrated = hydrateStepInfo([
    { ...row, currentStepName: null, currentStepOrd: null, stepCount: null } as RunRow,
  ]);
  return hydrated[0] ?? null;
}

export async function listSteps(runId: string): Promise<StepRow[]> {
  const db = getDb();
  return db
    .select({
      id: steps.id,
      ord: steps.ord,
      name: steps.name,
      type: steps.type,
      status: steps.status,
      startedAt: steps.startedAt,
      endedAt: steps.endedAt,
      durationMs: steps.durationMs,
      error: steps.error,
      provider: steps.provider,
      model: steps.model,
      tokensIn: steps.tokensIn,
      tokensOut: steps.tokensOut,
    })
    .from(steps)
    .where(eq(steps.runId, runId))
    .orderBy(steps.ord)
    .all();
}

export async function listRecentEvents(
  tenantSlug: string,
  opts: { limit?: number; name?: string } = {},
): Promise<EventRow[]> {
  const db = getDb();
  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return [];

  // Soft-deleted events are invisible to operator views. The SSE live tail
  // (fetchEventsSince) applies the same filter — both surfaces must agree
  // or the catch-up GET and the live socket disagree on what's "current".
  const whereParts = [eq(events.tenantId, tenantId), isNull(events.deletedAt)];
  if (opts.name) whereParts.push(eq(events.name, opts.name));

  return db
    .select({
      id: events.id,
      name: events.name,
      subject: events.subject,
      category: events.category,
      color: eventTypes.color,
      receivedAt: events.receivedAt,
      sourceAgentName: agents.name,
      sourceAgentTitle: agents.title,
      payloadRef: events.payloadRef,
    })
    .from(events)
    .leftJoin(agents, eq(agents.id, events.sourceAgentId))
    .leftJoin(
      eventTypes,
      and(
        eq(eventTypes.tenantId, events.tenantId),
        eq(eventTypes.name, events.name),
      ),
    )
    .where(and(...whereParts))
    .orderBy(desc(events.receivedAt))
    .limit(opts.limit ?? 30)
    .all();
}
