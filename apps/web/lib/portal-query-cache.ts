import { QueryClient } from "@tanstack/react-query";

const MAX_RETAINED_SCOPES = 4;
const cacheOwners = new WeakMap<QueryClient, PortalQueryCache>();

/** One cache owner per mounted portal, never a process-wide user-data cache. */
export class PortalQueryCache {
  private readonly clients = new Map<string, QueryClient>();

  constructor(private readonly limit = MAX_RETAINED_SCOPES) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("Portal query cache limit must be a positive integer");
    }
  }

  get(scope: string): QueryClient {
    let client = this.clients.get(scope);
    if (!client) {
      client = new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      });
      this.clients.set(scope, client);
      cacheOwners.set(client, this);
    }
    return client;
  }

  /** Run after navigation commits; an abandoned render must not evict the
   * currently visible scope. Stop inactive requests/retries because legacy
   * query functions can read request headers from the current browser URL. */
  activate(scope: string): void {
    const active = this.get(scope);
    this.clients.delete(scope);
    this.clients.set(scope, active);
    for (const client of this.clients.values()) {
      if (client !== active) void client.cancelQueries();
    }
    while (this.clients.size > this.limit) {
      const oldest = this.clients.keys().next().value!;
      this.clients.get(oldest)!.clear();
      this.clients.delete(oldest);
    }
  }

  clear(): void {
    // Preserve client identities through React StrictMode's effect replay.
    // Clearing their data also cancels pending requests and removes retries.
    for (const client of this.clients.values()) client.clear();
  }
}

/** Logout must erase visited scopes as well as the currently visible one. */
export function clearPortalQueryCaches(client: QueryClient): void {
  cacheOwners.get(client)?.clear();
  // Also handles callers outside the portal and clients already evicted.
  client.clear();
}
