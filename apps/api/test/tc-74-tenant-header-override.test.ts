/**
 * TC-74 — `x-agentic-tenant` header override in AUTH_MODE=dev.
 *
 * Hotfix — dashboard render hang (`/portal/hello/dashboard`).
 *
 * The portal URL says `/portal/<slug>/dashboard` but every `/v1/*` call
 * previously resolved to whichever slug `AGENTIC_DEV_TENANT` happened to
 * pin (default `raas`). The dashboard for tenant `hello` ended up
 * showing raas's runs, events, and tasks — confusing in the best case,
 * a data-leak smell in the worst. The fix is a dev-only header override:
 * the Next.js client forwards the URL segment as `x-agentic-tenant`, the
 * auth plugin honors it when (and only when) `AUTH_MODE=dev`.
 *
 * This suite locks down the contract:
 *   1. With `AUTH_MODE=dev` + valid header → request scopes to that tenant.
 *   2. With `AUTH_MODE=dev` + header pointing at a non-existent slug →
 *      falls back to AGENTIC_DEV_TENANT (advisory, never a 401).
 *   3. With `AUTH_MODE=dev` + malformed header → falls back (defense in
 *      depth; the header is client-controlled).
 *   4. Without `AUTH_MODE=dev` (production / unset) → header is ignored,
 *      bearer token is the only source of tenant truth.
 *
 * The bearer-only path is verified by the existing TC-6 P0-AUTH-01 suite;
 * this file adds the dev-mode override semantics.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestEnv, type TestEnv } from "./harness";

interface ViewerEnvelope {
  ok: boolean;
  data?: { viewer?: { tenantSlug?: string } };
  error?: { code: string; message?: string };
}

const HEADER = "x-agentic-tenant";

describe("TC-74: x-agentic-tenant header override", () => {
  let env: TestEnv;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    env = await buildTestEnv();
    saved.AUTH_MODE = process_env("AUTH_MODE");
    saved.AGENTIC_DEV_TENANT = process_env("AGENTIC_DEV_TENANT");
  });

  afterAll(() => {
    restore("AUTH_MODE", saved.AUTH_MODE);
    restore("AGENTIC_DEV_TENANT", saved.AGENTIC_DEV_TENANT);
  });

  describe("AUTH_MODE=dev: header switches the resolved tenant", () => {
    it("with header=raas → /v1/tenants viewer.tenantSlug = raas", async () => {
      process.env.AUTH_MODE = "dev";
      process.env.AGENTIC_DEV_TENANT = "__system";
      const res = await env.fetch("/v1/tenants", {
        headers: { [HEADER]: "raas" },
      });
      const body = (await res.json()) as ViewerEnvelope;
      expect(body.data?.viewer?.tenantSlug).toBe("raas");
    });

    it("with header=__system → viewer.tenantSlug = __system", async () => {
      process.env.AUTH_MODE = "dev";
      process.env.AGENTIC_DEV_TENANT = "raas";
      const res = await env.fetch("/v1/tenants", {
        headers: { [HEADER]: "__system" },
      });
      const body = (await res.json()) as ViewerEnvelope;
      expect(body.data?.viewer?.tenantSlug).toBe("__system");
    });

    it("no header → falls back to AGENTIC_DEV_TENANT (existing behaviour)", async () => {
      process.env.AUTH_MODE = "dev";
      process.env.AGENTIC_DEV_TENANT = "__system";
      const res = await env.fetch("/v1/tenants");
      const body = (await res.json()) as ViewerEnvelope;
      expect(body.data?.viewer?.tenantSlug).toBe("__system");
    });

    it("header pointing at a non-existent slug → falls back, never 401s", async () => {
      process.env.AUTH_MODE = "dev";
      process.env.AGENTIC_DEV_TENANT = "__system";
      const res = await env.fetch("/v1/tenants", {
        headers: { [HEADER]: "does-not-exist-xyz" },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as ViewerEnvelope;
      expect(body.data?.viewer?.tenantSlug).toBe("__system");
    });

    it("malformed header (uppercase / special chars) → falls back", async () => {
      process.env.AUTH_MODE = "dev";
      process.env.AGENTIC_DEV_TENANT = "__system";
      // Tenant slugs are constrained to /^[a-z0-9_-]{1,32}$/. Anything else
      // is rejected before hitting the database — defense in depth against
      // attacker-controlled header values.
      const r1 = await env.fetch("/v1/tenants", {
        headers: { [HEADER]: "Hello-World" },
      });
      const b1 = (await r1.json()) as ViewerEnvelope;
      expect(b1.data?.viewer?.tenantSlug).toBe("__system");

      const r2 = await env.fetch("/v1/tenants", {
        headers: { [HEADER]: "raas; DROP TABLE tenants" },
      });
      const b2 = (await r2.json()) as ViewerEnvelope;
      expect(b2.data?.viewer?.tenantSlug).toBe("__system");
    });

    it("empty header → falls back", async () => {
      process.env.AUTH_MODE = "dev";
      process.env.AGENTIC_DEV_TENANT = "raas";
      const res = await env.fetch("/v1/tenants", {
        headers: { [HEADER]: "" },
      });
      const body = (await res.json()) as ViewerEnvelope;
      expect(body.data?.viewer?.tenantSlug).toBe("raas");
    });
  });

  describe("AUTH_MODE != dev: header is ignored", () => {
    it("AUTH_MODE unset + header → 401 (no bearer, header doesn't unlock)", async () => {
      const savedMode = process.env.AUTH_MODE;
      delete process.env.AUTH_MODE;
      try {
        const res = await env.fetch("/v1/tenants", {
          headers: { [HEADER]: "raas" },
        });
        // Without dev mode, no bearer, header alone never authenticates.
        // /v1/tenants requireAuth → 401.
        expect(res.status).toBe(401);
      } finally {
        process.env.AUTH_MODE = savedMode;
      }
    });

    it("AUTH_MODE=production + header → 401 (header cannot bypass bearer)", async () => {
      const savedMode = process.env.AUTH_MODE;
      process.env.AUTH_MODE = "production";
      try {
        const res = await env.fetch("/v1/tenants", {
          headers: { [HEADER]: "raas" },
        });
        expect(res.status).toBe(401);
      } finally {
        process.env.AUTH_MODE = savedMode;
      }
    });
  });
});

function process_env(k: string): string | undefined {
  return process.env[k];
}
function restore(k: string, v: string | undefined): void {
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}
