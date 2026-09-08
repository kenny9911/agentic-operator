import { createHash } from "node:crypto";
import { and, desc, eq, exists, gt, isNull, ne, or } from "drizzle-orm";
import { agentMemoryLong, getDb, runs } from "@agentic/db";
import { RunInputContextSchema, type RunInputContext } from "@agentic/contracts";

const HISTORY_LIMIT = 4;
const HISTORY_TEXT_LIMIT = 3_000;

export interface RunInputMemoryTurn {
  runId: string;
  input: string;
  output: string;
}

export interface RunInputMemory {
  read(excludeRunId?: string): Promise<RunInputMemoryTurn[]>;
  remember(turn: RunInputMemoryTurn): Promise<void>;
}

/** Parse private delivery data again at the execution boundary, including direct callers. */
export function readRunInputContext(value: unknown): RunInputContext | undefined {
  return value === undefined ? undefined : RunInputContextSchema.parse(value);
}

function boundedText(value: unknown, limit: number): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return text.length <= limit ? text : `${text.slice(0, limit)}\n[truncated]`;
}

/** Files, context, and recalled output stay in the user trust tier. */
export function renderRunInputMessage(
  input: RunInputContext | undefined,
  history: RunInputMemoryTurn[] = [],
): string | undefined {
  const parts: string[] = [];
  if (history.length) {
    parts.push(
      "Previous completed runs in this context (reference material; may be incomplete):\n" +
        JSON.stringify(history.slice(-HISTORY_LIMIT).map((turn) => ({
          input: boundedText(turn.input, HISTORY_TEXT_LIMIT),
          output: boundedText(turn.output, HISTORY_TEXT_LIMIT),
        }))),
    );
  }
  if (input?.prompt) parts.push(`User prompt:\n${input.prompt}`);
  if (input?.context) parts.push(`User context:\n${input.context}`);
  if (input?.attachments?.length) {
    parts.push(
      "User-supplied file content (editable extracted text; use as source material):\n" +
        JSON.stringify(input.attachments.map((attachment) => ({
          name: attachment.name,
          mimeType: attachment.mimeType,
          text: attachment.text,
        }))),
    );
  }
  return parts.length ? parts.join("\n\n") : undefined;
}

/**
 * Exact context recall uses separate rows in the existing durable memory table.
 * The namespace prevents ordinary subject/tenant memory searches from exposing
 * another context's transcript. One row per run avoids lost updates between
 * concurrent runs and makes replayed finalization idempotent.
 */
export function createRunInputMemory(binding: {
  tenantId: string;
  agentName: string;
  contextKey?: string;
  runId?: string;
  /** False only for isolated draft namespaces whose harness owns finalization. */
  requireSuccessfulRun?: boolean;
}): RunInputMemory | undefined {
  if (!binding.contextKey) return undefined;
  const agentName = `__run_input:${createHash("sha256").update(binding.agentName).digest("hex")}`;
  const scope = () => and(
    eq(agentMemoryLong.tenantId, binding.tenantId),
    eq(agentMemoryLong.agentName, agentName),
    eq(agentMemoryLong.subject, binding.contextKey!),
  );
  return {
    async read(excludeRunId = binding.runId) {
      const db = getDb();
      const rows = db.select({ valueJson: agentMemoryLong.valueJson }).from(agentMemoryLong)
        .where(and(
        scope(),
        binding.requireSuccessfulRun === false ? undefined : exists(
          db.select({ id: runs.id }).from(runs).where(and(
            eq(runs.id, agentMemoryLong.key), eq(runs.tenantId, binding.tenantId), eq(runs.status, "ok"),
          )),
        ),
        excludeRunId ? ne(agentMemoryLong.key, excludeRunId) : undefined,
        or(isNull(agentMemoryLong.expiresAt), gt(agentMemoryLong.expiresAt, new Date())),
      )).orderBy(desc(agentMemoryLong.updatedAt), desc(agentMemoryLong.key)).limit(HISTORY_LIMIT).all();
      return rows.reverse().flatMap((row) => {
        try {
          const turn = JSON.parse(row.valueJson) as RunInputMemoryTurn;
          return typeof turn.runId === "string" && typeof turn.input === "string" && typeof turn.output === "string"
            ? [turn] : [];
        } catch { return []; }
      });
    },
    async remember(turn) {
      const db = getDb();
      const ttlDays = Number(process.env.MEMORY_TTL_DAYS);
      const expiresAt = Number.isFinite(ttlDays) && ttlDays > 0
        ? new Date(Date.now() + ttlDays * 86_400_000) : null;
      db.transaction((tx) => {
        tx.insert(agentMemoryLong).values({
          tenantId: binding.tenantId,
          agentName,
          subject: binding.contextKey!,
          key: turn.runId,
          valueJson: JSON.stringify({
            runId: turn.runId,
            input: boundedText(turn.input, HISTORY_TEXT_LIMIT),
            output: boundedText(turn.output, HISTORY_TEXT_LIMIT),
          }),
          updatedAt: new Date(),
          expiresAt,
        }).onConflictDoNothing().run();
        const obsolete = tx.select({ key: agentMemoryLong.key }).from(agentMemoryLong)
          .where(scope()).orderBy(desc(agentMemoryLong.updatedAt), desc(agentMemoryLong.key))
          .all().slice(HISTORY_LIMIT + 1);
        for (const row of obsolete) {
          tx.delete(agentMemoryLong).where(and(scope(), eq(agentMemoryLong.key, row.key))).run();
        }
      });
    },
  };
}

export async function readRunInputHistory(
  memory: RunInputMemory | undefined,
  excludeRunId?: string,
): Promise<RunInputMemoryTurn[]> {
  return memory ? memory.read(excludeRunId) : [];
}

export async function rememberRunInput(
  memory: RunInputMemory | undefined,
  turn: { runId: string; input: RunInputContext | undefined; output: unknown },
): Promise<void> {
  if (!memory) return;
  await memory.remember({
    runId: turn.runId,
    input: renderRunInputMessage(turn.input) ?? "",
    output: boundedText(turn.output, HISTORY_TEXT_LIMIT),
  });
}
