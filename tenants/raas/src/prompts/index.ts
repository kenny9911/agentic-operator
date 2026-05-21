/**
 * RAAS tenant prompts — one `definePrompt` per `logic` action in
 * `models/RAAS-v1/workflow_v1.json`.
 *
 * Boot-time validation (`findMissingTenantPrompts` in
 * `packages/runtime/src/register.ts`) refuses to register the RAAS tenant if
 * any logic action lacks a matching prompt here. See
 * `docs/tech-design/ar-tool.md` § "Option B — strict".
 *
 * Prompts are deliberately minimal — they describe the role (1-2 sentences)
 * and a short template that pipes `ctx.lastResult` + the trigger event into
 * the LLM. They are NOT the final production prompts; engineers should refine
 * per-action wording with the recruiting team. The goal here is to make RAAS
 * boot cleanly so the v1 Wave 5 test sweep can exercise the runtime end-to-end.
 *
 * Key by `action.name` (NOT agent.name). One agent may contain multiple logic
 * actions and each needs its own prompt entry.
 */

import { definePrompt } from "@agentic/agent-kit";
import type { PromptDescriptor, ToolContext } from "@agentic/agent-kit";

/** Build a "context bundle" the LLM can read — trigger event + previous step output. */
function ctxBundle(ctx: ToolContext): string {
  const parts: string[] = [];
  if (ctx.event) {
    parts.push(`Trigger event: ${ctx.event.name}`);
    parts.push(`Event data: ${JSON.stringify(ctx.event.data ?? {}, null, 2)}`);
  }
  if (ctx.subject) parts.push(`Subject: ${ctx.subject}`);
  if (ctx.lastResult !== undefined) {
    parts.push(`Previous step output: ${JSON.stringify(ctx.lastResult, null, 2)}`);
  }
  return parts.join("\n");
}

// ── syncFromClientSystem ─────────────────────────────────────────────────────

export const checkDeduplicatedRequisition = definePrompt({
  name: "checkDeduplicatedRequisition",
  description:
    "Deduplicate inbound recruiting requisitions against existing records.",
  system:
    "You are a recruiting-operations assistant. Inspect a client recruiting requisition and decide whether it is a NEW requisition, an UPDATE to an existing one, or a TERMINATION. Use the client_role_unique_id and client_role_name fields to match.",
  template: (ctx) =>
    `Determine whether this requisition is new, an update, or terminated.\n\n${ctxBundle(ctx)}\n\nReturn JSON: { "decision": "new" | "update" | "terminate", "matched_requisition_id": string | null, "reason": string }.`,
});

export const persistRequisitionData = definePrompt({
  name: "persistRequisitionData",
  description:
    "Plan the database writes that persist or update a recruiting requisition.",
  system:
    "You are a recruiting-operations data steward. Given a dedup decision, decide which fields to write to the recruiting_requirement and recruiting_role records, and what change-log entry to emit.",
  template: (ctx) =>
    `Plan persistence actions for this requisition.\n\n${ctxBundle(ctx)}\n\nReturn JSON: { "writes": [...], "change_log": string, "failed_items": [...] }.`,
});

// ── analyzeRequirement ───────────────────────────────────────────────────────

export const assessFeasibilityAndDifficulty = definePrompt({
  name: "assessFeasibilityAndDifficulty",
  description:
    "Assess feasibility and difficulty of a recruiting requirement.",
  system:
    "You are a senior recruiter analyst. Evaluate whether a requirement is realistic given contract scope, market salary bands, timeline, and internal consistency. Rate hiring difficulty.",
  template: (ctx) =>
    `Assess feasibility and difficulty for this requirement.\n\n${ctxBundle(ctx)}\n\nReturn JSON: { "feasible": boolean, "difficulty": "easy" | "medium" | "hard" | "extreme", "key_risks": string[], "rationale": string }.`,
});

