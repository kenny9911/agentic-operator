/**
 * Source: models/RAAS-v1/*.json
 *
 * Loads the canonical workflow + events definitions from disk and transforms
 * them into the shape the v1_1 SPA expects.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  SAMPLE_CANDIDATES,
  SAMPLE_LOG,
  SAMPLE_REQS,
  SAMPLE_TENANTS,
  STAGES,
  collectEvents,
  enrichAgent,
  stageFromId,
  synthesizeDeployments,
  synthesizeEventStream,
  synthesizeRuns,
  synthesizeTasks,
  titleFromName,
} from "./derive";
import type { SpaAgent, SpaBootstrap, SpaEvent } from "./types";

const REPO_ROOT = path.resolve(process.cwd(), "../..");
const MODELS_DIR = path.join(REPO_ROOT, "models", "RAAS-v1");

type WorkflowNode = {
  id: string;
  name: string;
  description?: string;
  actor?: string[];
  trigger?: string[];
  input_data?: Record<string, unknown>;
  ontology_instructions?: string;
  actions?: Array<{ order?: string; name: string; description?: string; type?: string; condition?: string }>;
  typescript_code?: string;
  tool_use?: unknown;
  triggered_event?: string[];
};

type EventDef = {
  name: string;
  description?: string;
  payload?: unknown;
};

type EventsFile = {
  metadata?: Record<string, unknown>;
  events?: EventDef[];
};

const MODEL_OVERRIDES: Record<string, string> = {
  // Pin the default model per actor type. Most agents use sonnet; light-weight
  // routing agents use haiku.
  syncFromClientSystem: "claude-sonnet-4-5",
  analyzeRequirement: "claude-sonnet-4-5",
  clarifyRequirement: "claude-haiku-4-5",
  createJD: "claude-sonnet-4-5",
  assignRecruitTasks: "claude-haiku-4-5",
  publishJD: "claude-haiku-4-5",
  processResume: "claude-sonnet-4-5",
  ruleCheckerForClientResume: "claude-haiku-4-5",
  matchResume: "claude-sonnet-4-5",
  inviteInternalInterview: "claude-haiku-4-5",
  evaluateInterview: "claude-sonnet-4-5",
  refineResume: "claude-sonnet-4-5",
  generateRecommendationPackage: "claude-sonnet-4-5",
  submitToClientPortal: "claude-sonnet-4-5",
};

function modelFor(name: string): string {
  return MODEL_OVERRIDES[name] ?? "claude-sonnet-4-5";
}

function transformAgent(node: WorkflowNode): SpaAgent {
  const actor =
    Array.isArray(node.actor) && node.actor.length > 0
      ? node.actor[0] === "Human"
        ? "Human"
        : "Agent"
      : "Agent";
  return {
    id: node.id,
    name: node.name,
    title: titleFromName(node.name),
    description: node.description ?? "",
    actor,
    stage: stageFromId(node.id),
    triggers: node.trigger ?? [],
    emits: node.triggered_event ?? [],
    steps: (node.actions ?? []).map((a) => a.name),
    tools: [],
    model: actor === "Agent" ? modelFor(node.name) : "",
    input_data: node.input_data ?? {},
    ontology_instructions: node.ontology_instructions ?? "",
    tool_use: node.tool_use ?? "",
    typescript_code: node.typescript_code ?? "",
  };
}

/**
 * Merge events declared in events_v1.json with the implicit set derived from
 * the agent graph. The JSON-declared events take precedence for `description`,
 * but `category` + `color` are always derived from the name so the SPA
 * styling stays consistent.
 */
function mergeEvents(
  declared: EventDef[] | undefined,
  derived: SpaEvent[],
): SpaEvent[] {
  const map = new Map<string, SpaEvent>();
  for (const e of derived) map.set(e.name, e);
  if (declared) {
    for (const d of declared) {
      if (!map.has(d.name)) {
        // declared in events_v1.json but never referenced by the workflow —
        // still include it, deriving styling from the name pattern.
        const fromDerived = collectEvents([
          { ...({} as SpaAgent), triggers: [d.name], emits: [] },
        ])[0];
        if (fromDerived) map.set(d.name, fromDerived);
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadFromJson(): Promise<SpaBootstrap> {
  const [workflowRaw, eventsRaw] = await Promise.all([
    readFile(path.join(MODELS_DIR, "workflow_v1.json"), "utf-8"),
    readFile(path.join(MODELS_DIR, "events_v1.json"), "utf-8").catch(() => "{}"),
  ]);

  const workflow: WorkflowNode[] = JSON.parse(workflowRaw);
  const eventsFile: EventsFile = JSON.parse(eventsRaw);

  const agents = workflow.map(transformAgent).map(enrichAgent);
  const derivedEvents = collectEvents(agents);
  const events = mergeEvents(eventsFile.events, derivedEvents);

  const tenants = [...SAMPLE_TENANTS];
  if (tenants[0]) tenants[0].agentCount = agents.length;

  const runs = synthesizeRuns(agents, SAMPLE_REQS, SAMPLE_CANDIDATES);
  const eventStream = synthesizeEventStream(
    events,
    agents,
    SAMPLE_REQS,
    SAMPLE_CANDIDATES,
  );
  const tasks = synthesizeTasks(agents);
  const deployments = synthesizeDeployments(agents);

  return {
    source: "json",
    loadedAt: new Date().toISOString(),
    agents,
    events,
    stages: STAGES,
    reqs: SAMPLE_REQS,
    candidates: SAMPLE_CANDIDATES,
    runs,
    eventStream,
    tasks,
    sampleLog: SAMPLE_LOG,
    deployments,
    tenants,
  };
}
