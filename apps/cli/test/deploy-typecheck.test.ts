/**
 * `agentic deploy` runs the tenant's typecheck so "a broken handler can't land
 * in prod" (deploy.ts's own words). It has to actually run one.
 *
 * It used to shell out to `npx tsc`. A scaffolded tenant has no node_modules of
 * its own until the repo-root install, so npx fetched the unrelated `tsc`
 * package from the registry, which prints "This is not the tsc command you are
 * looking for" and exits 0 — deploy read that as a pass and printed "typecheck:
 * ok" for code no compiler had read. That is how `agentic init`'s starter
 * template shipped a prompt that did not satisfy `definePrompt` and killed
 * every freshly initialised tenant at its first LLM step.
 *
 * These tests use a self-contained tsconfig (no `extends`, no imports) so they
 * check the compiler wiring itself, not the workspace's module resolution.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveTscBin, runDeploy } from "../src/commands/deploy.js";
import { parseArgs } from "../src/cli.js";

let cwd: string;
let originalFetch: typeof fetch;

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), "agentic-deploy-tsc-"));
  originalFetch = globalThis.fetch;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  if (cwd) await rm(cwd, { recursive: true, force: true });
});

function captureStream() {
  const chunks: string[] = [];
  return {
    write(s: string): boolean {
      chunks.push(s);
      return true;
    },
    get text(): string {
      return chunks.join("");
    },
  };
}

/** A tenant whose only TypeScript is `source`, with a standalone tsconfig. */
async function setupTypedTenant(slug: string, source: string): Promise<string> {
  const tenantDir = path.join(cwd, "repo", "data", "tenants", slug);
  const modelsDir = path.join(cwd, "repo", "models", `${slug}-v1`);
  await mkdir(path.join(tenantDir, "src"), { recursive: true });
  await mkdir(modelsDir, { recursive: true });
  await writeFile(
    path.join(tenantDir, "agentic.json"),
    JSON.stringify({ slug, version: "v1", manifestPath: `models/${slug}-v1` }),
  );
  await writeFile(
    path.join(tenantDir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, skipLibCheck: true },
      include: ["src/**/*.ts"],
    }),
  );
  await writeFile(path.join(tenantDir, "src", "index.ts"), source);
  await writeFile(
    path.join(modelsDir, "workflow_v1.json"),
    JSON.stringify([
      {
        id: "1",
        name: "a1",
        actor: ["Agent"],
        trigger: ["X_HAPPENED"],
        actions: [{ order: "1", name: "tool1", type: "tool" }],
        triggered_event: ["A1_DONE"],
      },
    ]),
  );
  await writeFile(
    path.join(modelsDir, "actions_v1.json"),
    JSON.stringify({ metadata: { version: "v1" }, actions: [] }),
  );
  return tenantDir;
}

function stubApiOk(): Array<{ url: string }> {
  const calls: Array<{ url: string }> = [];
  globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
    calls.push({ url: typeof input === "string" ? input : input.toString() });
    return new Response(
      JSON.stringify({
        ok: true,
        data: {
          workflow_version_id: "wfv-test",
          version: "auto-deadbeef",
          diff: { added: ["a1"], modified: [], removed: [], prior_version: null },
          note: "deployed",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  return calls;
}

async function deploy(tenantDir: string, extraArgs: string[] = []) {
  const stdout = captureStream();
  const stderr = captureStream();
  const code = await runDeploy({
    args: parseArgs(["deploy", tenantDir, ...extraArgs]),
    apiUrl: "http://api.test",
    apiToken: "tok",
    stdout: stdout as unknown as NodeJS.WritableStream,
    stderr: stderr as unknown as NodeJS.WritableStream,
  });
  return { code, out: stdout.text, err: stderr.text };
}

describe("agentic deploy: the typecheck actually runs", () => {
  it("resolves a real TypeScript compiler, not whatever npx would fetch", () => {
    const bin = resolveTscBin(cwd);
    expect(bin, "the CLI ships typescript; resolution must not depend on npx").toBeTruthy();
    expect(bin).toMatch(/typescript[/\\]bin[/\\]tsc$/);
  });

  it("fails the deploy on a real type error and never POSTs the manifest", async () => {
    const tenantDir = await setupTypedTenant(
      "badtypes",
      "export const answer: number = \"forty-two\";\n",
    );
    const calls = stubApiOk();

    const { code, out, err } = await deploy(tenantDir);

    expect(code, "a tenant that does not compile must not deploy").not.toBe(0);
    expect(out).toContain("typecheck: FAILED");
    // The compiler's own diagnostic, i.e. proof a compiler ran: a TS error
    // code, the offending file, and the assignment it rejected.
    expect(err).toMatch(/error TS\d+/);
    expect(err).toContain("index.ts");
    expect(err).toContain("not assignable");
    expect(calls, "nothing may be uploaded when the typecheck fails").toHaveLength(0);
  });

  it("passes a clean tenant through to the upload", async () => {
    const tenantDir = await setupTypedTenant(
      "goodtypes",
      "export const answer: number = 42;\n",
    );
    const calls = stubApiOk();

    const { code, out } = await deploy(tenantDir);

    expect(code, out).toBe(0);
    expect(out).toContain("typecheck: ok");
    expect(calls.map((c) => c.url)).toContain("http://api.test/v1/agents");
  });

  it("still skips when the tenant has no tsconfig at all", async () => {
    const tenantDir = await setupTypedTenant("notsconfig", "export const x = 1;\n");
    await rm(path.join(tenantDir, "tsconfig.json"));
    stubApiOk();

    const { code, out } = await deploy(tenantDir);

    expect(code).toBe(0);
    // "skipped", not "ok" — the deploy must not claim a check it did not make.
    expect(out).toContain("typecheck: skipped");
    expect(out).toContain("no tsconfig.json");
    expect(out).not.toContain("typecheck: ok");
  });
});