export const generateClarificationAndStrategy = definePrompt({
  name: "generateClarificationAndStrategy",
  description:
    "Generate clarifying questions and an initial recruiting strategy.",
  system:
    "You are a senior recruiter. Given an analyzed requirement, produce a prioritized list of questions to clarify with the client and an initial recruiting strategy (channels, timeline, expected conversion).",
  template: (ctx) =>
    `Generate clarification questions and recruiting strategy.\n\n${ctxBundle(ctx)}\n\nReturn JSON: { "questions": [{ "q": string, "priority": "high" | "medium" | "low", "background": string }], "strategy": { "channels": string[], "timeline_weeks": number, "expected_conversion": number } }.`,
});

// ── clarifyRequirement ───────────────────────────────────────────────────────

export const prepareClarificationMaterial = definePrompt({
  name: "prepareClarificationMaterial",
  description: "Compile clarification material for the delivery manager.",
  system:
    "You are a recruiting-operations assistant. Compile a clarification packet: prioritized questions, background context for each, and 1-2 historical analogues if available.",
  template: (ctx) =>
    `Compile clarification material.\n\n${ctxBundle(ctx)}\n\nReturn JSON: { "packet": [{ "q": string, "background": string, "suggested_followup": string }], "references": string[] }.`,
});

export const recordAndValidateResult = definePrompt({
  name: "recordAndValidateResult",
  description:
    "Parse a clarification response and validate completeness.",
  system:
    "You are a recruiting-operations validator. Parse the clarification result, update the must-have / nice-to-have / excluded fields on the requirement, and check whether all critical questions were answered without contradiction.",
  template: (ctx) =>
    `Parse and validate this clarification result.\n\n${ctxBundle(ctx)}\n\nReturn JSON: { "updates": { "must_have": string[], "nice_to_have": string[], "exclusions": string[] }, "complete": boolean, "unresolved_questions": string[] }.`,
});

// ── createJD ─────────────────────────────────────────────────────────────────

export const generateJDContent = definePrompt({
  name: "generateJDContent",
  description: "Draft a complete job description from a clarified requirement.",
  system:
    "You are a job-description writer. Given a clarified requirement and a template, produce a polished JD with title, top 5 search keywords, responsibilities, requirements, company blurb, comp, and logistics.",
  template: (ctx) =>
    `Write the JD.\n\n${ctxBundle(ctx)}\n\nReturn JSON: { "title": string, "keywords": string[], "responsibilities": string[], "requirements": string[], "company": string, "compensation": string, "logistics": string }.`,
});

export const handleRequisitionMapping = definePrompt({
  name: "handleRequisitionMapping",
  description:
    "Decide how to map requirements to job postings (1-to-many / many-to-1).",
  system:
    "You are a recruiting-operations planner. Decide whether requirements should aggregate into one posting or fan out into several customized postings per channel.",
  template: (ctx) =>
    `Plan requisition-to-posting mapping.\n\n${ctxBundle(ctx)}\n\nReturn JSON: { "mapping": [{ "posting_key": string, "requirement_ids": string[], "channel": string | null, "variant_note": string | null }] }.`,
});

// ── assignRecruitTasks ───────────────────────────────────────────────────────

export const assignRecruitTasks = definePrompt({
  name: "assignRecruitTasks",
  description:
    "Suggest which recruiters should own a given role based on skills + workload.",
  system:
    "You are a recruiting-ops dispatcher. Given role attributes (type, difficulty, urgency, skills) and recruiter profiles (specialty, history, current load), suggest the best-fit recruiters.",
  template: (ctx) =>
    `Recommend recruiter assignments.\n\n${ctxBundle(ctx)}\n\nReturn JSON: { "recommendations": [{ "recruiter_id": string, "score": number, "reason": string }] }.`,
});

// ── processResume ────────────────────────────────────────────────────────────

export const validateCompleteness = definePrompt({
  name: "validateCompleteness",
  description: "Check resume completeness and emit a missing-fields list.",
  system:
    "You are a resume-parsing validator. Confirm the extracted candidate profile has the required fields (name, phone, education, work history, projects). List anything missing.",
  template: (ctx) =>
    `Validate this candidate profile.\n\n${ctxBundle(ctx)}\n\nReturn JSON: { "complete": boolean, "missing_fields": string[] }.`,
});

