/** Reconcile through the running API; never open a second database writer. */
export {};
let apiUrl = process.env.AGENTIC_API_BASE_URL ?? "http://127.0.0.1:3540";
for (let index = 2; index < process.argv.length; index++) {
  const arg = process.argv[index];
  if (arg === "--api-url") {
    const value = process.argv[++index];
    if (!value || value.startsWith("--"))
      throw new Error("--api-url requires a value");
    apiUrl = value;
  } else if (arg === "--help") {
    process.stdout.write(
      "Usage: pnpm skills:reconcile [--api-url URL]\nRebuild shared and tenant Skill directories through the API. Requires a platform superadmin; use AGENTIC_API_TOKEN for authenticated APIs.\n",
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
  base.hash ||
  base.pathname !== "/"
)
  throw new Error(
    "API URL must be an HTTP(S) origin without credentials, path, query, or fragment",
  );
if (
  base.protocol === "http:" &&
  !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)
)
  throw new Error("Remote API connections must use HTTPS");
const token = process.env.AGENTIC_API_TOKEN;
const response = await fetch(new URL("/v1/skills/storage/reconcile", base), {
  method: "POST",
  headers: {
    "x-agentic-tenant": "__system",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  },
  redirect: "error",
  signal: AbortSignal.timeout(120_000),
});
const envelope = (await response.json()) as {
  ok?: boolean;
  data?: { skills: number; changed: number };
  error?: { code?: string; message?: string };
};
if (!response.ok || !envelope.ok || !envelope.data)
  throw new Error(
    `Skill directory reconciliation failed: ${envelope.error?.code ?? response.status} ${envelope.error?.message ?? "API request failed"}`,
  );
process.stdout.write(`${JSON.stringify(envelope.data, null, 2)}\n`);
