"use client";

import NextLink from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { canonicalPortalHref } from "./portal-scope";

type Props = ComponentProps<typeof NextLink> & { scope?: "tenant" | "domain" };

/** Shared feature links keep Domain scope, including copy-link and new-tab actions. */
export default function PortalLink({ href, scope, ...props }: Props) {
  const pathname = usePathname();
  const resolved = scope === "tenant" ? href : typeof href === "string"
    ? canonicalPortalHref(href, pathname)
    : href.pathname ? { ...href, pathname: canonicalPortalHref(href.pathname, pathname) } : href;
  return <NextLink {...props} href={resolved as never} />;
}
