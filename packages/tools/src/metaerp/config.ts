/**
 * Environment presets and credential resolution for the real Meta ERP.
 *
 * Values come from three places, later ones losing:
 *   1. process.env, `METAERP_`-prefixed  (how production injects secrets)
 *   2. a `config.local` file, KEY=VALUE   (how the skill and a laptop do it)
 *   3. the built-in preset for the target environment
 *
 * The presets are transcribed from metaerp-openapi-call/scripts/*.py, which are
 * the实证 record of what actually answers on each estate. They are also the ONLY
 * source of these origins: nothing derives a host from user input, so the
 * self-signed-certificate opt-out below can never be pointed somewhere else.
 */

import fs from "node:fs";
import path from "node:path";
import { findRepoRoot } from "../fs/_shared";

export type MetaerpEnv = "v15" | "beta";

export interface MetaerpEnvPreset {
  /** APIGW origin for openapi-form operations. */
  apigwBase: string;
  /** IAM token mint endpoint. */
  iamTokenUrl: string;
  /** Path prefix the APIG registration uses for this estate. */
  pathPrefix: string;
  /** Cloud console origin (UIAPI login step 1). */
  consoleBase: string;
  /** CSB federation origin (UIAPI login step 2). */
  csbBase: string;
  /** Portal origin that serves /gateway/... (UIAPI steps 3-4). */
  portalBase: string;
  /**
   * The HCS estate serves a self-signed CA, so certificate verification is off
   * for these hosts — the same call the skill's Python scripts make
   * (`verify=False`). It is pinned to the preset rather than exposed as a
   * global switch so it cannot leak onto any other origin. Set
   * METAERP_TLS_INSECURE=false once a CA bundle is deployed.
   */
  insecureTls: boolean;
}

const ENTERPRISE_DEFAULT = "88888888888888888888888888888888";

const PRESETS: Record<MetaerpEnv, MetaerpEnvPreset> = {
  v15: {
    apigwBase: "https://apigw.his.chinasoftinc.com",
    iamTokenUrl: "https://iam.his.chinasoftinc.com/iam/auth/token",
    pathPrefix: "/v15",
    consoleBase: "https://console.his.chinasoftinc.com",
    csbBase: "https://csb.his.chinasoftinc.com",
    portalBase: "https://r7.erp-v15.yf.chinasoftinc.com",
    insecureTls: true,
  },
  beta: {
    apigwBase: "https://apigw.his-beta.chinasoftinc.com",
    iamTokenUrl: "https://iam.his-beta.chinasoftinc.com/iam/auth/token",
    pathPrefix: "/beta",
    consoleBase: "https://console.his-beta.chinasoftinc.com",
    csbBase: "https://csb.his-beta.chinasoftinc.com",
    portalBase: "https://r7.erp-beta.yf.chinasoftinc.com",
    insecureTls: true,
  },
};

export interface MetaerpCredentials {
  env: MetaerpEnv;
  preset: MetaerpEnvPreset;
  /** IAM account/secret/appId — openapi transport. */
  account: string;
  secret: string;
  project: string;
  enterprise: string;
  renterId: string;
  /** Portal login — uiapi transport. Absent unless a UI operation is routed. */
  portalUser: string | null;
  portalPassword: string | null;
  /**
   * Scope fields merged UNDER every real request (the caller always wins).
   *
   * Nearly every metaERP operation rejects a request without a management unit,
   * and the field names are the API's own camelCase — `unitCode`, not the
   * ontology's `unit_code`. Leaving that to the model means it guesses the
   * casing per call and mostly guesses wrong: in the first real run 12 of 13
   * calls failed that way, each with a different spelling. A deployment-wide
   * constant belongs to the deployment, not to a prompt.
   */
  defaults: Record<string, string>;
}

let fileCache: { path: string; values: Record<string, string> } | null = null;

export function _clearMetaerpConfigCacheForTests(): void {
  fileCache = null;
}

/** Where the KEY=VALUE credentials file lives. */
export function metaerpConfigFilePath(): string {
  const explicit = process.env.METAERP_CONFIG_FILE?.trim();
  if (explicit) {
    return path.isAbsolute(explicit)
      ? explicit
      : path.resolve(findRepoRoot(), explicit);
  }
  return path.resolve(findRepoRoot(), "metaerp-openapi-call", "config.local");
}

