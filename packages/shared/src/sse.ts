/**
 * Server-Sent Events helper. Centralizes the headers Next.js App Router
 * needs to NOT buffer the stream (Plan agent risk #3). Build on top of
 * this in route handlers — don't hand-roll SSE per route.
 *
 * Required on Node runtime (`export const runtime = 'nodejs'`). Will not
 * work on edge runtime because better-sqlite3 + most upstream code is
 * Node-only anyway.
 */

export interface SseEvent {
  /** Optional event name. Default unspecified = generic `message`. */
  event?: string;
  /** Optional id for client-side last-event-id reconnection. */
  id?: string;
  /** Data payload. Will be JSON.stringify'd if not already a string. */
  data: unknown;
  /** Optional retry hint (milliseconds). */
  retry?: number;
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

/**
 * Build an SSE Response from a producer that yields events. Generator-based
 * so callers can produce events lazily (e.g., tailing a file with a watcher).
 *
 * The Response body is a ReadableStream wired to the producer; cancelling
 * the request (client disconnect) causes the generator's `return` to fire,
 * letting callers release file handles / DB cursors via try/finally.
 */
export function sseResponse(
  producer: () => AsyncGenerator<SseEvent, void, unknown>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const gen = producer();
      try {
        for await (const ev of gen) {
          controller.enqueue(encoder.encode(formatEvent(ev)));
        }
      } catch (err) {
        controller.error(err);
        return;
      } finally {
        controller.close();
      }
    },
    cancel() {
      // Stream consumer disconnected; generator's `return` fires on next yield.
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

function formatEvent(ev: SseEvent): string {
  const lines: string[] = [];
  if (ev.event) lines.push(`event: ${ev.event}`);
  if (ev.id) lines.push(`id: ${ev.id}`);
  if (ev.retry) lines.push(`retry: ${ev.retry}`);
  const data =
    typeof ev.data === "string" ? ev.data : JSON.stringify(ev.data);
  for (const line of data.split("\n")) {
    lines.push(`data: ${line}`);
  }
  lines.push("", ""); // double-newline terminates the event
  return lines.join("\n");
}
