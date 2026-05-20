/**
 * AgentRegistry — process-singleton map of code-defined agents.
 *
 * Agents register themselves at import time (each agent's file calls
 * `agentRegistry.register(new MyAgent())` at module scope). The apps/api
 * boot routine calls `bootstrapCodeAgents()` to ensure DB rows exist for
 * each registered agent.
 *
 * P5-TEN-01 — tenant-keyed lookup. The internal map key is
 * `${tenantSlug}:${agentName}` so two tenants can each register an agent
 * called e.g. `summarize` without one clobbering the other. The
 * `tenantSlug` argument is optional everywhere for backward compatibility;
 * when omitted the agent registers under the `__system` slug (these are the
 * platform-level system agents loaded from `data/system-agents/`).
 *
 * Lookup order in `get(name, tenantSlug?)`:
 *   1. tenant-scoped registration if a non-`__system` `tenantSlug` is given
 *   2. `__system` platform agent of the same name
 *
 * This means a tenant can override a platform agent for itself without
 * affecting other tenants — and platform agents remain the default for any
 * caller that doesn't supply a slug.
 */

import type { BaseAgent } from "./base-agent";

const SYSTEM_SLUG = "__system";

class AgentRegistry {
  private readonly map = new Map<string, BaseAgent<unknown, unknown>>();

  private key(tenantSlug: string | undefined, name: string): string {
    return `${tenantSlug ?? SYSTEM_SLUG}:${name}`;
  }

  register<TInput, TOutput>(
    agent: BaseAgent<TInput, TOutput>,
    tenantSlug?: string,
  ): void {
    const k = this.key(tenantSlug, agent.name);
    if (this.map.has(k)) {
      // Re-registering is benign in test/dev (hot reload). Silently overwrite.
      this.map.set(k, agent as unknown as BaseAgent<unknown, unknown>);
      return;
    }
    this.map.set(k, agent as unknown as BaseAgent<unknown, unknown>);
  }

  /**
   * Resolve an agent by name. When `tenantSlug` is provided and not
   * `__system`, the tenant-scoped registration wins; otherwise we fall back
   * to the platform `__system` registration.
   */
  get(
    name: string,
    tenantSlug?: string,
  ): BaseAgent<unknown, unknown> | undefined {
    if (tenantSlug && tenantSlug !== SYSTEM_SLUG) {
      const tenantHit = this.map.get(this.key(tenantSlug, name));
      if (tenantHit) return tenantHit;
    }
    return this.map.get(this.key(SYSTEM_SLUG, name));
  }

  has(name: string, tenantSlug?: string): boolean {
    return this.get(name, tenantSlug) !== undefined;
  }

  /**
   * List all registered agents. When `tenantSlug` is supplied, returns the
   * union of platform agents and that tenant's agents (de-duplicated by
   * name, tenant-scoped wins). With no slug, returns every registered agent
   * across every tenant — used by the boot routine to write `agents` rows.
   */
  list(tenantSlug?: string): BaseAgent<unknown, unknown>[] {
    if (!tenantSlug) return Array.from(this.map.values());
    const out = new Map<string, BaseAgent<unknown, unknown>>();
    for (const [k, agent] of this.map.entries()) {
      const ix = k.indexOf(":");
      if (ix < 0) continue;
      const slug = k.slice(0, ix);
      const name = k.slice(ix + 1);
      if (slug === SYSTEM_SLUG) {
        if (!out.has(name)) out.set(name, agent);
      } else if (slug === tenantSlug) {
        out.set(name, agent); // tenant-scoped wins
      }
    }
    return Array.from(out.values());
  }

  /**
   * Lower-level: every `(tenantSlug, agent)` pair currently registered. Used
   * by `bootstrapCodeAgents()` so the agents-table row carries the tenant-id
   * derived from `tenantSlug`.
   */
  entries(): Array<{ tenantSlug: string; agent: BaseAgent<unknown, unknown> }> {
    return Array.from(this.map.entries()).map(([k, agent]) => {
      const ix = k.indexOf(":");
      const tenantSlug = ix < 0 ? SYSTEM_SLUG : k.slice(0, ix);
      return { tenantSlug, agent };
    });
  }

  /** Test-only — clears the registry. */
  _clear(): void {
    this.map.clear();
  }
}

export const agentRegistry = new AgentRegistry();
