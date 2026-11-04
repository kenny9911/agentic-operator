"use client";
import { usePathname } from "next/navigation";
import type { AnchorHTMLAttributes } from "react";
import { canonicalPortalHref, scopedResourceHref } from "./portal-scope";
export default function PortalAnchor({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const pathname = usePathname();
  const resolved = href ? scopedResourceHref(canonicalPortalHref(href, pathname), pathname) : href;
  return <a {...props} href={resolved} />;
}
