"use client";

/**
 * PortalProviders — client-only context wrappers.
 *
 * Splits the QueryClient + DataProvider out of the server-component layout
 * so React 19 can keep the page tree async-first. The QueryClient instance
 * is memo'd via lazy initial state so it survives client-side route changes
 * without remounting.
 */

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DataProvider } from "@/lib/hooks/data-context";
import { DirtyProvider } from "../../lib/dirty-context";

export function PortalProviders({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <DataProvider>
        <DirtyProvider>{children}</DirtyProvider>
      </DataProvider>
    </QueryClientProvider>
  );
}
