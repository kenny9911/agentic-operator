/**
 * useDeployTenantCode — mutation for `POST /v1/tenants/:slug/code`,
 * powering the in-portal code-agent authoring save flow (P3-FE-02).
 *
 * Request body:
 *   { version: string, tarballBase64: string, note?: string }
 *
 * The caller builds the tarball with `buildTar()` + `gzipToBase64()` from
 * `app/portal/components/agent-code/tar.ts`.
 */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AGENT_KEYS } from "./useStream";
import { tenantHeader } from "./tenant-header";

interface ApiOk<T> {
  ok: true;
  data: T;
}
interface ApiErr {
  ok: false;
  error: { code: string; message: string };
}

async function callV1<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { headers: initHeaders, ...rest } = init;
  const res = await fetch(path, {
    credentials: "same-origin",
    ...rest,
    headers: {
      Accept: "application/json",
      ...tenantHeader(),
      ...(initHeaders as Record<string, string> | undefined),
    },
  });
  const body = (await res.json()) as ApiOk<T> | ApiErr;
  if (!body.ok) {
    throw new Error(`${path}: ${body.error.code} — ${body.error.message}`);
  }
  return body.data;
}

export interface TenantCodeDeployBody {
  version: string;
  tarballBase64: string;
  note?: string;
}

export interface TenantCodeDeployResponse {
  workflow_version_id: string;
  deployment_id: string;
  version: string;
}

export function useDeployTenantCode(slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: TenantCodeDeployBody) =>
      callV1<TenantCodeDeployResponse>(
        `/v1/tenants/${encodeURIComponent(slug)}/code`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: AGENT_KEYS.all });
      // Hot-reload could land a new agent version; refresh the bootstrap too.
      void client.invalidateQueries({ queryKey: ["spa", "bootstrap"] as const });
    },
  });
}
