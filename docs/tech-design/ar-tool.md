# Tech Design — Tools

**Module ID:** AR-TOOL
**Owner:** AI Software Architect
**Status:** V1.1 design
**Source catalog:** `docs/catalog/02-ai-runtime-catalog.md` § 5 (AR-TOOL-01..05)

## 1. Purpose

The tools module is **how an agent reaches outside the model**. It has three concentric rings: first-party tools shipped in `@agentic/tools` (mocked HTTP fetch + channel publish), the `defineTool` SDK that lets tenants declare typed tools in their `@tenants/<slug>` package, and the manifest step engine's six built-in action types that dispatch to those tools and to the LLM gateway. The SSRF guard sits orthogonally — every outbound HTTP call from a tool flows through it. The big V1.1 change is wiring the `agent.tool_use` field as the canonical binding from manifest action → tenant tool (closing AR-GAP-09 / UC-V11-23).

## 2. V1 state (citable)

- **First-party tools** (AR-TOOL-01) — three tools at `packages/tools/src/index.ts`:
  - `http.fetch` — `httpFetch(ctx, { url, method?, body? })`. V1 implementation is a mock at `packages/tools/src/index.ts:27-37` returning `{ status: 200, body: { mock: true, echoed: args } }`. V1.1 ticket exists to wire through the SSRF guard.
  - `channel.publish` — V1 mock returns `{ delivered: true, channel }`. Channels (email, Slack, WeWork) are platform integrations that should be wired through tenant tool overrides.
  - `llm.call` — **removed** from this dispatch (file comment lines 64-67). Logic-type actions route through the gateway in `packages/runtime/src/step-engine.ts:174-191`.
  - Generic dispatch `runTool(ctx, hintFromName?)` at `packages/tools/src/index.ts:69-83` inspects action name for hint words (`publish`/`notify`/`alert` → `channel.publish`; everything else → `http.fetch`).
- **`defineTool` SDK** (AR-TOOL-02) — `packages/agent-sdk/src/define-tool.ts:1-46`:
  ```ts
  defineTool({
    name: "loadEvaluatedCandidates",
    description?: string,
    output?: ZodSchema<TOutput>,
    handler(ctx: ToolContext): Promise<ToolResult<TOutput>>
  }): ToolDescriptor<TOutput>
  ```
  The companion `definePrompt({ name, system, user, output? })` in `packages/agent-sdk/src/define-prompt.ts` lets tenants override auto-built `logic` system/user messages. Tenant prompt is consulted before runtime defaults — `prompt.system` is the *first* system message (P0-RT-11) so the runtime prelude follows it.
- **Tenant tool registry** (AR-TOOL-03) — `@tenants/<slug>` workspace package exports a `TenantRegistry = { slug, tools, prompts, memory? }` from its `index.ts`. Wiring lives in `apps/api/src/bootstrap.ts` via `TENANT_REGISTRIES` (a plain object keyed by slug). Runtime accepts an opaque `TenantRegistry` and never imports `@tenants/<slug>` itself — pnpm's isolated module resolution requires each package to own its own deps.
- **Step engine action types** (AR-TOOL-04) — six types recognized by `runAction()` in `packages/runtime/src/step-engine.ts:158-208`:

| Type | Dispatcher | Step row written | Where |
|---|---|---|---|
| `logic` | LLM via `gateway.chat()`, optionally `definePrompt` first | type=logic, provider/model/tokens filled | `step-engine.ts:174-191` |
| `tool` | tenant `defineTool` wins, then generic `runTool` fallback | type=tool, outputRef = result JSON | `step-engine.ts:162-172` |
| `manual` | `step.waitForEvent("task.resolved")` | type=manual + tasks row | `register.ts:199-313` |
| `condition` | `evaluateCondition` from `packages/runtime/src/condition.ts` | logic-typed row with `meta.condition=true` | `register.ts:380-420` |
| `delay` | `step.sleep("ord-<n>", "<duration>s")` | tool-typed row with `meta.kind=delay` | `register.ts` action loop (P3) |
| `subflow` | `step.invoke` on the target agent's first trigger | tool-typed rows + child run (parent_run_id) | `register.ts` (P1-RT-04) |

- **SSRF guard** (AR-TOOL-05) — `apps/api/src/services/ssrf-guard.ts:34-220` enforces six invariants: HTTPS-only (except `http://localhost` with `AGENTIC_FETCH_ALLOW_HTTP_LOCALHOST=1`), DNS-after-resolve check against loopback/RFC1918/link-local/ULA/zero, redirect re-check (3 hops max), body byte-streaming cap (`AGENTIC_FETCH_URL_MAX_BYTES` default 5 MB), content-type allow-list, separate connect+body timeouts (5s each). Errors surface as `SsrfError` with discriminated codes.

