/**
 * Connectivity probe for the real Meta ERP — run this FIRST, before pointing
 * any agent at it.
 *
 *   pnpm erp:probe                 # every read routed to a real transport
 *   pnpm erp:probe queryPbpLine    # just one
 *
 * It answers the only question that matters at cutover: does this machine, with
 * these credentials, actually reach that operation? Each of the ways it can
 * fail has a different fix, and they are indistinguishable from inside an agent
 * run — so they are separated and named here instead.
 *
 * READS ONLY. Write operations are never probed: they create real plans,
 * packages and transfer orders, and a probe that leaves debris behind is not a
 * probe. The empty payload is deliberate too — an operation that answers
 * "field X is required" has already proved the link works, which is exactly
 * what we are measuring.
 */

import fs from "node:fs";
import path from "node:path";
import {
  loadMetaerpRoutes,
  metaerpConfigFilePath,
  resolveMetaerpCredentials,
  callMetaerpOpenapi,
  callMetaerpUiapi,
} from "../packages/tools/src/metaerp/index.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const MODELS = ["hc-digital-worker-v1", "hc-procurement-v1"];

/**
 * Apply METAERP_* settings from the repo's own .env.
 *
 * Done here rather than with `--env-file` because that flag resolves against
 * the working directory, and this script is launched through the api workspace
 * (which is where tsx lives) — so "it silently used different settings than the
 * running system" is a very easy mistake to make. Anything already in the
 * environment still wins.
 */
function loadRepoEnv(): void {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key.startsWith("METAERP_") || process.env[key] !== undefined) continue;
    process.env[key] = trimmed.slice(eq + 1).trim();
  }
}

type Verdict = "reachable" | "params" | "unauthorised" | "unregistered" | "network" | "failed";

const LABEL: Record<Verdict, string> = {
  reachable: "✅ 通",
  params: "✅ 链路已通（业务参数不满足）",
  unauthorised: "⚠️  未授权（在 APIG 给 appId 授权即可）",
  unregistered: "❌ 未注册（路径/环境前缀核对）",
  network: "❌ 网络不通（先确认 OpenVPN）",
  failed: "❌ 失败",
};

/** Which operations are reads, per the compiled catalogs. */
function readOperations(): Set<string> {
  const reads = new Set<string>();
  for (const model of MODELS) {
    const file = path.join(ROOT, "models", model, "erp-operations.json");
    if (!fs.existsSync(file)) continue;
    for (const entry of JSON.parse(fs.readFileSync(file, "utf8")) as Array<
      Record<string, unknown>
    >) {
      const name = String(entry.operation_id ?? entry.operation ?? "");
      if (name && entry.kind === "query") reads.add(name);
    }
  }
  return reads;
}

function classify(message: string): Verdict {
  if (/not authorised|couldn't access/i.test(message)) return "unauthorised";
  if (/not registered|Service Not Found/i.test(message)) return "unregistered";
  if (
    /ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|EPROTO|timed out|socket hang up|certificate/i.test(
      message,
    )
  ) {
    return "network";
  }
  // A business error code means the request was routed, authenticated and
  // understood — the link is up.
  if (/status=ERROR/i.test(message)) return "params";
  return "failed";
}

async function main(): Promise<void> {
  loadRepoEnv();
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const routes = loadMetaerpRoutes();
  const reads = readOperations();

  const targets = [...routes.entries()]
    .filter(([name, route]) => route.transport !== "mock" && reads.has(name))
    .filter(([name]) => only.length === 0 || only.includes(name));

  if (targets.length === 0) {
    console.error(
      only.length
        ? `[probe] ${only.join(", ")} 不是路由到真实 ERP 的读操作`
        : "[probe] 路由表里没有指向真实 ERP 的读操作",
    );
    process.exitCode = 1;
    return;
  }

  let credentials: ReturnType<typeof resolveMetaerpCredentials>;
  try {
    credentials = resolveMetaerpCredentials();
  } catch (error) {
    console.error(`[probe] ${(error as Error).message}`);
    console.error(`[probe] 凭据文件：${metaerpConfigFilePath()}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `[probe] 环境=${credentials.env} appId=${credentials.project} 租户=${credentials.renterId}`,
  );
  console.log(`[probe] 凭据文件=${metaerpConfigFilePath()}`);
  console.log(`[probe] 待探测读操作 ${targets.length} 个（只读，不产生任何单据）\n`);

  const tally = new Map<Verdict, number>();
  for (const [operation, route] of targets) {
    const call = route.transport === "openapi" ? callMetaerpOpenapi : callMetaerpUiapi;
    let verdict: Verdict;
    let detail = "";
    try {
      await call({
        operation,
        path: route.path!,
        payload: {},
        credentials,
        timeoutMs: 30_000,
      });
      verdict = "reachable";
    } catch (error) {
      const message = (error as Error).message;
      verdict = classify(message);
      detail = message.replace(/\s+/g, " ").slice(0, 150);
    }
    tally.set(verdict, (tally.get(verdict) ?? 0) + 1);
    console.log(`  ${operation.padEnd(32)} ${route.transport.padEnd(8)} ${LABEL[verdict]}`);
    if (detail && verdict !== "reachable") console.log(`      ${detail}`);
  }

  console.log("\n[probe] 汇总：");
  for (const [verdict, count] of tally) console.log(`  ${LABEL[verdict]} × ${count}`);
  const blocked = (tally.get("failed") ?? 0) + (tally.get("network") ?? 0) +
    (tally.get("unregistered") ?? 0);
  if (blocked > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[probe] 未预期的失败：", error);
  process.exitCode = 1;
});
