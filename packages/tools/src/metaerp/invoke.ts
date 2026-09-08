/**
 * metaerp.invoke — catalog-bound Meta ERP operation client.
 *
 * The ontology compiler (packages/ontology-compiler) emits an
 * `erp-operations.json` catalog per tenant model (derived from the domain's
 * transform maps): every entry names one Meta ERP OpenAPI operation, its
 * relative POST path, and whether it is a read (`query`) or a state-mutating
 * (`write`) operation. This tool is the ONLY way compiled agents reach the
 * ERP: the model (or a pinned `type:"tool"` step) may select an operation
 * name and a JSON payload — never a URL.
 *
 * Fail-closed contract:
 *   - base URL comes ONLY from the env var named by `config.base_url_env`
 *     (default METAERP_BASE_URL); unset/blank env throws.
 *   - the operation MUST exist in the configured catalog file; a missing
 *     catalog file or an unknown operation throws.
 *   - `config.operation` (compiler pin) overrides the model-supplied
 *     operation; when both are present and disagree, the call throws so a
 *     drifted manifest cannot silently invoke a different ERP op.
 *   - non-2xx and non-JSON upstream responses throw with a bounded
 *     diagnostic so the runtime surfaces a real tool error.
 *
 * Config (manifest `tool_use[].config`):
 *   - catalog_path  (required) repo-relative path to erp-operations.json,
 *                   e.g. "models/power-scm-v1/erp-operations.json".
 *   - base_url_env  env var NAME holding the ERP origin (default
 *                   "METAERP_BASE_URL"). Never a literal URL.
 *   - operation     optional pin — fixes/validates the operation for this
 *                   binding (compiled external actions always pin).
 *   - timeout_ms    request timeout, default 15000.
 */

import fs from "node:fs";
import path from "node:path";
import type { ToolContext } from "@agentic/agent-kit";
import { defineTool } from "@agentic/agent-kit";
import { findRepoRoot } from "../fs/_shared";
import { resolveMetaerpCredentials } from "./config";
import { normalizeMetaerpResponse } from "./envelope";
import { callMetaerpOpenapi } from "./openapi-transport";
import { resolveRoute, type MetaerpRoute } from "./routes";
import { callMetaerpUiapi } from "./uiapi-transport";

export type MetaerpOperationKind = "query" | "write";

export interface MetaerpCatalogOperation {
  operation: string;
  path: string;
  kind: MetaerpOperationKind;
  method: "POST";
  description?: string;
}

interface MetaerpInvokeConfig {
  catalog_path?: string;
  base_url_env?: string;
  operation?: string;
  timeout_ms?: number;
}

const DEFAULT_BASE_URL_ENV = "METAERP_BASE_URL";
const DEFAULT_TIMEOUT_MS = 15_000;

/** `code`/`kind` fact carried by a transport-level failure (no HTTP response
 * at all: refused connection, DNS failure, TLS handshake, timeout). Declarative
 * error ladders match it as `code == integration_unreachable`. */
export const METAERP_UNREACHABLE_CODE = "integration_unreachable";

/**
 * The ERP could not be reached — as opposed to the ERP answering with an
 * error. The two must never look alike to an operator: an HTTP 400 is the
 * agent's payload being wrong (deterministic, do not retry), while this is
 * the network/VPN/proxy/base-URL being wrong (transient at best, and the
 * fix is outside the workflow). The message is bilingual and names the
 * base URL + env var so the run's error is actionable without reading code.
 */
export class IntegrationUnreachableError extends Error {
  readonly code = METAERP_UNREACHABLE_CODE;
  readonly kind = METAERP_UNREACHABLE_CODE;
  readonly integration = "metaerp";
  readonly operation: string;
  readonly baseUrl: string;
  readonly baseUrlEnv: string;
  readonly reason: string;

