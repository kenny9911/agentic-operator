/**
 * Settings page mock data — ported from prototype views/settings.jsx.
 * These fixtures match the prototype 1:1 so the page renders identically.
 */

export interface SettingsMember {
  id: string;
  name: string;
  email: string;
  role: "Owner" | "Admin" | "Operator" | "Viewer" | "Service";
  last: number;
  avatar: string;
  color: string;
}

export const SETTINGS_MEMBERS: SettingsMember[] = [
  { id: "u1", name: "Liu Wei",        email: "liu.wei@agentic.local",     role: "Owner",    last: Date.now() - 2 * 60_000,    avatar: "LW", color: "#b594ff" },
  { id: "u2", name: "Chen Mengjie",   email: "chen.mj@agentic.local",     role: "Admin",    last: Date.now() - 19 * 60_000,   avatar: "CM", color: "#84a9ff" },
  { id: "u3", name: "Wu Hao",         email: "wu.hao@agentic.local",      role: "Operator", last: Date.now() - 6 * 60_000,    avatar: "WH", color: "#65e0a3" },
  { id: "u4", name: "Sun Yufei",      email: "sun.yufei@agentic.local",   role: "Operator", last: Date.now() - 3 * 3600_000,  avatar: "SY", color: "#ffb547" },
  { id: "u5", name: "Zhang Lina",     email: "zhang.lina@agentic.local",  role: "Viewer",   last: Date.now() - 8 * 3600_000,  avatar: "ZL", color: "#d0ff00" },
  { id: "u6", name: "Ops Pipeline",   email: "ops@agentic.local",         role: "Service",  last: Date.now() - 12 * 60_000,   avatar: "OP", color: "#6f7178" },
  { id: "u7", name: "Inngest Bridge", email: "svc-inngest@agentic.local", role: "Service",  last: Date.now() - 4 * 60_000,    avatar: "IN", color: "#6f7178" },
];

export interface SettingsKey {
  id: string;
  label: string;
  prefix: string;
  scopes: string[];
  created: number;
  lastUsed: number;
  author: string;
  expiring?: number;
}

export const SETTINGS_KEYS: SettingsKey[] = [
  { id: "k1", label: "raas-prod / runtime",   prefix: "sk_live_a7f2", scopes: ["agents:run", "events:emit", "runs:read"], created: Date.now() - 38 * 86_400_000, lastUsed: Date.now() - 12_000,    author: "Liu Wei" },
  { id: "k2", label: "raas-prod / read-only", prefix: "sk_live_b91c", scopes: ["runs:read", "events:read"],               created: Date.now() - 14 * 86_400_000, lastUsed: Date.now() - 4 * 60_000,  author: "Chen Mengjie" },
  { id: "k3", label: "ci-cd / deploy",        prefix: "sk_live_c44e", scopes: ["deploy:write", "agents:read"],            created: Date.now() - 6 * 86_400_000,  lastUsed: Date.now() - 22 * 60_000, author: "Ops" },
  { id: "k4", label: "grafana / read-only",   prefix: "sk_live_d10a", scopes: ["metrics:read"],                           created: Date.now() - 92 * 86_400_000, lastUsed: Date.now() - 53 * 60_000, author: "Liu Wei", expiring: 7 },
];

export interface SettingsIntegration {
  id: string;
  name: string;
  kind: string;
  status: "ok" | "warn" | "err" | "off";
  detail: string;
  monthly: string;
}

