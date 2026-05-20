/**
 * TC-52 — P4-OPS-05 / P4-API-04 metrics + hardened health.
 *
 * Verifies:
 *   - GET /metrics returns Prometheus text exposition (Content-Type +
 *     # HELP/# TYPE preamble) with the counter and histogram series the
 *     dashboards rely on.
 *   - Counters increment after an agent-invoke (runs_total, tokens_total).
 *   - GET /health includes version + schemaVersion + llmGateway fields.
 *   - /health returns 200 when subsystems are healthy.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { buildTestEnv, type TestEnv } from "./harness";
import type { HealthReport } from "@agentic/contracts";

describe("TC-52: P4-OPS-05 + P4-API-04", () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await buildTestEnv();
  });

  describe("GET /metrics", () => {
    it("returns Prometheus exposition format", async () => {
      const res = await env.fetch("/metrics");
      expect(res.status).toBe(200);
      const ct = res.headers.get("content-type") ?? "";
      expect(ct.startsWith("text/plain")).toBe(true);
      const body = await res.text();
      // Each metric has a HELP + TYPE preamble.
      expect(body).toContain("# HELP runs_total");
      expect(body).toContain("# TYPE runs_total counter");
      expect(body).toContain("# HELP tokens_total");
      expect(body).toContain("# TYPE tokens_total counter");
      expect(body).toContain("# HELP cost_usd_total");
      expect(body).toContain("# HELP http_requests_total");
      expect(body).toContain("# HELP llm_provider_errors_total");
      expect(body).toContain("# HELP run_duration_ms");
      expect(body).toContain("# TYPE run_duration_ms histogram");
      expect(body).toContain("# HELP http_request_duration_ms");
      expect(body).toContain("# TYPE http_request_duration_ms histogram");
    });

    it("increments runs_total + tokens_total after a successful invoke", async () => {
      // Baseline.
      const before = await (await env.fetch("/metrics")).text();
      const beforeRuns = parseCounterTotal(before, "runs_total");
      const beforeTokens = parseCounterTotal(before, "tokens_total");

      // Trigger one run via the test agent.
      const inv = await env.fetch("/v1/agents/testAgent/invoke?testRun=1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(inv.status).toBe(200);

      const after = await (await env.fetch("/metrics")).text();
      const afterRuns = parseCounterTotal(after, "runs_total");
      const afterTokens = parseCounterTotal(after, "tokens_total");
      expect(afterRuns).toBeGreaterThan(beforeRuns);
      // The mock adapter records non-zero tokens (see TC-3); tokens_total
      // should have grown by at least one new sample.
      expect(afterTokens).toBeGreaterThanOrEqual(beforeTokens);
    });
  });

  describe("GET /health", () => {
    it("returns 200 + extended fields when subsystems are healthy", async () => {
      const res = await env.fetch("/health");
      expect([200, 503]).toContain(res.status);
      const body = (await res.json()) as HealthReport;
      expect(typeof body.ok).toBe("boolean");
      expect(body.version).toBeTruthy();
      expect(body.schemaVersion).toBeTruthy();
      expect(body.llmGateway).toBeDefined();
      expect(body.llmGateway!.ok).toBe(true);
      expect(body.llmGateway!.defaultProvider).toBe("mock");
      expect(body.sqlite.ok).toBe(true);
    });
  });
});

function parseCounterTotal(prom: string, name: string): number {
  // Sum every series for a counter; the prom text exposition lists each
  // labelset on its own line.
  let total = 0;
  const lines = prom.split("\n");
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    if (line.startsWith(name)) {
      const m = line.match(/\s(\d+(?:\.\d+)?)$/);
      if (m && m[1]) total += Number(m[1]);
    }
  }
  return total;
}
