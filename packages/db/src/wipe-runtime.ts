/**
 * `pnpm db:wipe-runtime` — truncate runtime-traffic tables only, leave
 * identity + workflow + agent-config rows intact.
 *
 * The product rule is "production mode = zero mock data". This script is the
 * clean-slate primitive: run it to drop accumulated development/test traffic
 * before proving that dashboards and log tabs reflect only fresh live runs.
 *
 * Wiped: `runs`, `steps`, `usage_events`, `llm_calls` (usage ledger),
 *        `llm_call_telemetry`, `llm_turns`, `run_summaries`, `events`, `tasks`,
 *        `audit_log`, `artifacts`, `run_trace_events`, `run_emitted_events`,
 *        `run_messages`, `agent_run_sessions`,
 *        `event_listeners` (regenerated on bootstrap),
 *        `agent_memory_short`, `agent_memory_long` (per-run scratch),
 *        `llm_budget_reservations` (legacy), `event_store`, `acceptance_scores`,
 *        `tool_stats`, `idempotency_keys`, and runtime Skill snapshots,
 *        legacy byte captures, invocation grants and script reservations.
 *
 * KEPT:  `tenants`, `users`, `memberships`, `workflows`, `workflow_versions`,
 *        `deployments`, `agents`, `agent_versions`, `event_types`,
 *        `entity_types`, `api_tokens`, `webhook_subscriptions`,
 *        `agent_drafts`, `agent_draft_revisions`, `tenant_budgets`, `_meta`.
 *        Managed Skill libraries, drafts, publications and evaluations remain.
 *        These are identity + configuration,
 *        not runtime traffic.
 *
 * Idempotent. Reports a summary of rows cleared per table.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { closeDb, getRawSqlite } from "./client";

/**
 * Order matters because foreign keys are ON DELETE CASCADE for most child
 * tables, but a few cross-table FKs (e.g. `runs.trigger_event_id →
 * events.id`) would otherwise emit warnings. Wiping children first keeps
 * the trace clean even though SQLite is permissive in WAL mode.
 */
const TABLES_TO_WIPE = [
  "skill_script_reservations",
  "skill_invocation_grants",
  "run_skill_snapshots",
  "skill_legacy_bundles",
  "acceptance_scores",
  "run_trace_events",
  "run_emitted_events",
  "run_messages",
  "usage_events",
  "steps",
  "llm_turns",
  "run_summaries",
  "artifacts",
  "agent_memory_short",
  "agent_memory_long",
  "tasks",
  "runs",
  "agent_run_sessions",
  "events",
  "event_store",
  "event_listeners",
  "llm_calls",
  "llm_call_telemetry",
  "llm_budget_reservations",
  "idempotency_keys",
  "tool_stats",
  "audit_log",
] as const;

// Runtime retention prevents ordinary application deletion. Only this
// explicit administrative wipe temporarily suspends these exact triggers.
// Library publication/evaluation protections are never changed.
const RUNTIME_SKILL_RETENTION_TRIGGERS = {
  skill_script_reservations: "skill_script_reservations_no_delete",
  skill_invocation_grants: "skill_invocation_grants_no_delete",
  run_skill_snapshots: "run_skill_snapshots_no_delete",
  skill_legacy_bundles: "skill_legacy_bundles_no_delete",
} as const;

interface WipeReport {
  table: string;
  beforeRows: number;
  afterRows: number;
  cleared: number;
}

export function wipeRuntime(): WipeReport[] {
  const sqlite = getRawSqlite();
  const report: WipeReport[] = [];

  // Suspend enforcement while deleting cyclic runtime references. The
  // transaction must pass foreign_key_check before it may commit.
  sqlite.pragma("foreign_keys = OFF");
  const tx = sqlite.transaction(() => {
    const restoreTriggers: string[] = [];
    for (const [table, name] of Object.entries(RUNTIME_SKILL_RETENTION_TRIGGERS)) {
      if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
      const trigger = sqlite.prepare("SELECT tbl_name, sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name) as { tbl_name: string; sql: string } | undefined;
      if (!trigger || trigger.tbl_name !== table || !trigger.sql) throw new Error(`Runtime Skill retention trigger is missing or mismatched: ${name}`);
      restoreTriggers.push(trigger.sql);
      sqlite.exec(`DROP TRIGGER ${name}`);
    }
    for (const table of TABLES_TO_WIPE) {
      // The table may not exist on databases that pre-date a migration; the
      // existence probe keeps this script forward + backward compatible
      // across schema versions.
      const exists = sqlite
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
        )
        .get(table) as { name: string } | undefined;
      if (!exists) {
        report.push({ table, beforeRows: 0, afterRows: 0, cleared: 0 });
        continue;
      }

      const beforeRow = sqlite
        .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
        .get() as { n: number };
      sqlite.prepare(`DELETE FROM ${table}`).run();
      const afterRow = sqlite
        .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
        .get() as { n: number };
      report.push({
        table,
        beforeRows: beforeRow.n,
        afterRows: afterRow.n,
        cleared: beforeRow.n - afterRow.n,
      });
    }
    // Usage rows and budget projections are one accounting system. Keep the
    // configured caps, but reset their projections when the source ledger is
    // wiped so totals remain reconcilable.
    const hasBudgets = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='tenant_budgets'",
      )
      .get();
    if (hasBudgets) {
      const now = Date.now();
      const date = new Date(now);
      const periodStart = Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        1,
      );
      sqlite
        .prepare(
          "UPDATE tenant_budgets SET used_tokens_month=0, used_usd_month=0, used_usd_nanos=0, period_start=?, updated_at=?",
        )
        .run(periodStart, now);
    }
    for (const definition of restoreTriggers) sqlite.exec(definition);
    const violations = sqlite.pragma("foreign_key_check") as unknown[];
    if (violations.length) throw new Error(`Runtime wipe would leave ${violations.length} foreign-key violation(s); all changes rolled back`);
  });
  try {
    tx();
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }

  return report;
}