export const SETTINGS_INTEGRATIONS: SettingsIntegration[] = [
  { id: "anthropic", name: "Anthropic",   kind: "Model provider",   status: "ok",   detail: "claude-sonnet-4-5 · claude-haiku-4-5",       monthly: "$1,824 / mo" },
  { id: "openai",    name: "OpenAI",      kind: "Model provider",   status: "ok",   detail: "gpt-4.1-mini (fallback only)",                monthly: "$84 / mo" },
  { id: "inngest",   name: "Inngest",     kind: "Event runtime",    status: "ok",   detail: "raas-worker · 3 workers · 0 lag",             monthly: "—" },
  { id: "boss",      name: "BOSS Zhipin", kind: "Channel · helper", status: "ok",   detail: "Helper-page render only (no API)",            monthly: "—" },
  { id: "zhilian",   name: "Zhilian",     kind: "Channel · API",    status: "ok",   detail: "zhilian.api · OAuth refreshed 2h ago",        monthly: "—" },
  { id: "liepin",    name: "Liepin",      kind: "Channel · API",    status: "warn", detail: "Quota: 18 of 20 posts used today",            monthly: "—" },
  { id: "wechat",    name: "WeChat Work", kind: "Notification",     status: "ok",   detail: "Bot · 12 routes",                             monthly: "—" },
  { id: "ses",       name: "AWS SES",     kind: "Email",            status: "ok",   detail: "noreply@raas.agentic.local",                  monthly: "$8 / mo" },
  { id: "tencent",   name: "Tencent ATS", kind: "Client portal",    status: "err",  detail: "TLS cert expired 04:11 — renew",              monthly: "—" },
  { id: "github",    name: "GitHub",      kind: "Source",           status: "ok",   detail: "agentic/raas-workflows · 4 branches tracked", monthly: "—" },
];

export interface SettingsModel {
  id: string;
  name: string;
  provider: string;
  usedBy: number;
  cap: string;
  spent: number;
  status: "primary" | "fallback";
}

export const SETTINGS_MODELS: SettingsModel[] = [
  { id: "m1", name: "claude-sonnet-4-5", provider: "Anthropic", usedBy: 9, cap: "$60/day", spent: 41.2, status: "primary" },
  { id: "m2", name: "claude-haiku-4-5",  provider: "Anthropic", usedBy: 4, cap: "$15/day", spent: 6.83, status: "primary" },
  { id: "m3", name: "gpt-4.1-mini",      provider: "OpenAI",    usedBy: 0, cap: "$5/day",  spent: 0,    status: "fallback" },
];

export interface SettingsQuota {
  tenant: string;
  concurrency: { used: number; cap: number };
  tokens24h: { used: number; cap: number };
  spend30d: { used: number; cap: number };
}

export const SETTINGS_QUOTAS: SettingsQuota[] = [
  { tenant: "RAAS",         concurrency: { used: 47, cap: 80 }, tokens24h: { used: 4.21e6, cap: 8e6 }, spend30d: { used: 1924, cap: 4000 } },
  { tenant: "SupportFlow",  concurrency: { used: 8,  cap: 24 }, tokens24h: { used: 0.62e6, cap: 2e6 }, spend30d: { used: 318,  cap: 1000 } },
  { tenant: "FinanceClose", concurrency: { used: 2,  cap: 12 }, tokens24h: { used: 0.11e6, cap: 1e6 }, spend30d: { used: 42,   cap: 500  } },
];

export interface SettingsAudit {
  at: number;
  actor: string;
  action: string;
  target: string;
  ip: string;
}

export const SETTINGS_AUDIT: SettingsAudit[] = [
  { at: Date.now() - 5 * 60_000,      actor: "Liu Wei",      action: "deploy.live",         target: "raas@2026.05.16-a",                       ip: "10.42.7.18" },
  { at: Date.now() - 22 * 60_000,     actor: "Liu Wei",      action: "deploy.rollback",     target: "raas@2026.05.16",                         ip: "10.42.7.18" },
  { at: Date.now() - 41 * 60_000,     actor: "Chen Mengjie", action: "task.approve",        target: "TASK-9011 → REQ-2041",                    ip: "10.42.7.22" },
  { at: Date.now() - 2 * 3600_000,    actor: "Liu Wei",      action: "settings.update",     target: "models.fallback_chain",                   ip: "10.42.7.18" },
  { at: Date.now() - 4 * 3600_000,    actor: "Ops",          action: "key.rotate",          target: "sk_live_c44e",                            ip: "10.42.9.4"  },
  { at: Date.now() - 6 * 3600_000,    actor: "Liu Wei",      action: "member.invite",       target: "zhang.lina@agentic.local",                ip: "10.42.7.18" },
  { at: Date.now() - 22 * 3600_000,   actor: "Chen Mengjie", action: "integration.connect", target: "github → agentic/raas-workflows",         ip: "10.42.7.22" },
  { at: Date.now() - 2 * 86_400_000,  actor: "Liu Wei",      action: "member.role",         target: "Wu Hao: Viewer → Operator",               ip: "10.42.7.18" },
];

