/**
 * @tenants/raas — RAAS tenant code package.
 *
 * Bootstrap auto-discovers this package because the tenant slug "raas" matches
 * a `models/<slug>/` folder. Anything exported here becomes available to the
 * step engine when running RAAS agents:
 *
 *   - `tools`   — manifest action `{ "type": "tool", "name": "X" }` resolves
 *                 to `tools.X` before falling back to generic @agentic/tools
 *   - `prompts` — manifest action `{ "type": "logic", "name": "Y" }` resolves
 *                 to `prompts.Y` before falling back to the auto-built
 *                 `<name>: <description>` prompt
 *
 * To add a new tool/prompt: create a file under `src/tools/` or `src/prompts/`,
 * call `defineTool({...})` / `definePrompt({...})`, then register here.
 *
 * Pure-declarative agents (no custom code) need no entry here — the JSON
 * manifest alone is sufficient.
 */

import type { TenantRegistry } from "@agentic/agent-kit";
import { pingProbe } from "./tools/ping-probe";
import { raasPrompts } from "./prompts";

const tools: TenantRegistry["tools"] = {
  // The action.name in workflow_v1.json maps here. pingProbe targets the
  // first action of syncFromClientSystem ("monitorAndFetchRequirement") so
  // a SCHEDULED_SYNC trigger exercises the tenant resolver end-to-end.
  monitorAndFetchRequirement: pingProbe,
};

// Wave 4.5 — every `logic` action in models/RAAS-v1/workflow_v1.json must
// have a matching definePrompt or the tenant refuses to boot
// (`findMissingTenantPrompts` in packages/runtime/src/register.ts).
const prompts: TenantRegistry["prompts"] = raasPrompts;

const registry: TenantRegistry = { tools, prompts };
export default registry;
