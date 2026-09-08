#!/usr/bin/env node
/**
 * Carve 场景二「数字化员工的智能作业实践」out of the
 * `procurement-hc-formal` ontology-package bundle and write it as the Studio
 * export layout `scripts/stage-hc-digital-worker-ontology.mjs` consumes.
 *
 *   node scripts/extract-hc-digital-worker-source.mjs \
 *     --package <path to package.json of the 0.1.8 bundle> \
 *     [--out ontology-packages/hc-digital-worker/source]
 *
 * WHY A SEPARATE EXTRACTION
 * -------------------------
 * The 0.1.8 bundle carries BOTH scenarios. 场景一 is already staged, compiled
 * and running from `ontology-packages/hc-procurement/source` (release 0.1.4),
 * and must stay exactly as it is. Restaging it from 0.1.8 would not be a no-op:
 * that release renamed every `action_steps[].id` (`s1` →
 * `collectChainExecutionData-s1`) and dropped the property suffix from every
 * `source_object` (`Procurement_Plan.plan_id` → `Procurement_Plan`). Both feed
 * the compiler, so the 场景一 manifest would change — cosmetically in the
 * ontology, materially in the deployed workflow.
 *
 * So this reads the bundle and keeps ONLY what 场景二 reaches: its workflow,
 * its actions, and the events / objects / rules / links those actions
 * reference. 场景一's own source directory is never touched.
 *
 * Output is byte-stable for a fixed input (sorted keys, no timestamps), so it
 * can be re-run as a drift detector.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The workflow whose closure defines 场景二. */
const WORKFLOW_ID = "procurement-digital-employee-operations";

/**
 * 场景一's action names, read from its own staged source rather than hardcoded
 * — if that scenario ever gains an action, this stays correct without an edit.
 */
const SCENARIO_ONE_SOURCE = "ontology-packages/hc-procurement/source";

function fail(message) {
  console.error(`[extract-hc-digital-worker] ${message}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    package: { type: "string" },
    out: { type: "string", default: "ontology-packages/hc-digital-worker/source" },
  },
});
if (!values.package) fail("--package <path to bundle package.json> is required");

const bundlePath = path.resolve(values.package);
const outDir = path.resolve(ROOT, values.out);

const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
const artifacts = bundle.artifacts ?? fail("bundle has no `artifacts`");
const manifest = bundle.manifest ?? {};

/** Sort object keys everywhere so the output is byte-stable. */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(sortKeys(value), null, 2)}\n`, "utf8");
}

// ── which actions belong to 场景二 ────────────────────────────────────────────
const scenarioOneActions = new Set(
  (() => {
    const dir = path.resolve(ROOT, SCENARIO_ONE_SOURCE);
    const file = readdirSync(dir)
      .filter((name) => name.startsWith("actions_v") && name.endsWith(".json"))
      .sort()
      .pop();
    if (!file) fail(`no actions_v*.json under ${SCENARIO_ONE_SOURCE}`);
    const parsed = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
    return (Array.isArray(parsed) ? parsed : (parsed.actions ?? [])).map(
      (action) => action.name,
    );
  })(),
);

const workflow =
  artifacts.workflows.find((candidate) => candidate.id === WORKFLOW_ID) ??
  fail(`bundle has no workflow ${WORKFLOW_ID}`);

/**
 * The workflow's own `actions[]` are step descriptors, not action definitions —
 * they carry the step name and nothing else. Match them back to the real
 * actions, and refuse any that 场景一 already owns: a shared action would mean
 * the two scenarios are not separable and this whole approach is wrong.
 */
const wanted = new Set(workflow.actions.map((step) => step.name));
const shared = [...wanted].filter((name) => scenarioOneActions.has(name));
if (shared.length > 0) {
  fail(
    `场景二 and 场景一 share action(s): ${shared.join(", ")} — they cannot be staged as separate domains`,
  );
}

const actions = artifacts.actions.filter((action) => wanted.has(action.name));
const byName = new Set(actions.map((action) => action.name));

/**
 * A workflow step that matches no action must be an inline decision node —
 * 「d·判断·库存是否满足」and its kind. Those are branch conditions the compiler
 * expresses from the emitting action's own gates, not actions in their own
 * right. Anything else missing is a real gap and stops the extraction.
 */
