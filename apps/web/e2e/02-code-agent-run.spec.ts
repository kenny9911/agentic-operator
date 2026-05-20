/**
 * P4-TEST-02 — E2E: code agent run.
 *
 * POST /v1/agents/testAgent/invoke against the live api, assert:
 *
 *   - HTTP 200 + envelope with runId, status='ok', provider configured
 *   - tokens in/out > 0 (the mock provider always reports both)
 *   - the response output string is non-empty (mock embeds the prompt)
 *
 * Why no `/v1/runs/<runId>` detail re-fetch: `testAgent` is a code-defined
 * agent that lives under the `__system` tenant, but the E2E api is
 * booted with `AGENTIC_DEV_TENANT=raas` (the production-like default)
 * so `/v1/runs/<runId>` 404s the raas caller. The invoke envelope is
 * the authoritative result of the lifecycle — TC-3 covers the read-side
 * round-trip in the api workspace where the dev tenant is `__system`.
 *
 * This catches:
 *   1. CORS / origin handling that fastify.inject bypasses
 *   2. Connection pooling / keep-alive bugs on a long-running api
 *   3. The dev cookie auth path end to end
 *   4. End-to-end Inngest registration of the code-agent function
 */

import { test, expect } from "@playwright/test";
import { apiFetch } from "./helpers";

interface CodeRunOk {
  runId: string;
  status: string;
  output: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  testRun?: boolean;
}

test.describe("P4-TEST-02: code agent invocation E2E", () => {
  test("POST /v1/agents/testAgent/invoke succeeds against the gateway", async () => {
    const invoke = await apiFetch<CodeRunOk>("/v1/agents/testAgent/invoke", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(invoke.status).toBe(200);
    if (!invoke.body.ok) {
      throw new Error(
        `invoke failed: ${invoke.body.error.code} — ${invoke.body.error.message}`,
      );
    }
    const { runId, status, output, provider, model, tokensIn, tokensOut, durationMs } =
      invoke.body.data;
    expect(runId).toMatch(/^run-/);
    expect(status).toBe("ok");
    // Provider/model come from the gateway default. CI sets
    // LLM_DEFAULT_PROVIDER=mock so we'd see "mock" + "mock-model-v1";
    // locally a real provider may be configured. Assert shape rather
    // than exact identity so the spec is portable.
    expect(typeof provider).toBe("string");
    expect(typeof model).toBe("string");
    expect(tokensIn).toBeGreaterThan(0);
    expect(tokensOut).toBeGreaterThan(0);
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
    expect(durationMs).toBeGreaterThanOrEqual(0);
  });

  test("?testRun=1 surfaces the test-badge bit on the invoke envelope", async () => {
    const invoke = await apiFetch<CodeRunOk>(
      "/v1/agents/testAgent/invoke?testRun=1",
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );
    expect(invoke.status).toBe(200);
    if (!invoke.body.ok) throw new Error("invoke failed");
    expect(invoke.body.data.testRun).toBe(true);
    expect(invoke.body.data.status).toBe("ok");
  });

  test("invoke envelope includes a runId prefix that matches the makeId contract", async () => {
    const invoke = await apiFetch<CodeRunOk>("/v1/agents/testAgent/invoke", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(invoke.status).toBe(200);
    if (!invoke.body.ok) throw new Error("invoke failed");
    // P0-RT-04 contract: makeId('run') yields run-<lowerhex>. Twelve
    // chars of entropy is the current setting; allow ≥8 to stay loose.
    expect(invoke.body.data.runId).toMatch(/^run-[0-9a-f]{8,}$/);
  });

  test("404 envelope for an unknown agent name", async () => {
    const invoke = await apiFetch("/v1/agents/no-such-agent-12345/invoke", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(invoke.status).toBe(404);
    expect(invoke.body.ok).toBe(false);
    if (!invoke.body.ok) {
      expect(invoke.body.error.code).toBe("not_found");
    }
  });
});
