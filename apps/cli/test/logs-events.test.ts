/**
 * Tests for `agentic logs` (one-shot path) and `agentic events tail` (event
 * formatting). The streaming/SSE branches are exercised via a fake Response
 * with a ReadableStream body.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runLogs, fetchLogsOneShot } from "../src/commands/logs.js";
import { formatEvent } from "../src/commands/events.js";
import { parseArgs } from "../src/cli.js";
import type { RunStreamEvent } from "@agentic/contracts";

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function captureStream() {
  const chunks: string[] = [];
  return {
    write(s: string): boolean {
      chunks.push(s);
      return true;
    },
    get text(): string {
      return chunks.join("");
    },
  };
}

const SSE_PAYLOAD = [
  "event: log",
  "data: 2026-05-16T08:14:02.001Z  INFO   run.start  run_id=run-01000 agent=matchResume",
  "",
  "event: log",
  "data: 2026-05-16T08:14:02.301Z  INFO   step.ok    name=validateRedlineAndBlacklist duration=283ms",
  "",
  "event: end",
  "data: ok",
  "",
  "",
].join("\n");

describe("agentic logs", () => {
  it("fetchLogsOneShot parses SSE frames out of the body", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(SSE_PAYLOAD, { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await fetchLogsOneShot(
      {
        args: parseArgs(["logs", "run-01000"]),
        apiUrl: "http://api.test",
        apiToken: "tok",
        stdout: captureStream() as unknown as NodeJS.WritableStream,
        stderr: captureStream() as unknown as NodeJS.WritableStream,
      },
      "run-01000",
    );
    expect(result.ok).toBe(true);
    expect(result.lines.length).toBeGreaterThanOrEqual(2);
    expect(result.lines[0]).toContain("run.start");
  });

  it("runLogs (one-shot) prints lines to stdout", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(SSE_PAYLOAD, { status: 200 }),
    ) as unknown as typeof fetch;
    const stdout = captureStream();
    const stderr = captureStream();
    const code = await runLogs({
      args: parseArgs(["logs", "run-01000", "--no-color"]),
      apiUrl: "http://api.test",
      apiToken: "",
      stdout: stdout as unknown as NodeJS.WritableStream,
      stderr: stderr as unknown as NodeJS.WritableStream,
    });
    expect(code).toBe(0);
    expect(stdout.text).toContain("run.start");
  });

  it("runLogs without run-id returns 2", async () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const code = await runLogs({
      args: parseArgs(["logs"]),
      apiUrl: "http://api.test",
      apiToken: "",
      stdout: stdout as unknown as NodeJS.WritableStream,
      stderr: stderr as unknown as NodeJS.WritableStream,
    });
    expect(code).toBe(2);
    expect(stderr.text).toContain("missing run-id");
  });

  it("runLogs reports failure when the API returns non-200", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("", { status: 404 }),
    ) as unknown as typeof fetch;
    const stdout = captureStream();
    const stderr = captureStream();
    const code = await runLogs({
      args: parseArgs(["logs", "run-missing"]),
      apiUrl: "http://api.test",
      apiToken: "",
      stdout: stdout as unknown as NodeJS.WritableStream,
      stderr: stderr as unknown as NodeJS.WritableStream,
    });
    expect(code).toBe(1);
    expect(stderr.text).toContain("no log file");
  });
});

describe("agentic events tail — formatEvent", () => {
  const cases: Array<{ ev: RunStreamEvent; contains: string[] }> = [
    {
      ev: {
        type: "run.started",
        tenantId: "t",
        at: 0,
        runId: "run-1",
        agentName: "agentA",
        triggerEvent: "E1",
        subject: "S",
        correlationId: "c",
      },
      contains: ["run.start", "run-1", "agent=agentA"],
    },
    {
      ev: {
        type: "run.step.completed",
        tenantId: "t",
        at: 0,
        runId: "run-1",
        stepId: "s",
        ord: 2,
        name: "doThing",
        stepType: "tool",
        status: "ok",
        durationMs: 123,
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        tokensIn: 100,
        tokensOut: 50,
        error: null,
      },
      contains: ["step.end", "#2", "doThing", "ok", "123ms", "tokens=100/50"],
    },
    {
      ev: {
        type: "run.failed",
        tenantId: "t",
        at: 0,
        runId: "run-1",
        errorMessage: "boom",
      },
      contains: ["run.fail", "boom"],
    },
    {
      ev: {
        type: "event.emitted",
        tenantId: "t",
        at: 0,
        eventId: "evt-9",
        name: "X_DONE",
        subject: "S",
        sourceRunId: "run-1",
      },
      contains: ["emit", "X_DONE", "evt-9"],
    },
    {
      ev: {
        type: "task.created",
        tenantId: "t",
        at: 0,
        taskId: "TASK-1",
        runId: "run-1",
        taskType: "jdReview",
        title: "Review JD",
      },
      contains: ["task.new", "TASK-1", "jdReview"],
    },
    {
      ev: {
        type: "task.resolved",
        tenantId: "t",
        at: 0,
        taskId: "TASK-1",
        decision: "approve",
      },
      contains: ["task.done", "TASK-1", "approve"],
    },
  ];

  it.each(cases)("formats $ev.type", ({ ev, contains }) => {
    const line = formatEvent(ev, false);
    for (const needle of contains) {
      expect(line).toContain(needle);
    }
  });
});
