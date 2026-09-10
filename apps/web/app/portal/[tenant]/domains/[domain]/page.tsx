import { redirect } from "next/navigation";
import { domainPortalPath } from "@/lib/portal-scope";

export default async function DomainIndex({ params }: { params: Promise<{ tenant: string; domain: string }> }) {
  const { tenant, domain } = await params;
  redirect(domainPortalPath(tenant, domain));
}
