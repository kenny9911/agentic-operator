import type { ReactNode } from "react";
import { DomainBoundary } from "@/app/portal/components/domains/DomainBoundary";

export default function DomainLayout({ children }: { children: ReactNode }) {
  return <DomainBoundary>{children}</DomainBoundary>;
}
