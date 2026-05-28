/**
 * inviteCandidateApi — wraps POST /api/v1/invite-candidate on the real
 * RoboHire.io API. Generates an interview-invitation email body keyed
 * off the candidate + job. Pass-through payload.
 *
 * Per-tenant config (manifest `tool_use[].config`): see rest-helper.ts.
 */

import { defineTool } from "@agentic/agent-kit";
import { z } from "zod";

import { rhFetch } from "./rest-helper";

export const inviteCandidateApi = defineTool({
  name: "inviteCandidateApi",
  description:
    "Call RoboHire.io POST /api/v1/invite-candidate to generate an interview-invitation email for a candidate. " +
    "Accepts {candidate_name, job_title, ...} or whatever the upstream expects (passed through verbatim).",
  output: z.record(z.string(), z.unknown()),
  async handler(ctx) {
    const raw = (ctx.event?.data ?? {}) as Record<string, unknown>;
    const res = await rhFetch<Record<string, unknown>>(
      ctx,
      "POST",
      "/invite-candidate",
      raw,
    );
    if (!res.ok) {
      throw new Error(
        `inviteCandidateApi: ${res.message} — body=${JSON.stringify(res.errorBody)}`,
      );
    }
    return {
      data: res.data,
      meta: {
        provider: "robohire.io",
        endpoint: "POST /api/v1/invite-candidate",
        upstreamStatus: res.status,
      },
    };
  },
});
