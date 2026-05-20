import type { FastifyInstance } from "fastify";
import { metrics } from "../services/metrics";

/**
 * GET /metrics — Prometheus text exposition (P4-OPS-05).
 *
 * Unauthenticated by design; standard practice is to firewall the port
 * or restrict via reverse-proxy IP allow-list. Documented in
 * docs/RUNBOOK.md.
 */
export async function metricsRoute(app: FastifyInstance) {
  app.get("/metrics", async (_req, reply) => {
    reply.header("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    return reply.send(metrics.serialize());
  });
}
