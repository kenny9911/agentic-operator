/**
 * SPA bootstrap payload — shape expected by apps/web/public/portal/data.js
 * (the v1_1 prototype). Each field maps to one of the `window.RAAS_*` globals.
 */

export type SpaAgent = {
  id: string;
  name: string;
  title: string;
  description: string;
  actor: "Agent" | "Human";
  stage: number;
  triggers: string[];
  emits: string[];
  steps: string[];
  tools: string[];
  model: string;
  input_data: Record<string, unknown>;
  ontology_instructions: string;
  tool_use: unknown;
  typescript_code: string;
};

export type SpaEvent = {
  name: string;
  category: string;
  color: string;
};

export type SpaStage = { id: number; label: string };
export type SpaReq = {
  id: string;
  title: string;
  client: string;
  city: string;
  level: string;
  openings: number;
};
export type SpaCandidate = {
  id: string;
  name: string;
  role: string;
  years: number;
  school: string;
};
export type SpaRun = Record<string, unknown>;
export type SpaEventStreamItem = Record<string, unknown>;
export type SpaTask = Record<string, unknown>;
export type SpaDeployment = Record<string, unknown>;
export type SpaTenant = {
  id: string;
  name: string;
  subtitle: string;
  color: string;
  active: boolean;
  agentCount: number;
  runs24h: number;
};

export type SpaBootstrap = {
  source: "json" | "neo4j";
  loadedAt: string;
  agents: SpaAgent[];
  events: SpaEvent[];
  stages: SpaStage[];
  reqs: SpaReq[];
  candidates: SpaCandidate[];
  runs: SpaRun[];
  eventStream: SpaEventStreamItem[];
  tasks: SpaTask[];
  sampleLog: string;
  deployments: SpaDeployment[];
  tenants: SpaTenant[];
};

export type DataSource = "json" | "neo4j";