  constructor(args: {
    operation: string;
    baseUrl: string;
    baseUrlEnv: string;
    reason: string;
  }) {
    super(
      `${METAERP_UNREACHABLE_CODE}: Meta ERP 接口不可达（${args.baseUrlEnv}=${args.baseUrl}，操作 ${args.operation}）— ${args.reason}。` +
        `请检查 VPN／代理／接口地址；接口恢复前该步骤会按重试策略重试，用尽后以失败结束。 ` +
        `/ Meta ERP unreachable at ${args.baseUrl} while invoking '${args.operation}' (${args.reason}); check VPN, proxy and ${args.baseUrlEnv}.`,
    );
    this.name = "IntegrationUnreachableError";
    this.operation = args.operation;
    this.baseUrl = args.baseUrl;
    this.baseUrlEnv = args.baseUrlEnv;
    this.reason = args.reason;
  }
}

/** Human-readable transport failure reason (the undici `fetch failed` wrapper
 * hides the real cause in `error.cause`). */
function transportFailureReason(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && error.name === "TimeoutError") {
    return `timed out after ${timeoutMs}ms`;
  }
  const cause = (error as { cause?: unknown } | null)?.cause;
  const causeCode =
    cause && typeof cause === "object" && typeof (cause as { code?: unknown }).code === "string"
      ? (cause as { code: string }).code
      : undefined;
  const causeMessage = cause instanceof Error ? cause.message : undefined;
  const own = error instanceof Error ? error.message : String(error);
  return [own, causeCode ?? causeMessage].filter(Boolean).join(": ");
}

/** Parsed catalogs keyed by absolute file path. The compiler output is
 * byte-stable per deploy; a redeploy rewrites the file, and the api process
 * restarts (or hot-swaps manifests) around it, so a process-lifetime cache
 * is safe. Tests clear it explicitly. */
const catalogCache = new Map<string, Map<string, MetaerpCatalogOperation>>();

