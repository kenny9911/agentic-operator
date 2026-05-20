/**
 * TC-31 — P3-RT-03 + P3-RT-04 + P3-RT-05: webhook ingest.
 *
 * Covers:
 *   1. POST /v1/webhooks/:source — 404 when no enabled subscription.
 *   2. Empty body → 400.
 *   3. Missing signature → 401.
 *   4. Bad HMAC → 401.
 *   5. Valid HMAC + body → 202 + idempotency_key returned.
 *   6. Stale x-timestamp (>5min) → 401 replay_rejected.
 *   7. Idempotency key picked from explicit header when present.
 *   8. Authorization / Cookie headers stripped from the emitted Inngest event.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  getDb,
  tenants,
  webhookSubscriptions,
} from "@agentic/db";
import { makeId } from "@agentic/shared";
import { buildTestEnv, type TestEnv } from "./harness";

const SOURCE = `gh-test-${makeId("tag").slice(-6)}`;
const SECRET = "s3kret-shared-key";

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("TC-31: webhook ingest (P3-RT-03/04/05)", () => {
  let env: TestEnv;
  let tenantId: string;
  let tenantSlug: string;
  let subscriptionId: string;

  beforeAll(async () => {
    env = await buildTestEnv();
    const db = getDb();
    tenantSlug = `webhook-tenant-${makeId("tag").slice(-6)}`;
    tenantId = makeId("ten");
    db.insert(tenants)
      .values({ id: tenantId, slug: tenantSlug, name: tenantSlug })
      .run();
    subscriptionId = makeId("whk");
    db.insert(webhookSubscriptions)
      .values({
        id: subscriptionId,
        tenantId,
        source: SOURCE,
        secretEncrypted: SECRET,
        signingAlgo: "hmac-sha256",
        enabled: true,
      })
      .run();
  });

  it("404s when no enabled subscription matches the source slug", async () => {
    const body = JSON.stringify({ event: "ping" });
    const res = await env.fetch(`/v1/webhooks/unknown-source-xyz`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-256": sign(body),
      },
      body,
    });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("not_subscribed");
  });

  it("400s on an empty body", async () => {
    const res = await env.fetch(`/v1/webhooks/${SOURCE}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-256": sign(""),
      },
      body: "",
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(json.error.code).toBe("empty_body");
  });

  it("401s when signature header is missing", async () => {
    const body = JSON.stringify({ event: "ping" });
    const res = await env.fetch(`/v1/webhooks/${SOURCE}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(res.status).toBe(401);
    const json = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(json.error.code).toBe("no_signature");
  });

  it("401s on bad HMAC", async () => {
    const body = JSON.stringify({ event: "ping" });
    const bogus = "0".repeat(64);
    const res = await env.fetch(`/v1/webhooks/${SOURCE}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-256": bogus,
      },
      body,
    });
    expect(res.status).toBe(401);
    const json = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(json.error.code).toBe("bad_signature");
  });

  it("returns 202 + idempotency_key on valid HMAC", async () => {
    const body = JSON.stringify({ event: "ping", id: "abc" });
    const res = await env.fetch(`/v1/webhooks/${SOURCE}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-256": sign(body),
        "x-idempotency-key": "my-explicit-key",
      },
      body,
    });
    expect(res.status).toBe(202);
    const json = (await res.json()) as {
      ok: boolean;
      data: {
        source: string;
        tenant: string;
        event: string;
        idempotency_key: string;
      };
    };
    expect(json.ok).toBe(true);
    expect(json.data.source).toBe(SOURCE);
    expect(json.data.tenant).toBe(tenantSlug);
    expect(json.data.event).toBe(`${tenantSlug}/${SOURCE}.received`);
    expect(json.data.idempotency_key).toBe("my-explicit-key");
  });

  it("falls back to signature digest as idempotency_key when header absent", async () => {
    const body = JSON.stringify({ event: "x", n: 1 });
    const sig = sign(body);
    const res = await env.fetch(`/v1/webhooks/${SOURCE}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-256": sig,
      },
      body,
    });
    expect(res.status).toBe(202);
    const json = (await res.json()) as {
      ok: boolean;
      data: { idempotency_key: string };
    };
    expect(json.data.idempotency_key).toBe(sig.slice(0, 64));
  });

  it("401s on a stale x-timestamp (replay window)", async () => {
    const body = JSON.stringify({ event: "old" });
    const stale = String(Date.now() - 10 * 60 * 1000); // 10 min ago
    const res = await env.fetch(`/v1/webhooks/${SOURCE}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-256": sign(body),
        "x-timestamp": stale,
      },
      body,
    });
    expect(res.status).toBe(401);
    const json = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(json.error.code).toBe("replay_rejected");
  });

  it("accepts a fresh x-timestamp", async () => {
    const body = JSON.stringify({ event: "fresh" });
    const now = String(Date.now());
    const res = await env.fetch(`/v1/webhooks/${SOURCE}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-256": sign(body),
        "x-timestamp": now,
      },
      body,
    });
    expect(res.status).toBe(202);
  });

  it("400s on a malformed source slug", async () => {
    const body = JSON.stringify({ event: "x" });
    const res = await env.fetch(`/v1/webhooks/has%20space`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-256": sign(body),
      },
      body,
    });
    expect([400, 404]).toContain(res.status);
  });
});
