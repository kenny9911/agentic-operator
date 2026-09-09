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

/**
 * `stub` answers from the routing table itself — no HTTP call at all, not even
 * to the local mock ERP. Use it for a step that must simply pass in a demo
 * because the real operation has no counterpart on the target estate (the
 * transfer order lives in v15, so the mock's store has no row to update and
 * its handler 404s). Every stub answer is marked `simulated` in the run trace:
 * an operator reading a run must never mistake it for a real ERP call.
 */
export type MetaerpTransport = "mock" | "openapi" | "uiapi" | "stub";

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
  /** Canned answer for `transport: "stub"`. Required by that transport. */
  stub_response?: Record<string, unknown>;
  /**
   * 按租户覆盖这条路由。浅合并在声明之上。
   *
   * 路由表是全域共用的，一个域为了演示把某个操作改成桩，会连带改掉别的域——
   * 实测里 updateTransactionOrder 改桩后，采购-HC-Formal 的端到端测试立刻红了，
   * 因为它断言这个操作必须真的打到 ERP。演示口径属于某一个租户，不该是全域默认。
   */
  tenant_overrides?: Record<string, Partial<MetaerpRoute>>;
  /** Why this operation is stubbed — surfaced in the run trace. */
  stub_reason?: string;
  /**
   * 写回执的成功判据。ERP 会用 HTTP 200 + 顶层 status 正常，却把失败塞在行里：
   * 实测 createTransactionOrder 返回 affectedRows:0、没有单号，行里写着
   * "The outbound quantity is not enough." / txnOrderLineStatus:"FAILED"，
   * 整单其实没落库。信封校验看不到这些，于是「创建成功但 ERP 里没有单」。
   */
  write_receipt?: {
    /** 这些字段必须存在且非空，否则判失败。 */
    require_fields?: string[];
    /**
     * 这些字段必须取到列出的值之一，否则判失败。
     *
     * createPbp 的回执把整单结论放在 headerProcessedStatus 里，值不是
     * SUCCESS 就是没落库——而字段本身照样存在且非空，`require_fields` 看不出来。
     */
    require_values?: Record<string, string[]>;
    /** 这些字段是错误清单：数组非空即判失败，内容原样带进报错。 */
    error_list_fields?: string[];
    /**
     * 回执里行数组的字段名。缺省沿用 `line_field`（请求侧的名字）——但两侧未必
     * 同名：createPbp 请求发 pbpCreateLineDTOList，回执回 pbpResponseLineList。
     */
    line_field?: string;
    /** 行状态字段名（行数组取 write_receipt.line_field ?? line_field）。 */
    line_status_field?: string;
    /** 行状态取到这些值即判失败。 */
    line_failed_values?: string[];
    /**
     * 每一行都必须带上这些字段且非空，否则判失败。
     *
     * 「来源可溯」这类规则的证据就在行回执里：createPbp 把 sourceObjectLineId 原样
     * 回带，缺了就说明来源映射没写进去——而整单 headerProcessedStatus 照样是 SUCCESS。
     */
    line_require_fields?: string[];
    /** 这些行字段非空（字符串非空 / 数组非空）即判失败，其内容原样带进报错。 */
    line_error_fields?: string[];
  };
  /**
   * 请求体的外层形状。
   *
   * 绝大多数 metaERP 接口收一个对象，但 createPbp 的 requestBody 是
   * `array of PbpCreateHeaderDTO`——直接发对象会被网关按类型不匹配退回。
   * 声明 `"array"` 后，合并好的单据头在发出前包成单元素数组；defaults /
   * overrides / line_* 全部照常作用在**头对象**上，不受影响。
   */
  body_envelope?: "array";
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

let cache: {
  path: string;
  routes: Map<string, MetaerpRoute>;
  tenants: Map<string, TenantRouteDefault>;
} | null = null;