export function _clearMetaerpCatalogCacheForTests(): void {
  catalogCache.clear();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeKind(raw: unknown, operation: string): MetaerpOperationKind {
  if (raw === "query" || raw === "read") return "query";
  if (raw === "write" || raw === "external" || raw === "action") return "write";
  throw new Error(
    `metaerp.invoke: catalog entry '${operation}' has invalid kind '${String(
      raw,
    )}' (expected "query" or "write")`,
  );
}

function normalizeEntry(raw: unknown, index: number): MetaerpCatalogOperation {
  if (!isRecord(raw)) {
    throw new Error(
      `metaerp.invoke: catalog entry #${index} is not an object`,
    );
  }
  const operation =
    typeof raw.operation === "string" && raw.operation.trim()
      ? raw.operation.trim()
      : typeof raw.operation_id === "string" && raw.operation_id.trim()
        ? raw.operation_id.trim()
        : typeof raw.name === "string" && raw.name.trim()
          ? raw.name.trim()
          : null;
  if (!operation) {
    throw new Error(
      `metaerp.invoke: catalog entry #${index} is missing an operation name`,
    );
  }
  const rawPath =
    typeof raw.path === "string" && raw.path.trim()
      ? raw.path.trim()
      : typeof raw.endpoint === "string" && raw.endpoint.trim()
        ? raw.endpoint.trim()
        : null;
  if (!rawPath || !rawPath.startsWith("/") || rawPath.includes("..")) {
    throw new Error(
      `metaerp.invoke: catalog entry '${operation}' needs an absolute relative path starting with '/'`,
    );
  }
  const method = typeof raw.method === "string" ? raw.method.toUpperCase() : "POST";
  if (method !== "POST") {
    throw new Error(
      `metaerp.invoke: catalog entry '${operation}' declares method '${method}'; only POST is supported`,
    );
  }
  return {
    operation,
    path: rawPath,
    kind: normalizeKind(raw.kind, operation),
    method: "POST",
    ...(typeof raw.description === "string"
      ? { description: raw.description }
      : {}),
  };
}

/** Load + cache the operation catalog. Accepts either a bare array of
 * operations or an `{ operations: [...] }` envelope (optionally with
 * metadata), so the compiler's five-file envelope conventions fit. */
export function loadMetaerpCatalog(
  catalogPath: string,
): Map<string, MetaerpCatalogOperation> {
  const absolute = path.isAbsolute(catalogPath)
    ? catalogPath
    : path.resolve(findRepoRoot(), catalogPath);
  const cached = catalogCache.get(absolute);
  if (cached) return cached;

  let rawText: string;
  try {
    rawText = fs.readFileSync(absolute, "utf8");
  } catch (error) {
    throw new Error(
      `metaerp.invoke: operation catalog not readable at '${absolute}' — ` +
        `deploy the compiled erp-operations.json before invoking (${
          (error as NodeJS.ErrnoException).code ?? "read error"
        })`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(
      `metaerp.invoke: operation catalog at '${absolute}' is not valid JSON`,
    );
  }
  const rawEntries: unknown[] = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.operations)
      ? parsed.operations
      : (() => {
          throw new Error(
            `metaerp.invoke: operation catalog at '${absolute}' must be an array or { operations: [...] }`,
          );
        })();
  if (rawEntries.length === 0) {
    throw new Error(
      `metaerp.invoke: operation catalog at '${absolute}' declares zero operations`,
    );
  }
  const map = new Map<string, MetaerpCatalogOperation>();
  rawEntries.forEach((raw, index) => {
    const entry = normalizeEntry(raw, index);
    if (map.has(entry.operation)) {
      throw new Error(
        `metaerp.invoke: duplicate catalog operation '${entry.operation}'`,
      );
    }
    map.set(entry.operation, entry);
  });
  catalogCache.set(absolute, map);
  return map;
}

/**
 * 每个运行允许的 ERP 调用次数上限。
 *
 * 对着 mock 从来不需要：种子数据只有几条，扇出天然有界。对着真实 ERP，
 * 同一段提示词会把查到的每条询价单、每条定标结果再展开一遍——实测一次运行打了
 * 152 次调用、上下文涨到 11 万 token、四次重试全部失败。没有上界时，模型打转的
 * 代价是无限的，而且失败信息看起来像模型不行，不像扇出失控。
 *
 * 预算按 runId 计，**重试共用**：重试会把整个取数循环从头再跑一遍，给它一份新预算
 * 只是把打转重来一次。宁可第二次就明确失败。
 */
const DEFAULT_MAX_CALLS_PER_RUN = 40;
/** 计数表的条目上限，避免长期运行的进程无限增长。 */
const MAX_TRACKED_RUNS = 500;

const callsPerRun = new Map<string, number>();

export function _clearMetaerpCallBudgetForTests(): void {
  callsPerRun.clear();
}

function maxCallsPerRun(): number {
  const raw = Number.parseInt(process.env.METAERP_MAX_CALLS_PER_RUN ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_CALLS_PER_RUN;
}

/**
 * 预算的计量单位。
 *
 * `runId` 是想要的口径，但清单运行时的 LLM 工具循环不一定把它放进 ToolContext
 * （类型上就是可选的）。退化到 correlationId 时必须再带上 agentName——
 * correlationId 是**整条级联共用**的，单用它会让下游 agent 继承上游花掉的预算，
 * 一个取数扇出失控会饿死后面每一步。
 */
/**
 * Apply a route's line-level scope to a document payload.
 *
 * The header's `defaults`/`overrides` merge at the top level only, so nothing
 * reached the entries of `lineList` — and the LLM that authors those entries
 * left out the deployment-wide codes (transactionTypeCode, txnOrderTypeCode,
 * submittedBy) while filling `sourceCode` with a business document number.
 * Same lesson as the backward schedule: codes and constants are the platform's
 * job, the model supplies the business values.
 *
 * Also fails closed on a missing/empty line array. ERP answers a line-less
 * document with "Cannot submit because there is no detailed line information",
 * which names neither the document nor the field; catching it here says which
 * operation and which payload key were empty.
 */
/**
 * Mark a successful write so `lastResult.applied == true` holds on the real ERP.
 *
 * `applied` is a MOCK invention (apps/mock-erp/src/effects.ts) that the compiled
 * manifests adopted as their "did the write land" signal — three option branches
 * gate their emit on it. The real ERP has no such field, so the moment the route
 * flipped to the live transport those emits silently evaluated false: the ERP
 * created INOT20260908YF100013 and the workflow still sat in
 * createStockTransferRequest with nothing downstream. The write path only gets
 * here after the envelope normalizer has rejected an ERROR status, so reaching
 * this point IS the applied signal.
 *
 * Set only when absent: a mock write that reports `applied: false` (option type
 * not applicable) must keep saying so.
 */
/**
 * Reject a write whose envelope said fine but whose receipt says nothing landed.
 *
 * ERP answers a rejected transfer order with HTTP 200 and no top-level ERROR:
 * the header comes back with `affectedRows: 0` and NO `txnOrderHeaderNumber`,
 * and the reason sits per line — `txnOrderLineStatus: "FAILED"` with
 * `errorMessage: "The outbound quantity is not enough."`. Nothing above this
 * can see that, so the platform reported success, stamped `applied: true`, and
 * the workflow marched on past a transfer order that does not exist.
 *
 * The route declares what a real receipt must contain; anything short of it
 * throws with the ERP's own wording, per line.
 */
export function _assertWriteReceiptForTests(
  operation: string,
  route: MetaerpRoute,
  data: unknown,
): void {
  assertWriteReceipt(operation, route, data);
}

function assertWriteReceipt(
  operation: string,
  route: MetaerpRoute,
  data: unknown,
): void {
  const spec = route.write_receipt;
  if (!spec) return;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(
      `metaerp.invoke: '${operation}' 的回执不是对象，无法确认写入是否落库`,
    );
  }
  const receipt = data as Record<string, unknown>;

  const failures: string[] = [];
  for (const field of spec.require_fields ?? []) {
    const value = receipt[field];
    if (value === undefined || value === null || value === "") {
      failures.push(`回执缺少 ${field}（值为 ${JSON.stringify(value ?? null)}）`);
    }
  }

  const lines = route.line_field ? receipt[route.line_field] : undefined;
  if (Array.isArray(lines)) {
    lines.forEach((line, index) => {
      if (typeof line !== "object" || line === null) return;
      const row = line as Record<string, unknown>;
      const status = spec.line_status_field
        ? String(row[spec.line_status_field] ?? "")
        : "";
      if (status && (spec.line_failed_values ?? []).includes(status)) {
        failures.push(`第 ${index + 1} 行状态 ${status}`);
      }
      for (const field of spec.line_error_fields ?? []) {
        const message = row[field];
        if (typeof message === "string" && message.trim() !== "") {
          failures.push(`第 ${index + 1} 行 ${field}: ${message}`);
        }
      }
    });
  }

  if (failures.length > 0) {
    throw new Error(
      `metaerp.invoke: '${operation}' 未在 ERP 落库——${failures.join("；")}。` +
        `ERP 以 HTTP 200 返回但把失败写在了回执里，因此这里判失败而不是成功。`,
    );
  }
}

export function _markAppliedForTests(
  kind: "query" | "write",
  data: unknown,
): unknown {
  return markApplied(kind, data);
}

function markApplied(kind: "query" | "write", data: unknown): unknown {
  if (kind !== "write") return data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return data;
  const record = data as Record<string, unknown>;
  return "applied" in record ? record : { ...record, applied: true };
}

export function _applyLineScopeForTests(
  operation: string,
  route: MetaerpRoute,
  payload: Record<string, unknown>,
  idempotencyKey: string | null,
): Record<string, unknown> {
  return applyLineScope(operation, route, payload, idempotencyKey);
}

function applyLineScope(
  operation: string,
  route: MetaerpRoute,
  payload: Record<string, unknown>,
  idempotencyKey: string | null,
): Record<string, unknown> {
  const field = route.line_field;
  if (!field) return payload;

  const raw = payload[field];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      `metaerp.invoke: '${operation}' 的行数组 ${field} 为空——单据必须至少有一行。` +
        `收到的 payload 顶层字段为 [${Object.keys(payload).join(", ")}]。` +
        `请把带 ${field} 的完整单据头作为 payload 传入，而不是单独一行。`,
    );
  }

  const lineDefaults = route.line_defaults ?? {};
  const lineOverrides = route.line_overrides ?? {};
  // The line carries the header's idempotency value, not one of its own.
  const lineIdempotency =
    route.idempotency_field && idempotencyKey
      ? { [route.idempotency_field]: idempotencyKey }
      : {};

  return {
    ...payload,
    [field]: raw.map((line, index) => {
      if (typeof line !== "object" || line === null || Array.isArray(line)) {
        throw new Error(
          `metaerp.invoke: '${operation}' 的 ${field}[${index}] 不是对象`,
        );
      }
      return {
        ...lineDefaults,
        ...(line as Record<string, unknown>),
        ...lineOverrides,
        ...lineIdempotency,
      };
    }),
  };
}

