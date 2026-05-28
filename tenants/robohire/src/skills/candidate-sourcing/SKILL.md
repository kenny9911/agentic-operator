---
name: candidate-sourcing
description: How to translate a job requisition into a structured RoboHire candidate search and select shortlist
audience: sourcerAgent
---

# Candidate sourcing

Use this skill when you need to turn a fresh job requisition into a candidate longlist.

## Input you will see

You will be invoked after a `NEW_JOB_REQUISITION` event. The event payload always carries `job_requisition_id`. Use `robohire-mcp.get_job_requisition` (or the real REST `getJobRequisitionApi` if available) to fetch the structured req before doing anything else.

## Procedure

1. **Fetch the req** with `robohire-mcp.get_job_requisition`. Record `title`, `must_have`, `nice_to_have`, `location`.
2. **Build the search args** for `searchCandidatesApi`:
   - `job_title` = the req's `title`
   - `must_have` = first 3-5 items from `must_have`
   - `nice_to_have` = first 3 items from `nice_to_have`
   - `location` = req's `location` if it constrains to a city or "Remote"
   - `limit` = 10 unless you have a reason to go wider
3. **If the real REST search fails or returns empty**, fall back to `robohire-mcp.search_candidates` (the mock MCP server) with `{ job_title }` as the query — confirms the workflow is alive even when the live API is unreachable.
4. **Score the longlist** by calling `robohire-mcp.score_resume` for each candidate (or `matchResumeApi` if you have `resume_id`). Keep only `STRONG_FIT` and the top 2 `POSSIBLE_FIT` results.
5. **Emit `CANDIDATES_SOURCED`** with payload `{ job_requisition_id, shortlist: [{candidate_id, score, verdict}, …] }`.

## What "done" looks like

A shortlist of 3-5 candidates with a numeric score and a one-line rationale per entry. If RoboHire returns zero candidates, surface that as `{ shortlist: [], reason: "no_candidates_found", searched_at: <iso> }` — silence is worse than an empty result.

## Failure modes

- `ROBOHIRE_API_KEY not set` — surface verbatim. Do not retry.
- Upstream 5xx — try the MCP mock fallback once, then give up.
- Empty result — emit the empty shortlist with `reason`. Don't synthesize candidates.
