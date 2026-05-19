/**
 * Hello function — M3 sanity check. Triggered by `system/PING`, logs a line.
 * Used to verify end-to-end Inngest wiring before M4 brings in the real
 * manifest-driven agent functions.
 */

import { inngest } from "./client";
import type { InngestFunction } from "inngest";

/**
 * Explicit `InngestFunction.Any` annotation — TS 6 (TS2883) refuses to infer
 * function types that reference Inngest v4 internal `api/api` symbols across
 * package boundaries. The runtime functions are dispatched via Inngest's
 * runtime registry, so the loose `Any` signature is the right narrowing.
 */
export const helloFn: InngestFunction.Any = inngest.createFunction(
  {
    id: "system.hello",
    name: "Hello world",
    // v4: triggers moved into opts (was a separate 2nd arg in v3)
    triggers: [{ event: "system/PING" }],
  },
  async ({ event, step, logger }) => {
    const data = (event.data ?? {}) as { from?: string };
    logger.info("[hello] received PING", { from: data.from });
    await step.sleep("brief-pause", "200ms");
    return { ok: true, at: Date.now(), from: data.from ?? "anonymous" };
  },
);