## 3. V1.1 changes

### UC-V11-23 / AR-GAP-09 — `agent.tool_use` field dispatch (canonical fix)
**Site:** `packages/runtime/src/step-engine.ts:158-208` (the `runAction` switch — `case "tool"` branch). Also `packages/runtime/src/manifest.ts:43` (`ActionSpec` schema) — `tool_use?: string` is **per-action**, not per-agent.
**Bug:** Manifest schema accepts `tool_use` (field exists since Phase 0), and it round-trips through `agent_versions.manifest_json`, but `step-engine.ts:166` does `runTool(genericCtx(ctx), action.name)` — the name-hint dispatcher — without ever consulting `action.tool_use`. Result: RAAS-v1's `tool_use: ""` strings are no-ops and ad-hoc tool naming requires renaming the action to match the tenant's `defineTool` key.
**Fix:** Update `step-engine.ts:162-172` `case "tool"` dispatch order:
```ts
case "tool": {
  // 1. Explicit tool_use binding wins (V1.1)
  if (typeof action.tool_use === "string" && action.tool_use.length > 0) {
    const tenantTool = tenantRegistry?.tools?.[action.tool_use];
    if (tenantTool) return runTenantTool(ctx, tenantTool);
    // tool_use was declared but no matching descriptor — return a soft error
    // (so the run fails with a clear message rather than silently routing to
    // the wrong tool via name-hint)
    return {
      ok: false,
      type: "tool",
      data: null,
      meta: {
        tool_use: action.tool_use,
        error: `tool_use="${action.tool_use}" declared but no matching defineTool in tenant registry`,
      },
    };
  }
  // 2. Backward-compatible: action.name as registry key
  const tenantTool = tenantRegistry?.tools?.[action.name];
  if (tenantTool) return runTenantTool(ctx, tenantTool);
  // 3. Generic name-hint fallback
  const result = await runTool(genericCtx(ctx), action.name);
  return { ok: result.ok, type: "tool", data: result.data, meta: result.meta };
}
```
**New types:** `tool_use?: string` added to `ActionSpec` in `packages/runtime/src/manifest.ts` and to `ToolActionSchema` in `packages/contracts/src/workflow.ts`. The manifest is currently `.passthrough()` so it already round-trips the field; this change makes it visible in the typed surface.
**Migration:** None. Existing manifests with `tool_use: ""` continue to fall through to name-hint dispatch (empty string is treated as "not set"). Manifests that introduce non-empty `tool_use` get the new dispatch.
**Tests:** `tc-tool-use-dispatch.test.ts` (new):
1. Manifest with `tool_use:"customLoader"` + tenant registry with `customLoader` defineTool → assert `customLoader` handler invoked, step.outputRef carries its result, action.name was *not* used as a lookup key.
2. Manifest with `tool_use:"missingTool"` + no matching descriptor → assert step row is `status="failed"` with `meta.error` containing `tool_use="missingTool"`.
3. Manifest with `tool_use:""` (empty) → assert legacy name-hint dispatch is used.
4. Manifest with no `tool_use` field → same as (3) — backward compat.

### V1.1-coupled: SSRF wire-through for `http.fetch`
**Site:** `packages/tools/src/index.ts:27-37` (the mock) and `apps/api/src/services/ssrf-guard.ts:safeFetch`.
**Issue:** V1's `http.fetch` is a mock so RAAS's `monitorAndFetchRequirement` (`AR-RAAS-01`) and `executeAutomatedPublication` (`AR-RAAS-07`) have something to dispatch to. V1.1 wires the real `safeFetch()` path so tenant `defineTool` handlers can opt in to safe outbound HTTP without rolling their own.
**Fix:** Replace the mock body of `httpFetch` with a thin wrapper around `safeFetch()`:
```ts
import { safeFetch, SsrfError } from "@agentic-api/services/ssrf-guard";
// (or move the guard into a shared package to avoid the api dependency)

async function httpFetch(ctx, { url, method = "GET", body }) {
  try {
    const r = await safeFetch(url, { method, body, maxBytes: 5*1024*1024, timeoutMs: 5000 });
    return { ok: true, data: { status: r.status, body: r.body, headers: r.headers } };
  } catch (err) {
    if (err instanceof SsrfError) {
      return { ok: false, data: null, meta: { ssrfError: { code: err.code, hint: err.message } } };
    }
    throw err;
  }
}
```
**Important:** The SSRF guard currently lives at `apps/api/src/services/ssrf-guard.ts` — V1.1 should move it to a shared `@agentic/ssrf` package (or `packages/runtime/src/ssrf-guard.ts`) because `@agentic/tools` cannot depend on `apps/api`. This is a refactor; the contract is unchanged.
**Tests:** `tc-http-fetch-ssrf.test.ts` — call `httpFetch` with `http://169.254.169.254/latest/meta-data/` → assert returns `ok:false` with `ssrfError.code === "blocked_target"`. Call with `https://api.example.com/data` (mocked to return 200) → assert returns the response body.

