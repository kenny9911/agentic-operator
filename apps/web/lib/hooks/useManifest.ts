/**
 * useDeployManifest — mutation for `POST /v1/agents` (manifest upload),
 * powering the in-portal Workflow editor save flow (P3-FE-01).
 *
 * Request shape mirrors the `ManifestUploadBody` contract:
 *   { manifest: WorkflowManifest, workflowSlug?: string, note?: string, actions?: unknown[] }
 *
 * Response shape:
 *   {
 *     workflow_version_id: string,
 *     version: string,
 *     diff: { added: string[]; removed: string[]; modified: string[]; prior_version: string | null },
 *     note: string
 *   }
 *
 * On success we invalidate the agents/workflows/runs query keys so the
 * portal updates without a reload.
 */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AGENT_KEYS, COUNT_KEYS } from "./useStream";

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

export interface ManifestDeployResponse {
  workflow_version_id: string;
  version: string;
  diff: {
    added: string[];
    removed: string[];
    modified: string[];
    prior_version: string | null;
  };
  note: string;
}

export interface ManifestDeployBody {
  manifest: unknown[];
  workflowSlug?: string;
  note?: string;
  actions?: unknown[];
}

export function useDeployManifest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ManifestDeployBody) =>
      callV1<ManifestDeployResponse>("/v1/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: AGENT_KEYS.all });
      void client.invalidateQueries({ queryKey: COUNT_KEYS.tenant });
      void client.invalidateQueries({ queryKey: ["workflows"] as const });
    },
  });
}
