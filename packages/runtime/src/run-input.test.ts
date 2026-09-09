import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getRawSqlite } from "@agentic/db";
import { createMemoryHandle, getMemoryDriver, setMemoryDriver } from "./memory";
import {
  createRunInputMemory,
  readRunInputContext,
  readRunInputHistory,
  rememberRunInput,
  renderRunInputMessage,
} from "./run-input";

const previousUrl = process.env.DATABASE_URL;
const previousWriter = process.env.AGENTIC_SQLITE_TEST_WRITER;
const previousDriver = getMemoryDriver();
beforeEach(() => {
  closeDb();
  process.env.DATABASE_URL = ":memory:";
  process.env.AGENTIC_SQLITE_TEST_WRITER = "1";
  getRawSqlite().exec(`
    CREATE TABLE agent_memory_long (
      tenant_id TEXT NOT NULL, agent_name TEXT NOT NULL, subject TEXT NOT NULL,
      key TEXT NOT NULL, value_json TEXT NOT NULL, embedding_json TEXT,
      created_at INTEGER DEFAULT 0, updated_at INTEGER NOT NULL, expires_at INTEGER,
      PRIMARY KEY (tenant_id, agent_name, subject, key)
    );
    CREATE TABLE runs (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, status TEXT NOT NULL);
  `);
});
afterAll(() => {
  closeDb();
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  if (previousWriter === undefined) delete process.env.AGENTIC_SQLITE_TEST_WRITER;
  else process.env.AGENTIC_SQLITE_TEST_WRITER = previousWriter;
  setMemoryDriver(previousDriver);
});

const binding = { tenantId: "tenant-a", agentName: "reviewer", contextKey: "case-1" };
function completeRun(id: string, tenantId = binding.tenantId, status = "ok") {
  getRawSqlite().prepare("INSERT INTO runs (id, tenant_id, status) VALUES (?, ?, ?)").run(id, tenantId, status);
}

describe("operator input and durable context memory", () => {
  it("recalls only successful runs with the exact tenant, agent, and context key", async () => {
    const own = createRunInputMemory(binding);
    completeRun("run-first");
    await rememberRunInput(own, { runId: "run-first", input: { prompt: "Review contract A" }, output: "Clause A expires soon" });
    expect(await readRunInputHistory(createRunInputMemory({ ...binding, runId: "run-next" })))
      .toEqual([{ runId: "run-first", input: "User prompt:\nReview contract A", output: "Clause A expires soon" }]);
    for (const other of [{ tenantId: "tenant-b" }, { agentName: "other" }, { contextKey: "case-2" }]) {
      expect(await readRunInputHistory(createRunInputMemory({ ...binding, ...other }))).toEqual([]);
    }
    expect(createRunInputMemory({ tenantId: binding.tenantId, agentName: binding.agentName })).toBeUndefined();
    expect(await readRunInputHistory(own, "run-first")).toEqual([]);

    for (const status of ["running", "failed", "cancelled"]) {
      completeRun(`run-${status}`, binding.tenantId, status);
      await rememberRunInput(own, { runId: `run-${status}`, input: { prompt: status }, output: "must not recall" });
    }
    expect((await readRunInputHistory(own)).map((turn) => turn.runId)).toEqual(["run-first"]);
  });

  it("makes repeated finalization idempotent and caps stored history", async () => {
    const memory = createRunInputMemory(binding);
    for (let index = 0; index < 8; index++) {
      completeRun(`run-${index}`);
      await rememberRunInput(memory, { runId: `run-${index}`, input: { prompt: "a".repeat(10_000) }, output: "b".repeat(10_000) });
    }
    await rememberRunInput(memory, { runId: "run-7", input: { prompt: "duplicate replay" }, output: "must not replace" });
    const history = await readRunInputHistory(memory);
    expect(history).toHaveLength(4);
    expect(history.at(-1)?.input).not.toContain("duplicate replay");
    expect(history.every((turn) => turn.input.length < 3_020 && turn.output.length < 3_020)).toBe(true);
    expect(getRawSqlite().prepare("SELECT count(*) AS count FROM agent_memory_long").get()).toEqual({ count: 5 });
  });

  it("supports an explicitly isolated draft namespace and honors expiry", async () => {
    const memory = createRunInputMemory({ ...binding, agentName: "draft:workflow:agent", requireSuccessfulRun: false });
    await rememberRunInput(memory, { runId: "draft-1", input: { context: "draft requirements" }, output: "draft answer" });
    expect(await readRunInputHistory(memory)).toHaveLength(1);
    getRawSqlite().exec("UPDATE agent_memory_long SET expires_at = 1");
    expect(await readRunInputHistory(memory)).toEqual([]);
  });

  it("keeps reviewed file text and recalled output in user content and validates the boundary", () => {
    const input = readRunInputContext({ prompt: "Summarize", context: "For the auditor", attachments: [{ id: "file-1", name: "scan.png", mimeType: "image/png", size: 1, text: "Total: 42" }] });
    const message = renderRunInputMessage(input, [{ runId: "prior", input: "Previous request", output: "Previous result" }]);
    expect(message).toContain("Total: 42");
    expect(message).toContain("For the auditor");
    expect(message).toContain("Previous result");
    expect(() => readRunInputContext({ contextKey: " " })).toThrow();
    expect(() => readRunInputContext({ attachments: [{ text: "x" }] })).toThrow();
    expect(renderRunInputMessage(undefined)).toBeUndefined();
  });

  it("renders all 200,000 characters of a reviewed Markdown attachment including the ending", () => {
    const ending = "\n## Final finding\nEvidence from the end must reach the model.";
    const text = "# Reviewed source\n\n- Reference material with \"quotes\" and 中文.\n"
      .repeat(4_000)
      .slice(0, 200_000 - ending.length) + ending;
    const input = readRunInputContext({
      prompt: "Summarize the reviewed attachment",
      attachments: [{
        id: "file-large-markdown",
        name: "research-evidence.md",
        mimeType: "text/markdown",
        size: Buffer.byteLength(text),
        text,
      }],
    });

    expect(text).toHaveLength(200_000);
    const message = renderRunInputMessage(input);
    expect(message).toContain(JSON.stringify(text));
    expect(message).toContain("Evidence from the end must reach the model.");
    expect(message).not.toContain("[truncated]");
  });

  it("opts code-agent semantic recall into the exact context without changing legacy scope", async () => {
    const scopes: unknown[] = [];
    setMemoryDriver({ search: async (_query, _count, scope) => { scopes.push(scope); return []; } });
    const base = { tenantId: "tenant-a", agentName: "agent", subject: "case-1", runId: "run-1" };
    await createMemoryHandle({ ...base, subjectExact: true }).search("query", 5);
    await createMemoryHandle(base).search("query", 5);
    expect(scopes).toEqual([
      { tenantId: "tenant-a", agentName: "agent", subject: "case-1", subjectExact: true },
      { tenantId: "tenant-a", agentName: "agent", subject: "case-1" },
    ]);
  });
});