### V1.1-coupled: ban auto-fallback for "looks like a tool" actions without explicit binding
**Site:** `packages/runtime/src/step-engine.ts:166` (the name-hint `runTool(ctx, action.name)` call).
**Issue:** `AR-TOOL-01`'s name-hint heuristic (`publish`/`notify`/`alert` → `channel.publish`; else → `http.fetch`) is fragile. After UC-V11-23 lands, the recommended path is `tool_use` (explicit) or matching the action name to a tenant `defineTool`. The name-hint should only fire when both fail and only for *known* hint words.
**Fix:** Add `STRICT_TOOL_BINDING` env flag (default off in V1.1; on by default in V2). When on, the name-hint fallback is replaced by a hard error: `"action '${action.name}' has no tool_use binding and no matching tenant defineTool; either set tool_use or register a defineTool with this name"`. This gives operators a hard signal early.

## 4. Interfaces (the contract)

**Tool descriptor (`packages/agent-sdk/src/types.ts`):**
```ts
export interface ToolContext {
  agentName: string;
  actionName: string;
  subject?: string;
  correlationId: string;
  tenantSlug: string;
  event: { name: string; data: Record<string, unknown> };
  lastResult: unknown;
  memory: MemoryHandle;  // bound to (tenantId, agentName, subject, runId)
}
export interface ToolResult<T = unknown> {
  data: T;
  tokensIn?: number;
  tokensOut?: number;
  meta?: Record<string, unknown>;
}
export interface ToolDescriptor<T = unknown> {
  kind: "tool";
  name: string;
  description?: string;
  output?: ZodSchema<T>;
  handler(ctx: ToolContext): Promise<ToolResult<T>>;
}
```

**Tenant registry (`packages/agent-kit/src/types.ts`):**
```ts
export interface TenantRegistry {
  slug: string;
  tools?: Record<string, ToolDescriptor>;
  prompts?: Record<string, PromptDescriptor>;
  memory?: MemoryHandle;
}
```

**Action schema (V1.1, `packages/runtime/src/manifest.ts`):**
```ts
const ToolActionSchema = z.object({
  type: z.literal("tool"),
  name: z.string(),
  description: z.string().optional(),
  tool_use: z.string().optional(),   // NEW in V1.1 typed surface
  // ... other optional fields
}).passthrough();
```

**SSRF guard (`apps/api/src/services/ssrf-guard.ts:34-220` — moving to `@agentic/ssrf` in V1.1):**
```ts
export interface SafeFetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "HEAD";
  body?: BodyInit;
  headers?: Record<string, string>;
  maxBytes?: number;        // default 5 MB
  timeoutMs?: number;        // default 5000
  allowContentTypes?: string[];
}
export class SsrfError extends Error {
  override readonly name = "SsrfError";
  constructor(readonly code:
    "https_only" | "scheme_not_allowed" | "blocked_target" |
    "dns_resolution_failed" | "redirect_limit_exceeded" |
    "body_too_large" | "timeout" | "bad_url",
    message: string,
  ) { super(message); }
}
export async function safeFetch(url: string, opts?: SafeFetchOptions): Promise<{...}>;
```

## 5. Data flow

Tool dispatch for a manifest `type:"tool"` action:

