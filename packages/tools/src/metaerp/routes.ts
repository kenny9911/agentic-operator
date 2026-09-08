/**
 * Which operations reach the real Meta ERP, and how.
 *
 * The compiled catalog (`erp-operations.json`) names the operations an agent
 * may call; it says nothing about where they live, because the ontology does
 * not know. This table supplies that, per operation:
 *
 *   mock    → the local mock ERP (the default for anything unlisted)
 *   openapi → APIGW + IAM application token
 *   uiapi   → portal gateway + user session
 *
 * Being a table rather than a per-tenant switch is the point. Both scenarios
 * need BOTH real transports (poHeader and the two inventory reads are UI-form
 * while everything else is openapi), and cutting over is done one operation at
 * a time by adding a row — an unlisted operation keeps working against the mock
 * exactly as before, so a half-migrated system is a normal state rather than a
 * broken one.
 */

import fs from "node:fs";
import path from "node:path";
import { findRepoRoot } from "../fs/_shared";

export type MetaerpTransport = "mock" | "openapi" | "uiapi";

export interface MetaerpRoute {
  transport: MetaerpTransport;
  /** Required for the real transports; the path on the target estate. */
  path?: string;
  /** Pin one estate for this operation. Defaults to the configured env. */
  env?: string;
  /**
   * 该操作的默认请求字段，合并在部署级范围键之上、调用方之下。
   *
   * 用来把一个接口钉在确定的范围内——例如 queryPbpHeader 不支持全量列举
   * （不带 pbpNumberList 就报 PBP-ServiceLogic-401069），演示只需要固定那几单。
   */
  defaults?: Record<string, unknown>;
  /**
   * 让这一个写操作绕过全局写闸口。
   *
   * 全局开关是「全放行」，粒度太粗：演示只需要「执行调拨」在真实 ERP 里落一张
   * 调拨单，而同一批路由里还有 changePbp——那会改掉一张真实的采购计划。逐个放行
   * 才能把不可回滚的动作限制在真正需要的那一个上。
   */
  /**
   * 强制字段：合并在调用方**之上**，调用方给了也会被覆盖。
   *
   * `defaults` 是「没给才补」，挡不住模型自己编一个过滤条件——实测里它就编过一个
   * 不存在的采购需求号（PR-2026-11832），还在 coverage_note 里写着「平台锁定单号」，
   * 于是整条链路建立在虚构数据上、判成无偏差。演示范围这种东西必须由平台说了算，
   * 不能是模型的自由度。
   */
  overrides?: Record<string, unknown>;
  /**
   * 单据行数组在 payload 里的字段名（如 `lineList`）。声明了它，`line_defaults`
   * 与 `line_overrides` 才会逐行生效，并且**空行会被就地拦下**——ERP 对无行单据
   * 只回一句 "Cannot submit because there is no detailed line information"，
   * 不说是哪张单、也不说缺什么，排查成本远高于在这里报错。
   */
  line_field?: string;
  /** 逐行合并在调用方**之下**：调用方没给才补。业务字段用这个。 */
  line_defaults?: Record<string, unknown>;
  /**
   * 逐行合并在调用方**之上**。行上的交易类型、单据类型、接收组织、申请人这类
   * 部署级编码属于这里：实测模型给的行漏了 transactionTypeCode / txnOrderTypeCode /
   * submittedBy，还把 sourceCode 填成了业务单号——这些不该是模型的自由度。
   */
  line_overrides?: Record<string, unknown>;
  allow_real_write?: boolean;
  /**
   * 让运行时把稳定的幂等键写进这个字段。
   *
   * ERP 自己要求 uniqueSequenceNumber，这正好解决 Inngest 重放的问题：编译出的外部
   * 动作每次运行只发一次这个写调用，所以 runId 就是稳定且唯一的键——重放拿到同一个
   * 值，ERP 据此拒掉重复建单，而不是造出第二张单。
   */
  idempotency_field?: string;
  note?: string;
}

const DEFAULT_ROUTES_FILE = path.join("config", "metaerp-routes.json");

let cache: { path: string; routes: Map<string, MetaerpRoute> } | null = null;

export function _clearMetaerpRoutesCacheForTests(): void {
  cache = null;
}

