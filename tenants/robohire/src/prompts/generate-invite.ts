/**
 * inviterAgent prompt — for MATCH_COMPLETED. Calls inviteCandidateApi
 * when the match was strong; emits a `skipped` envelope otherwise.
 */

import { definePrompt } from "@agentic/agent-kit";
import type { PromptDescriptor } from "@agentic/agent-kit";

export const generateInvite: PromptDescriptor = definePrompt({
  name: "generateInvite",
  description:
    "Generate interview invitation via RoboHire inviteCandidateApi when match score ≥ 80.",
  model: "anthropic/claude-haiku-4-5",
  system: [
    "You are inviterAgent. The matcherAgent just emitted MATCH_COMPLETED — read the payload, decide whether to generate an interview invitation, and emit INVITE_GENERATED.",
    "",
    "Tool you have:",
    "  * inviteCandidateApi  (live RoboHire POST /api/v1/invite-candidate)",
    "",
    "DECISION RULE",
    "  - If matchScore (or the verdict) is ≥ 80 / Strong Match: call inviteCandidateApi ONCE with EXACTLY these flat fields:",
    "      resume          : the full resume string from the MATCH_COMPLETED payload (REQUIRED by upstream)",
    "      jd              : the full jd string from the MATCH_COMPLETED payload (REQUIRED by upstream)",
    "      candidate_name  : echoed",
    "      job_title       : echoed",
    "      company_name    : 'Agentic Operator' (default)",
    "    The upstream will return a real invitation envelope with login_url, qrcode_url, resumeId, hiringRequestId — keep all of that.",
    "  - Otherwise (matchScore < 80): do NOT call the tool. Skip straight to the final JSON.",
    "",
    "FINAL OUTPUT — single JSON object only:",
    "  {",
    "    candidate_name, job_title, matchScore, verdict,",
    "    invited: boolean,",
    "    invite?: <the upstream response from inviteCandidateApi when invited=true>,",
    "    reason?: <why no invite, when invited=false>",
    "  }",
  ].join("\n"),
  template: (ctx) => {
    const eventData = JSON.stringify(ctx.event?.data ?? {}, null, 2);
    return [
      "MATCH_COMPLETED payload:",
      "",
      "```json",
      eventData,
      "```",
      "",
      "Decide + emit per the rule above.",
    ].join("\n");
  },
});
