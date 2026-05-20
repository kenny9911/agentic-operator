/**
 * useEvents — TanStack Query wrappers around `/v1/events` and event replay.
 *
 * Cache invalidation driven by `useStream()` (see useStream.ts) on
 * `event.emitted` SSE events.
 */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { EVENT_KEYS, COUNT_KEYS } from "./useStream";

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

export interface EventListFilter {
  name?: string;
  subject?: string;
  limit?: number;
}

function buildQuery(f: EventListFilter | undefined): string {
  if (!f) return "";
  const sp = new URLSearchParams();
  if (f.name) sp.set("name", f.name);
  if (f.subject) sp.set("subject", f.subject);
  if (f.limit) sp.set("limit", String(f.limit));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export interface EventRow {
  id: string;
  name: string;
  subject: string | null;
  category: string | null;
  color: string | null;
  receivedAt: string | null;
  sourceAgentName: string | null;
  sourceAgentTitle: string | null;
  payloadRef: string | null;
}

export function useEvents(
  filter?: EventListFilter,
): UseQueryResult<EventRow[]> {
  const query = buildQuery(filter);
  return useQuery({
    queryKey: filter
      ? EVENT_KEYS.list(filter as Record<string, unknown>)
      : EVENT_KEYS.list(),
    queryFn: () => callV1<EventRow[]>(`/v1/events${query}`),
    staleTime: 2_000,
  });
}

/** Emit a new event: `POST /v1/events`. */
export function useEmitEvent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      subject?: string;
      payload?: Record<string, unknown>;
    }) =>
      callV1<{ event_id: string; name: string }>("/v1/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: EVENT_KEYS.all });
      void client.invalidateQueries({ queryKey: COUNT_KEYS.tenant });
    },
  });
}

/** Replay an event: `POST /v1/events/:id/replay`. */
export function useReplayEvent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      callV1<{ replayed: string; new_event_id: string }>(
        `/v1/events/${encodeURIComponent(id)}/replay`,
        { method: "POST" },
      ),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: EVENT_KEYS.all });
    },
  });
}