/**
 * 租户级默认通道。
 *
 * 路由表按操作名归属，而操作名是跨租户共用的：场景二的 queryPbpHeader / createPbp /
 * createTransactionOrder 与场景一同名。场景一切到真实 ERP 后，场景二的 13 个操作
 * 跟着一起指向了 v15——其中两个是真实写入，还会带上场景一钉死的 pbpNumberList 过滤。
 * 「先在 mock 上把整条链路跑通」需要一句话就能把一个租户整体钉住，而不是给 35 个
 * 操作各写一段 tenant_overrides。操作级 tenant_overrides 仍然更具体，可以覆盖它。
 */
export interface TenantRouteDefault {
  transport: MetaerpTransport;
  reason?: string;
}

function normalizeTenantDefaults(raw: unknown): Map<string, TenantRouteDefault> {
  const out = new Map<string, TenantRouteDefault>();
  if (raw === undefined) return out;
  if (!isRecord(raw)) {
    throw new Error("metaerp routes: top-level 'tenants' must be an object keyed by tenant slug");
  }
  for (const [slug, value] of Object.entries(raw)) {
    if (!isRecord(value)) {
      throw new Error(`metaerp routes: tenants.${slug} must be an object`);
    }
    const transport = value.transport;
    if (transport !== "mock" && transport !== "stub") {
      // A tenant default may only point AWAY from the real estate. Pointing a
      // whole tenant at a real transport by default would let one line in a
      // config file switch every write it makes to live documents.
      throw new Error(
        `metaerp routes: tenants.${slug}.transport must be mock | stub (got '${String(transport)}')`,
      );
    }
    out.set(slug, {
      transport,
      ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
    });
  }
  return out;
}

