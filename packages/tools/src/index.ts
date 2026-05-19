/**
 * @agentic/tools — first-party tool implementations.
 *
 * v1 ships mock implementations sufficient to exercise the runtime end-to-end
 * against the RAAS demo workload. Real implementations (HTTP fetch, LLM
 * calls, channel adapters) come post-v1.
 *
 * All tools are async, accept a typed input, return a typed output. They are
 * deliberately small and observable so the step engine can record I/O refs.
 */

export interface ToolContext {
  agentName: string;
  actionName: string;
  subject?: string;
  correlationId: string;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  data: T;
  meta?: Record<string, unknown>;
}

// ─── http.fetch — pretend HTTP fetch ────────────────────────────────────────

export async function httpFetch(
  ctx: ToolContext,
  args: { url: string; method?: string; body?: unknown },
): Promise<ToolResult<{ status: number; body: unknown }>> {
  await delay(120 + jitter(80));
  return {
    ok: true,
    data: { status: 200, body: { mock: true, echoed: args } },
    meta: { tool: "http.fetch" },
  };
}

// ─── channel.publish — mock external channel publish ────────────────────────

export async function channelPublish(
  ctx: ToolContext,
  args: { channel: string; payload: unknown },
): Promise<ToolResult<{ delivered: boolean; channel: string }>> {
  await delay(180 + jitter(120));
  return {
    ok: true,
    data: { delivered: true, channel: args.channel },
    meta: { tool: "channel.publish" },
  };
}

// ─── Generic dispatch — used by step-engine ─────────────────────────────────

export type ToolName = "http.fetch" | "channel.publish";

/**
 * Best-effort tool dispatch by action name. The RAAS manifest doesn't name
 * a specific tool per `type: "tool"` action — it just describes intent in
 * `description`. For v1 we pick a sensible default tool based on the action
 * name's hint words; real wiring lands when each action declares an explicit
 * `tool` field.
 *
 * Note: `llm.call` has been removed from this dispatch. Logic-type actions
 * now route through the LLM gateway (see packages/runtime/src/step-engine.ts);
 * tool-type actions that are LLM-flavored should declare a `logic` type
 * instead, or invoke the gateway explicitly via a tenant tool.
 */
export async function runTool(
  ctx: ToolContext,
  hintFromName?: string,
): Promise<ToolResult> {
  const tool = guessTool(hintFromName ?? ctx.actionName);
  switch (tool) {
    case "http.fetch":
      return httpFetch(ctx, { url: `https://mock.invalid/${ctx.actionName}` });
    case "channel.publish":
      return channelPublish(ctx, {
        channel: "mock",
        payload: { actionName: ctx.actionName },
      });
  }
}

function guessTool(name: string): ToolName {
  const low = name.toLowerCase();
  if (low.includes("publish") || low.includes("notify") || low.includes("alert"))
    return "channel.publish";
  // Default: http.fetch for any unknown tool intent.
  return "http.fetch";
}

// ─── tiny helpers ───────────────────────────────────────────────────────────

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function jitter(max: number) {
  return Math.floor(Math.random() * max);
}
