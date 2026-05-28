/**
 * useTools — TanStack Query wrapper around GET /v1/tools.
 *
 * Returns the catalog of every globally-registered tool in
 * @agentic/tools, including per-tenant config schema + a copy-paste
 * config example. Used by the portal's Tools view so manifest authors
 * can browse what's available without grepping the codebase.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { tenantHeader } from "./tenant-header";

export interface ToolFieldSchema {
  type: string;
  required?: boolean;
  description?: string;
  default?: unknown;
}

export interface ToolCatalogEntry {
  name: string;
  category: string;
  summary: string;
  description?: string;
  /** Shape of the LLM-supplied arguments. */
  argsSchema?: Record<string, ToolFieldSchema>;
  argsExample?: Record<string, unknown>;
  /** Per-tenant config keys from manifest tool_use[].config. */
  configSchema?: Record<string, ToolFieldSchema>;
  configExample?: Record<string, unknown>;
  /** Shape of the success return value. */
  returnsSchema?: Record<string, ToolFieldSchema>;
  returnsExample?: unknown;
  /** Tools this one chains with via ctx.lastResult. */
  chainsWith?: string[];
  aliases?: string[];
  sourcePath: string;
}

export interface ToolCatalogPayload {
  tools: ToolCatalogEntry[];
  count: number;
  categories: string[];
}

interface ApiOk<T> {
  ok: true;
  data: T;
}
interface ApiErr {
  ok: false;
  error: { code: string; message: string };
}

async function callV1<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { Accept: "application/json", ...tenantHeader() },
  });
  const body = (await res.json()) as ApiOk<T> | ApiErr;
  if (!body.ok) {
    throw new Error(`${path}: ${body.error.code} — ${body.error.message}`);
  }
  return body.data;
}

export function useTools(): UseQueryResult<ToolCatalogPayload> {
  return useQuery({
    queryKey: ["tools", "catalog"] as const,
    queryFn: () => callV1<ToolCatalogPayload>("/v1/tools"),
    // The catalog is process-stable (boot-time registry) — refetch on
    // window focus is wasteful. 5 minutes is generous; the operator can
    // hard-refresh if the api ships a new tool.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}
