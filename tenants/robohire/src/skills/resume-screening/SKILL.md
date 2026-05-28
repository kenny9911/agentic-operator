---
name: resume-screening
description: Rubric for ranking sourced candidates against the requisition's must-have and nice-to-have criteria
audience: screenerAgent
---

# Resume screening

Use this skill when you have a shortlist from sourcing and need to produce a ranked, justified ordering.

## Inputs

- The `CANDIDATES_SOURCED` event payload (shortlist + `job_requisition_id`).
- The req's `must_have` and `nice_to_have` arrays (refetch via `robohire-mcp.get_job_requisition` if not in the event).

## Procedure

1. For each candidate, call `matchResumeApi` with `{ candidate_id, resume_id, job_requisition_ids: [<the one>] }`.
2. Translate the upstream `overall_status` to one of `STRONG_FIT | POSSIBLE_FIT | WEAK_FIT`:
   - `pass` or score ≥ 80 → `STRONG_FIT`
   - `partial` or score 65-79 → `POSSIBLE_FIT`
   - else → `WEAK_FIT`
3. Sort candidates by score desc, ties broken by must-have coverage.
4. For the top 3, write one sentence explaining why they topped the list — reference at least one specific must-have they cover.
5. Emit `CANDIDATES_SCREENED` with `{ job_requisition_id, ranked: [{candidate_id, score, verdict, why}, …], evaluated_at }`.

## Sanity checks

- Reject any candidate scored as `STRONG_FIT` with score < 70 — it indicates a calibration drift; downgrade to `POSSIBLE_FIT` and log a note.
- Never invent skills the candidate doesn't have. If you can't cite the must-have from the candidate's profile, drop them out of the top 3.
