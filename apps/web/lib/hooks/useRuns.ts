/**
 * useRuns — TanStack Query wrappers around `/v1/runs` and `/v1/runs/:id`.
 *
 * Cache invalidation is driven by `useStream()` (see useStream.ts). Components
 * that read this hook automatically re-render on `run.started`,
 * `run.step.{started,completed}`, `run.completed`, and `run.failed` SSE
 * events — no window listeners required.
 */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { RUN_KEYS, COUNT_KEYS } from "./useStream";

interface ApiOk<T> {
  ok: true;
  data: T;
}
interface ApiErr {
  ok: false;
  error: { code: string; message: string };
}

async function callV1<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
    ...init,
  });
  const body = (await res.json()) as ApiOk<T> | ApiErr;
  if (!body.ok) {
    throw new Error(`${path}: ${body.error.code} — ${body.error.message}`);
  }
  return body.data;
}

export interface RunListFilter {
  status?: string;
  agent?: string;
  q?: string;
  limit?: number;
  /**
   * P3-FE-04 — only runs whose `parentRunId` matches this. Used by the
   * trace-tree view to load the children of the current run.
   */
  parentRunId?: string;
}

function buildQuery(filter: RunListFilter | undefined): string {
  if (!filter) return "";
  const sp = new URLSearchParams();
  if (filter.status) sp.set("status", filter.status);
  if (filter.agent) sp.set("agent", filter.agent);
  if (filter.q) sp.set("q", filter.q);
  if (filter.limit) sp.set("limit", String(filter.limit));
  if (filter.parentRunId) sp.set("parentRunId", filter.parentRunId);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export interface RunListRow {
  id: string;
  status: string;
  agentName: string;
  agentTitle: string | null;
  subject: string | null;
  triggerEvent: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  model: string | null;
  currentStepName: string | null;
  currentStepOrd: number | null;
  stepCount: number | null;
  /** P3-FE-04 — id of the parent run when this run is a sub-run. */
  parentRunId?: string | null;
  /** P2-FE-18 — TEST RUN badge driver. */
  testRun?: boolean;
  error?: string | null;
  emittedEvent?: string | null;
}

export function useRuns(
  filter?: RunListFilter,
): UseQueryResult<RunListRow[]> {
  const query = buildQuery(filter);
  return useQuery({
    queryKey: filter
      ? RUN_KEYS.list(filter as Record<string, unknown>)
      : RUN_KEYS.list(),
    queryFn: () => callV1<RunListRow[]>(`/v1/runs${query}`),
    staleTime: 2_000,
  });
}

export interface StepRow {
  id: string;
  ord: number;
  name: string;
  type: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  error: string | null;
  provider: string | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
}

export interface RunDetail {
  run: RunListRow;
  steps: StepRow[];
}

export function useRun(id: string | null | undefined): UseQueryResult<RunDetail> {
  return useQuery({
    queryKey: id ? RUN_KEYS.detail(id) : (["runs", "detail", "__none__"] as const),
    queryFn: () => callV1<RunDetail>(`/v1/runs/${encodeURIComponent(id!)}`),
    enabled: Boolean(id),
  });
}

/** Replay a run: `/v1/runs/:id/replay` */
export function useReplayRun() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      callV1<{ replayed_run: string; new_event_id: string }>(
        `/v1/runs/${encodeURIComponent(id)}/replay`,
        { method: "POST" },
      ),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: RUN_KEYS.all });
      void client.invalidateQueries({ queryKey: COUNT_KEYS.tenant });
    },
  });
}
