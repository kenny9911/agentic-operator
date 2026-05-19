/**
 * Drizzle schema for Agentic Operator — 16 tables per DESIGN.md §3.
 *
 * Conventions:
 *   - Primary keys are prefixed string IDs (run-, evt-, agt-, …) generated
 *     via @agentic/shared makeId().
 *   - Timestamps are unix-epoch milliseconds (integer mode timestamp_ms).
 *   - Payload/manifest blobs are stored as text in JSON mode for type safety.
 *   - Foreign keys are declared but cascade behavior is per-table.
 *   - Every user-visible table carries `tenant_id` — enforced at query time
 *     via with-tenant.ts helpers.
 */

import { relations, sql } from "drizzle-orm";
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch() * 1000)`;

// ─── Identity ────────────────────────────────────────────────────────────────

export const tenants = sqliteTable(
  "tenants",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    subtitle: text("subtitle"),
    color: text("color"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
  },
  (t) => ({
    slugUq: uniqueIndex("tenants_slug_uq").on(t.slug),
  }),
);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
  },
  (t) => ({
    emailUq: uniqueIndex("users_email_uq").on(t.email),
  }),
);

export const memberships = sqliteTable(
  "memberships",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["admin", "operator", "viewer"] }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.tenantId] }),
  }),
);

// ─── Workflow definitions ────────────────────────────────────────────────────

export const workflows = sqliteTable(
  "workflows",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
  },
  (t) => ({
    tenantSlugUq: uniqueIndex("workflows_tenant_slug_uq").on(t.tenantId, t.slug),
    tenantIdx: index("workflows_tenant_idx").on(t.tenantId),
  }),
);

export const workflowVersions = sqliteTable(
  "workflow_versions",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    manifestJson: text("manifest_json", { mode: "json" }).notNull(),
    actionsJson: text("actions_json", { mode: "json" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
    createdBy: text("created_by").references(() => users.id),
  },
  (t) => ({
    workflowVersionUq: uniqueIndex("wfv_workflow_version_uq").on(
      t.workflowId,
      t.version,
    ),
  }),
);

export const deployments = sqliteTable(
  "deployments",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    target: text("target", {
      enum: ["workflow", "agent", "runtime", "code_agent"],
    }).notNull(),
    versionId: text("version_id").notNull(),
    status: text("status", {
      enum: ["live", "rolled_back", "pending"],
    }).notNull(),
    deployedBy: text("deployed_by").references(() => users.id),
    deployedAt: integer("deployed_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
    note: text("note"),
  },
  (t) => ({
    tenantStatusIdx: index("dpl_tenant_status_idx").on(t.tenantId, t.status),
    versionIdx: index("dpl_version_idx").on(t.versionId),
  }),
);

export const agents = sqliteTable(
  "agents",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    kebabId: text("kebab_id").notNull(),
    name: text("name").notNull(),
    title: text("title"),
    actor: text("actor", { enum: ["Agent", "Human"] }).notNull(),
    kind: text("kind", { enum: ["manifest", "code"] })
      .notNull()
      .default("manifest"),
    enabled: integer("enabled", { mode: "boolean" })
      .notNull()
      .default(true),
  },
  (t) => ({
    workflowKebabUq: uniqueIndex("agents_workflow_kebab_uq").on(
      t.workflowId,
      t.kebabId,
    ),
    workflowIdx: index("agents_workflow_idx").on(t.workflowId),
  }),
);

export const agentVersions = sqliteTable(
  "agent_versions",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    workflowVersionId: text("workflow_version_id")
      .notNull()
      .references(() => workflowVersions.id, { onDelete: "cascade" }),
    manifestJson: text("manifest_json", { mode: "json" }).notNull(),
  },
  (t) => ({
    agentWfvUq: uniqueIndex("agv_agent_wfv_uq").on(
      t.agentId,
      t.workflowVersionId,
    ),
  }),
);

// ─── Events ──────────────────────────────────────────────────────────────────

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category"),
    sourceAgentId: text("source_agent_id").references(() => agents.id),
    subject: text("subject"),
    receivedAt: integer("received_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
    payloadRef: text("payload_ref"),
  },
  (t) => ({
    tenantNameReceivedIdx: index("evt_tenant_name_received_idx").on(
      t.tenantId,
      t.name,
      t.receivedAt,
    ),
    tenantSubjectIdx: index("evt_tenant_subject_idx").on(t.tenantId, t.subject),
  }),
);

export const eventListeners = sqliteTable(
  "event_listeners",
  {
    eventName: text("event_name").notNull(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.eventName, t.agentId] }),
    eventIdx: index("evtl_event_idx").on(t.eventName),
  }),
);

// ─── Runs + Steps ────────────────────────────────────────────────────────────

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    agentVersionId: text("agent_version_id").references(() => agentVersions.id),
    triggerEventId: text("trigger_event_id").references(() => events.id),
    status: text("status", {
      enum: ["queued", "running", "ok", "failed", "waiting", "cancelled"],
    }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    durationMs: integer("duration_ms"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    model: text("model"),
    emittedEventId: text("emitted_event_id"),
    errorMessage: text("error_message"),
    logPath: text("log_path"),
    correlationId: text("correlation_id").notNull(),
    subject: text("subject"),
  },
  (t) => ({
    tenantStartedIdx: index("runs_tenant_started_idx").on(
      t.tenantId,
      t.startedAt,
    ),
    tenantStatusIdx: index("runs_tenant_status_idx").on(t.tenantId, t.status),
    agentIdx: index("runs_agent_idx").on(t.agentId),
    correlationIdx: index("runs_correlation_idx").on(t.correlationId),
    subjectIdx: index("runs_subject_idx").on(t.subject),
  }),
);

export const steps = sqliteTable(
  "steps",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    ord: integer("ord").notNull(),
    name: text("name").notNull(),
    type: text("type", { enum: ["tool", "logic", "manual"] }).notNull(),
    status: text("status", {
      enum: ["pending", "running", "ok", "failed", "skipped"],
    }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    durationMs: integer("duration_ms"),
    inputRef: text("input_ref"),
    outputRef: text("output_ref"),
    error: text("error"),
    provider: text("provider"),
    model: text("model"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
  },
  (t) => ({
    runOrdIdx: index("steps_run_ord_idx").on(t.runId, t.ord),
  }),
);

// ─── Tasks ───────────────────────────────────────────────────────────────────

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    runId: text("run_id").references(() => runs.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    awaitingRole: text("awaiting_role"),
    awaitingUserId: text("awaiting_user_id").references(() => users.id),
    priority: text("priority", { enum: ["low", "medium", "high"] })
      .notNull()
      .default("medium"),
    status: text("status", { enum: ["open", "resolved", "snoozed"] })
      .notNull()
      .default("open"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    resolvedBy: text("resolved_by").references(() => users.id),
    payloadJson: text("payload_json", { mode: "json" }),
    resolutionJson: text("resolution_json", { mode: "json" }),
  },
  (t) => ({
    tenantStatusIdx: index("tasks_tenant_status_idx").on(t.tenantId, t.status),
    runIdx: index("tasks_run_idx").on(t.runId),
  }),
);

// ─── Artifacts ───────────────────────────────────────────────────────────────

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    path: text("path").notNull(),
    size: integer("size").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
  },
  (t) => ({
    runIdx: index("art_run_idx").on(t.runId),
  }),
);

// ─── Ops ─────────────────────────────────────────────────────────────────────

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => users.id),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    at: integer("at", { mode: "timestamp_ms" }).notNull().default(now),
    metaJson: text("meta_json", { mode: "json" }),
  },
  (t) => ({
    tenantAtIdx: index("audit_tenant_at_idx").on(t.tenantId, t.at),
    targetIdx: index("audit_target_idx").on(t.targetType, t.targetId),
  }),
);

export const apiTokens = sqliteTable(
  "api_tokens",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    hash: text("hash").notNull(),
    name: text("name").notNull(),
    scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(now),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  },
  (t) => ({
    hashUq: uniqueIndex("tok_hash_uq").on(t.hash),
    tenantIdx: index("tok_tenant_idx").on(t.tenantId),
  }),
);

// ─── Ontology (RF-1.4): per-tenant event + entity catalogs ──────────────────

export const eventTypes = sqliteTable(
  "event_types",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category"),
    color: text("color"),
    description: text("description"),
    payloadJson: text("payload_json", { mode: "json" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.name] }),
  }),
);

export const entityTypes = sqliteTable(
  "entity_types",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    entityId: text("entity_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    primaryKeyName: text("primary_key_name"),
    propertiesJson: text("properties_json", { mode: "json" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.entityId] }),
  }),
);

// ─── Relations (used by Drizzle's relational queries) ───────────────────────

export const tenantsRelations = relations(tenants, ({ many }) => ({
  workflows: many(workflows),
  events: many(events),
  runs: many(runs),
  tasks: many(tasks),
  memberships: many(memberships),
}));

export const workflowsRelations = relations(workflows, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [workflows.tenantId],
    references: [tenants.id],
  }),
  versions: many(workflowVersions),
  agents: many(agents),
}));

export const workflowVersionsRelations = relations(
  workflowVersions,
  ({ one, many }) => ({
    workflow: one(workflows, {
      fields: [workflowVersions.workflowId],
      references: [workflows.id],
    }),
    agentVersions: many(agentVersions),
  }),
);

export const agentsRelations = relations(agents, ({ one, many }) => ({
  workflow: one(workflows, {
    fields: [agents.workflowId],
    references: [workflows.id],
  }),
  versions: many(agentVersions),
  runs: many(runs),
}));

export const runsRelations = relations(runs, ({ one, many }) => ({
  tenant: one(tenants, { fields: [runs.tenantId], references: [tenants.id] }),
  agent: one(agents, { fields: [runs.agentId], references: [agents.id] }),
  triggerEvent: one(events, {
    fields: [runs.triggerEventId],
    references: [events.id],
  }),
  steps: many(steps),
  tasks: many(tasks),
}));

export const stepsRelations = relations(steps, ({ one }) => ({
  run: one(runs, { fields: [steps.runId], references: [runs.id] }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  tenant: one(tenants, { fields: [tasks.tenantId], references: [tenants.id] }),
  run: one(runs, { fields: [tasks.runId], references: [runs.id] }),
}));

export const eventsRelations = relations(events, ({ one }) => ({
  tenant: one(tenants, {
    fields: [events.tenantId],
    references: [tenants.id],
  }),
  sourceAgent: one(agents, {
    fields: [events.sourceAgentId],
    references: [agents.id],
  }),
}));

// ─── Helper: full schema export for drizzle() ───────────────────────────────

export const schema = {
  tenants,
  users,
  memberships,
  workflows,
  workflowVersions,
  deployments,
  agents,
  agentVersions,
  events,
  eventListeners,
  runs,
  steps,
  tasks,
  artifacts,
  auditLog,
  apiTokens,
  eventTypes,
  entityTypes,
  tenantsRelations,
  workflowsRelations,
  workflowVersionsRelations,
  agentsRelations,
  runsRelations,
  stepsRelations,
  tasksRelations,
  eventsRelations,
};
