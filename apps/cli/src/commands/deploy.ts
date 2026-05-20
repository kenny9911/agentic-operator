/**
 * `agentic deploy [path]` — atomic manifest deploy (P1-CLI-02).
 *
 * Steps:
 *   1. Locate the tenant root: `[path]` arg (defaults to cwd) must contain
 *      `agentic.json`.
 *   2. Read `agentic.json` → `manifestPath` (relative to repo root).
 *   3. Read `models/<slug>-v1/workflow_v1.json` + `actions_v1.json`.
 *   4. Run `tsc --noEmit` on the tenant's TS code so a broken handler can't
 *      land in prod. Skipped with `--no-typecheck`.
 *   5. POST the manifest to `/v1/agents`. Server returns
 *      `{ workflow_version_id, version, diff, note }`.
 *   6. Pretty-print the diff (added/modified/removed agents).
 *
 * Flags:
 *   --no-typecheck       Skip step 4 (useful in CI where types ran separately)
 *   --note <text>        Deployment note (audit log + UI)
 *   --workflow-slug <s>  Override the workflow slug (defaults to <tenant>-default)
 */
import { readFile, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import type { RunContext } from "../cli.js";

interface AgenticJson {
  slug: string;
  name?: string;
  version?: string;
  manifestPath?: string;
  codeRoot?: string;
  description?: string;
}

interface DeployOptions {
  tenantRoot: string;
  noTypecheck: boolean;
  note?: string;
  workflowSlug?: string;
}

interface ApiOkPayload {
  workflow_version_id: string;
  version: string;
  diff: {
    added: string[];
    modified: string[];
    removed: string[];
    prior_version: string | null;
  };
  note: string;
}

interface ApiOk<T> {
  ok: true;
  data: T;
}
interface ApiErr {
  ok: false;
  error: { code: string; message: string; hint?: string };
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function parseDeployOptions(ctx: RunContext): DeployOptions {
  const arg = ctx.args.positional[0];
  return {
    tenantRoot: path.resolve(process.cwd(), arg ?? "."),
    noTypecheck: ctx.args.flags["no-typecheck"] === true,
    note:
      typeof ctx.args.flags["note"] === "string"
        ? (ctx.args.flags["note"] as string)
        : undefined,
    workflowSlug:
      typeof ctx.args.flags["workflow-slug"] === "string"
        ? (ctx.args.flags["workflow-slug"] as string)
        : undefined,
  };
}

async function readTenantManifest(
  tenantRoot: string,
): Promise<AgenticJson> {
  const p = path.join(tenantRoot, "agentic.json");
  if (!(await exists(p))) {
    throw new Error(
      `deploy: no agentic.json at ${p}. Pass a tenant path or cd into one. Bootstrap with 'agentic init <slug>'.`,
    );
  }
  const raw = await readFile(p, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `deploy: ${p} is not valid JSON: ${err instanceof Error ? err.message : err}`,
    );
  }
  const m = parsed as AgenticJson;
  if (!m.slug) throw new Error(`deploy: ${p} missing required field "slug"`);
  return m;
}

function resolveRepoRoot(tenantRoot: string): string {
  // tenantRoot is .../data/tenants/<slug>; repo root is ../../..
  const parts = tenantRoot.split(path.sep);
  for (let i = parts.length - 1; i >= 2; i--) {
    if (parts[i - 1] === "tenants" && parts[i - 2] === "data") {
      return parts.slice(0, i - 2).join(path.sep) || path.sep;
    }
  }
  // Fallback: caller is running from a non-standard location. Use cwd.
  return process.cwd();
}

async function readWorkflow(repoRoot: string, manifestPath: string): Promise<{
  workflow: unknown[];
  actions: unknown[] | null;
}> {
  const wfPath = path.join(repoRoot, manifestPath, "workflow_v1.json");
  const acPath = path.join(repoRoot, manifestPath, "actions_v1.json");
  if (!(await exists(wfPath))) {
    throw new Error(`deploy: workflow not found at ${wfPath}`);
  }
  const workflow = JSON.parse(await readFile(wfPath, "utf-8")) as unknown[];
  if (!Array.isArray(workflow)) {
    throw new Error(`deploy: ${wfPath} is not a JSON array of agents`);
  }
  let actions: unknown[] | null = null;
  if (await exists(acPath)) {
    const a = JSON.parse(await readFile(acPath, "utf-8")) as unknown;
    if (a && typeof a === "object" && "actions" in a) {
      actions = (a as { actions: unknown[] }).actions ?? [];
    } else if (Array.isArray(a)) {
      actions = a;
    }
  }
  return { workflow, actions };
}

async function runTsc(tenantRoot: string): Promise<{ ok: boolean; output: string }> {
  const tsconfig = path.join(tenantRoot, "tsconfig.json");
  if (!(await exists(tsconfig))) {
    return { ok: true, output: "(no tsconfig.json; skipping typecheck)" };
  }
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsc", "--noEmit", "-p", tsconfig], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: tenantRoot,
    });
    let buf = "";
    child.stdout?.on("data", (b) => {
      buf += b.toString();
    });
    child.stderr?.on("data", (b) => {
      buf += b.toString();
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, output: buf.trim() });
    });
    child.on("error", (err) => {
      resolve({ ok: false, output: `tsc failed to launch: ${err.message}` });
    });
  });
}

