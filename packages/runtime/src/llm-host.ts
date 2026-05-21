/**
 * Gateway host for the runtime. apps/api builds the singleton LLMGateway
 * from env at boot and calls setRuntimeGateway() so the step engine can
 * dispatch LLM calls for manifest-defined agents' `logic`-type actions.
 *
 * Mirrors the same pattern as packages/agents/src/gateway-host.ts.
 *
 * UC-V11-22 / AR-GAP-07 / PF-GAP-08 — the runtime also needs to bump the
 * `runs_total` Prometheus counter on every manifest-engine run finalize.
 * We don't want `@agentic/runtime` to depend on the api's metrics module
 * (that would invert the package layering), so we follow the same DI
 * pattern: the api builds the registry at boot and calls
 * `setRuntimeMetrics()`; the manifest engine reads `getRuntimeMetrics()`
 * inside the finalize `step.run` block.
 */

import type { LLMGateway } from "@agentic/llm-gateway";

let _gateway: LLMGateway | null = null;

export function setRuntimeGateway(g: LLMGateway): void {
  _gateway = g;
}

export function getRuntimeGateway(): LLMGateway | null {
  return _gateway;
}

/**
 * Minimal contract the api's `metrics` singleton must satisfy. Mirrors the
 * subset of `apps/api/src/services/metrics.ts#metrics.runs` that the
 * runtime calls. Kept in this file (not its own host module) so consumers
 * see one import surface for both gateway + metrics DI.
 */
export interface RuntimeMetricsRegistry {
  runs: {
    inc(labels?: Record<string, string | number | undefined | null>, delta?: number): void;
  };
  runDuration?: {
    observe(value: number, labels?: Record<string, string | number | undefined | null>): void;
  };
}

let _metrics: RuntimeMetricsRegistry | null = null;

export function setRuntimeMetrics(m: RuntimeMetricsRegistry): void {
  _metrics = m;
}

/**
 * Returns null in tests / standalone harness invocations where the api
 * never wired the registry. Callers must tolerate null and skip the inc.
 */
export function getRuntimeMetrics(): RuntimeMetricsRegistry | null {
  return _metrics;
}
