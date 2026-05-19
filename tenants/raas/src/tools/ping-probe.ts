/**
 * Smoke-test tool — proves the agent-kit resolver loop is wired end-to-end.
 *
 * When a manifest action with `name: "monitorAndFetchRequirement"` runs, the
 * step engine looks up `monitorAndFetchRequirement` in the RAAS tenant
 * registry FIRST (this file), falls back to generic @agentic/tools only if
 * nothing's registered. The presence of `tool: "raas.ping-probe"` in the
 * step's meta confirms the tenant path was taken.
 *
 * Replace with real tool implementations as agents are built out.
 */

import { defineTool } from "@agentic/agent-kit";
import { z } from "zod";

export const pingProbe = defineTool({
  name: "monitorAndFetchRequirement",
  description:
    "Tenant-resolver smoke test. Returns a hello payload to confirm the agent-kit dispatch path is live.",
  output: z.object({
    pong: z.literal(true),
    seenSubject: z.string().nullable(),
    seenEvent: z.string().nullable(),
  }),
  async handler(ctx) {
    return {
      data: {
        pong: true,
        seenSubject: ctx.subject ?? null,
        seenEvent: ctx.event?.name ?? null,
      },
      meta: { tool: "raas.ping-probe" },
    };
  },
});
