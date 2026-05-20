/**
 * Boot-time wiring: runs `bootstrapAll()` from @agentic/runtime which reads
 * manifests from `models/<slug>/` and returns an array of Inngest functions,
 * then exposes them via the `inngest/fastify` adapter.
 *
 * Tenant code wiring lives HERE (not in @agentic/runtime) because pnpm's
 * isolated module resolution requires each package to declare its own deps.
 * To add a new tenant with custom tools/prompts:
 *   1. Create `tenants/<slug>/` (see tenants/raas/ as the template)
 *   2. Add `"@tenants/<slug>": "workspace:*"` to apps/api/package.json
 *   3. Import + register here
 *   4. Drop `models/<slug>/` for the manifest
 *
 * Pure-declarative tenants (manifest only, no custom code) skip steps 1-3
 * and just need a `models/<slug>/` folder — bootstrap auto-discovers them
 * and they run with the generic @agentic/tools fallbacks.
 */

import {
  bootstrapAll,
  helloFn,
  inngest,
  setRuntimeGateway,
  type TenantRegistries,
} from "@agentic/runtime";
import type { Inngest, InngestFunction } from "inngest";
import raasTenant from "@tenants/raas";
import {
  bootstrapCodeAgents,
  setGateway as setAgentGateway,
} from "@agentic/agents";
import "@agentic/agents/system";
import { getLLMGateway } from "./services/llm";
import { reconcileImports } from "./services/reconcile-imports";
import { getDb } from "@agentic/db";
import { reregisterInngest } from "./services/inngest-registry";

/**
 * v4 typing: TS2742 surfaces because `InngestFunction` references internal
 * `api/api` symbols. Pin the return type so consumers don't need to import
 * package internals.
 */
export interface BootstrapResult {
  inngest: Inngest.Any;
  functions: InngestFunction.Any[];
}

/**
 * Map of tenant slug → tenant code registry. Keys MUST match the slug
 * derived from each `models/<folder>/` directory (e.g. "RAAS-v1" → "raas").
 */
const TENANT_REGISTRIES: TenantRegistries = {
  raas: raasTenant,
};

export async function bootstrapRuntime(): Promise<BootstrapResult> {
  // 1. Construct LLM gateway once and wire it into both consumers
  //    (agents package for BaseAgent.run, runtime package for step-engine logic actions).
  const gateway = getLLMGateway();
  setAgentGateway(gateway);
  setRuntimeGateway(gateway);
  console.log(
    `[bootstrap] LLM gateway online — default provider=${gateway.defaultProvider}, default model=${gateway.defaultModel ?? "(adapter default)"}, ${gateway.listProviders().length} providers registered`,
  );

  // 2. Bootstrap code-defined agents (writes agents/agent_versions/deployments rows).
  const codeSummary = await bootstrapCodeAgents();
  console.log(
    `[bootstrap] code agents ready — ${codeSummary.agentCount} registered, ${codeSummary.deploymentsWritten} new deployment(s)`,
  );

  // 3. Manifest-driven (RAAS etc) Inngest functions.
  const tenantFns = await bootstrapAll(TENANT_REGISTRIES);
  const allFns = [helloFn, ...tenantFns];
  console.log(
    `[bootstrap] api serving ${allFns.length} Inngest function(s) (${tenantFns.length} from tenant manifests)`,
  );

  // 4. Crash recovery for the manifest-import wizard (per review C1).
  //    `reconcileImports` does three things:
  //      a. Drop expired `status='pending'` rows + their staging dirs.
  //      b. Complete crashed renames: rows where `file_path` still points at
  //         `data/imports/...` (phase 4 didn't finish) get renamed into
  //         `models/<slug>-vN/workflow_v<N+1>.json` and the row updated.
  //         If the rename causes a live agent set change, re-register that
  //         tenant's Inngest functions.
  //      c. Re-emit on-disk manifests that were manually deleted, using
  //         `workflow_versions.manifest_json` as the source of truth.
  //    Idempotent; safe to run every boot. Failures are logged but never
  //    block startup.
  try {
    const swept = await reconcileImports(getDb(), {
      reregister: async (tenantSlug) => {
        await reregisterInngest({ tenantSlug, scope: "tenant" });
      },
    });
    if (
      swept.expired_pruned > 0 ||
      swept.rename_completed > 0 ||
      swept.missing_file_repaired > 0 ||
      swept.failures > 0
    ) {
      console.log(
        `[bootstrap] import reconcile — pruned ${swept.expired_pruned}, repaired ${swept.rename_completed} crashed rename(s), re-emitted ${swept.missing_file_repaired} missing file(s), ${swept.failures} failure(s)`,
      );
    }
  } catch (err) {
    console.warn("[bootstrap] reconcileImports failed", err);
  }

  return { inngest, functions: allFns };
}