export interface SettingsSection {
  id: string;
  label: string;
  icon: string;
  hint: string;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "general",      label: "General",          icon: "settings",  hint: "Workspace, locale, region" },
  { id: "members",      label: "Members & access", icon: "human",     hint: "RBAC, invites" },
  { id: "keys",         label: "API keys",         icon: "code",      hint: "Tokens & scopes" },
  { id: "integrations", label: "Integrations",     icon: "external",  hint: "Models, channels, ATS" },
  { id: "models",       label: "Models",           icon: "spark",     hint: "Fleet & fallback chain" },
  { id: "usage",        label: "Usage & costs",    icon: "dashboard", hint: "LLM spend & token breakdown" },
  { id: "quotas",       label: "Quotas & limits",  icon: "filter",    hint: "Per-tenant concurrency, $" },
  { id: "audit",        label: "Audit log",        icon: "logs",      hint: "Recent admin actions" },
  { id: "danger",       label: "Danger zone",      icon: "alert",     hint: "Destructive actions" },
];

// ---------- Provider credentials (Models section) ----------
export interface Provider {
  id: string;
  name: string;
  color: string;
  endpoint: string;
  keyPrefix: string;
  keyMasked: string;
  keyLast4: string;
  setBy: string;
  setAt: number;
  lastUsed: number;
  headerName: string;
  docs: string;
  healthy: boolean;
  monthlySpend: number;
}

export const PROVIDERS: Provider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    color: "#d97757",
    endpoint: "https://api.anthropic.com",
    keyPrefix: "sk-ant-api03-",
    keyMasked: "sk-ant-api03-PfV4...8nQz",
    keyLast4: "8nQz",
    setBy: "Liu Wei",
    setAt: Date.now() - 14 * 86_400_000,
    lastUsed: Date.now() - 9_000,
    headerName: "x-api-key",
    docs: "https://console.anthropic.com/settings/keys",
    healthy: true,
    monthlySpend: 1824,
  },
  {
    id: "openai",
    name: "OpenAI",
    color: "#10a37f",
    endpoint: "https://api.openai.com/v1",
    keyPrefix: "sk-proj-",
    keyMasked: "sk-proj-1xK9...rT2A",
    keyLast4: "rT2A",
    setBy: "Ops",
    setAt: Date.now() - 38 * 86_400_000,
    lastUsed: Date.now() - 53 * 60_000,
    headerName: "Authorization: Bearer",
    docs: "https://platform.openai.com/api-keys",
    healthy: true,
    monthlySpend: 84,
  },
];

export const MODEL_DEFAULTS: Record<string, { contextWindow: number; maxOut: number; inPrice: number; outPrice: number }> = {
  "claude-sonnet-4-5": { contextWindow: 200_000, maxOut: 8192,   inPrice: 3.0, outPrice: 15.0 },
  "claude-haiku-4-5":  { contextWindow: 200_000, maxOut: 8192,   inPrice: 0.8, outPrice: 4.0 },
  "gpt-4.1-mini":      { contextWindow: 128_000, maxOut: 16_384, inPrice: 0.4, outPrice: 1.6 },
};