function budgetKey(ctx: ToolContext): string {
  return ctx.runId ?? `${ctx.correlationId}:${ctx.agentName}`;
}

/** 记一次调用；超预算就失败关闭，并说清是扇出失控而不是接口坏了。 */
function chargeCallBudget(key: string, operation: string): void {
  const limit = maxCallsPerRun();
  const used = (callsPerRun.get(key) ?? 0) + 1;
  callsPerRun.set(key, used);
  if (callsPerRun.size > MAX_TRACKED_RUNS) {
    const oldest = callsPerRun.keys().next().value;
    if (oldest !== undefined) callsPerRun.delete(oldest);
  }
  if (used > limit) {
    throw new Error(
      `metaerp.invoke: 本次运行的 ERP 调用已达上限 ${limit} 次（第 ${used} 次调用 '${operation}' 被拒）。` +
        `这通常意味着取数扇出失控——先收窄查询范围，或调整 METAERP_MAX_CALLS_PER_RUN。`,
    );
  }
}

function readConfig(ctx: ToolContext): MetaerpInvokeConfig {
  return (ctx.config ?? {}) as MetaerpInvokeConfig;
}

function resolveBaseUrl(config: MetaerpInvokeConfig): string {
  const envName = config.base_url_env?.trim() || DEFAULT_BASE_URL_ENV;
  const value = process.env[envName]?.trim();
  if (!value) {
    throw new Error(
      `metaerp.invoke: env var '${envName}' is not set — configure the Meta ERP base URL (e.g. METAERP_BASE_URL=http://localhost:3620)`,
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `metaerp.invoke: env var '${envName}' is not an absolute URL`,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `metaerp.invoke: env var '${envName}' must be an http(s) URL`,
    );
  }
  return value.replace(/\/+$/, "");
}

