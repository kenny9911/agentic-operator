/**
 * useStream — subscribe to the per-tenant `/v1/stream` SSE channel and
 * dispatch each event into TanStack Query's cache invalidator.
 *
 * Replaces the v0 `useLiveData` window-event pattern (the SPA's old
 * `window.addEventListener('raas-runs-updated', …)`). Phase 1 (P1-FE-02).
 *
 * Wiring:
 *
 *   import { QueryClientProvider } from "@tanstack/react-query";
 *   import { useStream } from "@/lib/hooks/useStream";
 *
 *   function PortalShell() {
 *     useStream();   // mount once at the app root
 *     return <Routes />;
 *   }
 *
 * The hook is intentionally idempotent — closing/reopening a connection is
 * cheap. Callers don't need to thread `enabled` state through.
 */
"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { scopedStreamPath } from "@/lib/portal-scope";
import { useQueryClient } from "@tanstack/react-query";
import { RunStreamEvent, type RunStreamEvent as StreamEvent } from "@agentic/contracts";

export interface UseStreamOptions {
  /** Override the SSE path. Defaults to `/v1/stream`. */
  path?: string;
  /**
   * Auto-reconnect with exponential backoff on disconnect. Defaults to true.
   * Tests can pass `false` to keep behaviour deterministic.
   */
  reconnect?: boolean;
  /** Keep the chrome's resume point with its scope cache across navigation. */
  retainCursor?: boolean;
  /** Local replay consumers can leave cache invalidation to portal chrome. */
  invalidateQueries?: boolean;
  /**
   * Called for every parsed event. Useful for a debug ticker or a
   * tweaks-panel inspector. Cache invalidation still happens internally.
   */
  onEvent?: (event: StreamEvent) => void;
  /** Transport lifecycle for connection-aware surfaces such as Live terminal. */
  onStatusChange?: (status: StreamConnectionState) => void;
}

export type StreamConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed";

const MAX_BACKOFF_MS = 30_000;

/** Preserve the last durable SSE id when this hook creates a new EventSource.
 * Native EventSource only carries Last-Event-ID while it owns the reconnect;
 * our explicit backoff closes that instance, so the cursor must travel in the
 * proxy URL and be translated back into a header server-side. */
export function streamPathWithCursor(path: string, lastEventId: string): string {
  if (!lastEventId) return path;
  const absolute = /^https?:\/\//i.test(path);
  const url = new URL(path, "http://agentic.local");
  url.searchParams.set("lastEventId", lastEventId);
  return absolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
}

/** A replay consumer starts from history; the chrome resumes its retained
 * scope. Query-cache storage means eviction and logout erase the cursor too. */
export function createStreamCursor(client: QueryClient, path: string, retain = false) {
  const key = ["stream", "cursor", path] as const;
  if (retain) client.setQueryDefaults(["stream", "cursor"], { gcTime: Infinity });
  let lastEventId = retain ? client.getQueryData<string>(key) ?? "" : "";
  return {
    path: () => streamPathWithCursor(path, lastEventId),
    remember(id: string) {
      if (!id) return;
      lastEventId = id;
      if (retain) client.setQueryData(key, id);
    },
  };
}

