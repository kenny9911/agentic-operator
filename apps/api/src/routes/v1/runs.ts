import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { events, getDb, runs } from "@agentic/db";
import { inngest } from "@agentic/runtime";
import { makeId } from "@agentic/shared";
import { ListRunsQuery } from "@agentic/contracts";
import { requireAuth } from "../../plugins/auth";
import { getRun, listRecentRuns, listSteps } from "../../queries/runs";

export async function runsRoutes(app: FastifyInstance) {
  // GET /v1/runs — list
  app.get("/runs", async (req, reply) => {
    const auth = requireAuth(req);
    const q = ListRunsQuery.parse(req.query);
    const rows = await listRecentRuns(auth.tenantSlug, {
      limit: q.limit,
      status: q.status,
      agentName: q.agent,
      query: q.q,
    });
    return reply.ok(rows);
  });

  // GET /v1/runs/:id — single. Falls back to __system tenant so code-agent
  // runs (which live cross-tenant) are visible to any authed caller.
  app.get<{ Params: { id: string } }>("/runs/:id", async (req, reply) => {
    const auth = requireAuth(req);
    const run =
      (await getRun(auth.tenantSlug, req.params.id)) ??
      (await getRun("__system", req.params.id));
    if (!run) return reply.fail("not_found", "run not found", 404);
    const steps = await listSteps(run.id);
    return reply.ok({ run, steps });
  });

  // POST /v1/runs/:id/replay
  app.post<{ Params: { id: string } }>(
    "/runs/:id/replay",
    async (req, reply) => {
      const auth = requireAuth(req);
      const db = getDb();
      const run = db.select().from(runs).where(eq(runs.id, req.params.id)).all()[0];
      if (!run) return reply.fail("not_found", "run not found", 404);
      if (run.tenantId !== auth.tenantId)
        return reply.fail("forbidden", "forbidden", 403);
      if (!run.triggerEventId)
        return reply.fail("no_trigger", "run has no trigger event", 400);

      const evt = db
        .select()
        .from(events)
        .where(eq(events.id, run.triggerEventId))
        .all()[0];
      if (!evt) return reply.fail("gone", "trigger event missing", 410);

      let payload: Record<string, unknown> = {};
      if (evt.payloadRef) {
        const [filePath, offsetStr] = evt.payloadRef.split("#");
        if (filePath && offsetStr != null) {
          try {
            const buf = await readFile(filePath);
            const offset = parseInt(offsetStr, 10);
            const nl = buf.indexOf(0x0a, offset);
            const line = buf.toString(
              "utf8",
              offset,
              nl === -1 ? undefined : nl,
            );
            payload = (JSON.parse(line).data ?? {}) as Record<string, unknown>;
          } catch {}
        }
      }

      const newEventId = makeId("evt");
      await inngest.send({
        name: `${auth.tenantSlug}/${evt.name}` as `${string}/${string}`,
        data: {
          ...payload,
          subject: evt.subject ?? undefined,
          __triggerEventId: newEventId,
          __replayOfRun: run.id,
        },
      });
      return reply.ok({ replayed_run: run.id, new_event_id: newEventId });
    },
  );
}