function resolveOperationName(
  ctx: ToolContext,
  config: MetaerpInvokeConfig,
): string {
  const pinned = config.operation?.trim() || null;
  const supplied =
    typeof ctx.event?.data?.operation === "string" &&
    ctx.event.data.operation.trim()
      ? ctx.event.data.operation.trim()
      : null;
  if (pinned && supplied && pinned !== supplied) {
    throw new Error(
      `metaerp.invoke: this binding is pinned to operation '${pinned}' but the call requested '${supplied}'`,
    );
  }
  const operation = pinned ?? supplied;
  if (!operation) {
    throw new Error(
      "metaerp.invoke: no operation — pass args.operation or pin config.operation",
    );
  }
  return operation;
}

function resolvePayload(ctx: ToolContext): Record<string, unknown> {
  const raw = ctx.event?.data?.payload;
  if (raw == null) return {};
  if (!isRecord(raw)) {
    throw new Error("metaerp.invoke: args.payload must be a JSON object");
  }
  return raw;
}

export const metaerpInvoke = defineTool({
  name: "metaerp.invoke",
  description:
    "Invoke one Meta ERP OpenAPI operation from the tenant's compiled " +
    "erp-operations.json catalog. Args: { operation, payload? }. The manifest " +
    "config names the catalog file, the base-URL env var, and may pin the " +
    "operation. Unknown operations, an unset base-URL env, non-2xx and " +
    "non-JSON responses all fail closed.",
  async handler(ctx) {
    const config = readConfig(ctx);
    if (!config.catalog_path || !config.catalog_path.trim()) {
      throw new Error(
        "metaerp.invoke: config.catalog_path is required (repo-relative path to erp-operations.json)",
      );
    }
    const catalog = loadMetaerpCatalog(config.catalog_path.trim());
    const operationName = resolveOperationName(ctx, config);
    const entry = catalog.get(operationName);
    if (!entry) {
      const known = [...catalog.keys()].sort();
      throw new Error(
        `metaerp.invoke: operation '${operationName}' is not in the catalog ` +
          `'${config.catalog_path}'. Known operations: ${known
            .slice(0, 20)
            .join(", ")}${known.length > 20 ? ", …" : ""}`,
      );
    }
    const payload = resolvePayload(ctx);
    const timeoutMs =
      typeof config.timeout_ms === "number" &&
      Number.isFinite(config.timeout_ms) &&
      config.timeout_ms > 0
        ? Math.min(config.timeout_ms, 120_000)
        : DEFAULT_TIMEOUT_MS;

    // Where this operation actually lives. Unlisted operations, and anything
    // held back by the two gates, keep going to the mock ERP exactly as before
    // — a half-migrated estate is a normal state here, not a broken one.
    chargeCallBudget(budgetKey(ctx), entry.operation);

    const route = resolveRoute(entry.operation, entry.kind, ctx.tenantSlug);
    const routeMeta = {
      tool: "metaerp.invoke",
      operation: entry.operation,
      kind: entry.kind,
      path: entry.path,
      transport: route.transport,
      ...(route.downgradedFrom
        ? {
            // Say it plainly in the trace: an operator reading a run needs to
            // know the ERP was simulated, not merely that a call succeeded.
            simulated: true,
            declaredTransport: route.downgradedFrom,
            simulatedBecause: route.downgradeReason,
          }
        : {}),
      request: payload,
      correlationId: ctx.correlationId,
    };

    if (route.transport === "stub") {
      return {
        data: markApplied(entry.kind, { ...route.stub_response }),
        meta: {
          ...routeMeta,
          // Say it plainly: nothing was called. A stub that reads like a
          // successful ERP call is worse than no call at all.
          simulated: true,
          simulatedBecause: route.stub_reason ?? "routing table declares this operation as a stub",
        },
      };
    }

    if (route.transport !== "mock") {
      const credentials = resolveMetaerpCredentials(route.env);
      // 幂等键：ERP 自己要求 uniqueSequenceNumber，而编译出的外部动作每次运行只发
      // 一次这个写调用——所以 runId 就是稳定且唯一的键。Inngest 重放拿到同一个值，
      // 由 ERP 拒掉重复建单，而不是造出第二张单。没有 runId 就不填：宁可让 ERP 报
      // 缺字段，也不要用一个每次都不同的值把幂等性悄悄变成空话。
      const idempotencyKey = route.idempotency_field && ctx.runId ? ctx.runId : null;
      const routeDefaults =
        route.defaults || idempotencyKey
          ? {
              ...(route.defaults ?? {}),
              ...(idempotencyKey ? { [route.idempotency_field!]: idempotencyKey } : {}),
            }
          : undefined;
      const scopedPayload = applyLineScope(entry.operation, route, payload, idempotencyKey);
      const call =
        route.transport === "openapi" ? callMetaerpOpenapi : callMetaerpUiapi;
      const result = await call({
        operation: entry.operation,
        path: route.path ?? entry.path,
        payload: scopedPayload,
        credentials,
        timeoutMs,
        ...(routeDefaults ? { defaults: routeDefaults } : {}),
        ...(route.overrides ? { overrides: route.overrides } : {}),
      });
      assertWriteReceipt(entry.operation, route, result.data);
      return {
        data: markApplied(entry.kind, result.data),
        meta: {
          ...routeMeta,
          env: credentials.env,
          url: result.url,
          status: result.status,
        },
      };
    }

    const baseUrl = resolveBaseUrl(config);
    const url = `${baseUrl}${entry.path}`;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = ctx.signal
      ? AbortSignal.any([ctx.signal, timeoutSignal])
      : timeoutSignal;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      });
    } catch (error) {
      // No HTTP response at all — the ERP was never reached. Typed so the
      // run's error ladder and the operator can tell "ERP unreachable" from
      // "ERP rejected the payload" (the HTTP-status branch below).
      throw new IntegrationUnreachableError({
        operation: operationName,
        baseUrl,
        baseUrlEnv: config.base_url_env?.trim() || DEFAULT_BASE_URL_ENV,
        reason: transportFailureReason(error, timeoutMs),
      });
    }

    return {
      data: normalizeMetaerpResponse({
        operation: entry.operation,
        status: response.status,
        body: await response.text(),
        url,
      }),
      meta: {
        ...routeMeta,
        // The absolute URL actually called, and the body actually sent. An
        // operator asked to trust that the ERP was written to needs to see the
        // request, not a claim that one happened.
        url,
        status: response.status,
      },
    };
  },
});
