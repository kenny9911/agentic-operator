/**
 * parseJdApi — wraps POST /api/v1/parse-jd on the real RoboHire.io API.
 * Companion to parseResumeApi for the job-description side.
 *
 * Forwards whatever payload the caller provides ({jd_text}, {jd_url},
 * {jd_base64}) verbatim; upstream rejects malformed payloads with a 400
 * which surfaces as tool_result:is_error so the LLM can self-correct.
 *
 * Per-tenant config (manifest `tool_use[].config`): see rest-helper.ts.
 */

import { defineTool } from "@agentic/agent-kit";
import { z } from "zod";

import { rhFetch } from "./rest-helper";

export const parseJdApi = defineTool({
  name: "parseJdApi",
  description:
    "Call RoboHire.io POST /api/v1/parse-jd to turn a job description (PDF URL, base64-encoded PDF, or plain text) into structured requirements.",
  output: z.record(z.string(), z.unknown()),
  async handler(ctx) {
    const raw = (ctx.event?.data ?? {}) as Record<string, unknown>;
    if (Object.keys(raw).length === 0) {
      throw new Error(
        "parseJdApi: empty input — provide one of {jd_url, jd_base64, jd_text}.",
      );
    }
    const res = await rhFetch<Record<string, unknown>>(ctx, "POST", "/parse-jd", raw);
    if (!res.ok) {
      throw new Error(
        `parseJdApi: ${res.message} — body=${JSON.stringify(res.errorBody)}`,
      );
    }
    return {
      data: res.data,
      meta: {
        provider: "robohire.io",
        endpoint: "POST /api/v1/parse-jd",
        upstreamStatus: res.status,
      },
    };
  },
});
