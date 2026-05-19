/**
 * Ontology + manifest loader.
 *
 * Per RF-1.4: each tenant's ontology lives in `models/<tenant-slug>-v<n>/`
 * and ships 5 files. Two are runtime-load-bearing (workflow + actions); the
 * other three are pass-through metadata served via the api.
 */

import { z } from "zod";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const ActorEnum = z.enum(["Agent", "Human"]);
export const StepTypeEnum = z.enum(["tool", "logic", "manual"]);

export const ActionSchema = z.object({
  order: z.string(),
  name: z.string(),
  description: z.string().optional().default(""),
  type: StepTypeEnum,
  condition: z.string().optional(),
  task_type: z.string().optional(),
  retries: z.number().int().nonnegative().optional(),
  timeout_s: z.number().int().positive().optional(),
});
export type ActionSpec = z.infer<typeof ActionSchema>;

export const AgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional().default(""),
  actor: z.array(ActorEnum).min(1),
  trigger: z.array(z.string()),
  actions: z.array(ActionSchema),
  triggered_event: z.array(z.string()),
});
export type AgentSpec = z.infer<typeof AgentSchema>;

export const WorkflowManifestSchema = z.array(AgentSchema);
export type WorkflowManifest = z.infer<typeof WorkflowManifestSchema>;

export const ActionsManifestSchema = z.array(z.record(z.string(), z.unknown()));
export type ActionsManifest = z.infer<typeof ActionsManifestSchema>;

/** Per-event metadata for the Events catalog view. Loose schema. */
export const EventCatalogEntry = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    category: z.string().optional(),
    color: z.string().optional(),
    payload: z.unknown().optional(),
  })
  .passthrough();
export const EventCatalogSchema = z.object({
  events: z.array(EventCatalogEntry).optional(),
  metadata: z.unknown().optional(),
});

/** Per-entity metadata from objects.json. */
export const EntityPropertySchema = z
  .object({
    name: z.string(),
    type: z.string().optional(),
    description: z.string().optional(),
    is_foreign_key: z.boolean().optional(),
    references: z.string().optional(),
  })
  .passthrough();
export const EntitySchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    primary_key: z.string().optional(),
    properties: z.array(EntityPropertySchema).optional(),
  })
  .passthrough();
export const ObjectsManifestSchema = z.object({
  payload: z.array(EntitySchema).optional(),
  metadata: z.unknown().optional(),
});

/** Per-rule metadata from rules.json. Pass-through. */
export const RulesManifestSchema = z
  .object({
    payload: z.array(z.unknown()).optional(),
    metadata: z.unknown().optional(),
  })
  .passthrough();

export interface LoadedManifest {
  manifest: WorkflowManifest;
  actionsExt: ActionsManifest;
  manifestPath: string;
  actionsPath: string;
}

export interface LoadedModels extends LoadedManifest {
  events: z.infer<typeof EventCatalogSchema>;
  objects: z.infer<typeof ObjectsManifestSchema>;
  rules: z.infer<typeof RulesManifestSchema>;
  dir: string;
}

/**
 * Resolve a model file in a dir. Accepts the bare name (`workflow.json`),
 * a versioned suffix (`workflow_v1.json`, `workflow_v2.json`, …), and any
 * legacy alias. Returns the first existing path, or null if none.
 */
async function resolveModelFile(
  dir: string,
  candidates: string[],
): Promise<string | null> {
  let allFiles: string[];
  try {
    const { readdir } = await import("node:fs/promises");
    allFiles = await readdir(dir);
  } catch {
    return null;
  }
  for (const c of candidates) {
    if (allFiles.includes(c)) return path.join(dir, c);
  }
  // versioned fallback: <base>_v<N>.json
  for (const c of candidates) {
    const base = c.replace(/\.json$/, "");
    const versioned = allFiles
      .filter((f) => new RegExp(`^${base}_v\\d+(\\.\\d+)*\\.json$`).test(f))
      .sort()
      .reverse();
    if (versioned.length > 0) return path.join(dir, versioned[0]!);
  }
  return null;
}

async function readJsonFileOptional<T>(
  filePath: string | null,
  schema: z.ZodType<T>,
  fallback: T,
): Promise<T> {
  if (!filePath) return fallback;
  const raw = JSON.parse(await readFile(filePath, "utf8"));
  return schema.parse(raw);
}

/**
 * Backwards-compat wrapper: loads workflow + actions from a dir.
 * Accepts versioned names (`workflow_v1.json`).
 */
export async function loadManifestFromDisk(
  workflowDir: string,
): Promise<LoadedManifest> {
  const workflowPath = await resolveModelFile(workflowDir, [
    "workflow.json",
    "manifest.json",
  ]);
  if (!workflowPath) {
    throw new Error(
      `[manifest] no workflow.json found in ${workflowDir}`,
    );
  }
  const actionsPath = await resolveModelFile(workflowDir, ["actions.json"]);
  const manifest = WorkflowManifestSchema.parse(
    JSON.parse(await readFile(workflowPath, "utf8")),
  );
  const actionsExt = await readJsonFileOptional(
    actionsPath,
    ActionsManifestSchema,
    [],
  );
  return {
    manifest,
    actionsExt,
    manifestPath: workflowPath,
    actionsPath: actionsPath ?? path.join(workflowDir, "actions.json"),
  };
}

/**
 * Load all 5 ontology files from a tenant model directory.
 */
export async function loadModelsFromDisk(
  modelDir: string,
): Promise<LoadedModels> {
  const base = await loadManifestFromDisk(modelDir);
  const [eventsPath, objectsPath, rulesPath] = await Promise.all([
    resolveModelFile(modelDir, ["events.json"]),
    resolveModelFile(modelDir, ["objects.json"]),
    resolveModelFile(modelDir, ["rules.json"]),
  ]);
  const [events, objects, rules] = await Promise.all([
    readJsonFileOptional(eventsPath, EventCatalogSchema, { events: [] }),
    readJsonFileOptional(objectsPath, ObjectsManifestSchema, { payload: [] }),
    readJsonFileOptional(rulesPath, RulesManifestSchema, { payload: [] }),
  ]);
  return { ...base, events, objects, rules, dir: modelDir };
}

/**
 * Derive tenant slug from a model folder name.
 *   "RAAS-v1"        → "raas"
 *   "supportflow-v3" → "supportflow"
 *   "finance"        → "finance"
 */
export function tenantSlugFromFolder(folder: string): string {
  return folder.toLowerCase().replace(/-v\d+(\.\d+)*$/i, "");
}