```
runAction({ ctx, action, tenantRegistry })  // step-engine.ts:158
   |
   v
case "tool":
   |
   +-- action.tool_use is set?  (V1.1)
   |     yes -> tenantRegistry.tools[action.tool_use]
   |              found -> runTenantTool(ctx, descriptor)
   |              missing -> return ok:false with helpful error
   |
   +-- action.tool_use empty/unset
         tenantRegistry.tools[action.name]
              found -> runTenantTool(ctx, descriptor)
              missing -> runTool(ctx, action.name)  // name-hint fallback
                            |
                            v
                       hint = "publish"|"notify"|"alert"? -> channel.publish
                       else -> http.fetch (mock today; safeFetch in V1.1)
   |
   v
runTenantTool:
   const result = await descriptor.handler(ctx)
   if (descriptor.output) validate result.data via Zod
   return { ok, type:"tool", data: validated, tokensIn, tokensOut, meta }


SSRF guard flow for safeFetch (V1.1 wire-through):

caller url + opts
   |
   v
URL parse / scheme check (https-only)
   |
   v
DNS lookup (family:0)  -> reject if loopback/RFC1918/link-local/ULA/zero
   |
   v
fetch(url, { redirect:'manual' })
   |
   +-- Location header? re-validate at each hop (3 max)
   |
   v
stream body, byte-cap at maxBytes
   |
   v
content-type re-check after first chunk
   |
   v
return { status, body, headers }   OR throw SsrfError(code, message)
```

## 6. Failure modes

| Failure | What happens | Recovery |
|---|---|---|
| Tenant `defineTool` handler throws | step row `status='failed'` with `meta.error` carrying the message | Caller fixes the tool; run can be replayed via `/v1/events/:id/replay` |
| Zod validation on `descriptor.output` fails | step row `status='failed'` with `meta.schemaError` carrying Zod issues | Caller fixes the tool's return shape |
| `tool_use` declared but missing descriptor (V1.1) | step row `status='failed'` with `meta.error` referencing the missing name | Operator registers the missing tool or removes the `tool_use` declaration |
| Name-hint fallback fires for an unrecognized hint | Falls through to `http.fetch` mock — returns `{mock: true}` | V1.1 `STRICT_TOOL_BINDING` flag (off by default) turns this into a hard error |
| SSRF guard rejects URL | `safeFetch` throws `SsrfError(code, message)`; the tool wrapper converts to `ok:false` | Caller adjusts URL or, if a real internal endpoint is needed, the operator may add it to an allow-list (V1.1 ticket — currently no per-tenant override) |
| SSRF guard hits 3-hop redirect limit | `SsrfError(code:"redirect_limit_exceeded")` | Same as above |
| Tool returns `ok:false` | `step-engine.ts:166` records `ok:false`; register.ts:384 calls `failRun` and re-throws | Run replays via `/v1/events/:id/replay` after fix |
| Tool runs longer than 5s SSRF timeout | `SsrfError(code:"timeout")` returned | Bump `AGENTIC_FETCH_URL_BODY_TIMEOUT_MS` (per-process) or use a tenant-tool that doesn't hit SSRF guard |

## 7. V2 roadmap

- **UC-V2-12 / AR-GAP-10** — Execute `typescript_code` snippets via a sandbox (vm2 / isolated-vm / wasm). V1 stores the field but never executes it.
- **Toolside multi-turn for manifest agents (AR-GAP-11).** Today only code agents have the tool-use loop; manifest path is single-shot per `logic` action. V2 unifies both run engines.
- **Per-tenant SSRF allow-list.** Today the guard is process-wide. V2 stores per-tenant overrides in `tenants.config_json.ssrf_allowlist[]` so a tenant that needs a specific internal endpoint can opt in.
- **Real `channel.publish` adapters.** WeChat Work + AWS SES + Slack inbound — V1 ships the mock; UC-V11-01 wires the notifications adapter (covered in a sibling tech-design doc).

## 8. Acceptance tests

- `tc-tool-use-dispatch.test.ts` — UC-V11-23 four-way dispatch table (explicit tool_use found, declared but missing, empty/legacy, no field).
- `tc-http-fetch-ssrf.test.ts` — V1.1 `safeFetch` wire-through.
- `tc-2-http-fetch-happy.test.ts` (existing — covers the mock today; V1.1 update to assert real path).
- `tc-2b-channel-publish-happy.test.ts` (existing).
- `tc-23-define-tool-schema.test.ts` (existing) — `defineTool` Zod validation on output.
- `tc-22-tenant-registry.test.ts` (existing) — RAAS registry round-trip.
- `tc-ssrf-guard.test.ts` (existing, 24 cases) — guard rejection classes.
- `tc-strict-tool-binding.test.ts` (new) — `STRICT_TOOL_BINDING=1` env turns name-hint fallback into a hard error.
- `tc-tenant-registry.test.ts` (existing) — tenant tool resolution order.
- `tc-10-prompt-override.test.ts` (existing) — auto-built logic prompt vs tenant `definePrompt`.

Coverage gates: every UC-V11-* listed has a paired failing-then-passing test per the TDD mandate in `docs/USE_CASES.md` § 6.