export function metaerpTenantDefault(tenantSlug: string | undefined): TenantRouteDefault | undefined {
  if (!tenantSlug) return undefined;
  loadMetaerpRoutes();
  return cache?.tenants.get(tenantSlug);
}

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
  if (
    transport !== "mock" &&
    transport !== "openapi" &&
    transport !== "uiapi" &&
    transport !== "stub"
  ) {
    throw new Error(
      `metaerp routes: entry '${operation}' has transport '${String(transport)}' (expected mock | openapi | uiapi | stub)`,
    );
  }
  const stubResponse = (raw as { stub_response?: unknown }).stub_response;
  if (transport === "stub") {
    if (!stubResponse || typeof stubResponse !== "object" || Array.isArray(stubResponse)) {
      throw new Error(
        `metaerp routes: entry '${operation}' is stub and needs a 'stub_response' object`,
      );
    }
  } else if (stubResponse !== undefined) {
    throw new Error(
      `metaerp routes: entry '${operation}' declares stub_response but transport is '${transport}'`,
    );
  }

  const routePath = typeof raw.path === "string" ? raw.path.trim() : "";
  if (transport !== "mock" && transport !== "stub") {
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
  const bodyEnvelopeRaw = (raw as { body_envelope?: unknown }).body_envelope;
  if (bodyEnvelopeRaw !== undefined && bodyEnvelopeRaw !== "array") {
    throw new Error(
      `metaerp routes: entry '${operation}' body_envelope must be "array" when present`,
    );
  }
  if (bodyEnvelopeRaw === "array" && transport !== "openapi") {
    // Only the openapi transport builds its body by merging; wrapping anywhere
    // else would produce a body the other transport never unwraps.
    throw new Error(
      `metaerp routes: entry '${operation}' body_envelope is only supported on the openapi transport (got '${transport}')`,
    );
  }
  const bodyEnvelope = bodyEnvelopeRaw as "array" | undefined;

  return {
    transport,
    ...(routePath ? { path: routePath } : {}),
    ...(routeDefaults ? { defaults: routeDefaults as Record<string, unknown> } : {}),
    ...(routeOverrides ? { overrides: routeOverrides as Record<string, unknown> } : {}),
    ...(lineField ? { line_field: lineField } : {}),
    ...(lineDefaults ? { line_defaults: lineDefaults } : {}),
    ...(lineOverrides ? { line_overrides: lineOverrides } : {}),
    ...(stubResponse ? { stub_response: stubResponse as Record<string, unknown> } : {}),
    ...((raw as { tenant_overrides?: unknown }).tenant_overrides
      ? {
          tenant_overrides: Object.fromEntries(
            Object.entries(
              (raw as { tenant_overrides: Record<string, unknown> }).tenant_overrides,
            ).map(([tenant, override]) => [
              tenant,
              normalizeRoute(`${operation}@${tenant}`, {
                // 覆盖块只写要改的字段，transport 缺省沿用主声明。
                transport: (override as { transport?: unknown }).transport ?? transport,
                ...(override as Record<string, unknown>),
              }),
            ]),
          ),
        }
      : {}),
    ...(typeof (raw as { stub_reason?: unknown }).stub_reason === "string"
      ? { stub_reason: (raw as { stub_reason: string }).stub_reason }
      : {}),
    ...((raw as { write_receipt?: unknown }).write_receipt
      ? { write_receipt: (raw as { write_receipt: MetaerpRoute["write_receipt"] }).write_receipt }
      : {}),
    ...(bodyEnvelope ? { body_envelope: bodyEnvelope } : {}),
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
  let parsedTenants: unknown;
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
    parsedTenants = isRecord(parsed) ? parsed.tenants : undefined;
    for (const [operation, raw] of Object.entries(table)) {
      routes.set(operation, normalizeRoute(operation, raw));
    }
  }
  cache = { path: file, routes, tenants: normalizeTenantDefaults(parsedTenants) };
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

/**
 * One `{"$env"}` / `{"$now"}` node, or `MISSING` when an unset env var means the
 * whole key should be omitted (that is how a route says "leave this field out
 * entirely" — see METAERP_TRANSFER_AUTO_SUBMIT).
 */
const MISSING = Symbol("metaerp:missing");

function expandNode(value: unknown): unknown | typeof MISSING {
  if (Array.isArray(value)) {
    // Nested, because deployment codes also live inside arrays of objects:
    // createPbp's approverList is `[{approveNode, handlerList}]`, and a
    // top-level-only expansion would ship the literal {"$env":…} to the ERP.
    const out: unknown[] = [];
    for (const entry of value) {
      const expanded = expandNode(entry);
      if (expanded !== MISSING) out.push(expanded);
    }
    return out;
  }
  if (!value || typeof value !== "object") return value;
  if ("$env" in value) {
    const name = (value as { $env?: unknown }).$env;
    const resolved = typeof name === "string" ? process.env[name]?.trim() : undefined;
    return resolved ? resolved : MISSING;
  }
  if ("$now" in value) return erpTimestamp((value as { $now?: unknown }).$now);
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    const expanded = expandNode(nested);
    if (expanded !== MISSING) out[key] = expanded;
  }
  return out;
}

function expandDefaults(
  defaults: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!defaults) return undefined;
  const expanded = expandNode(defaults);
  const out = (expanded === MISSING ? {} : expanded) as Record<string, unknown>;
  return Object.keys(out).length ? out : undefined;
}

export function resolveRoute(
  operation: string,
  kind: "query" | "write",
  tenantSlug?: string,
): ResolvedRoute {
  const base = loadMetaerpRoutes().get(operation);
  const override = tenantSlug ? base?.tenant_overrides?.[tenantSlug] : undefined;
  const tenantDefault = override ? undefined : metaerpTenantDefault(tenantSlug);
  // 优先级：操作级 tenant_overrides > 租户级默认 > 主声明。浅合并，覆盖块只写要改的字段。
  // `override` 只可能来自 `base.tenant_overrides`，所以它存在时 base 必然存在。
  const stored: MetaerpRoute | undefined =
    base && override
      ? ({ ...base, ...override } as MetaerpRoute)
      : tenantDefault
        ? { ...(base ?? { transport: "mock" as const }), transport: tenantDefault.transport }
        : base;
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
  // A stub reaches no system at all, so neither gate applies to it: there is
  // nothing to protect against and downgrading it to the mock would send an
  // HTTP call the table just said not to make.
  if (declared.transport === "mock" || declared.transport === "stub") return declared;
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
