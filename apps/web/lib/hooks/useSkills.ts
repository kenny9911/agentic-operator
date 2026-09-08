"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { z } from "zod";
import {
  SkillDetailSchema,
  SkillListResponseSchema,
  SkillRevisionHistorySchema,
  SkillValidationResponseSchema,
  SkillImportPreviewSchema,
  ManagedSkillGenerationResponseSchema,
  SkillVersionSchema,
  SkillVersionHistorySchema,
  SkillDraftSchema,
  type SkillBundle,
  type GenerateSkillBody,
  type SkillVisibilitySchema,
} from "@agentic/contracts";
import {
  fetchApiData,
  fetchApiResponse,
  readApiData,
} from "@/lib/api-response";
import { tenantFromPathname, tenantHeader } from "./tenant-header";

type Visibility = z.infer<typeof SkillVisibilitySchema>;
export const skillKeys = {
  root: ["skills"] as const,
  tenant: (tenant: string) => ["skills", tenant] as const,
  list: (tenant: string, scope: string, archived: boolean) =>
    ["skills", tenant, "list", scope, archived] as const,
  detail: (tenant: string, id: string) =>
    ["skills", tenant, "detail", id] as const,
};

async function request<S extends z.ZodType>(
  path: string,
  schema: S,
  body?: unknown,
  signal?: AbortSignal,
  method = body === undefined ? "GET" : "POST",
  tenant?: string,
): Promise<z.output<S>> {
  const data = await fetchApiData<unknown>(path, {
    method,
    signal,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(tenant === undefined
        ? tenantHeader()
        : { "x-agentic-tenant": tenant }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return schema.parse(data);
}
const pathFor = (id: string) => `/v1/skills/${encodeURIComponent(id)}`;
export const skillApi = {
  get: (id: string, signal?: AbortSignal, tenant?: string) =>
    request(pathFor(id), SkillDetailSchema, undefined, signal, "GET", tenant),
  create: (
    bundle: SkillBundle,
    visibility: Visibility = "tenant",
    tenant?: string,
  ) =>
    request(
      "/v1/skills",
      SkillDetailSchema,
      { bundle, visibility },
      undefined,
      "POST",
      tenant,
    ),
  save: (id: string, expectedRevision: number, bundle: SkillBundle) =>
    request(
      `${pathFor(id)}/draft`,
      SkillDetailSchema,
      { expectedRevision, bundle },
      undefined,
      "PUT",
    ),
  validate: (bundle: SkillBundle, signal?: AbortSignal, tenant?: string) =>
    request(
      "/v1/skills/validate",
      SkillValidationResponseSchema,
      { bundle },
      signal,
      "POST",
      tenant,
    ),
  publish: (id: string, expectedRevision: number) =>
    request(`${pathFor(id)}/publish`, SkillDetailSchema, { expectedRevision }),
  archive: (
    id: string,
    body: {
      archived: boolean;
      expectedRevision: number;
      expectedLatestVersionId: string | null;
    },
  ) => request(`${pathFor(id)}/archive`, SkillDetailSchema, body),
  revisions: (id: string, offset = 0, tenant?: string) =>
    request(
      `${pathFor(id)}/revisions?offset=${offset}&limit=50`,
      SkillRevisionHistorySchema,
      undefined,
      undefined,
      "GET",
      tenant,
    ),
  revision: (id: string, revision: number) =>
    request(`${pathFor(id)}/revisions/${revision}`, SkillDraftSchema),
  versions: (id: string, offset = 0, tenant?: string) =>
    request(
      `${pathFor(id)}/versions?offset=${offset}&limit=50`,
      SkillVersionHistorySchema,
      undefined,
      undefined,
      "GET",
      tenant,
    ),
  version: (
    id: string,
    versionId: string,
    signal?: AbortSignal,
    tenant?: string,
  ) =>
    request(
      `${pathFor(id)}/versions/${encodeURIComponent(versionId)}`,
      SkillVersionSchema,
      undefined,
      signal,
      "GET",
      tenant,
    ),
  restore: (id: string, expectedRevision: number, revision: number) =>
    request(`${pathFor(id)}/restore`, SkillDetailSchema, {
      expectedRevision,
      revision,
    }),
  preview: (
    body:
      | { format: "zip"; archiveBase64: string }
      | { format: "markdown"; content: string }
      | { format: "bundle"; bundle: SkillBundle },
    signal?: AbortSignal,
    tenant?: string,
  ) =>
    request(
      "/v1/skills/import/preview",
      SkillImportPreviewSchema,
      body,
      signal,
      "POST",
      tenant,
    ),
  import: (
    bundle: SkillBundle,
    visibility: Visibility = "tenant",
    tenant?: string,
  ) =>
    request(
      "/v1/skills/import",
      SkillDetailSchema,
      {
        format: "bundle",
        bundle,
        visibility,
      },
      undefined,
      "POST",
      tenant,
    ),
  generate: (
    body: GenerateSkillBody & { visibility?: Visibility },
    signal?: AbortSignal,
    tenant?: string,
  ) =>
    request(
      "/v1/skills/generate",
      ManagedSkillGenerationResponseSchema,
      body,
      signal,
      "POST",
      tenant,
    ),
  revise: (
    id: string,
    body: GenerateSkillBody & { expectedRevision: number },
    signal?: AbortSignal,
    tenant?: string,
  ) =>
    request(
      `${pathFor(id)}/generate`,
      ManagedSkillGenerationResponseSchema,
      body,
      signal,
      "POST",
      tenant,
    ),
  async export(
    id: string,
    name: string,
    options: {
      format?: "zip" | "markdown";
      draft?: boolean;
      versionId?: string;
    } = {},
  ) {
    const query = new URLSearchParams({
      format: options.format ?? "zip",
      ...(options.draft ? { draft: "true" } : {}),
      ...(options.versionId ? { versionId: options.versionId } : {}),
    });
    const path = `${pathFor(id)}/export?${query}`;
    const response = await fetchApiResponse(path, {
      credentials: "same-origin",
      headers: tenantHeader(),
    });
    if (!response.ok) await readApiData(response, path);
    const mediaType = response.headers.get("Content-Type")?.split(";")[0];
    if (
      !response.ok ||
      !["application/zip", "text/markdown", "text/plain"].includes(
        mediaType ?? "",
      )
    )
      throw new Error("Skill export returned an invalid download.");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download =
      options.format === "markdown"
        ? "SKILL.md"
        : `${name.replace(/[^a-z0-9-]/gi, "-") || "skill"}.zip`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
};

export function useSkills(
  options: {
    scope?: "available" | "owned" | "shared";
    archived?: boolean;
  } = {},
) {
  const tenant = tenantFromPathname(usePathname() ?? "") ?? "";
  const scope = options.scope ?? "available";
  const archived = options.archived ?? false;
  return useInfiniteQuery({
    queryKey: skillKeys.list(tenant, scope, archived),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      request(
        `/v1/skills?scope=${scope}&archived=${archived}&offset=${pageParam}&limit=50`,
        SkillListResponseSchema,
        undefined,
        signal,
        "GET",
        tenant,
      ),
    getNextPageParam: (page) => page.nextOffset ?? undefined,
    enabled: Boolean(tenant),
    staleTime: 10_000,
  });
}

export function useSkill(id: string, enabled = true) {
  const tenant = tenantFromPathname(usePathname() ?? "") ?? "";
  return useQuery({
    queryKey: skillKeys.detail(tenant, id),
    queryFn: ({ signal }) => skillApi.get(id, signal, tenant),
    enabled: enabled && Boolean(id) && Boolean(tenant),
    staleTime: 10_000,
  });
}

/** A detail response contains only recent version summaries. Resolve an older
 * authored pin by its exact immutable id without expanding every detail read. */
export function useSkillVersion(
  id: string,
  versionId: string | undefined,
  enabled = true,
  tenantScope?: string,
) {
  const routeTenant = tenantFromPathname(usePathname() ?? "") ?? "";
  const tenant = tenantScope ?? routeTenant;
  return useQuery({
    queryKey: [...skillKeys.detail(tenant, id), "version", versionId ?? null],
    queryFn: ({ signal }) => {
      if (!versionId) throw new Error("A pinned Skill version is required");
      return skillApi.version(id, versionId, signal, tenant);
    },
    enabled: enabled && Boolean(id && versionId && tenant),
    staleTime: 10_000,
  });
}
