/**
 * Demo-mode toggle — `/v1/demo/{status,start,stop}`.
 *
 * Background: the legacy contract was env-var driven (`AGENTIC_DEMO_MODE`)
 * and required an api restart to flip. This route exposes a runtime
 * toggle so the operator can start/stop the synthetic-traffic loop from
 * the UI without touching `.env.local`.
 *
 * Safety model (user requirement, 2026-05-26): demo must NEVER run unless
 * explicitly started — recommended `.env.local` setting is
 * `AGENTIC_DEMO_MODE=false`, leaving this endpoint as the only way demo
 * traffic ever spins up. The boot-time env path is preserved for
 * backwards-compat (true => auto-start at boot, exactly as before).
 *
 * Token-burn protection. `POST /v1/demo/start` swaps
 * `LLM_DEFAULT_PROVIDER` to `mock` (unless the operator opted into a real
 * provider via `AGENTIC_DEMO_LLM_PROVIDER`) and rebuilds the LLM gateway
 * singleton, so the demo runner's events hit deterministic canned
 * responses instead of OpenRouter. `POST /v1/demo/stop` restores the
 * original env values + rebuilds the gateway — flipping a real provider
 * back into place for normal interactive use.
 *
 * Lifetime. The runtime override is process-local. If the api restarts,
 * the env flag wins again (so `false` => demo OFF on next boot regardless
 * of what was toggled last).
 */

import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth";
import { writeAudit } from "../../plugins/audit";
import {
  activateRuntimeDemoMode,
  deactivateRuntimeDemoMode,
  isDemoMode,
  isRuntimeDemoActive,
  type DemoOverrideRecord,
} from "../../config/demo-mode.js";
import {
  getDemoRunnerStats,
  isDemoRunnerActive,
  startDemoRunner,
  stopDemoRunner,
} from "../../services/demo-runner.js";
import {
  getLLMGateway,
  resetLLMGateway,
} from "../../services/llm";
import { setGateway as setAgentGateway } from "@agentic/agents";
import { setRuntimeGateway } from "@agentic/runtime";

interface DemoStatusBody {
  running: boolean;
  demoMode: boolean;
  runtimeOverride: boolean;
  llmProvider: string;
  llmModel: string | undefined;
  stats: ReturnType<typeof getDemoRunnerStats>;
}

function snapshot(): DemoStatusBody {
  const g = (() => {
    try {
      return getLLMGateway();
    } catch {
      return null;
    }
  })();
  return {
    running: isDemoRunnerActive(),
    demoMode: isDemoMode(),
    runtimeOverride: isRuntimeDemoActive(),
    llmProvider: g?.defaultProvider ?? process.env.LLM_DEFAULT_PROVIDER ?? "unknown",
    llmModel: g?.defaultModel ?? process.env.LLM_DEFAULT_MODEL ?? undefined,
    stats: getDemoRunnerStats(),
  };
}

/**
 * Rebuild the LLM gateway + re-wire the consumers. Called after any
 * runtime env mutation (start/stop) so the next LLM call uses the new
 * provider. Matches the boot-time wiring in `bootstrap.ts:117-121`.
 */
function rebuildGateway(): void {
  resetLLMGateway();
  const g = getLLMGateway();
  setAgentGateway(g);
  setRuntimeGateway(g);
}

export async function demoRoutes(app: FastifyInstance) {
  // GET /v1/demo/status — current state, no side effects.
  app.get("/demo/status", async (_req, reply) => {
    return reply.ok(snapshot());
  });

  // POST /v1/demo/start — turn demo ON for this process. Idempotent.
  app.post("/demo/start", async (req, reply) => {
    const auth = requireAuth(req);

    if (process.env.NODE_ENV === "test") {
      return reply.fail(
        "test_blocked",
        "demo cannot be toggled under NODE_ENV=test",
        409,
      );
    }
    if (isDemoRunnerActive()) {
      return reply.ok({ ...snapshot(), note: "already running" });
    }

    // 1. Activate the runtime flag + apply env overrides (mock LLM).
    const applied: DemoOverrideRecord[] = activateRuntimeDemoMode();
    // 2. Rebuild the gateway so the new provider is live.
    rebuildGateway();
    // 3. Spin up the periodic event/task-resolve loop.
    startDemoRunner({
      info: (msg) => app.log.info(msg),
      warn: (msg) => app.log.warn(msg),
      error: (msg) => app.log.error(msg),
    });

    writeAudit({
      tenantId: auth.tenantId,
      action: "demo.start",
      targetType: "system",
      targetId: "demo-runner",
      meta: { overrides: applied },
    });
    app.log.info(
      `[demo] runtime ON — overrides: ${applied.map((r) => `${r.key}=${r.after}`).join(", ") || "none"}`,
    );

    return reply.ok(snapshot());
  });

  // POST /v1/demo/stop — turn demo OFF for this process. Idempotent.
  app.post("/demo/stop", async (req, reply) => {
    const auth = requireAuth(req);

    const wasRunning = stopDemoRunner();
    const restored = deactivateRuntimeDemoMode();
    if (wasRunning || restored.length > 0) {
      rebuildGateway();
      writeAudit({
        tenantId: auth.tenantId,
        action: "demo.stop",
        targetType: "system",
        targetId: "demo-runner",
        meta: { restored },
      });
      app.log.info(
        `[demo] runtime OFF — restored: ${restored.map((r) => `${r.key}=${r.before ?? "(unset)"}`).join(", ") || "none"}`,
      );
    }

    return reply.ok({ ...snapshot(), wasRunning });
  });
}
