/**
 * Tenant fixtures for the Sidebar tenant switcher (display-only).
 * Per-tenant data + auth lives in the api.
 *
 * To add a tenant: drop a `models/<slug>/` folder and add an entry here.
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

export const TENANTS: Tenant[] = [
  {
    id: "raas",
    name: "RAAS",
    subtitle: "Recruitment-as-a-Service",
    color: "#d0ff00",
    active: true,
    agentCount: 22,
    runs24h: 1842,
  },
  {
    id: "support",
    name: "SupportFlow",
    subtitle: "Tier-1 ticket triage",
    color: "#7c9eff",
    active: false,
    agentCount: 11,
    runs24h: 312,
  },
  {
    id: "finance",
    name: "FinanceClose",
    subtitle: "Monthly close orchestration",
    color: "#f5c46b",
    active: false,
    agentCount: 8,
    runs24h: 47,
  },
];