export function metaerpRoutesFilePath(): string {
  const explicit = process.env.METAERP_ROUTES_FILE?.trim();
  const relative = explicit || DEFAULT_ROUTES_FILE;
  return path.isAbsolute(relative)
    ? relative
    : path.resolve(findRepoRoot(), relative);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeRoute(operation: string, raw: unknown): MetaerpRoute {
  if (!isRecord(raw)) {
    throw new Error(`metaerp routes: entry '${operation}' must be an object`);
  }
  const transport = raw.transport;
  if (transport !== "mock" && transport !== "openapi" && transport !== "uiapi") {
    throw new Error(
      `metaerp routes: entry '${operation}' has transport '${String(transport)}' (expected mock | openapi | uiapi)`,
    );
  }
  const routePath = typeof raw.path === "string" ? raw.path.trim() : "";
  if (transport !== "mock") {
    // A real transport without a path would silently fall back to the mock
    // path, i.e. call the wrong system while looking configured.
    if (!routePath.startsWith("/") || routePath.includes("..")) {
      throw new Error(
        `metaerp routes: entry '${operation}' is ${transport} and needs an absolute 'path'`,
      );
    }
  }
  const routeDefaults = (raw as { defaults?: unknown }).defaults;
  if (
    routeDefaults !== undefined &&
    (!routeDefaults || typeof routeDefaults !== "object" || Array.isArray(routeDefaults))
  ) {
    throw new Error(`metaerp routes: entry '${operation}' defaults must be an object`);
  }
  const routeOverrides = (raw as { overrides?: unknown }).overrides;
  if (
    routeOverrides !== undefined &&
    (!routeOverrides || typeof routeOverrides !== "object" || Array.isArray(routeOverrides))
  ) {
    throw new Error(`metaerp routes: entry '${operation}' overrides must be an object`);
  }
  const objectField = (key: "line_defaults" | "line_overrides") => {
    const value = (raw as Record<string, unknown>)[key];
    if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
      throw new Error(`metaerp routes: entry '${operation}' ${key} must be an object`);
    }
    return value as Record<string, unknown> | undefined;
  };
  const lineDefaults = objectField("line_defaults");
  const lineOverrides = objectField("line_overrides");
  const lineFieldRaw = (raw as { line_field?: unknown }).line_field;
  const lineField = typeof lineFieldRaw === "string" ? lineFieldRaw.trim() : "";
  if (lineFieldRaw !== undefined && !lineField) {
    throw new Error(`metaerp routes: entry '${operation}' line_field must be a non-empty string`);
  }
  // Per-line scoping is only applied when line_field names the array, so a
  // table that declares one without the other would silently do nothing.
  if (!lineField && (lineDefaults || lineOverrides)) {
    throw new Error(
      `metaerp routes: entry '${operation}' declares line_defaults/line_overrides without line_field`,
    );
  }
  return {
    transport,
    ...(routePath ? { path: routePath } : {}),
    ...(routeDefaults ? { defaults: routeDefaults as Record<string, unknown> } : {}),
    ...(routeOverrides ? { overrides: routeOverrides as Record<string, unknown> } : {}),
    ...(lineField ? { line_field: lineField } : {}),
    ...(lineDefaults ? { line_defaults: lineDefaults } : {}),
    ...(lineOverrides ? { line_overrides: lineOverrides } : {}),
    ...((raw as { allow_real_write?: unknown }).allow_real_write === true
      ? { allow_real_write: true }
      : {}),
    ...(typeof (raw as { idempotency_field?: unknown }).idempotency_field === "string" &&
    (raw as { idempotency_field: string }).idempotency_field.trim()
      ? { idempotency_field: (raw as { idempotency_field: string }).idempotency_field.trim() }
      : {}),
    ...(typeof raw.env === "string" && raw.env.trim() ? { env: raw.env.trim() } : {}),
    ...(typeof raw.note === "string" ? { note: raw.note } : {}),
  };
}

export function loadMetaerpRoutes(): Map<string, MetaerpRoute> {
  const file = metaerpRoutesFilePath();
  if (cache?.path === file) return cache.routes;
  const routes = new Map<string, MetaerpRoute>();
  if (fs.existsSync(file)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      throw new Error(
        `metaerp routes: ${file} is not valid JSON — ${(error as Error).message}`,
      );
    }
    const table = isRecord(parsed) && isRecord(parsed.routes) ? parsed.routes : null;
    if (!table) {
      throw new Error(`metaerp routes: ${file} must be { "routes": { ... } }`);
    }
    for (const [operation, raw] of Object.entries(table)) {
      routes.set(operation, normalizeRoute(operation, raw));
    }
  }
  cache = { path: file, routes };
  return routes;
}