const unmatched = workflow.actions.filter((step) => !byName.has(step.name));
const notDecisions = unmatched.filter((step) => step.type !== "logic");
if (notDecisions.length > 0) {
  fail(
    `workflow names non-logic step(s) with no action definition: ${notDecisions
      .map((step) => `${step.name} (${step.type})`)
      .join(", ")}`,
  );
}

// ── the closure those actions reach ──────────────────────────────────────────
const eventNames = new Set();
for (const action of actions) {
  for (const name of action.trigger ?? []) eventNames.add(name);
  const emitted = action.triggered_event;
  for (const name of Array.isArray(emitted) ? emitted : emitted ? [emitted] : []) {
    eventNames.add(name);
  }
}

const objectNames = new Set();
for (const action of actions) {
  for (const port of [...(action.inputs ?? []), ...(action.outputs ?? [])]) {
    // `source_object` is either `Object` or the older `Object.property`.
    const ref = typeof port.source_object === "string" ? port.source_object : "";
    if (ref) objectNames.add(ref.split(".")[0]);
  }
  for (const target of action.target_objects ?? []) {
    if (typeof target === "string") objectNames.add(target.split(".")[0]);
  }
  for (const change of action.side_effects?.data_changes ?? []) {
    if (typeof change.target_object === "string") {
      objectNames.add(change.target_object.split(".")[0]);
    }
  }
}

const ruleIds = new Set();
for (const action of actions) {
  for (const binding of action.rule_bindings ?? []) {
    if (binding.rule_id) ruleIds.add(binding.rule_id);
  }
}
for (const ref of workflow.rule_refs ?? []) {
  if (typeof ref === "string") ruleIds.add(ref);
  else if (ref?.rule_id) ruleIds.add(ref.rule_id);
}

const events = artifacts.events.filter((event) =>
  eventNames.has(event.name ?? event.id),
);
// `id` is the machine name a source_object points at; `name` is its Chinese label.
const objects = artifacts.objects.filter((object) => objectNames.has(object.id));
const rules = artifacts.rules.filter((rule) => ruleIds.has(rule.id ?? rule.rule_id));

/** Links whose BOTH endpoints survived the carve — a dangling link is noise. */
const kept = new Set(objects.map((object) => object.id));
/** An endpoint is `{id, displayName, type}`, or a bare id on older exports. */
const endpointId = (side) =>
  typeof side === "string" ? side.split(".")[0] : (side?.id ?? "");
const links = artifacts.links.filter(
  (link) => kept.has(endpointId(link.from)) && kept.has(endpointId(link.to)),
);

// ── write the Studio layout ──────────────────────────────────────────────────
const stamp = {
  project_name: manifest.name ?? "采购-HC-Formal",
  source_package: `${bundle.manifest?.name ?? "procurement-hc-formal"}@${manifest.version ?? "0.1.8"}`,
  extracted_scenario: WORKFLOW_ID,
  note:
    "由 scripts/extract-hc-digital-worker-source.mjs 从本体包中切出场景二；" +
    "场景一保持在 ontology-packages/hc-procurement/source，未被本次抽取改动。",
};

writeJson(path.join(outDir, "actions_v0_1_008.json"), actions);
writeJson(path.join(outDir, "events_v0_1_008.json"), {
  metadata: { ...stamp, document_type: "领域事件 (Domain Events)" },
  events,
});
writeJson(path.join(outDir, "objects_v0_1_008.json"), {
  metadata: { ...stamp, document_type: "本体定义 (Ontology Schema)" },
  payload: objects,
});
writeJson(path.join(outDir, "rules_v0_2_008.json"), {
  metadata: { ...stamp, document_type: "业务规则 (Business Rules)" },
  payload: rules,
});
writeJson(path.join(outDir, "workflows_v0_1_008.json"), {
  metadata: { ...stamp, document_type: "工作流 (Workflows)" },
  workflows: [workflow],
});
writeJson(path.join(outDir, "links_v0_1_008.json"), {
  metadata: { ...stamp, document_type: "关系 (Links)" },
  links,
});

console.log(
  `[extract-hc-digital-worker] ${actions.length} actions, ${events.length} events, ` +
    `${objects.length} objects, ${rules.length} rules, ${links.length} links → ${path.relative(ROOT, outDir)}`,
);
