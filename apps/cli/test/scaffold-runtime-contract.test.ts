/**
 * `agentic init` scaffolds a tenant package that the RUNTIME loads and calls.
 * These tests execute the generated modules against the real
 * `@agentic/agent-sdk` builders and assert the shapes the step engine actually
 * invokes — not the text of the templates.
 *
 * Why this exists: the scaffolded prompt used to be written as
 * `definePrompt({ ..., async build() { return { system, user } } })`. That is
 * not the contract — `definePrompt` takes `template(ctx): string` — so the
 * descriptor had no `template`, and every freshly initialised tenant died at
 * its first LLM step with `examplePrompt: prompt.template is not a function`,
 * after ~132 s of Inngest retries. Nothing caught it: `agentic deploy` skips
 * the tenant typecheck under `--no-typecheck` (which the E2E suite passes),
 * and E2E spec 06 only polled the FIRST scaffolded agent.
 *
 * The step engine's contact points, pinned below:
 *   - `prompt.template(ctx)` — packages/runtime/src/step-engine.ts (`const
 *     rendered = prompt.template(ctx)`), so it must exist and return a string.
 *   - `tool.handler(ctx)` — resolved from the tenant registry for a
 *     `type: "tool"` action.
 *   - `registry.tools` / `registry.prompts` — keyed by the manifest's action
 *     names, so the workflow the same command scaffolds must line up with them.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { PromptDescriptor, ToolContext, ToolDescriptor } from "@agentic/agent-sdk";
import { scaffoldTenant } from "../src/commands/init.js";

const here = path.dirname(fileURLToPath(import.meta.url));

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), "agentic-scaffold-contract-"));
  // The scaffolded tsconfig extends "../../../tsconfig.base.json" — i.e. it
  // assumes a repo root three levels above data/tenants/<slug>. Give the tmp
  // root the real base config so importing the generated .ts files exercises
  // the same compiler settings a tenant author gets, instead of failing on a
  // missing extends. (That assumption is part of the scaffold's contract, so
  // satisfying it here is faithful, not a workaround.)
  await copyFile(
    path.resolve(here, "..", "..", "..", "tsconfig.base.json"),
    path.join(cwd, "tsconfig.base.json"),
  );
});

afterEach(async () => {
  if (cwd) await rm(cwd, { recursive: true, force: true });
});

/** The context the step engine passes: enough of it for the scaffold's needs. */
function fakeContext(): ToolContext {
  return {
    agentName: "summarize",
    actionName: "examplePrompt",
    correlationId: "corr-scaffold-test",
    tenantSlug: "demo",
    subject: "subj-1",
    event: { name: "demo/INTAKE_DONE", data: { hello: "world" } },
    lastResult: { ok: true, seenSubject: "subj-1" },
  } as ToolContext;
}

async function scaffoldAndImport(slug: string): Promise<{
  prompt: PromptDescriptor;
  tool: ToolDescriptor;
}> {
  const result = await scaffoldTenant({ slug, cwd, force: false });
  const promptModule = (await import(
    pathToFileURL(path.join(result.tenantDir, "src", "prompts", "example.ts")).href
  )) as { examplePrompt: PromptDescriptor };
  const toolModule = (await import(
    pathToFileURL(path.join(result.tenantDir, "src", "tools", "example.ts")).href
  )) as { exampleTool: ToolDescriptor };
  return { prompt: promptModule.examplePrompt, tool: toolModule.exampleTool };
}

describe("agentic init: the scaffold satisfies the runtime contract", () => {
  it("scaffolded prompt exposes template() and renders a string", async () => {
    const { prompt } = await scaffoldAndImport("demoprompt");

    expect(prompt.kind).toBe("prompt");
    expect(prompt.name).toBe("examplePrompt");
    // The exact failure that shipped: `template` was absent because the
    // scaffold declared `build()` instead.
    expect(
      typeof prompt.template,
      "definePrompt takes template(ctx): string — a scaffold without it dies at the first LLM step",
    ).toBe("function");

    const rendered = prompt.template(fakeContext());
    expect(typeof rendered).toBe("string");
    expect(rendered.length).toBeGreaterThan(0);
    // It must actually USE the context it is handed, or the starter teaches
    // people to ignore their own inputs.
    expect(rendered).toContain("seenSubject");
    expect(rendered).toContain("hello");
  });

  it("scaffolded tool exposes handler() and returns its declared output", async () => {
    const { tool } = await scaffoldAndImport("demotool");

    expect(tool.kind).toBe("tool");
    expect(tool.name).toBe("exampleTool");
    expect(typeof tool.handler).toBe("function");

    const out = (await tool.handler(fakeContext())) as {
      data: { ok: true; seenSubject: string | null };
    };
    expect(out.data).toEqual({ ok: true, seenSubject: "subj-1" });
    // `output` is a Zod schema; the runtime validates against it.
    expect(tool.output?.parse(out.data)).toEqual(out.data);
  });

  it("the scaffolded registry keys match the scaffolded manifest's action names", async () => {
    const result = await scaffoldTenant({ slug: "demoreg", cwd, force: false });
    const registryModule = (await import(
      pathToFileURL(path.join(result.tenantDir, "src", "index.ts")).href
    )) as {
      default: {
        tools?: Record<string, ToolDescriptor>;
        prompts?: Record<string, PromptDescriptor>;
      };
    };
    const registry = registryModule.default;

    const manifest = JSON.parse(
      await readFile(path.join(result.modelsDir, "workflow_v1.json"), "utf8"),
    ) as Array<{ actions: Array<{ name: string; type: string }> }>;

    // Every action the starter workflow declares must resolve in the registry
    // it ships beside it, or the tenant deploys and then fails at run time.
    for (const agent of manifest) {
      for (const action of agent.actions) {
        const bag = action.type === "tool" ? registry.tools : registry.prompts;
        expect(
          bag?.[action.name],
          `${action.type} action "${action.name}" has no entry in the scaffolded registry`,
        ).toBeDefined();
      }
    }
    // Guard the pairing itself: both halves of the two-agent starter.
    expect(Object.keys(registry.tools ?? {})).toContain("exampleTool");
    expect(Object.keys(registry.prompts ?? {})).toContain("examplePrompt");
  });
});
