/**
 * AgentRegistry — process-singleton Map of code-defined agents.
 *
 * Agents register themselves at import time (each agent's file calls
 * `agentRegistry.register(new MyAgent())` at module scope), then the
 * apps/api boot routine calls `bootstrapCodeAgents()` to ensure DB rows
 * exist for each registered agent.
 */

import type { BaseAgent } from "./base-agent";

class AgentRegistry {
  private readonly map = new Map<string, BaseAgent<unknown, unknown>>();

  register<TInput, TOutput>(agent: BaseAgent<TInput, TOutput>): void {
    if (this.map.has(agent.name)) {
      // Re-registering is benign in test/dev (hot reload). Silently overwrite.
      this.map.set(agent.name, agent as unknown as BaseAgent<unknown, unknown>);
      return;
    }
    this.map.set(agent.name, agent as unknown as BaseAgent<unknown, unknown>);
  }

  get(name: string): BaseAgent<unknown, unknown> | undefined {
    return this.map.get(name);
  }

  has(name: string): boolean {
    return this.map.has(name);
  }

  list(): BaseAgent<unknown, unknown>[] {
    return Array.from(this.map.values());
  }

  /** Test-only — clears the registry. */
  _clear(): void {
    this.map.clear();
  }
}

export const agentRegistry = new AgentRegistry();
