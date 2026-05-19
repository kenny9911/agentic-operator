/**
 * Inngest client — single shared instance for the whole runtime.
 *
 * App ID `agentic-operator` ties this app to the Inngest project. In dev,
 * the local Inngest CLI auto-discovers this via /api/inngest polling.
 *
 * Event keys / signing keys are sourced from env (.env.example has defaults
 * good enough for local dev). In production, set INNGEST_EVENT_KEY and
 * INNGEST_SIGNING_KEY from secrets.
 *
 * v4 NOTE: The `EventSchemas().fromRecord<EventMap>()` helper was removed in
 * inngest@4. The new model is per-function trigger typing via `eventType()` /
 * `staticSchema()` (Standard Schema spec). For this runtime we use generic
 * `${tenant}/${EVENT}` event names with `Record<string, unknown>` data — the
 * shape is enforced by per-agent manifests, not the SDK — so we register
 * without a global schema.
 */

import { Inngest } from "inngest";

/**
 * Event-name → payload type map. Retained as documentation for what shapes
 * flow through the system; not handed to the SDK in v4.
 *
 * Tenant-namespaced event names are written as `${tenant}/${EVENT_NAME}`
 * (e.g. `raas/REQUIREMENT_LOGGED`) per DESIGN.md §6.
 */
export type EventMap = {
  "system/PING": { data: { from?: string } };
  "task.resolved": {
    data: { taskId: string; decision: string; payload?: unknown };
  };
  [k: `${string}/${string}`]: { data: Record<string, unknown> };
};

export const inngest = new Inngest({
  id: "agentic-operator",
  // Dev mode is auto-detected by the SDK when running against the local
  // Inngest CLI (no signing key required).
});
