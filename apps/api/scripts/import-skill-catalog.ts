/** Local catalog CLI uses the running API so SQLite retains a single writer.
 * Run with the pinned Node runtime; no source scripts or model calls execute. */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { SkillDetailSchema, SkillListResponseSchema } from "@agentic/contracts";
import {
  importSkillCatalog,
  readSkillCatalog,
  type SkillCatalogStore,
} from "../src/services/skill-catalog-import";
import type { SkillLibraryContext } from "../src/services/skill-library-store";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
let catalogFile = resolve(repositoryRoot, "skills-library/catalog.json");
let apiUrl = process.env.AGENTIC_API_BASE_URL ?? "http://127.0.0.1:3540";
let apply = false;
for (let index = 2; index < process.argv.length; index++) {
  const arg = process.argv[index];
  if (arg === "--apply") apply = true;
  else if (arg === "--catalog" || arg === "--api-url") {
    const value = process.argv[++index];
    if (!value || value.startsWith("--"))
      throw new Error(`${arg} requires a value`);
    if (arg === "--catalog") catalogFile = resolve(value);
    else apiUrl = value;
  } else if (arg === "--help") {
    process.stdout.write(
      "Usage: pnpm --filter @agentic/api exec tsx scripts/import-skill-catalog.ts [--catalog PATH] [--api-url URL] [--apply]\nDry-run is the default. Shared imports need a platform superadmin session; set AGENTIC_API_TOKEN for authenticated APIs.\n",
    );
    process.exit(0);
  } else throw new Error(`Unknown argument: ${arg}`);
}
const base = new URL(apiUrl);
if (
  !["http:", "https:"].includes(base.protocol) ||
  base.username ||
  base.password ||
  base.search ||
  base.hash
)
  throw new Error(
    "API URL must be an HTTP(S) origin without credentials, query, or fragment",
  );
if (
  base.protocol === "http:" &&
  !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)
)
  throw new Error("Remote API connections must use HTTPS");
if (base.pathname !== "/")
  throw new Error("API URL must be an origin without a path");
const token = process.env.AGENTIC_API_TOKEN;
async function request(path: string, method = "GET", body?: unknown) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(new URL(path, base), {
      method,
      headers: {
        "x-agentic-tenant": "__system",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    });
    const envelope = (await response.json()) as {
      ok?: boolean;
      data?: unknown;
      error?: { code?: string; message?: string };
    };
    // A rate-limit rejection happens before the mutation. Retry only that explicit
    // response, never an ambiguous network failure or a conflicting draft write.
    if (
      response.status === 429 &&
      envelope.error?.code === "rate_limited" &&
      attempt < 2
    ) {
      const seconds = Number(response.headers.get("retry-after"));
      if (Number.isFinite(seconds) && seconds > 0 && seconds <= 60) {
        process.stderr.write(
          `API rate limit: waiting ${seconds}s before retrying ${method} ${path}.\n`,
        );
        await delay(seconds * 1000);
        continue;
      }
    }
    if (!response.ok || envelope.ok !== true)
      throw new Error(
        `${method} ${path}: ${envelope.error?.code ?? response.status} ${envelope.error?.message ?? "API request failed"}`,
      );
    return envelope.data;
  }
}
const store: SkillCatalogStore = {
  list: async (_ctx, query) =>
    SkillListResponseSchema.parse(
      await request(
        `/v1/skills?${new URLSearchParams(Object.fromEntries(Object.entries(query).map(([key, value]) => [key, String(value)])))}`,
      ),
    ),
  detail: async (_ctx, id) =>
    SkillDetailSchema.parse(
      await request(`/v1/skills/${encodeURIComponent(id)}`),
    ),
  create: async (_ctx, input) =>
    SkillDetailSchema.parse(
      await request("/v1/skills/import", "POST", {
        format: "bundle",
        ...input,
      }),
    ),
  save: async (_ctx, id, expectedRevision, bundle) =>
    SkillDetailSchema.parse(
      await request(`/v1/skills/${encodeURIComponent(id)}/draft`, "PUT", {
        expectedRevision,
        bundle,
      }),
    ),
  publish: async (_ctx, id, expectedRevision) =>
    SkillDetailSchema.parse(
      await request(`/v1/skills/${encodeURIComponent(id)}/publish`, "POST", {
        expectedRevision,
      }),
    ),
};
// This describes the requested administrative scope, not authenticated identity.
// Each HTTP call independently authenticates + authorizes through the API.
const ctx: SkillLibraryContext = {
  tenantId: "__system",
  tenantSlug: "__system",
  platformRole: "superadmin",
  role: "admin",
  userId: null,
  email: null,
  name: null,
  via: "token",
};
try {
  const { root, catalog } = readSkillCatalog(catalogFile);
  const report = await importSkillCatalog({ root, catalog, store, ctx, apply });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.blocked > 0) process.exitCode = 1;
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Catalog import failed"}\n`,
  );
  process.exitCode = 1;
}
