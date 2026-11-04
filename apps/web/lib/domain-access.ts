import { cookies } from "next/headers";
import { DomainMutationResponseSchema, type Domain } from "@agentic/contracts";
import { COOKIE_NAME } from "@/lib/auth/session";
import { readApiData } from "@/lib/api-response";
import { serverApiUrl } from "@/lib/server-api-url";

/** Resolve access close to the API, before hydration. The API remains the
 * authority for tenant membership and domain visibility. Never share this
 * response across requests or forward the session credential to the browser. */
export async function readDomainForRoute(tenant: string, domain: string): Promise<Domain | null> {
  if (![tenant, domain].every((part) => /^[a-z0-9_-]{1,64}$/.test(part))) return null;
  const session = (await cookies()).get(COOKIE_NAME)?.value;
  if (!session) return null;
  const path = `/v1/domains/${encodeURIComponent(domain)}`;
  const response = await fetch(`${serverApiUrl()}${path}`, {
    headers: {
      Accept: "application/json",
      cookie: `${COOKIE_NAME}=${session}`,
      "x-agentic-tenant": tenant,
    },
    cache: "no-store",
  });
  if ([401, 403, 404].includes(response.status)) return null;
  const result = DomainMutationResponseSchema.parse(await readApiData(response, path));
  if (result.domain.slug !== domain) throw new Error("Domain service returned an unexpected scope");
  return result.domain;
}
