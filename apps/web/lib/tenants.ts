/**
 * Tenant type for the Sidebar tenant switcher.
 *
 * 2026-05-26 architectural rule: production mode = ZERO mock data.
 * Per-tenant data + auth lives in the api. If the api is unreachable
 * the UI should show an error state, not mock data.
 *
 * The legacy export `TENANTS` is intentionally empty by design — every
 * portal view fetches `/v1/tenants` live via `useTenants()`. A stale
 * static fixture here would re-introduce the "looks like demo, actually
 * mock fallback" footgun.
 */

export interface Tenant {
  id: string;
  name: string;
  subtitle: string;
  color: string;
  active: boolean;
  agentCount: number;
  runs24h: number;
}

// No static fallback by design. If api is unreachable, UI should show an
// error state, not mock data.
export const TENANTS: Tenant[] = [];
