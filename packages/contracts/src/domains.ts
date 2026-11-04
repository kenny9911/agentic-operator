import { z } from "zod";

/** Route identity is local to the owning tenant, never an upstream ontology id. */
export const DomainSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(48)
  .regex(
    /^[a-z](?:[a-z0-9-]*[a-z0-9])?$/,
    "Use lowercase letters, digits and interior hyphens",
  );

export const DomainSchema = z
  .object({
    id: z.string(),
    tenantId: z.string(),
    // Legacy defaults retain their original route slug, including __system.
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    runtimeTenantId: z.string(),
    runtimeTenantSlug: z.string(),
    isDefault: z.boolean(),
    createdAt: z.number(),
    updatedAt: z.number(),
    archivedAt: z.number().nullable(),
  })
  .strict();
export type Domain = z.infer<typeof DomainSchema>;

export const CreateDomainBodySchema = z
  .object({
    slug: DomainSlugSchema,
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1_000).optional(),
  })
  .strict();
export type CreateDomainBody = z.infer<typeof CreateDomainBodySchema>;

export const UpdateDomainBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1_000).nullable().optional(),
  })
  .strict()
  .refine(
    (input) => input.name !== undefined || input.description !== undefined,
    "At least one mutable field is required",
  );
export type UpdateDomainBody = z.infer<typeof UpdateDomainBodySchema>;

export const ArchiveDomainBodySchema = z
  .object({ confirm: z.string() })
  .strict();
export const DomainListResponseSchema = z
  .object({
    items: z.array(DomainSchema),
    count: z.number().int().nonnegative(),
  })
  .strict();
export const DomainMutationResponseSchema = z
  .object({ domain: DomainSchema })
  .strict();

export const DomainMembershipSchema = z
  .object({
    domainId: z.string(),
    userId: z.string(),
    role: z.enum(["viewer", "operator", "admin"]),
    createdAt: z.number(),
  })
  .strict();
export type DomainMembership = z.infer<typeof DomainMembershipSchema>;
export const PutDomainMembershipBodySchema = z
  .object({
    userId: z.string().trim().min(1),
    role: z.enum(["viewer", "operator", "admin"]),
  })
  .strict();
export const DomainMembershipListResponseSchema = z
  .object({
    items: z.array(DomainMembershipSchema),
    count: z.number().int().nonnegative(),
  })
  .strict();

/** Only owner administrators receive the tenant roster for granting access. */
export const DomainMemberSchema = z
  .object({
    userId: z.string(),
    name: z.string(),
    email: z.string(),
    tenantRole: z.enum(["viewer", "operator", "admin"]),
    domainRole: z.enum(["viewer", "operator", "admin"]).nullable(),
  })
  .strict();
export type DomainMember = z.infer<typeof DomainMemberSchema>;
export const DomainMemberListResponseSchema = z
  .object({
    items: z.array(DomainMemberSchema),
    count: z.number().int().nonnegative(),
  })
  .strict();
