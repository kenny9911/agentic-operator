/**
 * GET /ready — core readiness (process + SQLite + Inngest registration).
 *
 * Distinct from /health on purpose: /health is FULL production readiness and
 * answers 503 whenever the optional execution planes or image trust are
 * unconfigured, which on a CI runner or a laptop is always. The Playwright
 * E2E web-server gate waits on /ready, so its contract is pinned here.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { buildTestEnv, type TestEnv } from "./harness";

describe("GET /ready", () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await buildTestEnv();
  });

  it("answers 200 with the readiness schema when SQLite and Inngest are usable", async () => {
    const res = await env.fetch("/ready");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      schema: string;
      ready: boolean;
      inngest: { ok: boolean };
      sqlite: { ok: boolean };
      uptime: number;
    };
    expect(body.schema).toBe("agentic-api-readiness/v1");
    expect(body.ready).toBe(true);
    expect(body.inngest.ok).toBe(true);
    expect(body.sqlite.ok).toBe(true);
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  it("does not depend on the production execution planes that keep /health at 503 outside production", async () => {
    const [ready, health] = await Promise.all([env.fetch("/ready"), env.fetch("/health")]);
    expect(ready.status).toBe(200);
    // /health may legitimately be 503 here (execution planes unconfigured);
    // whatever it says, its core subsystems must agree with /ready.
    const report = (await health.json()) as { inngest: { ok: boolean }; sqlite: { ok: boolean } };
    expect(report.inngest.ok).toBe(true);
    expect(report.sqlite.ok).toBe(true);
  });

  it("keeps /live dependency-free", async () => {
    const res = await env.fetch("/live");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ schema: "agentic-api-liveness/v1", live: true });
  });
});