function configuredStorageRoot(
  envName: "AGENTIC_LOGS_DIR" | "AGENTIC_ARTIFACTS_DIR",
  fallbackName: "logs" | "artifacts",
): string {
  const configured = process.env[envName]?.trim();
  if (configured) return path.resolve(process.cwd(), configured);
  const rawDatabase = process.env.DATABASE_URL?.replace(/^file:/, "");
  const databasePath = path.resolve(process.cwd(), rawDatabase || "agentic.db");
  return path.join(path.dirname(databasePath), fallbackName);
}

function fsyncDirectory(directory: string): void {
  const fd = openSync(directory, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Atomically replace the runtime log/artifact roots with empty directories,
 * then remove the quarantined old trees. Refuse symlinks and dangerously
 * broad paths so an environment typo cannot turn a cleanup command into an
 * arbitrary recursive delete.
 */
export function wipeRuntimeFiles(): Array<{ kind: "logs" | "artifacts"; root: string }> {
  const roots = [
    {
      kind: "logs" as const,
      root: configuredStorageRoot("AGENTIC_LOGS_DIR", "logs"),
    },
    {
      kind: "artifacts" as const,
      root: configuredStorageRoot("AGENTIC_ARTIFACTS_DIR", "artifacts"),
    },
  ];
  const logsRoot = roots[0]!;
  const artifactsRoot = roots[1]!;
  if (logsRoot.root === artifactsRoot.root) {
    throw new Error("AGENTIC_LOGS_DIR and AGENTIC_ARTIFACTS_DIR must be distinct");
  }
  for (const { kind, root } of roots) {
    const parsedRoot = path.parse(root).root;
    const parent = path.dirname(root);
    if (root === parsedRoot || root === process.cwd() || root === parent) {
      throw new Error(`refusing to wipe unsafe ${kind} path: ${root}`);
    }
    mkdirSync(parent, { recursive: true });
    if (!existsSync(root)) {
      mkdirSync(root, { recursive: true });
      fsyncDirectory(parent);
      continue;
    }
    if (lstatSync(root).isSymbolicLink()) {
      throw new Error(`refusing to wipe symlinked ${kind} path: ${root}`);
    }
    const quarantine = `${root}.wipe-${process.pid}-${Date.now()}`;
    renameSync(root, quarantine);
    try {
      mkdirSync(root, { recursive: false });
      fsyncDirectory(parent);
    } catch (error) {
      renameSync(quarantine, root);
      throw error;
    }
    rmSync(quarantine, { recursive: true, force: false });
    fsyncDirectory(parent);
  }
  return roots;
}

function formatReport(report: WipeReport[]): string {
  const width = Math.max(...report.map((r) => r.table.length), 12);
  const lines = report.map(
    (r) =>
      `  ${r.table.padEnd(width)}  cleared ${String(r.cleared).padStart(6)}  (was ${r.beforeRows})`,
  );
  return lines.join("\n");
}

async function main(): Promise<void> {
  console.log("[wipe-runtime] truncating runtime traffic tables …");
  console.log(
    "[wipe-runtime] KEEPING: tenants, users, memberships, workflows, workflow_versions,",
  );
  console.log(
    "[wipe-runtime]          deployments, agents, agent_versions, event_types,",
  );
  console.log(
    "[wipe-runtime]          agent_drafts, agent_draft_revisions, entity_types, api_tokens,",
  );
  console.log(
    "[wipe-runtime]          webhook_subscriptions, tenant_budgets, _meta",
  );
  console.log("[wipe-runtime]          managed Skill libraries, drafts, versions and evaluations");
  const clearedRoots = wipeRuntimeFiles();
  const report = wipeRuntime();
  console.log(formatReport(report));
  const total = report.reduce((sum, r) => sum + r.cleared, 0);
  for (const cleared of clearedRoots) {
    console.log(`[wipe-runtime] cleared ${cleared.kind} root: ${cleared.root}`);
  }
  console.log(`[wipe-runtime] done — ${total} row(s) cleared in total`);
  closeDb();
}

const isMain =
  !!process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  main().catch((err) => {
    console.error("[wipe-runtime] failed", err);
    process.exit(1);
  });
}