async function postManifest(
  ctx: RunContext,
  body: {
    manifest: unknown[];
    actions: unknown[] | null;
    note?: string;
    workflowSlug?: string;
  },
): Promise<ApiOkPayload> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (ctx.apiToken) headers["Authorization"] = `Bearer ${ctx.apiToken}`;
  const res = await fetch(`${ctx.apiUrl}/v1/agents`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      manifest: body.manifest,
      actions: body.actions ?? [],
      note: body.note,
      workflowSlug: body.workflowSlug,
    }),
  });
  let parsed: ApiOk<ApiOkPayload> | ApiErr;
  try {
    parsed = (await res.json()) as ApiOk<ApiOkPayload> | ApiErr;
  } catch {
    throw new Error(
      `deploy: api returned ${res.status} with non-JSON body`,
    );
  }
  if (!parsed.ok) {
    throw new Error(
      `deploy: ${parsed.error.code} — ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

export async function runDeploy(ctx: RunContext): Promise<number> {
  const opts = parseDeployOptions(ctx);
  const manifest = await readTenantManifest(opts.tenantRoot);
  const repoRoot = resolveRepoRoot(opts.tenantRoot);
  const manifestPath = manifest.manifestPath ?? `models/${manifest.slug}-v1`;

  ctx.stdout.write(`Deploying tenant "${manifest.slug}"\n`);
  ctx.stdout.write(`  manifest:  ${manifestPath}\n`);

  if (!opts.noTypecheck) {
    ctx.stdout.write("  typecheck: ");
    const tsc = await runTsc(opts.tenantRoot);
    if (!tsc.ok) {
      ctx.stdout.write("FAILED\n\n");
      ctx.stderr.write(tsc.output + "\n");
      ctx.stderr.write(
        "\ndeploy: aborting due to typecheck failure. Re-run with --no-typecheck to bypass.\n",
      );
      return 1;
    }
    ctx.stdout.write("ok\n");
  } else {
    ctx.stdout.write("  typecheck: skipped (--no-typecheck)\n");
  }

  const { workflow, actions } = await readWorkflow(repoRoot, manifestPath);
  ctx.stdout.write(`  agents:    ${workflow.length}\n`);

  ctx.stdout.write("  uploading… ");
  const result = await postManifest(ctx, {
    manifest: workflow,
    actions,
    note: opts.note,
    workflowSlug: opts.workflowSlug,
  });
  ctx.stdout.write("done\n\n");

  ctx.stdout.write(`Deployed ${result.version}\n`);
  ctx.stdout.write(`  workflow_version_id: ${result.workflow_version_id}\n`);
  if (result.diff.added.length > 0) {
    ctx.stdout.write(`  + added (${result.diff.added.length}):    ${result.diff.added.join(", ")}\n`);
  }
  if (result.diff.modified.length > 0) {
    ctx.stdout.write(`  ~ modified (${result.diff.modified.length}): ${result.diff.modified.join(", ")}\n`);
  }
  if (result.diff.removed.length > 0) {
    ctx.stdout.write(`  - removed (${result.diff.removed.length}):  ${result.diff.removed.join(", ")}\n`);
  }
  if (result.note) ctx.stdout.write(`\n${result.note}\n`);
  return 0;
}
