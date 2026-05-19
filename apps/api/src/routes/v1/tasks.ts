import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { getDb, tasks } from "@agentic/db";
import { inngest } from "@agentic/runtime";
import { ResolveTaskBody } from "@agentic/contracts";
import { requireAuth } from "../../plugins/auth";
import { writeAudit } from "../../plugins/audit";
import { listAllTasks, getTask } from "../../queries/tasks";

export async function tasksRoutes(app: FastifyInstance) {
  // GET /v1/tasks — list
  app.get("/tasks", async (req, reply) => {
    const auth = requireAuth(req);
    const rows = await listAllTasks(auth.tenantSlug, { limit: 100 });
    return reply.ok(rows);
  });

  // GET /v1/tasks/:id — detail
  app.get<{ Params: { id: string } }>("/tasks/:id", async (req, reply) => {
    const auth = requireAuth(req);
    const row = await getTask(auth.tenantSlug, req.params.id);
    if (!row) return reply.fail("not_found", "task not found", 404);
    return reply.ok(row);
  });

  // POST /v1/tasks/:id/resolve
  app.post<{ Params: { id: string } }>(
    "/tasks/:id/resolve",
    async (req, reply) => {
      const auth = requireAuth(req);
      const body = ResolveTaskBody.parse(req.body);
      const db = getDb();
      const row = db.select().from(tasks).where(eq(tasks.id, req.params.id)).all()[0];
      if (!row) return reply.fail("not_found", "task not found", 404);
      if (row.tenantId !== auth.tenantId)
        return reply.fail("forbidden", "forbidden", 403);
      if (row.status !== "open")
        return reply.fail("already_resolved", `task already ${row.status}`, 409);

      await inngest.send({
        name: "task.resolved",
        data: {
          taskId: req.params.id,
          decision: body.decision,
          payload: body.payload ?? null,
        },
      });

      writeAudit({
        tenantId: auth.tenantId,
        action: "task.resolve",
        targetType: "task",
        targetId: req.params.id,
        meta: { decision: body.decision },
      });

      return reply.ok({ task_id: req.params.id, decision: body.decision });
    },
  );
}
