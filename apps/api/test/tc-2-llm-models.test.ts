/**
 * TC-2 — Model catalog endpoint returns provider's models, errors on unknown.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { buildTestEnv, type TestEnv } from "./harness";

describe("TC-2: /v1/llm/models", () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await buildTestEnv();
  });

  it("returns openrouter's prefixed model names", async () => {
    const res = await env.fetch("/v1/llm/models?provider=openrouter");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: string[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    // At least one entry contains the provider-prefix slash convention
    expect(body.data.some((m) => m.includes("/"))).toBe(true);
  });

  it("returns anthropic's models", async () => {
    const res = await env.fetch("/v1/llm/models?provider=anthropic");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: string[] };
    expect(body.ok).toBe(true);
    expect(body.data).toContain("claude-sonnet-4-5");
    expect(body.data).toContain("claude-haiku-4-5");
  });

  it("rejects unknown provider with 400 + envelope", async () => {
    const res = await env.fetch("/v1/llm/models?provider=bogus");
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toMatch(/bad_request|model_not_found/);
    expect(body.error.message.toLowerCase()).toContain("unknown");
  });

  it("returns full catalog when provider param is omitted", async () => {
    const res = await env.fetch("/v1/llm/models");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: Record<string, string[]>;
    };
    expect(body.ok).toBe(true);
    expect(typeof body.data).toBe("object");
    expect(Object.keys(body.data)).toContain("anthropic");
    expect(Object.keys(body.data)).toContain("openrouter");
    expect(Object.keys(body.data)).toContain("mock");
  });
});
