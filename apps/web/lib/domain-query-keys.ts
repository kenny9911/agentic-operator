/** Shared by server hydration and client queries; identity includes the owner. */
export const DOMAIN_KEYS = {
  tenant: (tenant: string) => ["domains", tenant] as const,
  detail: (tenant: string, domain: string | null) =>
    ["domains", tenant, "detail", domain] as const,
};
