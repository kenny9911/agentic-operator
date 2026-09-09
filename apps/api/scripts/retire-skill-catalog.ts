/** Use the authenticated running API; never open a second live SQLite writer. */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { SkillDetailSchema, SkillListResponseSchema } from "@agentic/contracts";
import { retireSkillCatalog, SkillCurationSchema, type SkillRetirementStore } from "../src/services/skill-catalog-retirement";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
let file = resolve(repository, "skills-library/curation.json");
let apiUrl = process.env.AGENTIC_API_BASE_URL ?? "http://127.0.0.1:3540";
let apply = false;
for (let index = 2; index < process.argv.length; index++) {
  const arg = process.argv[index];
  if (arg === "--apply") apply = true;
  else if (arg === "--curation" || arg === "--api-url") {
    const value = process.argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${arg} needs a value`);
    if (arg === "--curation") file = resolve(value); else apiUrl = value;
  } else if (arg === "--help") {
    console.log("Retire reviewed development imports: [--curation PATH] [--api-url ORIGIN] [--apply]. Dry run by default. Requires shared-library superadmin authorization; optional AGENTIC_API_TOKEN.");
    process.exit(0);
  } else throw new Error(`Unknown argument: ${arg}`);
}
const base = new URL(apiUrl);
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/' ||
    (base.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))) throw new Error("Use an HTTP(S) origin without credentials; remote connections require HTTPS");
const token = process.env.AGENTIC_API_TOKEN;
async function request(path: string, method = "GET", body?: unknown): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(new URL(path, base), {
      method, redirect: "error", signal: AbortSignal.timeout(120000),
      headers: { "x-agentic-tenant": "__system", ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const envelope = await response.json() as { ok?: boolean; data?: unknown; error?: { code?: string; message?: string } };
    const seconds = Number(response.headers.get("retry-after"));
    if (response.status === 429 && envelope.error?.code === "rate_limited" && attempt < 2 && seconds > 0 && seconds <= 60) {
      console.error(`Rate limited; retrying the rejected request after ${seconds}s.`);
      await delay(seconds * 1000); continue;
    }
    if (!response.ok || !envelope.ok) throw new Error(`${method} ${path}: ${envelope.error?.code ?? response.status} ${envelope.error?.message ?? "Request failed"}`);
    return envelope.data;
  }
}
function detail(value: unknown) {
  // Refuse an older server that cannot revoke historical runtime access.
  if (typeof (value as { skill?: { enabled?: unknown } })?.skill?.enabled !== "boolean")
    throw new Error("Server does not expose Skill availability; apply the enabled-state migration and restart it first");
  return SkillDetailSchema.parse(value);
}
const store: SkillRetirementStore = {
  list: async (query) => SkillListResponseSchema.parse(await request(`/v1/skills?${new URLSearchParams(Object.entries(query).map(([key,value]) => [key,String(value)]))}`)),
  detail: async (id) => detail(await request(`/v1/skills/${encodeURIComponent(id)}`)),
  setEnabled: async (id, input) => detail(await request(`/v1/skills/${encodeURIComponent(id)}/enabled`, "PATCH", input)),
  archive: async (id, input) => detail(await request(`/v1/skills/${encodeURIComponent(id)}/archive`, "POST", input)),
};
try {
  const curation = SkillCurationSchema.parse(JSON.parse(await readFile(file, "utf8")));
  const result = await retireSkillCatalog({ entries: curation.removed, store, apply });
  console.log(JSON.stringify(result, null, 2));
  if (result.blocked) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Skill retirement failed");
  process.exitCode = 1;
}
