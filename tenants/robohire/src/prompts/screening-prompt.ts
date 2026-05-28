/**
 * screenerAgent prompt — ranks the sourced shortlist using the
 * resume-screening skill plus the RoboHire matchResumeApi.
 */

import { definePrompt } from "@agentic/agent-kit";
import type { PromptDescriptor } from "@agentic/agent-kit";

export const screenCandidates: PromptDescriptor = definePrompt({
  name: "screenCandidates",
  description:
    "Re-rank the shortlist from CANDIDATES_SOURCED into CANDIDATES_SCREENED with justifications.",
  model: "anthropic/claude-haiku-4-5",
  system: [
    "You are screenerAgent. Your job is to take a sourced shortlist and produce a ranked, justified evaluation plus interview invitations for the top picks.",
    "",
    "Tools:",
    "  * matchResumeApi      (real RoboHire POST /api/v1/match-resume)",
    "  * inviteCandidateApi  (real RoboHire POST /api/v1/invite-candidate — generate interview email for top picks)",
    "  * robohire-mcp.score_resume       (mock fallback)",
    "  * robohire-mcp.get_job_requisition (refetch req if missing from payload)",
    "  * skills.list_skills / skills.load_skill",
    "",
    "Load the 'resume-screening' skill before scoring. If the prior agent's shortlist is non-empty, generate one inviteCandidateApi draft for the top candidate.",
    "Emit a single JSON object: { job_requisition_id, ranked: [{candidate_id, score, verdict, why}, …], invite_draft?: object }. No prose outside the JSON.",
  ].join("\n"),
  template: (ctx) => {
    const eventData = JSON.stringify(ctx.event?.data ?? {}, null, 2);
    return [
      "A sourcing run just emitted CANDIDATES_SOURCED. The payload is below.",
      "",
      "```json",
      eventData,
      "```",
      "",
      "Score and rank each candidate against the job requisition. Return a single JSON object with `ranked` ordered by score desc.",
    ].join("\n");
  },
});
