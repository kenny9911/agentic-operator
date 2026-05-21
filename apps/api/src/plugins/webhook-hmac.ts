/**
 * HMAC-SHA256 verifier for webhook signatures.
 *
 * Moved out of `auth.ts` in P0-RT-12: bearer-token authentication and
 * webhook-signature verification are two unrelated concerns and were tangled
 * inside the same module. Keeping HMAC verification next to the webhook
 * routes that use it makes the surface easier to reason about.
 *
 * Note: the live `POST /v1/webhooks/:provider` route in `routes/v1/webhooks.ts`
 * computes its HMAC inline (because it also needs the constant-time hex
 * comparison + signature-header sniffing). This helper exists as a stable
 * primitive for any new webhook ingest path that prefers a single-call
 * "verify body+sig with secret" API.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyHmac(
  body: string,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (!signature || !secret) return false;
  const sig = signature.replace(/^sha256=/, "");
  const hmac = createHmac("sha256", secret);
  hmac.update(body);
  const expected = hmac.digest("hex");
  try {
    return timingSafeEqual(
      Buffer.from(sig, "hex"),
      Buffer.from(expected, "hex"),
    );
  } catch {
    return false;
  }
}
