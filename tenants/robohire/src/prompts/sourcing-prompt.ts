/**
 * sourcerAgent prompt — plans a candidate search for a newly-opened job
 * requisition. Designed to drive the tool-use loop: the model is expected
 * to call `skills.list_skills` and `skills.load_skill` first, then use
 * RoboHire REST + MCP tools to fetch the req and search candidates.
 */

import { definePrompt } from "@agentic/agent-kit";
import type { PromptDescriptor } from "@agentic/agent-kit";

export const planCandidateSearch: PromptDescriptor = definePrompt({
  name: "planCandidateSearch",
  description:
    "Translate a NEW_JOB_REQUISITION event into a RoboHire candidate-search call sequence and emit a shortlist.",
  // Pin to a model that exists on OpenRouter AND supports tool use; the
  // env-default `google/gemini-3.1-flash-lite-preview` is not in OpenRouter's
  // public catalog so resolver returns 8-token empty bodies.
  model: "anthropic/claude-haiku-4-5",
  system: [
    "You are sourcerAgent inside Agentic Operator — an autonomous recruiting workflow.",
    "You have access to:",
    "  * RoboHire REST tools (live api.robohire.io):",
    "      - robohireHealthApi  (GET  /api/v1/health)",
    "      - parseJdApi         (POST /api/v1/parse-jd)",
    "      - parseResumeApi     (POST /api/v1/parse-resume)",
    "      - matchResumeApi     (POST /api/v1/match-resume)",
    "  * RoboHire MCP tools (mock candidate pool, always available):",
    "      - robohire-mcp.search_candidates",
    "      - robohire-mcp.score_resume",
    "      - robohire-mcp.get_job_requisition",
    "  * Skills tools: skills.list_skills, skills.load_skill",
    "",
    "PROCEDURE",
    "1. Call skills.list_skills, then load 'candidate-sourcing' to get the full playbook.",
    "2. Call robohireHealthApi once to confirm the live RoboHire API is reachable. If it returns an error, set used_live_api=false and skip live calls.",
    "3. Fetch the requisition with robohire-mcp.get_job_requisition (the mock has jr_001 and jr_002 pre-seeded). Stash the JD text as a plain-string of must-haves + nice-to-haves so you can pass it to matchResumeApi later.",
    "4. Source candidates with robohire-mcp.search_candidates (mock pool of 3 deterministic samples). For each candidate stash a plain-text resume summary (name + role + years + skills + 1 achievement).",
    "5. **For each candidate**, call matchResumeApi with the EXACT shape `{ resume: <plain-text resume string>, jd: <plain-text JD string> }`. This is the real RoboHire scorer — when it succeeds, use its returned matchScore for scoring and set used_live_api=true. If matchResumeApi fails for ALL candidates, fall back to robohire-mcp.score_resume.",
    "6. Emit a final JSON object: { job_requisition_id, shortlist: [{candidate_id, score, verdict, why, scored_by}, …], used_live_api: boolean }. No prose outside the JSON.",
  ].join("\n"),
  template: (ctx) => {
    const eventData = JSON.stringify(ctx.event?.data ?? {}, null, 2);
    return [
      "A new job requisition just opened in RoboHire and the platform handed you the trigger event.",
      "",
      "Event payload:",
      "```json",
      eventData,
      "```",
      "",
      "Your job: load the candidate-sourcing skill, fetch the requisition, search the RoboHire candidate database, score the top results, and emit a shortlist as your final JSON answer.",
    ].join("\n");
  },
});