// ---------- Add-provider preset catalog ----------
// Single source of truth lives in @agentic/contracts/src/providers.ts so the
// backend gateway and the frontend see the exact same catalog.
export {
  PROVIDER_PRESETS,
  PROVIDER_MODEL_CATALOG,
  defaultModelFor,
  type ProviderPreset,
  type CatalogModel,
  type ProviderId,
} from "@agentic/contracts";

// ---------- Usage & costs section data ----------
export interface UsageDailyPoint { day: number; spend: number; tokens: number }

// Deterministic LCG so the chart looks the same on every render (no hydration drift)
function makeUsageDaily(): UsageDailyPoint[] {
  const out: UsageDailyPoint[] = [];
  let s = 11;
  const now = Date.now();
  for (let i = 29; i >= 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const r = s / 233280;
    const day = now - i * 86_400_000;
    const dow = new Date(day).getDay();
    const dip = dow === 0 || dow === 6 ? 0.55 : 1;
    const base = 35 + (29 - i) * 1.6;
    out.push({
      day,
      spend: +(base * dip * (0.78 + r * 0.5)).toFixed(2),
      tokens: Math.floor((180_000 + (29 - i) * 8500) * dip * (0.8 + r * 0.4)),
    });
  }
  return out;
}

export const USAGE_DAILY = makeUsageDaily();

export const USAGE_BY_TENANT = [
  { id: "raas",    name: "RAAS",         calls: 18_420, tokensIn: 4.21e6, tokensOut: 0.62e6, spend: 1684.2, delta: 0.12  },
  { id: "support", name: "SupportFlow",  calls: 3_120,  tokensIn: 0.62e6, tokensOut: 0.11e6, spend: 184.4,  delta: -0.04 },
  { id: "finance", name: "FinanceClose", calls: 470,    tokensIn: 0.11e6, tokensOut: 0.02e6, spend: 45.1,   delta: 0.31  },
];

export const USAGE_BY_AGENT = [
  { id: "10",   name: "matchResume",                   tenant: "RAAS", calls: 4_180, spend: 412.3,  model: "claude-sonnet-4-5", avgLat: 2.1, errRate: 0.018 },
  { id: "12",   name: "evaluateInterview",             tenant: "RAAS", calls: 1_840, spend: 318.8,  model: "claude-sonnet-4-5", avgLat: 4.4, errRate: 0.022 },
  { id: "2",    name: "analyzeRequirement",            tenant: "RAAS", calls: 920,   spend: 246.5,  model: "claude-sonnet-4-5", avgLat: 3.0, errRate: 0.011 },
  { id: "14-1", name: "generateRecommendationPackage", tenant: "RAAS", calls: 1_640, spend: 198.2,  model: "claude-sonnet-4-5", avgLat: 1.8, errRate: 0.008 },
  { id: "9-1",  name: "processResume",                 tenant: "RAAS", calls: 5_210, spend: 162.1,  model: "claude-sonnet-4-5", avgLat: 1.2, errRate: 0.014 },
  { id: "4",    name: "createJD",                      tenant: "RAAS", calls: 410,   spend: 152.4,  model: "claude-sonnet-4-5", avgLat: 5.2, errRate: 0.005 },
  { id: "13",   name: "refineResume",                  tenant: "RAAS", calls: 1_480, spend: 98.1,   model: "claude-sonnet-4-5", avgLat: 2.5, errRate: 0.003 },
  { id: "3",    name: "clarifyRequirement",            tenant: "RAAS", calls: 880,   spend: 38.4,   model: "claude-haiku-4-5",  avgLat: 1.1, errRate: 0.002 },
  { id: "6",    name: "assignRecruitTasks",            tenant: "RAAS", calls: 740,   spend: 18.2,   model: "claude-haiku-4-5",  avgLat: 0.9, errRate: 0.001 },
  { id: "11-1", name: "inviteInternalInterview",       tenant: "RAAS", calls: 920,   spend: 12.4,   model: "claude-haiku-4-5",  avgLat: 0.8, errRate: 0.000 },
];

