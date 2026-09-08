/**
 * Regression coverage for the 2026-08-20 .env.local contamination: a Vitest
 * run whose settings JSON resolved under data/test-runs/ wrote the managed
 * AI-settings block into the developer's real apps/api/.env.local. The stale
 * AGENTIC_LLM_SETTINGS_PATH inside that block then silently rerouted the next
 * dev boot's model routing to deleted test scratch.
 *
 * Contract under test:
 *  - a test process without an explicit AGENTIC_LLM_ENV_MIRROR_PATH never
 *    writes apps/api/.env.local (saves succeed, mirror is skipped);
 *  - an explicit mirror path (what test/setup.ts provides) keeps mirroring;
 *  - a non-test boot ignores a persisted settings path that points into
 *    data/test-runs, warns once, and falls back to the default location.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetLlmSettingsCache,
  getLlmSettings,
  llmSettingsEnvMirrorPath,
  llmSettingsPath,
  saveLlmSettings,
} from "../src/services/llm-settings-store";

const ENV_KEYS = [
  "AGENTIC_LLM_SETTINGS_PATH",
  "AGENTIC_LLM_ENV_MIRROR_PATH",
  "DATABASE_URL",
  "NODE_ENV",
  "VITEST",
  "LLM_DEFAULT_PROVIDER",
  "LLM_DEFAULT_MODEL",
] as const;

describe("AI settings env-mirror isolation", () => {
  const apiRoot = resolve(import.meta.dirname, "..");
  const repoRoot = resolve(apiRoot, "../..");
  const realEnvLocal = join(apiRoot, ".env.local");
  const testRunsRoot =
    process.env.AGENTIC_API_TEST_RUN_ROOT?.trim() ||
    join(repoRoot, "data", "test-runs", String(process.pid));
  const previousEnvironment = new Map<string, string | undefined>();
  let realEnvLocalBaseline: string | null;

  beforeAll(() => {
    for (const name of ENV_KEYS) previousEnvironment.set(name, process.env[name]);
    realEnvLocalBaseline = existsSync(realEnvLocal)
      ? readFileSync(realEnvLocal, "utf8")
      : null;
  });

  beforeEach(() => {
    for (const [name, value] of previousEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    process.env.NODE_ENV = "test";
    process.env.LLM_DEFAULT_PROVIDER = "mock";
    process.env.LLM_DEFAULT_MODEL = "mock-model-v1";
    _resetLlmSettingsCache();
    vi.restoreAllMocks();
  });

  afterAll(() => {
    for (const [name, value] of previousEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    _resetLlmSettingsCache();
    expectRealEnvLocalUntouched();
  });

  function expectRealEnvLocalUntouched(): void {
    if (realEnvLocalBaseline === null) {
      expect(existsSync(realEnvLocal)).toBe(false);
    } else {
      expect(readFileSync(realEnvLocal, "utf8")).toBe(realEnvLocalBaseline);
    }
  }

  it("saves in a test process without an explicit mirror path and leaves apps/api/.env.local untouched", () => {
    const scratch = mkdtempSync(join(testRunsRoot, "mirror-isolation-"));
    try {
      process.env.AGENTIC_LLM_SETTINGS_PATH = join(scratch, "llm-settings.json");
      delete process.env.AGENTIC_LLM_ENV_MIRROR_PATH;
      _resetLlmSettingsCache();

      // A test process never mirrors into the operator's real file: without
      // an explicit mirror path the store mirrors into a sibling of the
      // test-owned JSON file instead — the exact contamination scenario this
      // suite guards against.
      const siblingMirror = join(scratch, "llm-settings.env.local");
      expect(llmSettingsEnvMirrorPath()).toBe(siblingMirror);
      expect(llmSettingsEnvMirrorPath()).not.toBe(realEnvLocal);

      const created = getLlmSettings("__system");
      expect(created.sync.status).toBe("synced");

      const saved = saveLlmSettings("__system", created.settings, 0);
      expect(saved.settings.revision).toBe(1);
      expect(saved.sync.status).toBe("synced");
      expect(existsSync(join(scratch, "llm-settings.json"))).toBe(true);
      expect(readFileSync(siblingMirror, "utf8")).toContain("AGENTIC_LLM_SETTINGS_B64=");

      // Re-reading an existing workspace must not report drift.
      _resetLlmSettingsCache();
      const reread = getLlmSettings("__system");
      expect(reread.sync.status).toBe("synced");

      expectRealEnvLocalUntouched();
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("still mirrors into an explicitly configured scratch .env.local", () => {
    const scratch = mkdtempSync(join(testRunsRoot, "mirror-explicit-"));
    try {
      const mirrorPath = join(scratch, ".env.local");
      process.env.AGENTIC_LLM_SETTINGS_PATH = join(scratch, "llm-settings.json");
      process.env.AGENTIC_LLM_ENV_MIRROR_PATH = mirrorPath;
      _resetLlmSettingsCache();

      const created = getLlmSettings("__system");
      expect(created.sync.status).toBe("synced");
      expect(created.sync.message).toBeNull();

      const mirrored = readFileSync(mirrorPath, "utf8");
      expect(mirrored).toContain("# BEGIN AGENTIC LLM SETTINGS (managed)");
      expect(mirrored).toContain("AGENTIC_LLM_SETTINGS_B64=");
      expectRealEnvLocalUntouched();
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("refuses a persisted test-run settings path outside test processes instead of silently redirecting", () => {
    const scratch = mkdtempSync(join(testRunsRoot, "stale-block-"));
    const outside = mkdtempSync(join(tmpdir(), "agentic-llm-settings-live-"));
    try {
      // Simulate a dev boot that inherited a stale managed block. A non-test
      // API must never persist operator routing state under the disposable
      // test-run tree (a leaked block once made a real revision vanish when
      // the tree was cleaned), so the store fails closed: the boot stops
      // with the offending path named, rather than quietly using another.
      process.env.NODE_ENV = "production";
      delete process.env.VITEST;
      process.env.AGENTIC_LLM_SETTINGS_PATH = join(scratch, "llm-settings.json");
      process.env.DATABASE_URL = `file:${join(outside, "agentic.db")}`;

      expect(() => llmSettingsPath()).toThrow(/must not use the disposable test-run tree outside NODE_ENV=test/);
      expect(() => llmSettingsPath()).toThrow(join(scratch, "llm-settings.json"));

      // Pointing the path outside the test-run tree is honoured as-is.
      process.env.AGENTIC_LLM_SETTINGS_PATH = join(outside, "llm-settings.json");
      expect(llmSettingsPath()).toBe(resolve(outside, "llm-settings.json"));
    } finally {
      rmSync(scratch, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("keeps honoring an explicit test-run settings path inside test processes", () => {
    const scratch = mkdtempSync(join(testRunsRoot, "honored-"));
    try {
      const settingsPath = join(scratch, "llm-settings.json");
      process.env.AGENTIC_LLM_SETTINGS_PATH = settingsPath;
      expect(llmSettingsPath()).toBe(resolve(settingsPath));
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
