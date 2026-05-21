"use client";

/**
 * useRaasData — React context wrapping the SPA bootstrap payload.
 *
 * Phase 2 (P2-FE) port of `apps/web/public/portal/data-context.jsx`. Fetches
 * `/api/spa/bootstrap` once on mount and exposes the agents/events/stages/runs
 * snapshot. **Live updates** to runs/events/tasks/agents flow through the
 * TanStack Query hooks (useRuns, useEvents, useTasks, useAgents) — this
 * context is only used for the workflow graph (stages + agent metadata) and
 * the few places that still want the synchronous snapshot.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import type {
  SpaAgent,
  SpaBootstrap,
  SpaCandidate,
  SpaDeployment,
  SpaEvent,
  SpaEventStreamItem,
  SpaReq,
  SpaStage,
  SpaTask,
  SpaTenant,
} from "@/lib/spa/types";

/**
 * Pure helper exposed for unit tests: extract the tenant slug from the
 * portal URL (`/portal/<slug>/...`). Returns null for top-level routes
 * (sign-in, the static-SPA fallback, the legacy `index.html` route).
 */
export function tenantFromPathname(pathname: string | null): string | null {
  if (!pathname) return null;
  if (pathname.endsWith("index.html")) return null;
  const m = pathname.match(/^\/portal\/([^/?#]+)/);
  return m ? (m[1] ?? null) : null;
}

/**
 * `SpaRun` is a `Record<string, unknown>` in the contract types but views
 * read a stable subset. This narrowed type makes the heavy views type-safe.
 */
export interface SpaRunShape {
  id: string;
  agentId: string;
  agentName?: string;
  agentTitle?: string;
  actor?: "Agent" | "Human";
  status: "running" | "ok" | "failed" | "waiting" | "paused" | "idle" | string;
  startedAt: number;
  endedAt?: number | null;
  durationMs?: number | null;
  triggerEvent?: string | null;
  emittedEvent?: string | null;
  subject?: string;
  model?: string;
  error?: string | null;
  testRun?: boolean;
  steps?: unknown[];
  currentStepName?: string | null;
  currentStepOrd?: number | null;
  stepCount?: number | null;
}

// Convenience aliases for downstream views.
export type RaasAgent = SpaAgent;
export type RaasEvent = SpaEvent;
export type RaasStage = SpaStage;
export type RaasReq = SpaReq;
export type RaasCandidate = SpaCandidate;
export type RaasRun = SpaRunShape;
export type RaasStreamItem = SpaEventStreamItem;
export type RaasTask = SpaTask;
export type RaasDeployment = SpaDeployment;
export type RaasTenant = SpaTenant;

export interface RaasData {
  agents: SpaAgent[];
  events: SpaEvent[];
  stages: SpaStage[];
  reqs: SpaReq[];
  candidates: SpaCandidate[];
  runs: SpaRunShape[];
  eventStream: SpaEventStreamItem[];
  tasks: SpaTask[];
  sampleLog: string;
  deployments: SpaDeployment[];
  tenants: SpaTenant[];
  loadedAt: string | null;
  source: "json";
}

const EMPTY: RaasData = {
  agents: [],
  events: [],
  stages: [],
  reqs: [],
  candidates: [],
  runs: [],
  eventStream: [],
  tasks: [],
  sampleLog: "",
  deployments: [],
  tenants: [
    {
      id: "raas",
      name: "RAAS",
      subtitle: "Loading…",
      color: "#d0ff00",
      active: true,
      agentCount: 0,
      runs24h: 0,
    },
  ],
  loadedAt: null,
  source: "json",
};

const DataContext = createContext<RaasData>(EMPTY);

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<RaasData>(EMPTY);
  // Re-fetch the bootstrap payload whenever the tenant segment in the URL
  // changes. Previously this had `[]` deps which left every tenant
  // showing the first-loaded tenant's snapshot (QA blocker #3).
  const pathname = usePathname();
  const tenantSlug = tenantFromPathname(pathname) ?? "raas";

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(
          `/api/spa/bootstrap?source=json&tenant=${encodeURIComponent(tenantSlug)}`,
          {
            credentials: "same-origin",
            headers: { Accept: "application/json" },
          },
        );
        if (!res.ok) return;
        const json = (await res.json()) as SpaBootstrap | { ok: false };
        if (cancelled) return;
        if ("ok" in json && json.ok === false) return;
        setData({ ...EMPTY, ...(json as unknown as RaasData) });
      } catch {
        // Network/parse error — keep EMPTY default so the UI still renders.
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  const value = useMemo(() => data, [data]);
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useRaasData(): RaasData {
  return useContext(DataContext);
}

/** Find one agent in the bootstrap payload. */
export function useAgentById(id: string | null | undefined): SpaAgent | null {
  const { agents } = useRaasData();
  return useMemo(() => {
    if (!id) return null;
    return agents.find((a) => a.id === id) ?? null;
  }, [agents, id]);
}

/** Find one event in the bootstrap payload. */
export function useEventByName(name: string | null | undefined): SpaEvent | null {
  const { events } = useRaasData();
  return useMemo(() => {
    if (!name) return null;
    return events.find((e) => e.name === name) ?? null;
  }, [events, name]);
}