export const validateCandidacy = definePrompt({
  name: "validateCandidacy",
  description:
    "Decide whether to create a candidate record or terminate due to a lock conflict.",
  system:
    "You are a candidate-intake gatekeeper. Given the completeness check + any existing lock state, decide to proceed (create record), terminate (locked elsewhere), or hold (wait for missing info).",
  template: (ctx) =>
    `Decide next action for this candidate.\n\n${ctxBundle(ctx)}\n\nReturn JSON: { "decision": "create" | "terminate" | "hold", "reason": string, "candidate_id": string | null }.`,
});

// ── ruleCheckerForClientResume ───────────────────────────────────────────────

export const ruleCheckerForClientResume = definePrompt({
  name: "检查客户规则",
  description:
    "Apply client-specific resume rules and emit pass/fail with rationale.",
  system:
    "You are a client-rules compliance checker. Apply the client's specific resume rules (e.g. background restrictions, certification requirements, exclusion criteria) to the candidate and produce a pass/fail with reasons.",
  template: (ctx) =>
    `Apply client rules to this candidate's resume.\n\n${ctxBundle(ctx)}\n\nReturn JSON: { "passed": boolean, "rule_violations": [{ "rule": string, "detail": string }], "notes": string }.`,
});

// ── matchResume ──────────────────────────────────────────────────────────────

export const validateRedlineAndBlacklist = definePrompt({
  name: "validateRedlineAndBlacklist",
  description:
    "Run redline + blacklist checks against a candidate.",
  system:
    "You are a recruiting-compliance checker. Verify the candidate against company and client blacklists, redline restrictions (non-compete, banned employers, high-risk separation codes), and historical employment flags.",
  template: (ctx) =>
    `Run redline + blacklist checks.\n\n${ctxBundle(ctx)}\n\nReturn JSON: { "passed": boolean, "blacklist_hits": string[], "redline_hits": string[], "tencent_history": boolean }.`,
});

export const matchHardRequirements = definePrompt({
  name: "matchHardRequirements",
  description:
    "Match a candidate against the requirement's hard criteria.",
  system:
    "You are a recruiting matcher. Compare the candidate against the role's hard requirements (education, years of experience, certifications, age range) using the And/Or logic from the clarified requirement.",
  template: (ctx) =>
    `Match hard requirements.\n\n${ctxBundle(ctx)}\n\nReturn JSON: { "matched": boolean, "criteria": [{ "name": string, "required": string, "actual": string, "passed": boolean }] }.`,
});

export const evaluateBonusAndCheckReflux = definePrompt({
  name: "evaluateBonusAndCheckReflux",
  description:
    "Score bonus attributes and check reflux freezing-period rules.",
  system:
    "You are a recruiting evaluator. Score the candidate's bonus attributes (top-tier employer, project highlights, skill overmatch), compute a composite match score, and enforce reflux freezing rules (Tencent FTE / Tencent outsource / competitor staffing) per client and BG.",
  template: (ctx) =>
    `Score bonus attributes and check reflux rules.\n\n${ctxBundle(ctx)}\n\nReturn JSON: { "match_score": number, "bonus_factors": string[], "reflux_blocked": boolean, "reflux_reason": string | null }.`,
});

// ── inviteInternalInterview ──────────────────────────────────────────────────

export const generateInterviewInvitation = definePrompt({
  name: "generateInterviewInvitation",
  description: "Compose a personalized interview invitation.",
  system:
    "You are an interview-coordination assistant. Write a personalized interview invitation including instructions, scheduling window, and reminders. Return the invite content plus a stable invite_link placeholder.",
  template: (ctx) =>
    `Compose an interview invitation.\n\n${ctxBundle(ctx)}\n\nReturn JSON: { "subject": string, "body": string, "deadline_days": number, "invite_link_placeholder": string }.`,
});

