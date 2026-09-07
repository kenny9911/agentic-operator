/**
 * 从 skill 携带的 swagger 里抽出每个已路由操作的请求字段，生成
 * config/metaerp-operation-params.json。
 *
 * 为什么需要：模型知道操作叫什么，却不知道它收什么。第一次对 v15 真跑时，
 * 13 次调用错了 12 次——全是在猜字段名和必填组合。接口的形状是确定的知识，
 * 不该每次运行现推；编译器会把这份清单写进工具描述，模型拿到的就是契约。
 *
 * 用法（swagger 更新后重跑）：
 *   node scripts/extract-metaerp-operation-params.mjs [--skill <路径>]
 *
 * swagger 不在版本库里（在 metaerp-openapi-call/ 这个未跟踪目录），所以产物
 * 提交、脚本可复现——没有 skill 目录的检出仍然能用生成好的清单。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const skillFlag = args.indexOf("--skill");
const SKILL = path.resolve(
  ROOT,
  skillFlag >= 0 ? args[skillFlag + 1] : "../../../metaerp-openapi-call",
);
const REFERENCE = path.join(SKILL, "reference");
const OUT = path.join(ROOT, "config", "metaerp-operation-params.json");

/** swagger 是机器生成的，缩进规整，够用的最小解析。 */
function parseSwagger(text) {
  const lines = text.split("\n");
  const pathRef = new Map();
  let inPaths = false;
  let current = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^paths:/.test(line)) { inPaths = true; continue; }
    if (inPaths && /^\S/.test(line)) inPaths = false;
    if (!inPaths) continue;
    const p = /^ {2}(\/\S+):\s*$/.exec(line);
    if (p) { current = p[1]; continue; }
    if (!current || !line.includes("requestBody")) continue;
    for (let j = i; j < Math.min(i + 12, lines.length); j += 1) {
      const ref = /\$ref:\s*'#\/components\/schemas\/([A-Za-z0-9_]+)'/.exec(lines[j]);
      if (!ref) continue;
      let isArray = false;
      for (let k = i; k < j; k += 1) if (lines[k].includes("type: array")) isArray = true;
      pathRef.set(current, { schema: ref[1], isArray });
      break;
    }
  }
  const schemas = new Map();
  let inComponents = false;
  let name = null;
  let inProps = false;
  for (const line of lines) {
    if (/^components:/.test(line)) { inComponents = true; continue; }
    if (inComponents && /^\S/.test(line)) inComponents = false;
    if (!inComponents) continue;
    const s = /^ {4}([A-Za-z0-9_]+):\s*$/.exec(line);
    if (s) { name = s[1]; if (!schemas.has(name)) schemas.set(name, []); inProps = false; continue; }
    if (!name) continue;
    if (/^ {6}properties:\s*$/.test(line)) { inProps = true; continue; }
    if (/^ {6}\S/.test(line) && !line.trim().startsWith("properties")) inProps = false;
    if (!inProps) continue;
    const prop = /^ {8}([A-Za-z0-9_]+):\s*$/.exec(line);
    if (prop) schemas.get(name).push(prop[1]);
  }
  return { pathRef, schemas };
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".yaml") ? [full] : [];
  });
}

const allPaths = new Map();
const allSchemas = new Map();
for (const file of walk(REFERENCE)) {
  const { pathRef, schemas } = parseSwagger(fs.readFileSync(file, "utf8"));
  for (const [k, v] of pathRef) if (!allPaths.has(k)) allPaths.set(k, v);
  for (const [k, v] of schemas) if (v.length && !allSchemas.has(k)) allSchemas.set(k, v);
}
if (allPaths.size === 0) {
  console.error(`[erp-params] ${REFERENCE} 下没找到 swagger —— 用 --skill 指定 skill 目录`);
  process.exit(1);
}

/** 路径尾段；poHeader/{pageSize}/{curPage} 这种要跳过占位段。 */
function tailOf(p) {
  const parts = p.replace(/\/+$/, "").split("/").filter(Boolean);
  while (parts.length && (/^\{.*\}$/.test(parts.at(-1)) || /^\d+$/.test(parts.at(-1)))) parts.pop();
  return parts.at(-1) ?? "";
}

const routes = JSON.parse(
  fs.readFileSync(path.join(ROOT, "config", "metaerp-routes.json"), "utf8"),
).routes;

const out = {};
const missing = [];
for (const [operation, route] of Object.entries(routes)) {
  if (route.transport === "mock") continue;
  const tail = tailOf(route.path);
  let match = null;
  for (const [p, meta] of allPaths) if (tailOf(p) === tail) { match = meta; break; }
  const fields = match ? allSchemas.get(match.schema) : null;
  if (!fields?.length) { missing.push(operation); continue; }
  out[operation] = {
    schema: match.schema,
    ...(match.isArray ? { bodyIsArray: true } : {}),
    fields,
  };
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      _readme:
        "由 scripts/extract-metaerp-operation-params.mjs 从 metaerp-openapi-call/reference 下的 swagger 生成。" +
        "编译器把 fields 写进 metaerp.invoke 的工具描述，模型据此拼入参，不用猜。" +
        "bodyIsArray=true 表示该接口的请求体是数组而不是对象。",
      operations: out,
    },
    null,
    2,
  )}\n`,
);
console.log(
  `[erp-params] ${Object.keys(out).length} 个操作写入 ${path.relative(ROOT, OUT)}` +
    (missing.length ? `；swagger 缺: ${missing.join(", ")}` : ""),
);
