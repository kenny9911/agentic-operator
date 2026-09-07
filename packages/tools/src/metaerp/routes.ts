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
  return {
    transport,
    ...(routePath ? { path: routePath } : {}),
    ...(routeDefaults ? { defaults: routeDefaults as Record<string, unknown> } : {}),
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
export function resolveRoute(
  operation: string,
  kind: "query" | "write",
): ResolvedRoute {
  const declared = loadMetaerpRoutes().get(operation) ?? { transport: "mock" as const };
  if (declared.transport === "mock") return declared;
  if (metaerpTransportMode() !== "real") {
    return {
      transport: "mock",
      downgradedFrom: declared.transport,
      downgradeReason: "METAERP_TRANSPORT_MODE is not 'real'",
    };
  }
  if (kind === "write" && !metaerpRealWritesEnabled()) {
    return {
      transport: "mock",
      downgradedFrom: declared.transport,
      downgradeReason: "METAERP_ALLOW_REAL_WRITES is not 'true'",
    };
  }
  return declared;
}