export function useStream(opts: UseStreamOptions = {}): void {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const path = scopedStreamPath(opts.path ?? "/livefeed", pathname);
  const reconnect = opts.reconnect ?? true;
  const retainCursor = opts.retainCursor ?? false;
  const invalidateQueries = opts.invalidateQueries ?? true;
  const onEventRef = useRef(opts.onEvent);
  const onStatusChangeRef = useRef(opts.onStatusChange);

  useEffect(() => {
    onEventRef.current = opts.onEvent;
    onStatusChangeRef.current = opts.onStatusChange;
  }, [opts.onEvent, opts.onStatusChange]);

  useEffect(() => {
    let es: EventSource | null = null;
    let attempt = 0;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cursor = createStreamCursor(queryClient, path, retainCursor);

    function connect() {
      if (cancelled) return;
      onStatusChangeRef.current?.(attempt > 0 ? "reconnecting" : "connecting");
      // EventSource defaults to credentialed same-origin requests; the
      // browser sends the session cookie automatically through Next's
      // /v1/* rewrite to apps/api.
      es = new EventSource(cursor.path(), {
        withCredentials: true,
      });

      es.onopen = () => {
        attempt = 0;
        onStatusChangeRef.current?.("connected");
      };

      es.onmessage = (msg) => {
        if (cancelled) return;
        cursor.remember(msg.lastEventId);
        let payload: unknown;
        try {
          payload = JSON.parse(msg.data);
        } catch (error) {
          console.warn("[useStream] dropping non-JSON event", error);
          return;
        }
        const parsed = RunStreamEvent.safeParse(payload);
        if (!parsed.success) {
          console.warn("[useStream] dropping malformed event", parsed.error);
          return;
        }
        if (invalidateQueries) dispatch(parsed.data, queryClient);
        onEventRef.current?.(parsed.data);
      };

      es.onerror = () => {
        if (es) es.close();
        es = null;
        if (!reconnect || cancelled) {
          onStatusChangeRef.current?.("closed");
          return;
        }
        attempt += 1;
        onStatusChangeRef.current?.("reconnecting");
        const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** Math.min(attempt, 6));
        timer = setTimeout(connect, delay);
      };
    }

    connect();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (es) es.close();
      onStatusChangeRef.current?.("closed");
    };
  }, [path, reconnect, retainCursor, invalidateQueries, queryClient]);
}

// ─── Cache invalidation strategy ─────────────────────────────────────────────
// Each SSE event maps to a small fan-out of `queryClient.invalidateQueries`
// calls. Keys match what `useRuns / useEvents / useTasks / useAgents` register.
// Keep this in lockstep with the query keys exported below.

export const RUN_KEYS = {
  all: ["runs"] as const,
  list: (filter?: Record<string, unknown>) =>
    filter ? (["runs", "list", filter] as const) : (["runs", "list"] as const),
  detail: (id: string) => ["runs", "detail", id] as const,
  logs: (id: string) => ["runs", "logs", id] as const,
};

export const EVENT_KEYS = {
  all: ["events"] as const,
  list: (filter?: Record<string, unknown>) =>
    filter ? (["events", "list", filter] as const) : (["events", "list"] as const),
};

export const TASK_KEYS = {
  all: ["tasks"] as const,
  list: ["tasks", "list"] as const,
  detail: (id: string) => ["tasks", "detail", id] as const,
};

export const AGENT_KEYS = {
  all: ["agents"] as const,
  list: ["agents", "list"] as const,
  detail: (kebab: string) => ["agents", "detail", kebab] as const,
};

export const COUNT_KEYS = {
  tenant: ["counts"] as const,
};

export const DEPLOYMENT_KEYS = {
  list: ["deployments", "list"] as const,
};

export const USAGE_KEYS = {
  all: ["usage"] as const,
};

export const AUDIT_KEYS = {
  all: ["audit"] as const,
};

export const OBSERVABILITY_KEYS = {
  all: ["observability"] as const,
};

import type { QueryClient } from "@tanstack/react-query";

/**
 * Coalescing layer over invalidateQueries.
 *
 * Frames arrive in bursts, not singly: connecting to the stream replays the
 * recent tail, and one power-scm scenario fans out to five agents that emit
 * continuously for several seconds. Invalidating per frame turns a 65-frame
 * burst into ~200 refetches — measured on the workflows canvas — which alone
 * exhausts the api's 600-reads-per-minute budget (plugins/security.ts:147) and
 * then feeds itself, because TanStack retries the resulting 429s.
 *
 * Keys collected inside one window collapse by serialised identity, so N
 * frames touching the same key cost exactly one refetch. The window is short
 * enough to stay imperceptible next to the refetch itself.
 */
const COALESCE_WINDOW_MS = 220;

interface InvalidationQueue {
  keys: Map<string, readonly unknown[]>;
  timer: ReturnType<typeof setTimeout>;
}
// Each QueryClient belongs to one Tenant/Domain pair. A pending old-scope
// flush must never absorb the new scope's events during navigation.
const invalidationQueues = new Map<QueryClient, InvalidationQueue>();

