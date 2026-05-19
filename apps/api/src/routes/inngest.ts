import type { FastifyInstance } from "fastify";
import { serve } from "inngest/fastify";
import type { Inngest } from "inngest";

/**
 * Register Inngest's serve adapter at /inngest. Inngest CLI auto-discovers
 * by hitting this URL during dev sync. The handler responds to GET/POST/PUT.
 */
export async function inngestRoute(
  app: FastifyInstance,
  opts: { client: Inngest; functions: unknown[] },
) {
  app.route({
    method: ["GET", "POST", "PUT"],
    url: "/inngest",
    handler: serve({
      client: opts.client,
      functions: opts.functions as never,
    }),
  });
}