function readConfigFile(): Record<string, string> {
  const file = metaerpConfigFilePath();
  if (fileCache?.path === file) return fileCache.values;
  const values: Record<string, string> = {};
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      values[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  }
  fileCache = { path: file, values };
  return values;
}

/**
 * One setting, by precedence. `<KEY>_<ENV>` beats `<KEY>` in the file, which is
 * how the skill lets the two estates carry different portal accounts.
 */
function setting(key: string, env: MetaerpEnv): string | null {
  const fromEnv = process.env[`METAERP_${key}`]?.trim();
  if (fromEnv) return fromEnv;
  const file = readConfigFile();
  const scoped = file[`${key}_${env.toUpperCase()}`]?.trim();
  if (scoped && !scoped.startsWith("<")) return scoped;
  const plain = file[key]?.trim();
  if (plain && !plain.startsWith("<")) return plain;
  return null;
}

export function resolveMetaerpEnv(explicit?: string | null): MetaerpEnv {
  const raw = (
    explicit?.trim() ||
    process.env.METAERP_ENV?.trim() ||
    readConfigFile().ENV?.trim() ||
    "v15"
  ).toLowerCase();
  if (raw !== "v15" && raw !== "beta") {
    throw new Error(
      `metaerp: unknown environment '${raw}' (expected "v15" or "beta")`,
    );
  }
  return raw;
}

export function resolveMetaerpPreset(env: MetaerpEnv): MetaerpEnvPreset {
  const base = PRESETS[env];
  const insecure = setting("TLS_INSECURE", env);
  return {
    ...base,
    apigwBase: setting("APIGW_BASE", env) ?? base.apigwBase,
    iamTokenUrl: setting("IAM_TOKEN_URL", env) ?? base.iamTokenUrl,
    consoleBase: setting("CONSOLE_BASE", env) ?? base.consoleBase,
    csbBase: setting("CSB_BASE", env) ?? base.csbBase,
    portalBase: setting("PORTAL_BASE", env) ?? base.portalBase,
    ...(insecure === null ? {} : { insecureTls: insecure !== "false" }),
  };
}

/**
 * Resolve credentials, failing closed with a message that names the missing key
 * and the file it belongs in — an operator hitting this is usually one line
 * away from working, and a generic 401 later would hide that.
 */
export function resolveMetaerpCredentials(explicitEnv?: string | null): MetaerpCredentials {
  const env = resolveMetaerpEnv(explicitEnv);
  const preset = resolveMetaerpPreset(env);
  const unitCode = setting("DEFAULT_UNIT_CODE", env);
  const organizationCode = setting("DEFAULT_ORGANIZATION_CODE", env);
  const need = (key: string): string => {
    const value = setting(key, env);
    if (!value) {
      throw new Error(
        `metaerp: missing credential '${key}' — set METAERP_${key} or add ${key}= to ${metaerpConfigFilePath()}`,
      );
    }
    return value;
  };
  return {
    env,
    preset,
    account: need("ACCOUNT"),
    secret: need("SECRET"),
    project: need("PROJECT"),
    enterprise: setting("ENTERPRISE", env) ?? ENTERPRISE_DEFAULT,
    renterId: need("RENTER_ID"),
    portalUser: setting("PORTAL_USER", env),
    portalPassword: setting("PORTAL_PASSWORD", env),
    defaults: {
      ...(unitCode ? { unitCode } : {}),
      ...(organizationCode ? { organizationCode } : {}),
    },
  };
}

/**
 * Normalise a registration path onto the target estate.
 *
 * The registration inventory is recorded in `/beta/...` form; v15 is the same
 * path with a different prefix. Routes may therefore be authored either with a
 * prefix or without one, and both land in the right place.
 */
export function normalizeMetaerpPath(rawPath: string, preset: MetaerpEnvPreset): string {
  const withSlash = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  for (const known of ["/v15", "/beta"]) {
    if (withSlash === known || withSlash.startsWith(`${known}/`)) {
      return preset.pathPrefix + withSlash.slice(known.length);
    }
  }
  return preset.pathPrefix + withSlash;
}