export const notifyRecruiter = definePrompt({
  name: "notifyRecruiter",
  description:
    "Generate a recruiter-facing handoff message for the interview invite.",
  system:
    "You are a recruiter-ops assistant. Compose a short message the recruiter can forward via WeCom to the candidate, including a copy-paste script and the interview link.",
  template: (ctx) =>
    `Compose recruiter-facing handoff.\n\n${ctxBundle(ctx)}\n\nReturn JSON: { "recruiter_id": string, "wecom_message": string, "interview_link": string }.`,
});

// ── evaluateInterview ────────────────────────────────────────────────────────

export const receiveInterviewResult = definePrompt({
  name: "receiveInterviewResult",
  description:
    "Acknowledge and normalize an inbound AI-interview result payload.",
  system:
    "You are an interview-results intake processor. Confirm the AI interview payload contains video, transcript, and per-question durations; emit a normalized record id for downstream analysis.",
  template: (ctx) =>
    `Acknowledge and normalize this interview result.\n\n${ctxBundle(ctx)}\n\nReturn JSON: { "interview_id": string, "ready_for_analysis": boolean, "missing_artifacts": string[] }.`,
});

export const analyzeInterviewResult = definePrompt({
  name: "analyzeInterviewResult",
  description:
    "Analyze interview answers and compare against role requirements.",
  system:
    "You are an interview analyst. Extract the key signals from the candidate's answers and compare them against the role's requirements. Score domain depth, problem-solving, communication, and reasoning.",
  template: (ctx) =>
    `Analyze interview content.\n\n${ctxBundle(ctx)}\n\nReturn JSON: { "scores": { "domain": number, "problem_solving": number, "communication": number, "reasoning": number }, "key_signals": string[], "concerns": string[] }.`,
});

export const generateEvaluationReport = definePrompt({
  name: "generateEvaluationReport",
  description:
    "Produce the final interview evaluation report with a recommendation.",
  system:
    "You are an interview-report writer. Produce a complete evaluation: overall score, per-dimension scores, highlights, strengths, concerns, risks (stability, fit), and a final recommendation.",
  template: (ctx) =>
    `Write the evaluation report.\n\n${ctxBundle(ctx)}\n\nReturn JSON: { "overall_score": number, "dimensions": Record<string, number>, "highlights": string[], "strengths": string[], "concerns": string[], "risks": string[], "recommendation": "recommend" | "hold" | "reject" }.`,
});

// ── refineResume ─────────────────────────────────────────────────────────────

export const selectTemplateAndFormat = definePrompt({
  name: "selectTemplateAndFormat",
  description:
    "Pick the right client resume template and reformat the candidate resume.",
  system:
    "You are a resume formatter. Pick the client-specific template and restructure the candidate's resume content into it, unifying fonts, sizes, and spacing.",
  template: (ctx) =>
    `Pick template and reformat.\n\n${ctxBundle(ctx)}\n\nReturn JSON: { "template_id": string, "reformatted_sections": Record<string, string>, "format_notes": string }.`,
});

export const generateRefinedResume = definePrompt({
  name: "generateRefinedResume",
  description:
    "Generate the polished client-ready resume PDF content with keyword highlighting.",
  system:
    "You are a resume polisher. Identify role-relevant keywords in the candidate's resume, highlight them, and produce the final client-ready content. Preserve all core information exactly.",
  template: (ctx) =>
    `Polish the resume.\n\n${ctxBundle(ctx)}\n\nReturn JSON: { "highlighted_keywords": string[], "final_content_markdown": string, "pdf_filename_hint": string }.`,
});

// ── generateRecommendationPackage ────────────────────────────────────────────

export const checkCompleteness = definePrompt({
  name: "checkCompleteness",
  description:
    "Validate the submission-package material set for completeness and compliance.",
  system:
    "You are a submission-package validator. Check required artifacts (portfolio, compliance proofs, separation docs), clean PII fields, recognize non-traditional education credentials, and validate WeChat IDs.",
  template: (ctx) =>
    `Validate the package.\n\n${ctxBundle(ctx)}\n\nReturn JSON: { "complete": boolean, "missing_items": string[], "data_cleaning_notes": string[], "compliance_issues": string[] }.`,
});

