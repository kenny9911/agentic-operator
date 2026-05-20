/**
 * Settings-local mock data, ported from
 * `apps/web/public/portal/views/settings.jsx:6-64`.
 * The audit log section will swap to the real `/v1/audit` endpoint when wired.
 */

export const SETTINGS_MEMBERS = [
  { id: "u1", name: "Liu Wei", email: "liu.wei@agentic.local", role: "Owner", last: Date.now() - 2 * 60_000, avatar: "LW", color: "#b594ff" },
  { id: "u2", name: "Chen Mengjie", email: "chen.mj@agentic.local", role: "Admin", last: Date.now() - 19 * 60_000, avatar: "CM", color: "#84a9ff" },
  { id: "u3", name: "Wu Hao", email: "wu.hao@agentic.local", role: "Operator", last: Date.now() - 6 * 60_000, avatar: "WH", color: "#65e0a3" },
  { id: "u4", name: "Sun Yufei", email: "sun.yufei@agentic.local", role: "Operator", last: Date.now() - 3 * 3600_000, avatar: "SY", color: "#ffb547" },
  { id: "u5", name: "Zhang Lina", email: "zhang.lina@agentic.local", role: "Viewer", last: Date.now() - 8 * 3600_000, avatar: "ZL", color: "#d0ff00" },
  { id: "u6", name: "Ops Pipeline", email: "ops@agentic.local", role: "Service", last: Date.now() - 12 * 60_000, avatar: "OP", color: "#6f7178" },
  { id: "u7", name: "Inngest Bridge", email: "svc-inngest@agentic.local", role: "Service", last: Date.now() - 4 * 60_000, avatar: "IN", color: "#6f7178" },
];

export interface ApiKey {
  id: string;
  label: string;
  prefix: string;
  scopes: string[];
  created: number;
  lastUsed: number;
  author: string;
  expiring?: number;
}

export const SETTINGS_KEYS: ApiKey[] = [
  { id: "k1", label: "raas-prod / runtime", prefix: "sk_live_a7f2", scopes: ["agents:run", "events:emit", "runs:read"], created: Date.now() - 38 * 86_400_000, lastUsed: Date.now() - 12_000, author: "Liu Wei" },
  { id: "k2", label: "raas-prod / read-only", prefix: "sk_live_b91c", scopes: ["runs:read", "events:read"], created: Date.now() - 14 * 86_400_000, lastUsed: Date.now() - 4 * 60_000, author: "Chen Mengjie" },
  { id: "k3", label: "ci-cd / deploy", prefix: "sk_live_c44e", scopes: ["deploy:write", "agents:read"], created: Date.now() - 6 * 86_400_000, lastUsed: Date.now() - 22 * 60_000, author: "Ops" },
  { id: "k4", label: "grafana / read-only", prefix: "sk_live_d10a", scopes: ["metrics:read"], created: Date.now() - 92 * 86_400_000, lastUsed: Date.now() - 53 * 60_000, author: "Liu Wei", expiring: 7 },
];

export const SETTINGS_INTEGRATIONS = [
  { id: "anthropic", name: "Anthropic", kind: "Model provider", status: "ok" as const, detail: "claude-sonnet-4-5 · claude-haiku-4-5", monthly: "$1,824 / mo" },
  { id: "openai", name: "OpenAI", kind: "Model provider", status: "ok" as const, detail: "gpt-4.1-mini (fallback only)", monthly: "$84 / mo" },
  { id: "openrouter", name: "OpenRouter", kind: "Model provider", status: "ok" as const, detail: "Multi-model gateway", monthly: "—" },
  { id: "inngest", name: "Inngest", kind: "Event runtime", status: "ok" as const, detail: "raas-worker · 3 workers · 0 lag", monthly: "—" },
  { id: "boss", name: "BOSS Zhipin", kind: "Channel · helper", status: "ok" as const, detail: "Helper-page render only (no API)", monthly: "—" },
  { id: "zhilian", name: "Zhilian", kind: "Channel · API", status: "ok" as const, detail: "zhilian.api · OAuth refreshed 2h ago", monthly: "—" },
  { id: "liepin", name: "Liepin", kind: "Channel · API", status: "warn" as const, detail: "Quota: 18 of 20 posts used today", monthly: "—" },
  { id: "wechat", name: "WeChat Work", kind: "Notification", status: "ok" as const, detail: "Bot · 12 routes", monthly: "—" },
  { id: "ses", name: "AWS SES", kind: "Email", status: "ok" as const, detail: "noreply@raas.agentic.local", monthly: "$8 / mo" },
  { id: "tencent", name: "Tencent ATS", kind: "Client portal", status: "err" as const, detail: "TLS cert expired 04:11 — renew", monthly: "—" },
  { id: "github", name: "GitHub", kind: "Source", status: "ok" as const, detail: "agentic/raas-workflows · 4 branches tracked", monthly: "—" },
];

