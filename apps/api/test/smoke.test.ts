/**
 * Smoke — Wave 5 ship-gate sanity check.
 *
 * Boots the Fastify instance via the shared test harness and hits
 * /health. Catches catastrophic boot regressions (missing env, broken
 * bootstrap, native module mismatch) early in the test pipeline.
 */

import { describe, it, expect } from "vitest";
import { buildTestEnv } from "./harness";

describe("smoke", () => {
  it("server builds via the test harness", async () => {
    const env = await buildTestEnv();
    expect(env).toBeDefined();
    expect(typeof env.fetch).toBe("function");
  });

  it("health endpoint returns 200", async () => {
    const env = await buildTestEnv();
    const res = await env.fetch("/health");
    expect(res.status).toBe(200);
  });
});