export const USAGE_BY_USER = [
  { id: "u1",          name: "Liu Wei",        role: "Owner",    calls: 12_840, spend: 1320.4, lastActive: Date.now() - 2 * 60_000,    color: "#b594ff", initials: "LW" },
  { id: "u2",          name: "Chen Mengjie",   role: "Admin",    calls: 4_120,  spend: 462.1,  lastActive: Date.now() - 19 * 60_000,   color: "#84a9ff", initials: "CM" },
  { id: "svc-inngest", name: "Inngest Bridge", role: "Service",  calls: 3_984,  spend: 84.2,   lastActive: Date.now() - 4 * 60_000,    color: "#6f7178", initials: "IN" },
  { id: "u3",          name: "Wu Hao",         role: "Operator", calls: 580,    spend: 28.3,   lastActive: Date.now() - 6 * 60_000,    color: "#65e0a3", initials: "WH" },
  { id: "u4",          name: "Sun Yufei",      role: "Operator", calls: 312,    spend: 14.8,   lastActive: Date.now() - 3 * 3600_000,  color: "#ffb547", initials: "SY" },
  { id: "svc-ops",     name: "Ops Pipeline",   role: "Service",  calls: 174,    spend: 3.9,    lastActive: Date.now() - 12 * 60_000,   color: "#6f7178", initials: "OP" },
];

export const USAGE_BY_PROVIDER = [
  { id: "anthropic", name: "Anthropic", spend: 1824.0, share: 0.95, calls: 21_420, tokensIn: 4.62e6, tokensOut: 0.71e6 },
  { id: "openai",    name: "OpenAI",    spend: 89.7,   share: 0.05, calls: 590,    tokensIn: 0.32e6, tokensOut: 0.04e6 },
];

export const USAGE_BY_MODEL = [
  { name: "claude-sonnet-4-5", provider: "Anthropic", spend: 1648.3, calls: 14_220, tokensIn: 3.42e6, tokensOut: 0.51e6, avgIn: 240, avgOut: 36, avgLat: 2.3 },
  { name: "claude-haiku-4-5",  provider: "Anthropic", spend: 175.7,  calls: 7_200,  tokensIn: 1.20e6, tokensOut: 0.20e6, avgIn: 167, avgOut: 28, avgLat: 0.9 },
  { name: "gpt-4.1-mini",      provider: "OpenAI",    spend: 89.7,   calls: 590,    tokensIn: 0.32e6, tokensOut: 0.04e6, avgIn: 542, avgOut: 68, avgLat: 1.6 },
];

// Mock subset of RAAS agents (id + name + pinned model) for the
// "Used by" badge list in the model drawer. Avoids a runtime API hit.
export interface MiniAgent { id: string; name: string; model: string }
export const MOCK_AGENTS_FOR_FLEET: MiniAgent[] = [
  { id: "10",   name: "matchResume",                   model: "claude-sonnet-4-5" },
  { id: "12",   name: "evaluateInterview",             model: "claude-sonnet-4-5" },
  { id: "2",    name: "analyzeRequirement",            model: "claude-sonnet-4-5" },
  { id: "14-1", name: "generateRecommendationPackage", model: "claude-sonnet-4-5" },
  { id: "9-1",  name: "processResume",                 model: "claude-sonnet-4-5" },
  { id: "4",    name: "createJD",                      model: "claude-sonnet-4-5" },
  { id: "13",   name: "refineResume",                  model: "claude-sonnet-4-5" },
  { id: "8",    name: "publishJD",                     model: "claude-sonnet-4-5" },
  { id: "16",   name: "submitCandidate",               model: "claude-sonnet-4-5" },
  { id: "3",    name: "clarifyRequirement",            model: "claude-haiku-4-5"  },
  { id: "6",    name: "assignRecruitTasks",            model: "claude-haiku-4-5"  },
  { id: "11-1", name: "inviteInternalInterview",       model: "claude-haiku-4-5"  },
  { id: "11-2", name: "inviteClientInterview",         model: "claude-haiku-4-5"  },
];
