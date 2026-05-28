/**
 * @tenants/tenant-test1 — code package for the smoke-test workflow.
 *
 * The matching manifest lives at `models/tenant-test1-v1/workflow_v1.json` and
 * defines two agents:
 *   - agent-test1 subscribes to START_AGENT_TEST1, runs a single `logic` step
 *     named `callAgentTest1` (LLM call with prompt body from
 *     `prompts/prompt-test1.md`), and emits AGENT_TEST1_DONE with the LLM
 *     response as its payload.
 *   - agent-test2 subscribes to AGENT_TEST1_DONE, runs a single `tool` step
 *     named `writeWorkflowLog` that appends the payload to
 *     `data/logs/tenant-test1/workflow-test1.log`.
 *
 * Wave 4 made `definePrompt` required at boot per `docs/tech-design/ar-tool.md`
 * Option B — every `logic` action listed in the manifest must have a matching
 * entry in `prompts` here or the tenant refuses to register Inngest functions
 * (`findMissingTenantPrompts` in packages/runtime/src/register.ts).
 */

import type { TenantRegistry } from "@agentic/agent-kit";

import { tenantTest1Prompts } from "./prompts";
import { writeWorkflowLog } from "./tools/write-workflow-log";

const tools: TenantRegistry["tools"] = {
  writeWorkflowLog,
};

const prompts: TenantRegistry["prompts"] = tenantTest1Prompts;

const registry: TenantRegistry = { tools, prompts };
export default registry;
