/**
 * SPA bootstrap loader — P1-FE-01.
 *
 * Fans out to the apps/api `/v1/*` REST surface and assembles the
 * `SpaBootstrap` payload the Babel-standalone portal expects. The old
 * JSON-on-disk synthesis (workflow_v1.json → fake runs/events/tasks) is
 * gone — empty DB means empty arrays.
 *
 * Eight endpoints are queried in parallel (each in its own try/catch so a
 * single 5xx degrades gracefully):
 *
 *   /v1/counts            → tenants[0].agentCount + tenants[0].runs24h
 *   /v1/agents?kind=all   → agents description hydration
 *   /v1/workflows/dag     → agent graph (id, kebabId, triggers, emits, stage)
 *   /v1/runs?limit=100    → recent runs
 *   /v1/events?limit=140  → recent event stream
 *   /v1/tasks             → open tasks
 *   /v1/event-types       → event catalog metadata
 *   /v1/entity-types      → entity catalog metadata
 *
 * Both `Cookie` and `Authorization` headers are forwarded so the apps/web
 * Next.js route can proxy any auth context the browser provides.
 */

import {
  SAMPLE_CANDIDATES,
  SAMPLE_LOG,
  SAMPLE_REQS,
  SAMPLE_TENANTS,
  STAGES,
  deriveEventCategory,
  deriveEventColor,
} from "./derive";
import type {
  SpaAgent,
  SpaBootstrap,
  SpaEvent,
  SpaEventStreamItem,
  SpaRun,
  SpaTask,
  SpaTenant,
} from "./types";

export interface BootstrapAuthHeaders {
  cookie: string | null;
  authorization: string | null;
}

const API_BASE =
  process.env.AGENTIC_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3501";

interface DagAgent {
  id: string;
  kebabId: string;
  name: string;
  title: string;
  actor: "Agent" | "Human";
  triggers: string[];
  emits: string[];
  stage: number;
  recentRunCount?: number;
  isLive?: boolean;
}

interface DagPayload {
  agents: DagAgent[];
  edges: unknown[];
  workflowVersion: string;
}

interface AgentInfo {
  id?: string;
  kebabId?: string;
  name?: string;
  description?: string;
  title?: string;
  actor?: "Agent" | "Human";
  kind?: "manifest" | "code";
  enabled?: boolean;
  runCount?: number;
  errorCount?: number;
  lastRunAt?: string | null;
}

interface EventTypeRow {
  name: string;
  category?: string | null;
  color?: string | null;
  description?: string | null;
}

interface EventLedgerRow {
  id: string;
  name: string;
  subject?: string | null;
  category?: string | null;
  color?: string | null;
  receivedAt?: string | number | null;
  sourceAgentName?: string | null;
  sourceAgentTitle?: string | null;
  payloadRef?: string | null;
}

interface CountsRow {
  agents?: number;
  runningRuns?: number;
  okRuns24h?: number;
  failedRuns24h?: number;
  events24h?: number;
  openTasks?: number;
  totalRuns?: number;
}

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message?: string };
}

function authHeaders(auth: BootstrapAuthHeaders): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (auth.authorization) headers["authorization"] = auth.authorization;
  if (auth.cookie) headers["cookie"] = auth.cookie;
  return headers;
}

async function fetchJson<T>(
  path: string,
  auth: BootstrapAuthHeaders,
): Promise<T | null> {
  try {
    const url = `${API_BASE}${path}`;
    const res = await fetch(url, { headers: authHeaders(auth) });
    if (!res.ok) return null;
    const body = (await res.json()) as ApiEnvelope<T>;
    if (!body.ok) return null;
    return (body.data ?? null) as T | null;
  } catch {
    return null;
  }
}

