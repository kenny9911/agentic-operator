/**
 * `agentic logs <run-id> [--tail]` (P1-CLI-03).
 *
 * Reads `/v1/runs/:id/logs` (one-shot) or `/v1/runs/:id/logs?follow=1` (SSE).
 * Pretty-prints each log line to stdout.
 *
 * Examples:
 *   agentic logs run-abc123              # print existing lines, exit
 *   agentic logs run-abc123 --tail       # tail forever (Ctrl-C to stop)
 *   agentic logs run-abc123 --no-color   # disable ANSI colour
 */
import type { RunContext } from "../cli.js";

function shouldColor(ctx: RunContext, args: RunContext["args"]): boolean {
  if (args.flags["no-color"] === true) return false;
  if (process.env.NO_COLOR) return false;
  return (ctx.stdout as NodeJS.WriteStream).isTTY === true;
}

const ANSI = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  grey: "\x1b[90m",
  bold: "\x1b[1m",
};

function colorize(line: string, useColor: boolean): string {
  if (!useColor) return line;
  if (line.includes(" ERROR ") || line.toLowerCase().includes("error"))
    return ANSI.red + line + ANSI.reset;
  if (line.includes(" WARN "))
    return ANSI.yellow + line + ANSI.reset;
  if (line.includes(" DEBUG "))
    return ANSI.grey + line + ANSI.reset;
  if (line.includes(" run.start ") || line.includes(" emit "))
    return ANSI.cyan + line + ANSI.reset;
  if (line.includes(" run.end "))
    return ANSI.green + line + ANSI.reset;
  return line;
}

function buildAuthHeaders(ctx: RunContext): Record<string, string> {
  const h: Record<string, string> = { Accept: "text/event-stream, text/plain" };
  if (ctx.apiToken) h["Authorization"] = `Bearer ${ctx.apiToken}`;
  return h;
}

export async function fetchLogsOneShot(
  ctx: RunContext,
  runId: string,
): Promise<{ ok: boolean; lines: string[] }> {
  const res = await fetch(`${ctx.apiUrl}/v1/runs/${encodeURIComponent(runId)}/logs`, {
    headers: buildAuthHeaders(ctx),
  });
  if (!res.ok) return { ok: false, lines: [] };
  const text = await res.text();
  // The endpoint streams SSE frames even in non-follow mode. Each frame is
  // `event: log\ndata: <line>\n\n`. Extract just the data lines.
  const lines: string[] = [];
  for (const block of text.split("\n\n")) {
    if (!block.trim()) continue;
    const dataLines: string[] = [];
    for (const ln of block.split("\n")) {
      if (ln.startsWith("data:")) dataLines.push(ln.slice(5).trim());
    }
    if (dataLines.length > 0) lines.push(dataLines.join("\n"));
  }
  return { ok: true, lines };
}

async function tailLogs(
  ctx: RunContext,
  runId: string,
  useColor: boolean,
): Promise<number> {
  const url = `${ctx.apiUrl}/v1/runs/${encodeURIComponent(runId)}/logs?follow=1`;
  const res = await fetch(url, { headers: buildAuthHeaders(ctx) });
  if (!res.ok) {
    ctx.stderr.write(
      `logs: GET ${url} → ${res.status}\n`,
    );
    return 1;
  }
  const body = res.body;
  if (!body) {
    ctx.stderr.write("logs: server returned no streaming body\n");
    return 1;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  process.on("SIGINT", () => {
    void reader.cancel("user interrupted");
    process.exit(130);
  });

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let eventType = "message";
      const dataParts: string[] = [];
      for (const ln of frame.split("\n")) {
        if (ln.startsWith("event:")) eventType = ln.slice(6).trim();
        else if (ln.startsWith("data:")) dataParts.push(ln.slice(5).trim());
      }
      if (dataParts.length === 0) continue;
      const data = dataParts.join("\n");
      if (eventType === "log") {
        ctx.stdout.write(colorize(data, useColor) + "\n");
      } else if (eventType === "end") {
        return 0;
      } else if (eventType === "info") {
        ctx.stdout.write(
          useColor
            ? ANSI.grey + `[info] ${data}` + ANSI.reset + "\n"
            : `[info] ${data}\n`,
        );
      } else if (eventType === "error") {
        ctx.stderr.write(
          useColor
            ? ANSI.red + `[error] ${data}` + ANSI.reset + "\n"
            : `[error] ${data}\n`,
        );
        return 1;
      }
    }
  }
  return 0;
}

export async function runLogs(ctx: RunContext): Promise<number> {
  const runId = ctx.args.positional[0];
  if (!runId) {
    ctx.stderr.write("logs: missing run-id. Usage: agentic logs <run-id> [--tail]\n");
    return 2;
  }
  const useColor = shouldColor(ctx, ctx.args);
  const tail = ctx.args.flags["tail"] === true || ctx.args.flags["follow"] === true;

  if (tail) {
    return tailLogs(ctx, runId, useColor);
  }

  const { ok, lines } = await fetchLogsOneShot(ctx, runId);
  if (!ok) {
    ctx.stderr.write(`logs: no log file for ${runId} (or the run is not visible to this token)\n`);
    return 1;
  }
  for (const ln of lines) {
    ctx.stdout.write(colorize(ln, useColor) + "\n");
  }
  return 0;
}
