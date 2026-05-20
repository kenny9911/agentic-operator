/**
 * Emit `models/workflow.schema.json` from the canonical `WorkflowManifestSchema`.
 *
 * The JSON Schema is the editor-facing source of truth for `workflow_v*.json`
 * files: IDEs that follow `$schema` will autocomplete and validate the manifest
 * shape. The runtime always parses with the Zod schema directly; this file is
 * a generated artifact only.
 *
 * Modes:
 *   - default        rewrite `models/workflow.schema.json` from current Zod
 *   - `--check`      build in-memory, compare to disk, exit 1 on diff
 *                    (used by CI to gate "did you forget to regenerate?")
 *
 * Run with: pnpm --filter @agentic/runtime run gen:schema
 *           pnpm --filter @agentic/runtime run gen:schema:check
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod";
import { WorkflowManifestSchema } from "./manifest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
const OUT_PATH = path.join(REPO_ROOT, "models", "workflow.schema.json");

/**
 * Patch the auto-generated JSON Schema so it accepts the on-disk legacy
 * shapes that the runtime's Zod `preprocess` hooks normalize away.
 *
 * Editor-side validators only see the static JSON Schema (preprocess hooks
 * aren't representable in JSON Schema), so without these patches the schema
 * would reject perfectly valid manifests that the runtime parses fine.
 */
function applyOnDiskShimsToSchema(schema: Record<string, unknown>): void {
  const item = (schema as { items?: Record<string, unknown> }).items;
  if (!item || typeof item !== "object") return;
  const props = (item as { properties?: Record<string, unknown> }).properties;
  if (!props) return;

  // tool_use: canonical is array of {name, …}, but legacy shapes are tolerated.
  const canonicalToolUse = props.tool_use as Record<string, unknown> | undefined;
  if (canonicalToolUse) {
    props.tool_use = {
      description:
        "Tools advertised to the LLM. Canonical: array of {name, description?, input_schema?}. Runtime also accepts an array of bare tool-name strings, or an empty string as a no-tools placeholder.",
      anyOf: [
        canonicalToolUse,
        { type: "array", items: { type: "string" } },
        { type: "string", maxLength: 0 },
      ],
    };
  }

  // Actions: on disk either `id` or `order` may carry the step identifier;
  // `name` and `type` may be omitted (the runtime fills them from id/order
  // and defaults the type to "logic"). Loosen `required` accordingly.
  const actions = props.actions as { items?: Record<string, unknown> } | undefined;
  if (actions?.items && typeof actions.items === "object") {
    const actionItem = actions.items as Record<string, unknown>;
    actionItem.required = [];
    actionItem.description =
      "Step in an agent's action list. On disk either `id` or `order` must be present; missing `name` falls back to `id`/`order`, and missing `type` defaults to 'logic' at runtime.";
    actionItem.anyOf = [
      { required: ["id"] },
      { required: ["order"] },
    ];
  }
}

/**
 * Build the editor-facing JSON Schema in memory. Pure — no IO. Used by both
 * the write path and the CI check path.
 */
export function buildWorkflowJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(WorkflowManifestSchema, {
    target: "draft-2020-12",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  applyOnDiskShimsToSchema(schema);
  return {
    title: "Agentic Operator Workflow Manifest",
    description:
      "Canonical shape of `models/<tenant>-v<n>/workflow_v*.json`. Generated from `packages/runtime/src/manifest.ts` (WorkflowManifestSchema). Some legacy on-disk shapes (eg `tool_use: \"\"`, array-of-strings tool refs, omitted `name`/`type`/`order` on actions) are tolerated by the runtime and accepted by this schema; the runtime normalizes them at parse time.",
    ...schema,
  };
}

/**
 * Canonical on-disk serialization: 2-space indent + trailing newline. Both
 * the write path and the diff check use this same formatter so a "no-op"
 * regeneration produces byte-identical output.
 */
export function serializeWorkflowSchema(schema: Record<string, unknown>): string {
  return JSON.stringify(schema, null, 2) + "\n";
}

async function writeSchema(): Promise<void> {
  const text = serializeWorkflowSchema(buildWorkflowJsonSchema());
  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, text, "utf8");
  console.log(`wrote ${OUT_PATH}`);
}

async function checkSchema(): Promise<void> {
  const expected = serializeWorkflowSchema(buildWorkflowJsonSchema());
  let actual: string;
  try {
    actual = await readFile(OUT_PATH, "utf8");
  } catch (err) {
    console.error(
      `[gen:schema:check] ${OUT_PATH} is missing. Run: pnpm --filter @agentic/runtime run gen:schema`,
    );
    process.exit(1);
  }
  if (actual === expected) {
    console.log(`[gen:schema:check] OK — ${OUT_PATH} matches current Zod schema`);
    return;
  }
  console.error(
    `[gen:schema:check] ${OUT_PATH} is stale.\n` +
      `The Zod schema in packages/runtime/src/manifest.ts has changed but the generated JSON Schema was not regenerated.\n` +
      `Fix: pnpm --filter @agentic/runtime run gen:schema && git add models/workflow.schema.json`,
  );
  // Show a small unified-ish diff hint (first 12 differing lines) without
  // shelling out — keeps the CI log self-contained.
  const actualLines = actual.split("\n");
  const expectedLines = expected.split("\n");
  const maxLines = Math.max(actualLines.length, expectedLines.length);
  let printed = 0;
  for (let i = 0; i < maxLines && printed < 12; i++) {
    const a = actualLines[i];
    const e = expectedLines[i];
    if (a !== e) {
      if (a !== undefined) console.error(`  -${i + 1}: ${a}`);
      if (e !== undefined) console.error(`  +${i + 1}: ${e}`);
      printed++;
    }
  }
  process.exit(1);
}

async function main(): Promise<void> {
  const mode = process.argv.includes("--check") ? "check" : "write";
  if (mode === "check") {
    await checkSchema();
  } else {
    await writeSchema();
  }
}

// Run only when invoked as a script (skip when imported as a module).
const invokedAsScript =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("generate-workflow-schema.ts") === true;
if (invokedAsScript) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
