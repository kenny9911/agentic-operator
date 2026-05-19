import type { FastifyInstance } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import { inngest } from "@agentic/runtime";

function pickSignature(headers: Record<string, unknown>): string | null {
  const get = (k: string): string | null => {
    const v = headers[k];
    return typeof v === "string" ? v : null;
  };
  return (
    get("x-signature-256") ??
    get("x-hub-signature-256") ??
    get("stripe-signature") ??
    get("x-signature") ??
    null
  );
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function webhooksRoutes(app: FastifyInstance) {
  app.post<{ Params: { provider: string } }>(
    "/webhooks/:provider",
    async (req, reply) => {
      const { provider } = req.params;
      const upper = provider.toUpperCase().replace(/[^A-Z0-9]/g, "_");
      const secret =
        process.env[`WEBHOOK_HMAC_SECRET_${upper}`] ??
        process.env.WEBHOOK_HMAC_SECRET_DEFAULT;
      if (!secret) {
        return reply.fail(
          "no_secret",
          "no HMAC secret configured",
          500,
          `set WEBHOOK_HMAC_SECRET_${upper}`,
        );
      }

      const body =
        typeof req.body === "string"
          ? req.body
          : JSON.stringify(req.body ?? {});
      const sigHeader = pickSignature(req.headers as Record<string, unknown>);
      if (!sigHeader)
        return reply.fail("no_signature", "missing signature header", 401);
      const signature = sigHeader.replace(/^sha256=/, "");
      const expected = createHmac("sha256", secret).update(body).digest("hex");
      if (!constantTimeEqualHex(expected, signature)) {
        return reply.fail("bad_signature", "invalid signature", 401);
      }

      let payload: unknown = null;
      try {
        payload = JSON.parse(body);
      } catch {
        payload = body;
      }

      const tenantSlug = process.env.AGENTIC_DEV_TENANT ?? "raas";
      const eventName = `WEBHOOK_${upper}`;
      await inngest.send({
        name: `${tenantSlug}/${eventName}` as `${string}/${string}`,
        data: { provider, payload, receivedAt: Date.now() },
      });

      return reply.ok({ provider, event: eventName });
    },
  );
}
