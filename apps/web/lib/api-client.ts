/**
 * Typed API client. Server components import this; the api lives at
 * AGENTIC_API_URL (env). Browser-side calls hit the same paths through
 * Next.js rewrites (next.config.ts).
 *
 * Every method runs the response data through its @agentic/contracts Zod
 * schema — which uses z.coerce.date() so ISO strings auto-coerce back to
 * Date objects. A server-component crash here means the api shape drifted.
 */

import { z } from "zod";
import {
  RunRow,
  StepRow,
  EventRow,
  TaskRow,
  DeploymentRow,
  ListAgentRow,
  AgentDetail,
  TenantCounts,
  DagAgent,
  DagEdge,
  type ListRunsQuery,
  type ListEventsQuery,
} from "@agentic/contracts";

const API_URL = process.env.AGENTIC_API_URL ?? "http://localhost:3501";
const API_TOKEN = process.env.AGENTIC_API_TOKEN ?? "";

interface ApiOk<T> {
  ok: true;
  data: T;
}
interface ApiErr {
  ok: false;
  error: { code: string; message: string; hint?: string };
}
type ApiResp<T> = ApiOk<T> | ApiErr;

async function call<S extends z.ZodTypeAny>(
  schema: S,
  path: string,
  init: RequestInit & { query?: Record<string, string | number | undefined> } = {},
): Promise<z.infer<S>> {
  const url = new URL(path, API_URL);
  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (API_TOKEN) headers["Authorization"] = `Bearer ${API_TOKEN}`;

  const r = await fetch(url, { ...init, headers, cache: "no-store" });
  const body = (await r.json()) as ApiResp<unknown>;
  if (!body.ok) {
    throw new Error(`api ${path}: ${body.error.code} — ${body.error.message}`);
  }
  return schema.parse(body.data);
}

// ─── Runs ────────────────────────────────────────────────────────────────

const GetRunPayload = z.object({ run: RunRow, steps: z.array(StepRow) });
const ReplayRunPayload = z.object({
  replayed_run: z.string(),
  new_event_id: z.string(),
});

export const runs = {
  list: (opts: z.input<typeof import("@agentic/contracts").ListRunsQuery> = {}) =>
    call(z.array(RunRow), "/v1/runs", { query: opts as never }),
  get: (id: string) =>
    call(GetRunPayload, `/v1/runs/${encodeURIComponent(id)}`),
  replay: (id: string) =>
    call(ReplayRunPayload, `/v1/runs/${encodeURIComponent(id)}/replay`, {
      method: "POST",
    }),
};

// ─── Events ──────────────────────────────────────────────────────────────

const IngestPayload = z.object({ event_id: z.string(), name: z.string() });
const ReplayEventPayload = z.object({
  replayed: z.string(),
  new_event_id: z.string(),
});

export const events = {
  list: (opts: z.input<typeof import("@agentic/contracts").ListEventsQuery> = {}) =>
    call(z.array(EventRow), "/v1/events", { query: opts as never }),
  ingest: (body: { name: string; subject?: string; payload?: Record<string, unknown> }) =>
    call(IngestPayload, "/v1/events", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  replay: (id: string) =>
    call(ReplayEventPayload, `/v1/events/${encodeURIComponent(id)}/replay`, {
      method: "POST",
    }),
};

// ─── Tasks ───────────────────────────────────────────────────────────────

const ResolvePayload = z.object({
  task_id: z.string(),
  decision: z.enum(["approve", "reject"]),
});

export const tasks = {
  list: () => call(z.array(TaskRow), "/v1/tasks"),
  get: (id: string) => call(TaskRow, `/v1/tasks/${encodeURIComponent(id)}`),
  resolve: (id: string, body: { decision: "approve" | "reject"; payload?: unknown }) =>
    call(ResolvePayload, `/v1/tasks/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

// ─── Agents ──────────────────────────────────────────────────────────────

const AgentDetailWithRuns = AgentDetail.extend({
  recentRuns: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      subject: z.string().nullable(),
      startedAt: z.coerce.date().nullable(),
      durationMs: z.number().nullable(),
    }),
  ),
});

const ManifestUploadPayload = z.object({
  workflow_version_id: z.string(),
  version: z.string(),
  diff: z.object({
    added: z.array(z.string()),
    modified: z.array(z.string()),
    removed: z.array(z.string()),
    prior_version: z.string().nullable(),
  }),
  note: z.string(),
});

export const agents = {
  list: () => call(z.array(ListAgentRow), "/v1/agents"),
  get: (kebab: string) =>
    call(AgentDetailWithRuns, `/v1/agents/${encodeURIComponent(kebab)}`),
  uploadManifest: (body: {
    manifest: unknown[];
    actions?: unknown[];
    note?: string;
    workflowSlug?: string;
  }) =>
    call(ManifestUploadPayload, "/v1/agents", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

// ─── Deployments ─────────────────────────────────────────────────────────

const DeploymentsListPayload = z.object({
  list: z.array(DeploymentRow),
  live: DeploymentRow.nullable(),
});
const RollbackPayload = z.object({
  deployment_id: z.string(),
  status: z.literal("live"),
  note: z.string(),
});

export const deployments = {
  list: () => call(DeploymentsListPayload, "/v1/deployments"),
  rollback: (id: string) =>
    call(
      RollbackPayload,
      `/v1/deployments/${encodeURIComponent(id)}/rollback`,
      { method: "POST" },
    ),
};

// ─── Workflows / counts ──────────────────────────────────────────────────

const DagPayload = z.object({
  agents: z.array(DagAgent),
  edges: z.array(DagEdge),
  workflowVersion: z.string(),
});

export const workflows = {
  dag: () => call(DagPayload, "/v1/workflows/dag"),
};

export const counts = () => call(TenantCounts, "/v1/counts");

// ─── Ontology (event_types + entity_types catalogs) ──────────────────────

const EventTypeRow = z.object({
  name: z.string(),
  category: z.string().nullable(),
  color: z.string().nullable(),
  description: z.string().nullable(),
});
export type EventTypeRow = z.infer<typeof EventTypeRow>;

const EntityTypeRow = z.object({
  entityId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  primaryKeyName: z.string().nullable(),
});
export type EntityTypeRow = z.infer<typeof EntityTypeRow>;

export const ontology = {
  eventTypes: () => call(z.array(EventTypeRow), "/v1/event-types"),
  entityTypes: () => call(z.array(EntityTypeRow), "/v1/entity-types"),
};
