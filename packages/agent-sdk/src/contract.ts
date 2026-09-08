/**
 * #REDESIGN P2 — the "power-strip" contract.
 *
 * The Agent Factory produces TWO kinds of agents (see docs/design/agent-factory-redesign.md):
 *   - DELIVERED functions — durable, event-triggered, registered on Inngest (the product).
 *   - RUNTIME task-agents — ephemeral CodeAct handlers spawned mid-run to do a subtask.
 *
 * They have different STANDARDS but plug into ONE socket: `AgentRuntime`. Any generated agent,
 * written against `UnifiedAgentContract`, receives the same capabilities regardless of tier — the
 * two ADAPTERS (the Inngest `register.ts` step engine; the CodeAct `codeact.ts` executor) each
 * provide an `AgentRuntime`. Different plugs, same socket.
 *
 * This module is interface-only (no runtime deps) so both the runtime adapters and the factory can
 * import it without a cycle.
 */

import type { MemoryHandle } from "./memory";

/** Read-only guidance, scoped to the host's immutable execution catalog.
 * Loading a Skill grants no business tools, credentials or script execution. */
export type AgentSkillSelector = { id: string } | { name: string };
export interface AgentSkillPageOptions { cursor?: string; limit?: number }
export interface AgentSkillReference {
  readonly id: string;
  readonly versionId: string;
  readonly contentDigest: string;
  readonly name: string;
  readonly description: string;
}
export interface AgentSkillResource {
  readonly path: string;
  readonly encoding: "utf8" | "base64";
  readonly bytes: number;
}
export interface AgentSkills {
  runScript(input: { id: string; scriptPath: string; interpreter: "node" | "python"; args?: string[]; stdin?: string }): Promise<unknown>;
  list(options?: AgentSkillPageOptions): Promise<{ skills: readonly AgentSkillReference[]; nextCursor?: string }>;
  load(selector: AgentSkillSelector): Promise<Omit<AgentSkillReference, "description"> & { origin: "model" | "explicit"; body: string; bytes: number }>;
  listResources(selector: AgentSkillSelector, options?: AgentSkillPageOptions): Promise<{ skill: AgentSkillReference; resources: readonly AgentSkillResource[]; nextCursor?: string }>;
  readResource(selector: AgentSkillSelector, path: string): Promise<AgentSkillResource & { skill: AgentSkillReference; content: string }>;
}
export interface AgentSpawnOptions {
  tools?: string[];
  /** Omit to inherit the exact parent catalog; provide IDs to narrow it. */
  skillIds?: string[];
}

/** Result of spawning a runtime sub-agent (CodeAct). `ok:false` on any failure — never throws. */
export interface SpawnResult {
  ok: boolean;
  data?: Record<string, unknown>;
  emitted?: Array<{ event: string; payload: Record<string, unknown> }>;
  /** the generated sub-agent's code, captured so the factory can PROMOTE it to a deployable spec. */
  code?: string;
  error?: string;
}

/** The capabilities every agent gets, identical on both tiers — THE SOCKET. An adapter may make a
 *  capability a graceful no-op where it doesn't apply (e.g. `spawn` on the delivered tier decomposes
 *  via `invoke` instead), but the SHAPE is uniform so generated code is tier-agnostic. */
export interface AgentRuntime {
  /** identity / tracing */
  agentName: string;
  tenantSlug: string;
  correlationId: string;
  subject?: string;

  /** LLM reasoning over an input with a system prompt → parsed JSON (or `{ text }`). */
  reason(systemPrompt: string, input: unknown): Promise<unknown>;
  /** call a registered tool by name (resolved: tenant → global → MCP), args default to the event. */
  tool(name: string, args?: unknown): Promise<unknown>;
  /** back-compat alias for `tool` — rendered code emits `ctx.tools.run(name, args)`. */
  tools?: { run(name: string, args?: unknown): Promise<unknown> };
  /** emit a downstream event (queued; the runtime finalizes exactly one on the delivered tier). */
  emit(event: string, payload?: Record<string, unknown>): void;
  /** vector-recall memory (run / subject / tenant scopes) — the real MemoryDriver. */
  memory: MemoryHandle;
  skills: AgentSkills;
  /** synchronously call another DEPLOYED agent (durable tier: step.invoke; runtime tier: a spawn). */
  invoke(agentRef: string, input?: unknown): Promise<unknown>;
  /** spawn an EPHEMERAL sub-agent by generating+running its code (runtime tier; depth-capped). */
  spawn(task: string, input?: unknown, opts?: AgentSpawnOptions): Promise<SpawnResult>;
  /** structured log line (surfaced in the run trace). */
  log(level: "info" | "warn" | "error", msg: string, data?: unknown): void;
}

/** Which standard an agent is held to (see the acceptance bars in the design doc). */
export type AgentTier = "delivered" | "runtime";

/** The unified plug: a generated agent implements this and runs on either adapter. */
export interface UnifiedAgentContract {
  name: string;
  tier: AgentTier;
  /** declared typed I/O (from the ontology event_data / the subtask contract). */
  io?: { input?: Array<{ field: string; type: string }>; output?: Array<{ field: string; type: string }> };
  /** the agent's body: input → (reason/tool/emit/spawn via ctx) → structured output. */
  handler(input: Record<string, unknown>, ctx: AgentRuntime): Promise<Record<string, unknown>>;
}

/** Runtime guard: does an object satisfy the AgentRuntime socket? Used by adapters + tests to prove
 *  both tiers provide the same capabilities. */
export function isAgentRuntime(x: unknown): x is AgentRuntime {
  const c = x as Partial<AgentRuntime> | null;
  return (
    !!c &&
    typeof c.agentName === "string" &&
    typeof c.tenantSlug === "string" &&
    typeof c.correlationId === "string" &&
    typeof c.reason === "function" &&
    typeof c.tool === "function" &&
    typeof c.emit === "function" &&
    typeof c.invoke === "function" &&
    typeof c.spawn === "function" &&
    typeof c.log === "function" &&
    !!c.memory &&
    !!c.skills &&
    typeof c.skills.list === "function" &&
    typeof c.skills.load === "function" &&
    typeof c.skills.listResources === "function" &&
    typeof c.skills.readResource === "function"
  );
}