export const requestMissingInfo = definePrompt({
  name: "requestMissingInfo",
  description:
    "Compose a missing-info request to the recruiter for the package.",
  system:
    "You are a recruiting-ops assistant. Compose a clear list of missing items for the recruiter to chase down with the candidate and set a follow-up reminder.",
  template: (ctx) =>
    `Compose missing-info request.\n\n${ctxBundle(ctx)}\n\nReturn JSON: { "recruiter_id": string, "missing_items": string[], "message": string, "followup_days": number }.`,
});

export const generateFinalPackage = definePrompt({
  name: "generateFinalPackage",
  description:
    "Compose the final submission package document.",
  system:
    "You are a submission-package writer. Assemble the final document by combining all artifacts (cover, refined resume, evaluation report, compliance proofs) into a single ready-to-submit bundle.",
  template: (ctx) =>
    `Assemble the final package.\n\n${ctxBundle(ctx)}\n\nReturn JSON: { "package_id": string, "sections": [{ "section": string, "content_ref": string }], "ready_for_submission": boolean }.`,
});

// ── submitToClientPortal ─────────────────────────────────────────────────────

export const prepareSubmissionData = definePrompt({
  name: "prepareSubmissionData",
  description:
    "Map the submission package into the client portal's expected payload shape.",
  system:
    "You are a client-portal integration adapter. Map our internal package fields to the client system's expected JSON / form fields. Emit a payload that satisfies the target schema.",
  template: (ctx) =>
    `Prepare submission payload.\n\n${ctxBundle(ctx)}\n\nReturn JSON: { "client_system": string, "payload": Record<string, unknown>, "field_mapping": Record<string, string> }.`,
});

export const handleSubmissionResult = definePrompt({
  name: "handleSubmissionResult",
  description:
    "Classify a client-portal submission result and decide next step.",
  system:
    "You are a submission-results triager. On success, record the client-side application id; on failure, classify (format error → retry, system error → human handoff, rule rejection → notify delivery manager).",
  template: (ctx) =>
    `Triage submission result.\n\n${ctxBundle(ctx)}\n\nReturn JSON: { "outcome": "success" | "retry" | "human_handoff" | "delivery_manager", "application_id": string | null, "error_class": string | null, "next_step": string }.`,
});

// ── registry export ──────────────────────────────────────────────────────────

/**
 * The map keyed by `action.name` consumed by `TenantRegistry.prompts`.
 * Boot-time validation (`findMissingTenantPrompts`) walks the manifest's
 * logic actions and looks them up here.
 */
export const raasPrompts: Record<string, PromptDescriptor> = {
  // syncFromClientSystem
  checkDeduplicatedRequisition,
  persistRequisitionData,
  // analyzeRequirement
  assessFeasibilityAndDifficulty,
  generateClarificationAndStrategy,
  // clarifyRequirement
  prepareClarificationMaterial,
  recordAndValidateResult,
  // createJD
  generateJDContent,
  handleRequisitionMapping,
  // assignRecruitTasks
  assignRecruitTasks,
  // processResume
  validateCompleteness,
  validateCandidacy,
  // ruleCheckerForClientResume  (action name is Chinese)
  检查客户规则: ruleCheckerForClientResume,
  // matchResume
  validateRedlineAndBlacklist,
  matchHardRequirements,
  evaluateBonusAndCheckReflux,
  // inviteInternalInterview
  generateInterviewInvitation,
  notifyRecruiter,
  // evaluateInterview
  receiveInterviewResult,
  analyzeInterviewResult,
  generateEvaluationReport,
  // refineResume
  selectTemplateAndFormat,
  generateRefinedResume,
  // generateRecommendationPackage
  checkCompleteness,
  requestMissingInfo,
  generateFinalPackage,
  // submitToClientPortal
  prepareSubmissionData,
  handleSubmissionResult,
};