export const SETTINGS_AUDIT_FALLBACK = [
  { at: Date.now() - 5 * 60_000, actor: "Liu Wei", action: "deploy.live", target: "raas@2026.05.16-a", ip: "10.42.7.18" },
  { at: Date.now() - 22 * 60_000, actor: "Liu Wei", action: "deploy.rollback", target: "raas@2026.05.16", ip: "10.42.7.18" },
  { at: Date.now() - 41 * 60_000, actor: "Chen Mengjie", action: "task.approve", target: "TASK-9011 → REQ-2041", ip: "10.42.7.22" },
  { at: Date.now() - 2 * 3600_000, actor: "Liu Wei", action: "settings.update", target: "models.fallback_chain", ip: "10.42.7.18" },
  { at: Date.now() - 4 * 3600_000, actor: "Ops", action: "key.rotate", target: "sk_live_c44e", ip: "10.42.9.4" },
  { at: Date.now() - 6 * 3600_000, actor: "Liu Wei", action: "member.invite", target: "zhang.lina@agentic.local", ip: "10.42.7.18" },
  { at: Date.now() - 22 * 3600_000, actor: "Chen Mengjie", action: "integration.connect", target: "github → agentic/raas-workflows", ip: "10.42.7.22" },
  { at: Date.now() - 2 * 86_400_000, actor: "Liu Wei", action: "member.role", target: "Wu Hao: Viewer → Operator", ip: "10.42.7.18" },
];

export interface ConfiguredModel {
  id: string;
  name: string;
  provider: string;
  context: string;
  role?: "primary" | "fallback" | "experiment" | "disabled";
}

export const DEFAULT_MODELS: ConfiguredModel[] = [
  { id: "m1", name: "claude-sonnet-4-5", provider: "anthropic", context: "200k", role: "primary" },
  { id: "m2", name: "claude-haiku-4-5", provider: "anthropic", context: "200k", role: "fallback" },
  { id: "m3", name: "gpt-4.1-mini", provider: "openai", context: "128k", role: "experiment" },
];

export const TIMEZONES = [
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Hong_Kong",
  "Australia/Sydney",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "UTC",
];

export const LOCALES = [
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "zh-CN", label: "Simplified Chinese" },
  { value: "zh-TW", label: "Traditional Chinese" },
  { value: "ja-JP", label: "Japanese" },
  { value: "ko-KR", label: "Korean" },
];

export const SETTINGS_SECTIONS = [
  { id: "workspace", label: "Workspace", icon: "settings" as const, hint: "Name, slug, timezone, locale, accent" },
  { id: "people", label: "People & roles", icon: "human" as const, hint: "RBAC, invites" },
  { id: "models", label: "Models", icon: "spark" as const, hint: "Fleet & fallback chain" },
  { id: "channels", label: "Channels", icon: "git" as const, hint: "Job boards & messaging" },
  { id: "integrations", label: "Integrations", icon: "external" as const, hint: "GitHub, SES, ATS" },
  { id: "notifications", label: "Notifications", icon: "alert" as const, hint: "Routes & quiet hours" },
  { id: "tokens", label: "API tokens", icon: "code" as const, hint: "Programmatic access" },
  { id: "billing", label: "Billing & cost caps", icon: "deploy" as const, hint: "Per-tenant budgets" },
  // P3-FE-03 — cost dashboard. Lives at its own sub-route so deep-links
  // and tab-state survive a reload.
  { id: "usage", label: "Usage & cost", icon: "dashboard" as const, hint: "Per-agent, per-model spend" },
  { id: "audit", label: "Audit log", icon: "logs" as const, hint: "Recent admin actions" },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];
