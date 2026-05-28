/**
 * useDemoMode — TanStack Query hooks for the runtime demo toggle.
 *
 * Backend: `POST /v1/demo/start`, `POST /v1/demo/stop`, `GET /v1/demo/status`
 * (apps/api/src/routes/v1/demo.ts). The status is also surfaced on
 * `/health` as `demoMode` / `llmGateway.defaultProvider`, but this hook
 * gives the sidebar a dedicated query key + mutations to flip the state
 * without an env edit + api restart.
 *
 * Stale time matches the sidebar polling cadence (10 s) so the toggle
 * lights up promptly after a manual env edit + restart, without
 * hammering the api.
 */
"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

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
    ...init,
    headers: {
      Accept: "application/json",
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
  });
  const body = (await res.json()) as ApiOk<T> | ApiErr;
  if (!body.ok) {
    throw new Error(`${path}: ${body.error.code} — ${body.error.message}`);
  }
  return body.data;
}

export interface DemoStatus {
  running: boolean;
  demoMode: boolean;
  runtimeOverride: boolean;
  llmProvider: string;
  llmModel: string | undefined;
  stats: {
    eventsFired: number;
    tasksResolved: number;
    ticksSkipped: number;
    errors: number;
  } | null;
}

export const DEMO_KEYS = {
  status: ["demo", "status"] as const,
};

export function useDemoStatus(): UseQueryResult<DemoStatus> {
  return useQuery({
    queryKey: DEMO_KEYS.status,
    queryFn: () => callV1<DemoStatus>("/v1/demo/status"),
    staleTime: 10_000,
    refetchInterval: 10_000,
  });
}

export function useStartDemo() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => callV1<DemoStatus>("/v1/demo/start", { method: "POST" }),
    onSuccess: (data) => {
      client.setQueryData(DEMO_KEYS.status, data);
      void client.invalidateQueries({ queryKey: ["health"] });
    },
  });
}

export function useStopDemo() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      callV1<DemoStatus & { wasRunning: boolean }>("/v1/demo/stop", {
        method: "POST",
      }),
    onSuccess: (data) => {
      client.setQueryData(DEMO_KEYS.status, data);
      void client.invalidateQueries({ queryKey: ["health"] });
    },
  });
}
