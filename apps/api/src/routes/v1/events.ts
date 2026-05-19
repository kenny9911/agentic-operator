import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { appendToLedger, inngest } from "@agentic/runtime";
import { events, getDb } from "@agentic/db";
import { makeId } from "@agentic/shared";
import { IngestEventBody, ListEventsQuery } from "@agentic/contracts";
import { requireAuth } from "../../plugins/auth";
import { listRecentEvents } from "../../queries/runs";

export async function eventsRoutes(app: FastifyInstance) {
  // POST /v1/events — public ingest
  app.post("/events", async (req, reply) => {
    const auth = requireAuth(req);
    const parsed = IngestEventBody.parse(req.body);

    const eventId = makeId("evt");
    const tenantNamespacedName = parsed.name.includes("/")
      ? parsed.name
      : `${auth.tenantSlug}/${parsed.name}`;
    const bareName = tenantNamespacedName.includes("/")
      ? tenantNamespacedName.split("/").slice(1).join("/")
      : tenantNamespacedName;

    const payloadRef = await appendToLedger(auth.tenantSlug, {
      id: eventId,
      name: bareName,
      subject: parsed.subject,
      data: parsed.payload ?? {},
      ts: Date.now(),
    });

    getDb()
      .insert(events)
      .values({
        id: eventId,
        tenantId: auth.tenantId,
        name: bareName,
        subject: parsed.subject ?? null,
        payloadRef,
      })
      .run();

    await inngest.send({
      name: tenantNamespacedName as `${string}/${string}`,
      data: {
        ...(parsed.payload ?? {}),
        subject: parsed.subject,
        __triggerEventId: eventId,
      },
    });

    return reply.ok({ event_id: eventId, name: tenantNamespacedName });
  });

  // POST /v1/events/:id/replay
  app.post<{ Params: { id: string } }>(
    "/events/:id/replay",
    async (req, reply) => {
      const auth = requireAuth(req);
      const { id } = req.params;
      const db = getDb();
      const row = db.select().from(events).where(eq(events.id, id)).all()[0];
      if (!row) return reply.fail("not_found", "event not found", 404);
      if (row.tenantId !== auth.tenantId)
        return reply.fail("forbidden", "forbidden", 403);

      let payload: unknown = null;
      if (row.payloadRef) {
        const [filePath, offsetStr] = row.payloadRef.split("#");
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
            payload = JSON.parse(line).data;
          } catch {}
        }
      }

      const newId = `${id}-replay-${Date.now()}`;
      await inngest.send({
        name: `${auth.tenantSlug}/${row.name}` as `${string}/${string}`,
        data: {
          ...((payload as Record<string, unknown>) ?? {}),
          __triggerEventId: newId,
          __replayOf: id,
        },
      });
      return reply.ok({ replayed: id, new_event_id: newId });
    },
  );

  // GET /v1/events — list recent
  app.get("/events", async (req, reply) => {
    const auth = requireAuth(req);
    const q = ListEventsQuery.parse(req.query);
    const rows = await listRecentEvents(auth.tenantSlug, q);
    return reply.ok(rows);
  });
}
