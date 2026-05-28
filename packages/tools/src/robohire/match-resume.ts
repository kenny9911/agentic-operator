/**
 * matchResumeApi — wraps POST {base}/match-resume on the real RoboHire.io
 * API. Endpoint name is hyphenated per the live catalogue (`GET /` on
 * api.robohire.io returns the canonical list).
 *
 * Args are tolerant of two common shapes the upstream supports:
 *   - structured: `{ resume, jd }` (both plain-text strings — preferred)
 *   - by-reference: `{ candidate_id, resume_id, job_requisition_ids }`
 *
 * The handler also normalises common LLM-emitted variants (resume_text,
 * jd_text, candidate_resume, job_description) into the canonical shape so
 * we don't burn a tool-use turn on a schema-fix retry.
 *
 * Returns a normalised top-level envelope so downstream agents don't have
 * to spelunk RoboHire's nested response:
 *   {
 *     matchScore: number | null,         // 0-100 or null when upstream omitted
 *     verdict: string | null,            // "Strong Match" | … | null
 *     hiringRecommendation: string | null,
 *     summary: string | null,
 *     raw: <full upstream body>          // for the detailed breakdown
 *   }
 *
 * Per-tenant config (manifest `tool_use[].config`): see rest-helper.ts.
 */

import { defineTool } from "@agentic/agent-kit";
import { z } from "zod";

import { rhFetch } from "./rest-helper";

interface MatchResumeBody {
  match_results?: unknown;
  overall_status?: string;
  match_score?: number;
  overallMatchScore?: { score?: number };
  overallFit?: {
    verdict?: string;
    hiringRecommendation?: string;
    summary?: string;
  };
  [k: string]: unknown;
}

export const matchResumeApi = defineTool({
  name: "matchResumeApi",
  description:
    "Call RoboHire.io POST /api/v1/match-resume to score a resume against a job description. " +
    "REQUIRED FIELDS: { resume: string, jd: string } — both plain-text full-body strings " +
    "(NOT field references, NOT URLs unless you've already fetched them). " +
    "Returns a normalised envelope { matchScore, verdict, hiringRecommendation, summary, raw }.",
  output: z.record(z.string(), z.unknown()),
  async handler(ctx) {
    const raw = (ctx.event?.data ?? {}) as Record<string, unknown>;
    const body: Record<string, unknown> = { ...raw };
    if (!body.resume) {
      body.resume =
        raw.resume_text ?? raw.candidate_resume ?? raw.resume_body ?? raw.candidateResume;
    }
    if (!body.jd) {
      body.jd =
        raw.jd_text ?? raw.job_description ?? raw.jobDescription ?? raw.jd_body;
    }
    if (typeof body.resume !== "string" || typeof body.jd !== "string") {
      throw new Error(
        "matchResumeApi: required string fields `resume` and `jd` missing — provide both as plain-text full bodies.",
      );
    }
    const res = await rhFetch<MatchResumeBody>(ctx, "POST", "/match-resume", {
      resume: body.resume,
      jd: body.jd,
    });
    if (!res.ok) {
      throw new Error(
        `matchResumeApi: ${res.message} — body=${JSON.stringify(res.errorBody)}`,
      );
    }

    const upstream = (res.data ?? {}) as MatchResumeBody;
    const normalized = {
      matchScore: upstream.overallMatchScore?.score ?? null,
      verdict: upstream.overallFit?.verdict ?? null,
      hiringRecommendation: upstream.overallFit?.hiringRecommendation ?? null,
      summary: upstream.overallFit?.summary ?? null,
      raw: upstream,
    };

    return {
      data: normalized,
      meta: {
        provider: "robohire.io",
        endpoint: "POST /api/v1/match-resume",
        upstreamStatus: res.status,
      },
    };
  },
});
