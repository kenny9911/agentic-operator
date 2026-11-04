/**
 * TC-2 — Model catalog endpoint returns provider's models, errors on unknown.
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  PROVIDER_IDS,
  PROVIDER_MODEL_CATALOG,
  type CatalogModel,
} from "@agentic/contracts";
import { buildTestEnv, type TestEnv } from "./harness";

function model(name: string, lifecycle: Partial<CatalogModel> = {}): CatalogModel {
  return {
    name,
    tier: "mid",
    ctx: 8192,
    out: 4096,
    inP: 1,
    outP: 1,
    vision: false,
    tools: true,
    reasoning: false,
    releaseDate: "2026-07-01",
    ...lifecycle,
  };
}

describe("TC-2: /v1/llm/models", () => {
  let env: TestEnv;
  const originalCatalog = { ...PROVIDER_MODEL_CATALOG };

  beforeAll(async () => {
    env = await buildTestEnv();
  });

  beforeEach(() => {
    // This endpoint reads the local catalog, not a provider API. Exercise its
    // real lifecycle filtering with stable fixtures: actual provider models
    // age out after 365 days, so their names cannot be timeless expectations.
    // Fake only Date so Fastify's request timers keep running normally.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-15T12:00:00.000Z"));
    for (const provider of PROVIDER_IDS) PROVIDER_MODEL_CATALOG[provider] = [];
    PROVIDER_MODEL_CATALOG.anthropic = [
      model("fixture-current"),
      model("fixture-boundary", { releaseDate: "2025-07-15" }),
      model("fixture-legacy", { releaseDate: "2025-07-14" }),
      model("fixture-restricted", { restricted: true }),
      model("fixture-deprecated", { deprecatedAt: "2026-07-15" }),
    ];
    PROVIDER_MODEL_CATALOG.openrouter = [model("fixture-vendor/current")];
    PROVIDER_MODEL_CATALOG.mock = [model("fixture-mock")];
  });

  afterEach(() => {
    Object.assign(PROVIDER_MODEL_CATALOG, originalCatalog);
    vi.useRealTimers();
  });

  it("returns openrouter's prefixed model names", async () => {
    const res = await env.fetch("/v1/llm/models?provider=openrouter");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: string[] };
    expect(body.ok).toBe(true);
    expect(body.data).toEqual(["fixture-vendor/current"]);
  });

  it("returns only the provider's selectable models, including the 365-day boundary", async () => {
    const res = await env.fetch("/v1/llm/models?provider=anthropic");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: string[] };
    expect(body.ok).toBe(true);
    expect(body.data).toEqual(["fixture-current", "fixture-boundary"]);
  });

  it("excludes a model after its 365-day boundary has passed", async () => {
    vi.setSystemTime(new Date("2026-07-16T00:00:00.000Z"));
    const res = await env.fetch("/v1/llm/models?provider=anthropic");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: ["fixture-current"] });
  });

  it("rejects unknown provider with 400 + envelope", async () => {
    const res = await env.fetch("/v1/llm/models?provider=bogus");
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("bad_request");
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
    expect(body.data).toEqual({
      ...Object.fromEntries(PROVIDER_IDS.map((provider) => [provider, []])),
      anthropic: ["fixture-current", "fixture-boundary"],
      openrouter: ["fixture-vendor/current"],
      mock: ["fixture-mock"],
    });
  });
});