export function queueInvalidate(client: QueryClient, queryKey: readonly unknown[]): void {
  let queue = invalidationQueues.get(client);
  if (!queue) {
    const keys = new Map<string, readonly unknown[]>();
    const timer = setTimeout(() => {
      invalidationQueues.delete(client);
      for (const pending of keys.values()) void client.invalidateQueries({ queryKey: pending });
    }, COALESCE_WINDOW_MS);
    queue = { keys, timer };
    invalidationQueues.set(client, queue);
  }
  queue.keys.set(JSON.stringify(queryKey), queryKey);
}

export function resetInvalidationQueue(): void {
  for (const queue of invalidationQueues.values()) clearTimeout(queue.timer);
  invalidationQueues.clear();
}

export function dispatch(event: StreamEvent, client: QueryClient): void {
  switch (event.type) {
    case "run.started":
    case "run.failed":
    case "run.cancelled":
    case "run.completed": {
      // The list views all show status; counts shows running runs.
      queueInvalidate(client, RUN_KEYS.all);
      queueInvalidate(client, COUNT_KEYS.tenant);
      queueInvalidate(client, RUN_KEYS.detail(event.runId));
      // Token/cost totals and per-agent/model series are persisted on run
      // lifecycle changes. Prefix invalidation refreshes every selected range.
      queueInvalidate(client, USAGE_KEYS.all);
      queueInvalidate(client, OBSERVABILITY_KEYS.all);
      // Per-agent throughput changes as runs start/finish. Prefix-match
      // invalidates every window variant ("1h"/"24h"/"7d").
      queueInvalidate(client, ["workflows", "throughput"] as const);
      break;
    }
    case "run.step.started":
    case "run.step.completed": {
      // ONLY this run's detail. Step frames are by far the highest-volume
      // event on this stream — one power-scm scenario fans out to five agents
      // and emits ~80 within a few seconds — so anything broader melts the
      // read budget: the api allows 600 reads/min (security.ts:147) and a
      // list refetch per frame blows through it, whereupon TanStack retries
      // the 429s and the storm feeds itself. The list's current-step badge
      // goes slightly stale between frames and is repaired by the
      // run.started/run.completed handlers above (rare enough to afford the
      // ["runs"] prefix) and by useRuns' own 15s refetchInterval.
      queueInvalidate(client, RUN_KEYS.detail(event.runId));
      break;
    }
    case "event.emitted": {
      queueInvalidate(client, EVENT_KEYS.all);
      queueInvalidate(client, COUNT_KEYS.tenant);
      queueInvalidate(client, OBSERVABILITY_KEYS.all);
      break;
    }
    case "task.created":
    case "task.resolved": {
      queueInvalidate(client, TASK_KEYS.all);
      queueInvalidate(client, COUNT_KEYS.tenant);
      break;
    }
    case "deployment.created": {
      // UC-V11-06: refresh the deployments list so a hot-reload lands in
      // the table immediately. The toast itself is fired by the chrome
      // (see chrome.tsx onEvent handler), which has access to useToast().
      queueInvalidate(client, DEPLOYMENT_KEYS.list);
      // Deployments can add or replace live agents. Keep both the agents page
      // and the sidebar's canonical count projection in sync with that write.
      queueInvalidate(client, AGENT_KEYS.all);
      queueInvalidate(client, COUNT_KEYS.tenant);
      break;
    }
    case "audit.recorded": {
      queueInvalidate(client, AUDIT_KEYS.all);
      queueInvalidate(client, OBSERVABILITY_KEYS.all);
      break;
    }
    case "llm.call.completed": {
      queueInvalidate(client, USAGE_KEYS.all);
      queueInvalidate(client, OBSERVABILITY_KEYS.all);
      break;
    }
    case "tool.call.completed": {
      queueInvalidate(client, RUN_KEYS.detail(event.runId));
      queueInvalidate(client, OBSERVABILITY_KEYS.all);
      break;
    }
    case "log.line": {
      // Consumed directly by terminal subscribers; no query-backed surface.
      break;
    }
  }
}
