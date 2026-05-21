/**
 * useDeployments — TanStack Query wrappers around `/v1/deployments`.
 *
 * Live deployment history + rollback. Replaces the bootstrap-synthesized
 * deployments list (`lib/spa/derive.ts → synthesizeDeployments`) that the
 * v1_1 SPA used for mock data. Tenant scope comes from the bearer
 * (AUTH_MODE=dev resolves it from AGENTIC_DEV_TENANT) — the path itself
 * isn't tenant-prefixed.
 *
 * Cache shape:
 *   - queryKey ["deployments", "list"]: { list, live }
 *
 * Mutations:
 *   - rollback(deploymentId): flips the live pointer; invalidates the list.
 *     Inngest re-register requires an api restart — surfaced in the response
 *     `note` field, not handled here.
 */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";

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

export interface DeploymentRow {
  id: string;
  versionId: string;
  versionString: string;
  status: "live" | "pending" | "rolled_back" | "superseded" | string;
  deployedAt: string | null;
  deployedBy: string | null;
  note: string | null;
  workflowSlug: string;
  agentCount: number;
}

export interface DeploymentsPayload {
  list: DeploymentRow[];
  live: DeploymentRow | null;
}

export interface RollbackPayload {
  deployment_id: string;
  status: "live";
  note: string;
}

export const DEPLOYMENT_KEYS = {
  list: ["deployments", "list"] as const,
};

export function useDeployments(): UseQueryResult<DeploymentsPayload> {
  return useQuery({
    queryKey: DEPLOYMENT_KEYS.list,
    queryFn: () => callV1<DeploymentsPayload>("/v1/deployments"),
    staleTime: 5_000,
  });
}

/**
 * Rollback a prior deployment to live. Invalidates the list on settle so the
 * "live" badge moves in the UI; the runtime requires an api restart for
 * Inngest to pick up the new manifest (surfaced in `note`).
 */
export function useRollbackDeployment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (deploymentId: string) =>
      callV1<RollbackPayload>(
        `/v1/deployments/${encodeURIComponent(deploymentId)}/rollback`,
        { method: "POST" },
      ),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: DEPLOYMENT_KEYS.list });
    },
  });
}
