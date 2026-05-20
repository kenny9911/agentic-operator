/**
 * Minimal Prometheus metrics registry (P4-OPS-05 / P4-OPS-06).
 *
 * We avoid `prom-client` to keep the dep surface small. The exposition
 * format is well-specified (text exposition 0.0.4) and easy to emit
 * inline — only counters and histograms are needed for v1.
 *
 * Conventions:
 *   - All metric names use snake_case + a `_total` suffix for counters
 *     (Prometheus naming convention).
 *   - Labels are restricted to a fixed allow-list per metric to keep
 *     cardinality bounded. The runtime feeds in `tenant`, `agent`,
 *     `model`, `status`, `direction`, `route`, `method` and similar
 *     low-cardinality dimensions.
 *   - Histograms use exponential buckets so they cover both
 *     sub-millisecond HTTP latency and multi-minute run durations.
 *
 * Usage:
 *   import { metrics } from "../services/metrics";
 *   metrics.runs.inc({ tenant, agent, model, status: "ok" });
 *   metrics.runDuration.observe(durationMs, { tenant, agent });
 *
 *   // Inside the /metrics route:
 *   reply.type("text/plain; version=0.0.4").send(metrics.serialize());
 */

type Labels = Record<string, string | number | undefined | null>;

interface Counter {
  name: string;
  help: string;
  values: Map<string, number>;
  inc(labels?: Labels, delta?: number): void;
}

interface Histogram {
  name: string;
  help: string;
  buckets: number[];
  // labelKey -> { bucketCounts, count, sum }
  values: Map<string, { counts: number[]; sum: number; count: number }>;
  observe(value: number, labels?: Labels): void;
}

const httpDurationBuckets = [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000];
const runDurationBuckets = [
  100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000, 120_000, 300_000, 600_000,
];

function labelKey(labels: Labels | undefined): string {
  if (!labels) return "";
  const entries = Object.entries(labels)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${k}="${escapeLabelValue(String(v))}"`).join(",");
}

function escapeLabelValue(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function makeCounter(name: string, help: string): Counter {
  const values = new Map<string, number>();
  return {
    name,
    help,
    values,
    inc(labels, delta = 1) {
      const key = labelKey(labels);
      values.set(key, (values.get(key) ?? 0) + delta);
    },
  };
}

function makeHistogram(name: string, help: string, buckets: number[]): Histogram {
  const values = new Map<string, { counts: number[]; sum: number; count: number }>();
  return {
    name,
    help,
    buckets,
    values,
    observe(value, labels) {
      const key = labelKey(labels);
      let cell = values.get(key);
      if (!cell) {
        cell = { counts: new Array(buckets.length).fill(0), sum: 0, count: 0 };
        values.set(key, cell);
      }
      cell.sum += value;
      cell.count += 1;
      for (let i = 0; i < buckets.length; i++) {
        const bound = buckets[i];
        if (bound !== undefined && value <= bound) {
          const current = cell.counts[i] ?? 0;
          cell.counts[i] = current + 1;
        }
      }
    },
  };
}

const runs = makeCounter(
  "runs_total",
  "Total number of agent runs, labeled by tenant/agent/model/status.",
);
const tokens = makeCounter(
  "tokens_total",
  "Total tokens consumed (direction=in|out), labeled by tenant/agent/model.",
);
const cost = makeCounter(
  "cost_usd_total",
  "Total cost in USD, labeled by tenant/agent/model.",
);
const httpRequests = makeCounter(
  "http_requests_total",
  "Total HTTP requests handled by the API, labeled by route/method/status.",
);
const llmErrors = makeCounter(
  "llm_provider_errors_total",
  "Total LLM provider errors, labeled by tenant/provider/model/code.",
);
const runDuration = makeHistogram(
  "run_duration_ms",
  "Distribution of agent-run wall-clock durations in ms.",
  runDurationBuckets,
);
const httpDuration = makeHistogram(
  "http_request_duration_ms",
  "Distribution of HTTP request durations in ms.",
  httpDurationBuckets,
);

function serializeCounter(c: Counter): string {
  let out = `# HELP ${c.name} ${c.help}\n# TYPE ${c.name} counter\n`;
  if (c.values.size === 0) {
    out += `${c.name} 0\n`;
    return out;
  }
  for (const [key, v] of c.values) {
    out += key ? `${c.name}{${key}} ${v}\n` : `${c.name} ${v}\n`;
  }
  return out;
}

function serializeHistogram(h: Histogram): string {
  let out = `# HELP ${h.name} ${h.help}\n# TYPE ${h.name} histogram\n`;
  if (h.values.size === 0) {
    // Emit a zeroed series so scrapers don't 5xx on missing histograms.
    for (const b of h.buckets) {
      out += `${h.name}_bucket{le="${b}"} 0\n`;
    }
    out += `${h.name}_bucket{le="+Inf"} 0\n`;
    out += `${h.name}_sum 0\n`;
    out += `${h.name}_count 0\n`;
    return out;
  }
  for (const [key, cell] of h.values) {
    for (let i = 0; i < h.buckets.length; i++) {
      const cumulative = cell.counts[i] ?? 0;
      const bound = h.buckets[i];
      const labelStr = key ? `${key},le="${bound}"` : `le="${bound}"`;
      out += `${h.name}_bucket{${labelStr}} ${cumulative}\n`;
    }
    const infLabelStr = key ? `${key},le="+Inf"` : `le="+Inf"`;
    out += `${h.name}_bucket{${infLabelStr}} ${cell.count}\n`;
    out += key ? `${h.name}_sum{${key}} ${cell.sum}\n` : `${h.name}_sum ${cell.sum}\n`;
    out += key ? `${h.name}_count{${key}} ${cell.count}\n` : `${h.name}_count ${cell.count}\n`;
  }
  return out;
}

export const metrics = {
  runs,
  tokens,
  cost,
  httpRequests,
  llmErrors,
  runDuration,
  httpDuration,
  /**
   * Render every registered metric in Prometheus text exposition format.
   * Safe to call on every scrape — generation is O(series).
   */
  serialize(): string {
    return [
      serializeCounter(runs),
      serializeCounter(tokens),
      serializeCounter(cost),
      serializeCounter(httpRequests),
      serializeCounter(llmErrors),
      serializeHistogram(runDuration),
      serializeHistogram(httpDuration),
    ].join("");
  },
  /** For tests — wipe every registered series. */
  __resetForTest() {
    runs.values.clear();
    tokens.values.clear();
    cost.values.clear();
    httpRequests.values.clear();
    llmErrors.values.clear();
    runDuration.values.clear();
    httpDuration.values.clear();
  },
};

export type MetricsRegistry = typeof metrics;
