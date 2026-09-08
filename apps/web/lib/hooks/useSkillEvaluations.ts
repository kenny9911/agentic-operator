"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { z } from "zod";
import {
  SkillEvaluationListSchema,
  SkillEvaluationSchema,
  type CreateSkillEvaluationBody,
  type GradeSkillEvaluationBody,
} from "@agentic/contracts";
import { fetchApiData } from "@/lib/api-response";
import { tenantFromPathname } from "./tenant-header";

export const skillEvaluationKeys = {
  list: (tenant: string, id: string) =>
    ["skill-evaluations", tenant, id] as const,
};
async function request<S extends z.ZodType>(
  tenant: string,
  path: string,
  schema: S,
  body?: unknown,
  signal?: AbortSignal,
): Promise<z.output<S>> {
  return schema.parse(
    await fetchApiData<unknown>(path, {
      method: body === undefined ? "GET" : "POST",
      signal,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "x-agentic-tenant": tenant,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}
const endpoint = (id: string) =>
  `/v1/skills/${encodeURIComponent(id)}/evaluations`;
export const skillEvaluationApi = {
  list: (tenant: string, id: string, offset = 0, signal?: AbortSignal) =>
    request(
      tenant,
      `${endpoint(id)}?offset=${offset}&limit=20`,
      SkillEvaluationListSchema,
      undefined,
      signal,
    ),
  get: (
    tenant: string,
    id: string,
    evaluationId: string,
    signal?: AbortSignal,
  ) =>
    request(
      tenant,
      `${endpoint(id)}/${encodeURIComponent(evaluationId)}`,
      SkillEvaluationSchema,
      undefined,
      signal,
    ),
  run: (
    tenant: string,
    id: string,
    body: CreateSkillEvaluationBody,
    signal: AbortSignal,
  ) => request(tenant, endpoint(id), SkillEvaluationSchema, body, signal),
  grade: (
    tenant: string,
    id: string,
    evaluationId: string,
    body: GradeSkillEvaluationBody,
  ) =>
    request(
      tenant,
      `${endpoint(id)}/${encodeURIComponent(evaluationId)}/grade`,
      SkillEvaluationSchema,
      body,
    ),
};
export function useSkillEvaluations(id: string) {
  const tenant = tenantFromPathname(usePathname() ?? "") ?? "";
  return useInfiniteQuery({
    queryKey: skillEvaluationKeys.list(tenant, id),
    enabled: Boolean(tenant && id),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      skillEvaluationApi.list(tenant, id, pageParam, signal),
    getNextPageParam: (page) => page.nextOffset ?? undefined,
    staleTime: 5000,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) =>
        page.evaluations.some(
          (item) =>
            item.status === "running" &&
            Date.now() - item.createdAt < 4 * 60_000,
        ),
      )
        ? 5000
        : false,
  });
}