function toMs(t: string | number | null | undefined): number {
  if (t === null || t === undefined) return 0;
  if (typeof t === "number") return t;
  const parsed = Date.parse(t);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapAgent(d: DagAgent, info?: AgentInfo): SpaAgent {
  return {
    id: d.kebabId ?? d.id,
    name: d.name,
    title: d.title || d.name,
    description: info?.description ?? "",
    actor: d.actor === "Human" ? "Human" : "Agent",
    stage: d.stage ?? 0,
    triggers: d.triggers ?? [],
    emits: d.emits ?? [],
    steps: [],
    tools: [],
    model: "",
    input_data: {},
    ontology_instructions: "",
    tool_use: [],
    typescript_code: "",
  };
}

function mergeEvents(
  declared: EventTypeRow[],
  references: Set<string>,
): SpaEvent[] {
  const map = new Map<string, SpaEvent>();
  for (const d of declared) {
    map.set(d.name, {
      name: d.name,
      category: d.category ?? deriveEventCategory(d.name),
      color: d.color ?? deriveEventColor(d.name),
    });
  }
  for (const ref of references) {
    if (!map.has(ref)) {
      map.set(ref, {
        name: ref,
        category: deriveEventCategory(ref),
        color: deriveEventColor(ref),
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function mapRun(r: Record<string, unknown>): SpaRun {
  return {
    ...r,
    startedAt: toMs(r.startedAt as string | number | null),
    endedAt: r.endedAt == null ? null : toMs(r.endedAt as string | number),
  } as SpaRun;
}

function mapEventStream(
  rows: EventLedgerRow[],
  dagAgents: DagAgent[],
  agentsByName: Map<string, DagAgent>,
): SpaEventStreamItem[] {
  return rows.map((row) => {
    const downstream: string[] = [];
    for (const a of dagAgents) {
      if (a.triggers?.includes(row.name)) downstream.push(a.id);
    }
    const source = row.sourceAgentName
      ? agentsByName.get(row.sourceAgentName)
      : undefined;
    return {
      id: row.id,
      name: row.name,
      category: row.category ?? deriveEventCategory(row.name),
      color: row.color ?? deriveEventColor(row.name),
      at: toMs(row.receivedAt ?? null),
      source: source?.id ?? "external",
      sourceTitle: source?.title ?? row.sourceAgentTitle ?? "External",
      downstream,
      subject: row.subject ?? null,
      payloadBytes: row.payloadRef ? 0 : 0,
    };
  });
}

/**
 * Main entry — apps/web's `/api/spa/bootstrap` route calls this with the
 * forwarded headers from the browser.
 */
export async function loadBootstrapFromApi(
  auth: BootstrapAuthHeaders,
): Promise<SpaBootstrap> {
  const [
    counts,
    runs,
    events,
    tasks,
    agentInfos,
    dag,
    eventTypes,
    _entityTypes,
  ] = await Promise.all([
    fetchJson<CountsRow>("/v1/counts", auth),
    fetchJson<Record<string, unknown>[]>("/v1/runs?limit=100", auth),
    fetchJson<EventLedgerRow[]>("/v1/events?limit=140", auth),
    fetchJson<SpaTask[]>("/v1/tasks", auth),
    fetchJson<AgentInfo[]>("/v1/agents?kind=all", auth),
    fetchJson<DagPayload>("/v1/workflows/dag", auth),
    fetchJson<EventTypeRow[]>("/v1/event-types", auth),
    fetchJson<unknown[]>("/v1/entity-types", auth),
  ]);

  const dagAgents = dag?.agents ?? [];
  const infoByKebab = new Map<string, AgentInfo>();
  for (const info of agentInfos ?? []) {
    if (info.kebabId) infoByKebab.set(info.kebabId, info);
    else if (info.id) infoByKebab.set(info.id, info);
  }
  const infoByName = new Map<string, AgentInfo>();
  for (const info of agentInfos ?? []) {
    if (info.name) infoByName.set(info.name, info);
  }
  const agentsByName = new Map<string, DagAgent>();
  for (const d of dagAgents) {
    agentsByName.set(d.name, d);
  }
  // Hydrate agent description: prefer kebabId match, fall back to name match
  // since /v1/agents and /v1/workflows/dag both keep `name` in sync.
  const agents = dagAgents.map((d) =>
    mapAgent(d, infoByKebab.get(d.kebabId) ?? infoByName.get(d.name)),
  );

  // Collect every event name referenced anywhere so we can synthesize an
  // entry for emits that the DB hasn't seen yet.
  const references = new Set<string>();
  for (const a of dagAgents) {
    a.triggers?.forEach((t) => references.add(t));
    a.emits?.forEach((e) => references.add(e));
  }
  const mappedEvents = mergeEvents(eventTypes ?? [], references);

  // Tenant table: keep the SAMPLE_TENANTS seed (the SPA switcher still
  // renders the static three-tenant list) and overlay `/v1/counts` aggregates
  // on the active slot. The live tenant-list endpoint (`/v1/tenants`) is
  // fetched lazily by the App Router tenant-switcher component (P5-TEN-01),
  // not from this bootstrap path — keeping the fan-out at exactly eight
  // endpoints honors the bootstrap test contract.
  const tenants: SpaTenant[] = SAMPLE_TENANTS.map((t) => ({ ...t }));
  if (tenants[0]) {
    if (typeof counts?.agents === "number")
      tenants[0].agentCount = counts.agents;
    if (typeof counts?.totalRuns === "number")
      tenants[0].runs24h = counts.totalRuns;
  }

  return {
    source: "json",
    loadedAt: new Date().toISOString(),
    agents,
    events: mappedEvents,
    stages: STAGES,
    reqs: SAMPLE_REQS,
    candidates: SAMPLE_CANDIDATES,
    runs: (runs ?? []).map(mapRun),
    eventStream: mapEventStream(events ?? [], dagAgents, agentsByName),
    tasks: tasks ?? [],
    sampleLog: SAMPLE_LOG,
    deployments: [],
    tenants,
  };
}
