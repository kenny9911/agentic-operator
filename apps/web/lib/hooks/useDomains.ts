"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Domain } from "@agentic/contracts";
import { fetchApiData } from "@/lib/api-response";

export type { Domain } from "@agentic/contracts";
import { DOMAIN_KEYS } from "@/lib/domain-query-keys";
export { DOMAIN_KEYS } from "@/lib/domain-query-keys";

async function callDomains<T>(tenant: string, path = "", init: RequestInit = {}): Promise<T> {
  return fetchApiData<T>(`/v1/domains${path}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "x-agentic-tenant": tenant,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

export function useDomains(tenant: string, includeArchived = false) {
  return useQuery({
    queryKey: [...DOMAIN_KEYS.tenant(tenant), "list", includeArchived],
    queryFn: () => callDomains<{ items: Domain[]; count: number }>(tenant, includeArchived ? "?include_archived=1" : ""),
    enabled: Boolean(tenant), staleTime: 5_000,
  });
}

export function useDomain(tenant: string, domain: string | null) {
  return useQuery({
    queryKey: DOMAIN_KEYS.detail(tenant, domain),
    queryFn: () => callDomains<{ domain: Domain }>(tenant, `/${encodeURIComponent(domain!)}`),
    enabled: Boolean(tenant && domain), staleTime: 5_000, retry: false,
  });
}

export function useDomainMutations(tenant: string) {
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: DOMAIN_KEYS.tenant(tenant) });
  const create = useMutation({
    mutationFn: (input: { slug: string; name: string; description?: string }) => callDomains<{ domain: Domain }>(tenant, "", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ slug, ...patch }: { slug: string; name: string; description?: string | null }) => callDomains<{ domain: Domain }>(tenant, `/${encodeURIComponent(slug)}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: invalidate,
  });
  const archive = useMutation({
    mutationFn: (slug: string) => callDomains<{ domain: Domain }>(tenant, `/${encodeURIComponent(slug)}`, { method: "DELETE", body: JSON.stringify({ confirm: slug }) }),
    onSuccess: invalidate,
  });
  const restore = useMutation({
    mutationFn: (slug: string) => callDomains<{ domain: Domain }>(tenant, `/${encodeURIComponent(slug)}/restore`, { method: "POST", body: "{}" }),
    onSuccess: invalidate,
  });
  return { create, update, archive, restore };
}

export interface DomainMember {
  userId: string; name: string; email: string;
  tenantRole: "admin" | "operator" | "viewer";
  domainRole: "admin" | "operator" | "viewer" | null;
}

export function useDomainMembers(tenant: string, domain: string) {
  const client = useQueryClient();
  const key = [...DOMAIN_KEYS.tenant(tenant), "members", domain];
  const query = useQuery({ queryKey: key, queryFn: () => callDomains<{ items: DomainMember[]; count: number }>(tenant, `/${encodeURIComponent(domain)}/members`) });
  const update = useMutation({
    mutationFn: (input: { userId: string; role: DomainMember["domainRole"] }) => input.role
      ? callDomains(tenant, `/${encodeURIComponent(domain)}/members`, { method: "PUT", body: JSON.stringify(input) })
      : callDomains(tenant, `/${encodeURIComponent(domain)}/members/${encodeURIComponent(input.userId)}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
  return { query, update };
}

interface DomainRuntimeStatus {
  enabled: boolean; status: "online" | "offline" | "blocked"; localFnCount: number;
  config?: { readiness: string; blockers?: string[] };
}

export function useDomainRuntime(tenant: string, domain: string) {
  const client = useQueryClient();
  const key = [...DOMAIN_KEYS.tenant(tenant), "runtime", domain];
  async function call<T>(suffix: string, init: RequestInit = {}) {
    return fetchApiData<T>(`/v1/tenants/${encodeURIComponent(tenant)}/${suffix}`, {
      ...init, credentials: "same-origin", headers: {
        "x-agentic-tenant": tenant, "x-agentic-domain": domain,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });
  }
  const query = useQuery({ queryKey: key, queryFn: () => call<DomainRuntimeStatus>("inngest-app"), staleTime: 5_000 });
  const update = useMutation({
    mutationFn: (enabled: boolean) => call<{ enabled: boolean; status: string; functionCount: number; brokerVerified: boolean }>("inngest-deployment", { method: "PUT", body: JSON.stringify({ enabled }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
  return { query, update };
}