export type MetaerpTransportMode = "mock" | "real";

/**
 * Master switch. `mock` (the default) forces every operation to the mock ERP
 * whatever the table says, so a deployment without credentials keeps working
 * exactly as it does today; the table only takes effect at `real`.
 */
export function metaerpTransportMode(): MetaerpTransportMode {
  return process.env.METAERP_TRANSPORT_MODE?.trim().toLowerCase() === "real"
    ? "real"
    : "mock";
}

/**
 * Second gate, for state-changing operations only.
 *
 * Reads against the real ERP are recoverable — a wrong query returns wrong data
 * and the run fails. A write is not: it creates a real plan, a real package, a
 * real transfer order, and Inngest replays step bodies. So reads may go live on
 * the strength of the routing table alone, while writes need this said out
 * loud as well.
 */
export function metaerpRealWritesEnabled(): boolean {
  return process.env.METAERP_ALLOW_REAL_WRITES?.trim().toLowerCase() === "true";
}

export interface ResolvedRoute extends MetaerpRoute {
  /** Why this ended up on the mock, when the table asked for something else. */
  downgradedFrom?: MetaerpTransport;
  downgradeReason?: string;
}

/**
 * The effective route for one operation, after both gates. Unlisted operations
 * stay on the mock — which is how the platform keeps simulating the reads the
 * real ERP has no interface for.
 */
/**
 * 展开 defaults 里的 `{"$env":"NAME"}`。
 *
 * txnOrderTypeCode 这类是 ERP **实例**的配置值，不同环境不同，不该硬写进版本库，
 * 更不该由模型猜——猜错了轻则再被拒，重则在真实 ERP 里建出错误的单据类型。
 * 环境变量没配就整个字段省略：ERP 自己的报错会点名缺哪个字段，比我们编一个值好。
 */
/**
 * `{"$now": {}}` → the ERP's "YYYY-MM-DD HH:mm:ss" in LOCAL time.
 *
 * The model used to author these. It reached for the alert's ISO timestamp,
 * which is UTC — so a 17:14 request landed in the ERP as 09:14 and the 申请时间
 * column read eight hours early. `minus_seconds` covers the line-level field,
 * which the ERP requires to be strictly earlier than the moment of submission.
 */
function erpTimestamp(spec: unknown): string {
  const minus =
    spec && typeof spec === "object" && "minus_seconds" in spec
      ? Number((spec as { minus_seconds?: unknown }).minus_seconds)
      : 0;
  const at = new Date(Date.now() - (Number.isFinite(minus) ? minus : 0) * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ` +
    `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
  );
}

function expandDefaults(
  defaults: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!defaults) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(defaults)) {
    if (value && typeof value === "object" && !Array.isArray(value) && "$env" in value) {
      const name = (value as { $env?: unknown }).$env;
      const resolved =
        typeof name === "string" ? process.env[name]?.trim() : undefined;
      if (resolved) out[key] = resolved;
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value) && "$now" in value) {
      out[key] = erpTimestamp((value as { $now?: unknown }).$now);
      continue;
    }
    out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

export function resolveRoute(
  operation: string,
  kind: "query" | "write",
): ResolvedRoute {
  const stored = loadMetaerpRoutes().get(operation);
  const declared: MetaerpRoute = stored
    ? {
        ...stored,
        ...(stored.defaults ? { defaults: expandDefaults(stored.defaults) } : {}),
        ...(stored.overrides ? { overrides: expandDefaults(stored.overrides) } : {}),
        ...(stored.line_defaults
          ? { line_defaults: expandDefaults(stored.line_defaults) }
          : {}),
        ...(stored.line_overrides
          ? { line_overrides: expandDefaults(stored.line_overrides) }
          : {}),
      }
    : { transport: "mock" as const };
  if (declared.transport === "mock") return declared;
  if (metaerpTransportMode() !== "real") {
    return {
      transport: "mock",
      downgradedFrom: declared.transport,
      downgradeReason: "METAERP_TRANSPORT_MODE is not 'real'",
    };
  }
  if (kind === "write" && !metaerpRealWritesEnabled() && !declared.allow_real_write) {
    return {
      transport: "mock",
      downgradedFrom: declared.transport,
      downgradeReason: "METAERP_ALLOW_REAL_WRITES is not 'true'",
    };
  }
  return declared;
}
