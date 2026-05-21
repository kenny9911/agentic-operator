/**
 * @tenants/__system — generic stub registry for the platform's built-in
 * test-fixture tenants.
 *
 * The `__system-v1` manifest plus the auto-generated `mi*-v1` /
 * `mi*-v2` fixtures (created by the manifest-import wizard's e2e tests) all
 * share two logic action names: `checkShape` and `applyRules`. Wave 4 made
 * `definePrompt` required at boot per `docs/tech-design/ar-tool.md` Option B;
 * without these stubs, every test-fixture tenant fails to register and the
 * Wave 5 test sweep can't run.
 *
 * The prompts are deliberately tiny — these tenants exist to exercise the
 * runtime, not to call real LLMs (tests pin `LLM_DEFAULT_PROVIDER=mock`).
 *
 * The same registry is reused for every `mi*` test-fixture tenant in
 * `apps/api/src/bootstrap.ts → TENANT_REGISTRIES` so we don't have to ship a
 * separate package per fixture slug.
 */

import { definePrompt } from "@agentic/agent-kit";
import type { PromptDescriptor, TenantRegistry } from "@agentic/agent-kit";

const checkShape: PromptDescriptor = definePrompt({
  name: "checkShape",
  description: "Confirm a payload has all required fields.",
  system:
    "You are a payload-shape validator. Inspect the inbound payload and confirm every required field is present and non-empty.",
  template: (ctx) => {
    const payload = JSON.stringify(ctx.event?.data ?? ctx.lastResult ?? {}, null, 2);
    return `Validate this payload.\n\nPayload:\n${payload}\n\nReturn JSON: { "ok": boolean, "missing_fields": string[] }.`;
  },
});

const applyRules: PromptDescriptor = definePrompt({
  name: "applyRules",
  description: "Score the inputs and select an outcome.",
  system:
    "You are a decision engine. Score the inputs and pick a single outcome.",
  template: (ctx) => {
    const ctxJson = JSON.stringify(ctx.lastResult ?? ctx.event?.data ?? {}, null, 2);
    return `Score the inputs and pick an outcome.\n\nContext:\n${ctxJson}\n\nReturn JSON: { "decision": string, "score": number, "rationale": string }.`;
  },
});

const prompts: TenantRegistry["prompts"] = {
  checkShape,
  applyRules,
};

/**
 * Default export consumed by the api's `TENANT_REGISTRIES` map. Pure-stub —
 * no tools.
 */
const registry: TenantRegistry = { prompts };
export default registry;
