"use client";

import { useMemo } from "react";
import { useRouter as useNextRouter, usePathname } from "next/navigation";
import { canonicalPortalHref } from "./portal-scope";

export { useParams, usePathname, useSearchParams, redirect, notFound } from "next/navigation";

/** Existing feature navigations inherit the selected Domain, including async completions. */
export function useRouter(): ReturnType<typeof useNextRouter> {
  const router = useNextRouter();
  const pathname = usePathname();
  return useMemo(() => ({
    ...router,
    push: (href, options) => router.push(canonicalPortalHref(href, pathname), options),
    replace: (href, options) => router.replace(canonicalPortalHref(href, pathname), options),
    prefetch: (href, options) => router.prefetch(canonicalPortalHref(href, pathname), options),
  }), [router, pathname]);
}
