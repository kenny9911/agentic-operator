// Agentic Operator — RAAS demo data
// Translated from the attached workflow_v1.json into English.
// Each agent is an event-driven node; events wire them together.

window.RAAS_AGENTS = [
  {
    id: "1-1",
    name: "syncFromClientSystem",
    title: "Sync Client Requirements",
    description: "Polls client RMS portals, detects new/changed/deleted reqs, normalizes fields, persists to RAAS.",
    actor: "Agent",
    stage: 0,
    triggers: ["SCHEDULED_SYNC"],
    emits: ["REQUIREMENT_SYNCED", "SYNC_FAILED_ALERT"],
    steps: ["monitorAndFetchRequirement", "checkDeduplicatedRequisition", "persistRequisitionData"],
    tools: ["http.fetch", "rms.adapter", "db.upsert"],
    model: "claude-sonnet-4-5",
  },
  {
    id: "1-2",
    name: "manualEntry",
    title: "Manual Requirement Entry",
    description: "Delivery manager / recruiter manually creates a requisition in RAAS.",
    actor: "Human",
    stage: 0,
    triggers: [],
    emits: ["REQUIREMENT_LOGGED"],
  },
  {
    id: "2",
    name: "analyzeRequirement",
    title: "Analyze Requirement",
    description: "Assesses feasibility, difficulty, generates clarification questions & sourcing strategy.",
    actor: "Agent",
    stage: 1,
    triggers: ["REQUIREMENT_SYNCED", "REQUIREMENT_LOGGED", "CLARIFICATION_RETRY"],
    emits: ["ANALYSIS_COMPLETED", "ANALYSIS_BLOCKED"],
    steps: ["loadContextData", "assessFeasibilityAndDifficulty", "generateClarificationAndStrategy"],
    tools: ["db.query", "market.lookup", "history.stats"],
    model: "claude-sonnet-4-5",
  },
  {
    id: "3",
    name: "clarifyRequirement",
    title: "Clarify Requirement",
    description: "Routes open questions back to the delivery manager; if none, fast-forwards to JD creation.",
    actor: "Agent",
    stage: 1,
    triggers: ["ANALYSIS_COMPLETED"],
    emits: ["CLARIFICATION_READY", "CLARIFICATION_INCOMPLETE"],
    steps: ["prepareClarificationMaterial", "recordAndValidateResult"],
    tools: ["notify.recruit-ide", "db.update"],
    model: "claude-haiku-4-5",
  },
  {
    id: "3-2",
    name: "requirementReClarification",
    title: "Re-clarify with Client",
    description: "HSM contacts the client, captures answers, retriggers analysis.",
    actor: "Human",
    stage: 1,
    triggers: ["CLARIFICATION_INCOMPLETE"],
    emits: ["CLARIFICATION_RETRY"],
  },
  {
    id: "4",
    name: "createJD",
    title: "Create Job Description",
    description: "Generates standardized JD content; handles 1:N and N:1 requisition→posting mapping.",
    actor: "Agent",
    stage: 2,
    triggers: ["CLARIFICATION_READY", "JD_REJECTED"],
    emits: ["JD_GENERATED"],
    steps: ["generateJDContent", "handleRequisitionMapping"],
    tools: ["llm.generate", "template.load"],
    model: "claude-sonnet-4-5",
  },
  {
    id: "5",
    name: "jdReview",
    title: "JD Review",
    description: "Delivery manager approves or rejects the generated JD.",
    actor: "Human",
    stage: 2,
    triggers: ["JD_GENERATED"],
    emits: ["JD_APPROVED", "JD_REJECTED"],
  },
  {
    id: "6",
    name: "assignRecruitTasks",
    title: "Assign Recruiter Tasks",
    description: "Matches reqs to recruiters by specialty, load, historical performance.",
    actor: "Agent",
    stage: 3,
    triggers: ["JD_APPROVED"],
    emits: ["TASK_ASSIGNED"],
    steps: ["assignRecruitTasks"],
    tools: ["db.query", "scoring.match"],
    model: "claude-haiku-4-5",
  },
  {
    id: "7-1",
    name: "publishJD",
    title: "Publish to Channels",
    description: "API-publishes to channels that support it; generates a paste-ready helper for the rest.",
    actor: "Agent",
    stage: 3,
    triggers: ["TASK_ASSIGNED"],
    emits: ["CHANNEL_PUBLISHED", "CHANNEL_PUBLISHED_FAILED"],
    steps: ["executeAutomatedPublication", "generatePublishHelperPage", "updatePublicationStatus"],
    tools: ["zhilian.api", "liepin.api", "boss.helper-render"],
    model: "claude-haiku-4-5",
  },
  {
    id: "7-2",
    name: "manualPublish",
    title: "Manual Channel Publish",
    description: "Recruiter completes posting on channels lacking API.",
    actor: "Human",
    stage: 3,
    triggers: ["CHANNEL_PUBLISHED_FAILED"],
    emits: ["CHANNEL_PUBLISHED"],
  },
  {
    id: "8",
    name: "resumeCollection",
    title: "Resume Collection",
    description: "Recruiter downloads candidate resumes from channels.",
    actor: "Human",
    stage: 4,
    triggers: ["CHANNEL_PUBLISHED"],
    emits: ["RESUME_DOWNLOADED"],
  },
  {
    id: "9-1",
    name: "processResume",
    title: "Process Resume",
    description: "Parses, dedupes, locks candidate to a single recruiter, validates completeness.",
    actor: "Agent",
    stage: 4,
    triggers: ["RESUME_DOWNLOADED"],
    emits: ["RESUME_PROCESSED", "RESUME_LOCKED_CONFLICT", "RESUME_INFO_MISSING", "RESUME_PARSE_ERROR"],
    steps: ["uploadResume", "parseResume", "extractResumeInfo", "validateCompleteness", "validateCandidacy"],
    tools: ["ocr.parse", "nlp.extract", "db.lock"],
    model: "claude-sonnet-4-5",
  },
  {
    id: "9-2",
    name: "resumeFix",
    title: "Resume Fix",
    description: "Recruiter manually corrects parse errors or re-uploads the resume.",
    actor: "Human",
    stage: 4,
    triggers: ["RESUME_PARSE_ERROR"],
    emits: ["RESUME_PROCESSED"],
  },
  {
    id: "10-1",
    name: "recallStockCandidates",
    title: "Recall Stock Candidates",
    description: "When a new client requirement is published, reactivates previously-submitted candidates who were never filtered by the client within the freshness window, or were frozen for non-capability reasons (HC on hold, budget pause). Emits one RESUME_PROCESSED event per recovered candidate so matchResume can score them against the fresh requirement.",
    actor: "Agent",
    stage: 5,
    triggers: ["CHANNEL_PUBLISHED"],
    emits: ["RESUME_PROCESSED"],
    steps: ["scanClientCandidatePool", "applyFreshnessWindow", "reactivateFrozenCandidates", "emitRecallEvents"],
    tools: ["db.query", "candidate.reflux"],
    model: "claude-haiku-4-5",
  },
  {
    id: "10-2",
    name: "matchResume",
    title: "Match Resume",
    description: "Runs redline + blacklist + hard-requirements + bonus scoring + reflux cooldown checks.",
    actor: "Agent",
    stage: 5,
    triggers: ["RESUME_PROCESSED"],
    emits: ["MATCH_PASSED_NEED_INTERVIEW", "MATCH_PASSED_NO_INTERVIEW", "MATCH_FAILED"],
    steps: ["validateRedlineAndBlacklist", "matchHardRequirements", "evaluateBonusAndCheckReflux", "generateMatchResult"],
    tools: ["db.query", "scoring.match", "blacklist.lookup"],
    model: "claude-sonnet-4-5",
  },
  {
    id: "11-1",
    name: "inviteInternalInterview",
    title: "Invite AI Interview",
    description: "Generates personalized invite, sends email, notifies recruiter for follow-up.",
    actor: "Agent",
    stage: 5,
    triggers: ["MATCH_PASSED_NEED_INTERVIEW"],
    emits: ["INTERVIEW_INVITATION_SENT"],
    steps: ["generateInterviewInvitation", "sendInvitationEmail", "notifyRecruiter"],
    tools: ["email.send", "wechat.notify"],
    model: "claude-haiku-4-5",
  },
  {
    id: "11-2",
    name: "interviewExecution",
    title: "AI Interview Execution",
    description: "Candidate completes the AI interview through the provided link.",
    actor: "Human",
    stage: 5,
    triggers: ["INTERVIEW_INVITATION_SENT"],
    emits: ["AI_INTERVIEW_COMPLETED"],
  },
  {
    id: "12",
    name: "evaluateInterview",
    title: "Evaluate Interview",
    description: "Transcribes, scores against rubric, generates evaluation report.",
    actor: "Agent",
    stage: 5,
    triggers: ["AI_INTERVIEW_COMPLETED"],
    emits: ["EVALUATION_PASSED", "EVALUATION_FAILED"],
    steps: ["receiveInterviewResult", "analyzeInterviewResult", "evaluateWithModel", "generateEvaluationReport"],
    tools: ["asr.transcribe", "llm.evaluate", "scoring.rubric"],
    model: "claude-sonnet-4-5",
  },
  {
    id: "13",
    name: "refineResume",
    title: "Refine Resume",
    description: "Re-templates resume per client, highlights matching keywords, exports PDF.",
    actor: "Agent",
    stage: 6,
    triggers: ["EVALUATION_PASSED", "MATCH_PASSED_NO_INTERVIEW"],
    emits: ["RESUME_OPTIMIZED"],
    steps: ["selectTemplateAndFormat", "generateRefinedResume"],
    tools: ["template.render", "pdf.export"],
    model: "claude-sonnet-4-5",
  },
  {
    id: "14-1",
    name: "generateRecommendationPackage",
    title: "Generate Recommendation Package",
    description: "Assembles resume + eval + highlights + compliance docs; flags missing items.",
    actor: "Agent",
    stage: 6,
    triggers: ["RESUME_OPTIMIZED"],
    emits: ["PACKAGE_GENERATED", "PACKAGE_MISSING_INFO"],
    steps: ["assemblePackageMaterials", "checkCompleteness", "requestMissingInfo", "generateFinalPackage"],
    tools: ["pdf.compose", "compliance.check"],
    model: "claude-sonnet-4-5",
  },
  {
    id: "14-2",
    name: "packageSupplement",
    title: "Supplement Package Info",
    description: "Recruiter collects missing portfolio / compliance items from candidate.",
    actor: "Human",
    stage: 6,
    triggers: ["PACKAGE_MISSING_INFO"],
    emits: ["RESUME_OPTIMIZED"],
  },
  {
    id: "15",
    name: "packageReview",
    title: "Package Review",
    description: "HSM approves the assembled recommendation package.",
    actor: "Human",
    stage: 6,
    triggers: ["PACKAGE_GENERATED"],
    emits: ["PACKAGE_APPROVED"],
  },
  {
    id: "16",
    name: "submitToClientPortal",
    title: "Submit to Client Portal",
    description: "Auto-submits to client ATS where possible; otherwise generates a guided manual task.",
    actor: "Agent",
    stage: 7,
    triggers: ["PACKAGE_APPROVED"],
    emits: ["APPLICATION_SUBMITTED", "SUBMISSION_FAILED"],
    steps: ["prepareSubmissionData", "submitToClientSystem", "handleSubmissionResult"],
    tools: ["ats.adapter", "browser.automation"],
    model: "claude-sonnet-4-5",
  },
];

// All event types in the RAAS workflow
window.RAAS_EVENTS = [
  { name: "SCHEDULED_SYNC", category: "system", color: "muted" },
  { name: "REQUIREMENT_SYNCED", category: "data", color: "blue" },
  { name: "REQUIREMENT_LOGGED", category: "data", color: "blue" },
  { name: "SYNC_FAILED_ALERT", category: "alert", color: "red" },
  { name: "ANALYSIS_COMPLETED", category: "agent", color: "green" },
  { name: "ANALYSIS_BLOCKED", category: "alert", color: "amber" },
  { name: "CLARIFICATION_READY", category: "agent", color: "green" },
  { name: "CLARIFICATION_INCOMPLETE", category: "human", color: "amber" },
  { name: "CLARIFICATION_RETRY", category: "human", color: "blue" },
  { name: "JD_GENERATED", category: "agent", color: "green" },
  { name: "JD_APPROVED", category: "human", color: "green" },
  { name: "JD_REJECTED", category: "human", color: "amber" },
  { name: "TASK_ASSIGNED", category: "agent", color: "blue" },
  { name: "CHANNEL_PUBLISHED", category: "external", color: "green" },
  { name: "CHANNEL_PUBLISHED_FAILED", category: "alert", color: "red" },
  { name: "RESUME_DOWNLOADED", category: "human", color: "blue" },
  { name: "RESUME_PROCESSED", category: "agent", color: "green" },
  { name: "RESUME_LOCKED_CONFLICT", category: "alert", color: "amber" },
  { name: "RESUME_INFO_MISSING", category: "alert", color: "amber" },
  { name: "RESUME_PARSE_ERROR", category: "alert", color: "red" },
  { name: "MATCH_PASSED_NEED_INTERVIEW", category: "agent", color: "green" },
  { name: "MATCH_PASSED_NO_INTERVIEW", category: "agent", color: "green" },
  { name: "MATCH_FAILED", category: "agent", color: "muted" },
  { name: "INTERVIEW_INVITATION_SENT", category: "external", color: "blue" },
  { name: "AI_INTERVIEW_COMPLETED", category: "external", color: "green" },
  { name: "EVALUATION_PASSED", category: "agent", color: "green" },
  { name: "EVALUATION_FAILED", category: "agent", color: "muted" },
  { name: "RESUME_OPTIMIZED", category: "agent", color: "green" },
  { name: "PACKAGE_GENERATED", category: "agent", color: "green" },
  { name: "PACKAGE_MISSING_INFO", category: "alert", color: "amber" },
  { name: "PACKAGE_APPROVED", category: "human", color: "green" },
  { name: "APPLICATION_SUBMITTED", category: "external", color: "green" },
  { name: "SUBMISSION_FAILED", category: "alert", color: "red" },
];

// Stage labels for the workflow canvas
window.RAAS_STAGES = [
  { id: 0, label: "Intake" },
  { id: 1, label: "Analyze" },
  { id: 2, label: "JD" },
  { id: 3, label: "Publish" },
  { id: 4, label: "Resume" },
  { id: 5, label: "Match & Interview" },
  { id: 6, label: "Package" },
  { id: 7, label: "Submit" },
];

// Mock candidates / requisitions used as "subjects" of runs
window.RAAS_REQS = [
  { id: "REQ-2041", title: "Senior Backend Engineer · WXG", client: "Tencent", city: "Shenzhen", level: "T7", openings: 3 },
  { id: "REQ-2039", title: "Data Platform PM · CSIG", client: "Tencent", city: "Beijing", level: "T8", openings: 1 },
  { id: "REQ-2037", title: "iOS Engineer · IEG", client: "Tencent", city: "Shanghai", level: "T6", openings: 2 },
  { id: "REQ-2033", title: "Growth Designer · PCG", client: "Tencent", city: "Shenzhen", level: "T6", openings: 1 },
  { id: "REQ-2028", title: "ML Researcher · TEG", client: "Tencent", city: "Beijing", level: "T9", openings: 2 },
  { id: "REQ-2024", title: "Frontend Engineer · WXG", client: "Tencent", city: "Guangzhou", level: "T6", openings: 4 },
];

window.RAAS_CANDIDATES = [
  { id: "CAN-88412", name: "Zhao Wenjun", role: "Backend Engineer", years: 6, school: "ZJU" },
  { id: "CAN-88407", name: "Liang Yifei", role: "Product Manager", years: 8, school: "Tsinghua" },
  { id: "CAN-88401", name: "Chen Haoran", role: "iOS Engineer", years: 5, school: "Fudan" },
  { id: "CAN-88394", name: "Wu Mengxi", role: "Designer", years: 4, school: "CAFA" },
  { id: "CAN-88388", name: "Sun Jiacheng", role: "ML Engineer", years: 9, school: "PKU" },
  { id: "CAN-88382", name: "Lin Xueying", role: "Frontend Engineer", years: 3, school: "BUPT" },
  { id: "CAN-88377", name: "Hu Zixuan", role: "Backend Engineer", years: 7, school: "SJTU" },
  { id: "CAN-88369", name: "Ma Qiwen", role: "Designer", years: 6, school: "CAA" },
];

// ---------- Mock runs ----------
// A "run" is one invocation of an agent in response to an event.
// We synthesize ~80 runs in various states across the last hour.

function uid(prefix, n) { return prefix + "-" + String(n).padStart(5, "0"); }

window.RAAS_RUNS = (function () {
  const agents = window.RAAS_AGENTS;
  const reqs = window.RAAS_REQS;
  const cands = window.RAAS_CANDIDATES;
  const now = Date.now();
  const runs = [];
  // Seeded pseudo-random for stability
  let seed = 42;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  // Active running: a handful
  const activeAgents = ["10-2", "9-1", "12", "14-1", "16", "7-1", "2"];
  activeAgents.forEach((aid, i) => {
    const a = agents.find(x => x.id === aid);
    const startedAt = now - (Math.floor(rnd() * 90_000) + 5_000);
    runs.push({
      id: uid("run", 1000 + i),
      agentId: a.id,
      agentName: a.name,
      agentTitle: a.title,
      actor: a.actor,
      status: "running",
      startedAt,
      endedAt: null,
      durationMs: now - startedAt,
      triggerEvent: a.triggers[0],
      subject: a.id.startsWith("1") || a.id === "2" || a.id === "3" || a.id === "4" || a.id === "5" || a.id === "6" || a.id === "7-1"
        ? pick(reqs).id
        : pick(cands).id,
      steps: (a.steps || []).map((s, si) => ({
        name: s,
        status: si < ((a.steps || []).length - 1) ? "ok" : "running",
        startedAt: startedAt + si * 4000,
        durationMs: si < ((a.steps || []).length - 1) ? 1200 + Math.floor(rnd() * 3000) : null,
      })),
      tokensIn: 1200 + Math.floor(rnd() * 8000),
      tokensOut: 200 + Math.floor(rnd() * 1500),
      model: a.model,
    });
  });

  // Completed runs
  for (let i = 0; i < 60; i++) {
    const a = pick(agents.filter(x => x.actor === "Agent"));
    const dur = 800 + Math.floor(rnd() * 24_000);
    const endedAt = now - Math.floor(rnd() * 3_500_000);
    const startedAt = endedAt - dur;
    const failed = rnd() < 0.08;
    runs.push({
      id: uid("run", 2000 + i),
      agentId: a.id,
      agentName: a.name,
      agentTitle: a.title,
      actor: "Agent",
      status: failed ? "failed" : "ok",
      startedAt,
      endedAt,
      durationMs: dur,
      triggerEvent: a.triggers[0],
      subject: pick([...reqs, ...cands]).id,
      emittedEvent: failed ? null : a.emits[0],
      error: failed ? pick([
        "ChannelAPI timeout after 30s",
        "RMS adapter: 401 invalid credentials",
        "PDF compose: missing portfolio reference",
        "LLM rate-limited (429), exhausted retries",
        "Lock conflict on CAN-88401: held by recruiter Wu Hao",
      ]) : null,
      steps: (a.steps || []).map((s, si) => ({
        name: s,
        status: (failed && si === (a.steps || []).length - 1) ? "failed" : "ok",
        startedAt: startedAt + si * (dur / Math.max(1, (a.steps || []).length)),
        durationMs: Math.floor(dur / Math.max(1, (a.steps || []).length)),
      })),
      tokensIn: 800 + Math.floor(rnd() * 6000),
      tokensOut: 100 + Math.floor(rnd() * 1200),
      model: a.model,
    });
  }

  // Paused-awaiting-human (these are NOT runs, but we surface as pending tasks)
  return runs.sort((a, b) => b.startedAt - a.startedAt);
})();

// ---------- Mock event stream ----------
// Events emitted over the past hour, ordered newest-first.
window.RAAS_EVENT_STREAM = (function () {
  const events = window.RAAS_EVENTS;
  const agents = window.RAAS_AGENTS;
  const reqs = window.RAAS_REQS;
  const cands = window.RAAS_CANDIDATES;
  const now = Date.now();
  const stream = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  for (let i = 0; i < 140; i++) {
    const ev = pick(events);
    const sourceAgent = agents.find(a => a.emits.includes(ev.name));
    const downstreamAgents = agents.filter(a => a.triggers.includes(ev.name));
    stream.push({
      id: uid("evt", 10000 + i),
      name: ev.name,
      category: ev.category,
      color: ev.color,
      at: now - Math.floor(rnd() * 3_600_000),
      source: sourceAgent ? sourceAgent.id : "external",
      sourceTitle: sourceAgent ? sourceAgent.title : "External",
      downstream: downstreamAgents.map(a => a.id),
      subject: ev.name.startsWith("RESUME") || ev.name.startsWith("MATCH") || ev.name.startsWith("EVALUATION") || ev.name.startsWith("PACKAGE") || ev.name.startsWith("INTERVIEW") || ev.name.startsWith("APPLICATION") || ev.name.startsWith("AI_") || ev.name.startsWith("SUBMISSION")
        ? pick(cands).id
        : pick(reqs).id,
      payloadBytes: 120 + Math.floor(rnd() * 4800),
    });
  }
  return stream.sort((a, b) => b.at - a.at);
})();

// ---------- Mock human tasks ----------
window.RAAS_TASKS = [
  {
    id: "TASK-9012",
    type: "jdReview",
    title: "Review JD: Senior Backend Engineer · WXG",
    agentId: "5",
    awaitingFrom: "Delivery Manager · Liu Wei",
    subject: "REQ-2041",
    createdAt: Date.now() - 18 * 60_000,
    priority: "high",
    payload: {
      title: "Senior Backend Engineer (Java/Go) — Tencent WeChat Group",
      level: "T7",
      city: "Shenzhen",
      salary: "¥45-65k × 14 months",
      responsibilities: [
        "Design and own core messaging infrastructure serving 1B+ DAU",
        "Drive availability, latency and capacity goals across services",
        "Mentor mid-level engineers; raise the bar on code review and design review",
      ],
      requirements: [
        "5+ years backend experience, at minimum one of Java / Go in production",
        "Distributed systems fundamentals: consistency, replication, queues",
        "Strong communication; comfortable with ambiguous, cross-team work",
      ],
    },
  },
  {
    id: "TASK-9011",
    type: "packageReview",
    title: "Approve package: Zhao Wenjun → REQ-2041",
    agentId: "15",
    awaitingFrom: "HSM · Chen Mengjie",
    subject: "CAN-88412",
    createdAt: Date.now() - 7 * 60_000,
    priority: "high",
    payload: {
      candidate: "Zhao Wenjun",
      matchScore: 87,
      missingItems: [],
      highlights: ["6yr Java/Go, ex-Meituan core search", "Led 200-QPS → 8k-QPS migration"],
    },
  },
  {
    id: "TASK-9010",
    type: "resumeFix",
    title: "Resume parse error: CAN-88394",
    agentId: "9-2",
    awaitingFrom: "Recruiter · Wu Hao",
    subject: "CAN-88394",
    createdAt: Date.now() - 41 * 60_000,
    priority: "med",
    payload: { error: "OCR: scanned PDF, layout columns merged. Please re-export or re-upload.", file: "wu_mengxi_resume.pdf" },
  },
  {
    id: "TASK-9009",
    type: "requirementReClarification",
    title: "Re-clarify with client: REQ-2028 (ML Researcher)",
    agentId: "3-2",
    awaitingFrom: "Delivery Manager · Liu Wei",
    subject: "REQ-2028",
    createdAt: Date.now() - 92 * 60_000,
    priority: "med",
    payload: {
      questions: [
        "Required: NeurIPS/ICML first-author papers, or sufficient if cited?",
        "Hard cap on years of experience? Open to recent PhD with 2 yrs internship?",
        "Is Beijing relocation supported or must be in-region already?",
      ],
    },
  },
  {
    id: "TASK-9008",
    type: "packageSupplement",
    title: "Supplement package: portfolio missing for CAN-88394",
    agentId: "14-2",
    awaitingFrom: "Recruiter · Wu Hao",
    subject: "CAN-88394",
    createdAt: Date.now() - 130 * 60_000,
    priority: "low",
    payload: { missing: ["portfolio.pdf", "design_case_study.pdf"] },
  },
  {
    id: "TASK-9007",
    type: "manualPublish",
    title: "Manual publish to BOSS Zhipin: REQ-2037",
    agentId: "7-2",
    awaitingFrom: "Recruiter · Wu Hao",
    subject: "REQ-2037",
    createdAt: Date.now() - 175 * 60_000,
    priority: "low",
    payload: { channel: "BOSS Zhipin", reason: "No API; helper page generated" },
  },
];

// ---------- Mock log lines for a sample run ----------
window.RAAS_SAMPLE_LOG = `
2026-05-16T08:14:02.001Z  INFO   run.start  run_id=run-01000 agent=matchResume subject=CAN-88412 trigger=RESUME_PROCESSED
2026-05-16T08:14:02.014Z  DEBUG  ctx.load   loaded job_requisition=REQ-2041 candidate=CAN-88412
2026-05-16T08:14:02.018Z  INFO   step.start name=validateRedlineAndBlacklist
2026-05-16T08:14:02.094Z  DEBUG  tool       blacklist.lookup status=ok hits=0
2026-05-16T08:14:02.122Z  DEBUG  tool       db.query  table=ClientRedlines rows=14
2026-05-16T08:14:02.301Z  INFO   step.ok    name=validateRedlineAndBlacklist duration=283ms
2026-05-16T08:14:02.305Z  INFO   step.start name=matchHardRequirements
2026-05-16T08:14:02.418Z  DEBUG  llm        model=claude-sonnet-4-5 in=4128 out=612 ms=2104
2026-05-16T08:14:04.522Z  INFO   step.ok    name=matchHardRequirements duration=2217ms passes=8 fails=0
2026-05-16T08:14:04.530Z  INFO   step.start name=evaluateBonusAndCheckReflux
2026-05-16T08:14:04.612Z  DEBUG  tool       db.query  table=CandidateRefluxHistory rows=2
2026-05-16T08:14:04.713Z  WARN   reflux     tencent_internal_history=true business=non-BPO cooling_period_remaining=0d
2026-05-16T08:14:04.812Z  INFO   step.ok    name=evaluateBonusAndCheckReflux duration=282ms bonus_score=12 reflux_block=false
2026-05-16T08:14:04.815Z  INFO   step.start name=generateMatchResult
2026-05-16T08:14:04.918Z  DEBUG  tool       scoring.match weighted=87 floor=70
2026-05-16T08:14:05.018Z  INFO   step.ok    name=generateMatchResult duration=203ms match_score=87 recommendation=interview
2026-05-16T08:14:05.020Z  INFO   emit       event=MATCH_PASSED_NEED_INTERVIEW dest=inviteInternalInterview
2026-05-16T08:14:05.022Z  INFO   run.end    run_id=run-01000 status=ok duration=3021ms tokens_in=4128 tokens_out=612
`.trim();

// ---------- Deployments ----------
window.RAAS_DEPLOYMENTS = [
  { id: "dpl-481", version: "raas@2026.05.16-a", agent: "matchResume",      status: "live",     by: "Liu Wei",  at: Date.now() - 5 * 60_000,     note: "Tighten reflux cooldown calc; +bonus weights for WXG" },
  { id: "dpl-480", version: "raas@2026.05.16",   agent: "matchResume",      status: "rolled-back", by: "Liu Wei",  at: Date.now() - 22 * 60_000,    note: "Reverted: over-aggressive reflux block" },
  { id: "dpl-479", version: "raas@2026.05.15-c", agent: "createJD",         status: "live",     by: "Chen Mengjie", at: Date.now() - 6 * 3600_000,   note: "New JD template for WXG; richer responsibilities" },
  { id: "dpl-478", version: "raas@2026.05.15-b", agent: "evaluateInterview",status: "live",     by: "Liu Wei",  at: Date.now() - 9 * 3600_000,   note: "Add cultural-fit rubric dimension" },
  { id: "dpl-477", version: "raas@2026.05.15-a", agent: "syncFromClientSystem", status: "live", by: "Ops",      at: Date.now() - 20 * 3600_000,  note: "RMS adapter v3: handle deleted reqs" },
  { id: "dpl-476", version: "raas@2026.05.14",   agent: "processResume",    status: "live",     by: "Ops",      at: Date.now() - 38 * 3600_000,  note: "OCR fallback chain (Tesseract → Vision API)" },
];

// ---------- Tenants ----------
window.TENANTS = [
  { id: "raas", name: "RAAS", subtitle: "Recruitment-as-a-Service", color: "#d0ff00", active: true, agentCount: 22, runs24h: 1842 },
  { id: "support", name: "SupportFlow", subtitle: "Tier-1 ticket triage", color: "#7c9eff", active: false, agentCount: 11, runs24h: 312 },
  { id: "finance", name: "FinanceClose", subtitle: "Monthly close orchestration", color: "#f5c46b", active: false, agentCount: 8, runs24h: 47 },
];

// ---------- Augment all agents with the v2 rich-spec properties ----------
// Adds `input_data`, `ontology_instructions`, `tool_use`, `typescript_code` to every
// agent in window.RAAS_AGENTS. Agents that already define a property keep it.
window.RAAS_AGENTS.forEach((a) => {
  if (!("input_data" in a)) a.input_data = sampleInputDataFor(a);
  if (!("ontology_instructions" in a)) a.ontology_instructions = sampleOntologyFor(a);
  if (!("tool_use" in a)) a.tool_use = sampleToolUseFor(a);
  if (!("typescript_code" in a)) a.typescript_code = sampleTypeScriptFor(a);
});

function sampleInputDataFor(a) {
  // Sketch a representative input payload based on stage + actor
  if (a.actor === "Human") {
    return {
      task_id: "TASK-9001",
      assignee: "Liu Wei",
      subject_id: a.stage <= 2 ? "REQ-2041" : "CAN-88412",
      due_at: "2026-05-18T17:00:00Z",
    };
  }
  if (a.stage <= 2) {
    return {
      job_requisition_id: "REQ-2041",
      client_id: "Tencent",
      tenant: "raas",
      trigger_event: a.triggers[0] || null,
      correlation_id: "corr_2026_05_18_001",
    };
  }
  if (a.stage <= 3) {
    return {
      job_requisition_id: "REQ-2041",
      client_id: "Tencent",
      recruiter_id: "U-WUHAO",
      channels: ["Zhilian", "Liepin", "BOSS"],
      trigger_event: a.triggers[0] || null,
    };
  }
  return {
    candidate_id: "CAN-88412",
    job_requisition_id: "REQ-2041",
    client_id: "Tencent",
    tenant: "raas",
    trigger_event: a.triggers[0] || null,
    correlation_id: "corr_2026_05_18_001",
  };
}

function sampleOntologyFor(a) {
  return `# ${a.title} · ontology

## Entities you may reference
- Job_Requisition (REQ-XXXX) — open client roles
- Candidate (CAN-XXXXX) — sourced candidates
- Client (e.g. Tencent) — contracted hiring partner
- Client_Preference — per-client preferred/forbidden criteria
- HRO_Service_Contract — billing & SLA terms with the client

## Domain vocabulary
- 红线 / "redline": hard-fail criteria a candidate must not violate (client-defined).
- 回流 / "reflux": candidate has prior employment with this client; subject to cooldown.
- BPO vs 非BPO: business-line distinction for reflux cooldowns.
- HC冻结 / "HC freeze": role-level pause; not a candidate-quality signal.

## Hard rules
1. Never write gender, age or marital status into outbound JD or external messages.
2. Mask candidate phone/ID-card in any non-recruiter-facing surface.
3. If a candidate is on a client blacklist, halt and emit MATCH_FAILED with reason="blacklist".
4. Confidence < 0.70 → defer to human review instead of auto-approving.

## When in doubt
Emit a HUMAN_TASK event with the ambiguity captured in payload.notes
rather than guessing. Cost of a false-positive is higher than a delay.`;
}

function sampleToolUseFor(a) {
  if (a.actor === "Human") return [];
  // Build a small tool_use list from the agent's declared tools
  const ts = (a.tools || []).slice(0, 4);
  return ts.map((t) => {
    const n = t.replace(/\W+/g, "_");
    return {
      name: n,
      description: `Wraps the ${t} runtime tool. Use to ${toolPurpose(t)}.`,
      input_schema: {
        type: "object",
        properties: toolSchemaFor(t),
        required: ["subject_id"],
      },
    };
  });
}

function toolPurpose(t) {
  const m = {
    "db.query": "fetch rows from the run-state database",
    "db.upsert": "write or update rows in the run-state database",
    "db.lock":   "acquire a distributed lock on a subject",
    "db.update": "update an existing row",
    "http.fetch":"make an HTTP request with retry & timeout",
    "llm.generate":"make a direct LLM call (escape hatch — prefer typed helpers)",
    "llm.evaluate":"score an input against a rubric using an LLM judge",
    "scoring.match":"score a resume↔requisition match",
    "blacklist.lookup":"check candidate against client blacklists",
    "ocr.parse":"extract text + structure from a PDF",
    "nlp.extract":"extract entities / typed fields from text",
    "pdf.compose":"render markdown into a PDF",
    "pdf.export":"serialize a candidate package into PDF",
    "compliance.check":"verify a package meets client compliance rules",
    "email.send":"send transactional email",
    "wechat.notify":"send a WeChat Work bot message",
    "ats.adapter":"submit a candidate package to a client ATS",
    "browser.automation":"drive a headless browser when no API exists",
    "rms.adapter":"talk to a client requisition system",
    "history.stats":"fetch historical sourcing stats",
    "market.lookup":"fetch market salary / talent supply data",
    "candidate.reflux":"check candidate reflux history",
    "template.load":"load a structured template",
    "template.render":"render a template with run data",
    "notify.recruit-ide":"send a task to the recruiter IDE",
    "asr.transcribe":"transcribe audio to text",
    "scoring.rubric":"score against a rubric",
    "zhilian.api":"publish/fetch on Zhilian",
    "liepin.api":"publish/fetch on Liepin",
    "boss.helper-render":"render a paste-ready BOSS Zhipin posting helper",
  };
  return m[t] || `invoke ${t}`;
}

function toolSchemaFor(t) {
  // Default schema; specialize a few that commonly appear
  if (t.startsWith("db.")) {
    return {
      subject_id: { type: "string", description: "RAAS entity id (REQ-* or CAN-*)" },
      table:      { type: "string", description: "Run-state table name" },
      where:      { type: "object", description: "Optional filter clauses" },
    };
  }
  if (t === "blacklist.lookup") {
    return {
      subject_id:  { type: "string", description: "Candidate id, e.g. CAN-88412" },
      client_id:   { type: "string", description: "Client id, e.g. Tencent" },
    };
  }
  if (t === "scoring.match") {
    return {
      subject_id: { type: "string", description: "Candidate id" },
      jd_id:      { type: "string", description: "Job requisition id" },
      weights:    { type: "object", description: "Optional weight overrides" },
    };
  }
  if (t === "http.fetch") {
    return {
      subject_id: { type: "string", description: "Correlation id for logging" },
      url:        { type: "string" },
      method:     { type: "string", enum: ["GET","POST","PUT","DELETE"] },
      body:       { type: "object" },
    };
  }
  return {
    subject_id: { type: "string", description: "Correlation id" },
    payload:    { type: "object", description: "Tool-specific input" },
  };
}

function sampleTypeScriptFor(a) {
  if (a.actor === "Human") return null;
  const emits = (a.emits || []).slice(0, 2);
  const firstEmit = emits[0] || "EVENT_DONE";
  return `import { defineAgent } from "@agentic/runtime";

/**
 * ${a.name} — ${a.title}
 *
 * ${a.description}
 *
 * Triggered by: ${(a.triggers || []).join(", ") || "manual"}
 * Emits:        ${(a.emits || []).join(", ") || "—"}
 */
export const ${a.name} = defineAgent({
  name: "${a.name}",
  model: "${a.model || "claude-sonnet-4-5"}",

  async run(ctx, input) {
${(a.steps || ["doWork"]).map((s, i) => `    // ${i + 1}. ${s}
    const r${i} = await ctx.use("${(a.tools || ["llm.generate"])[i % Math.max(1, (a.tools || []).length || 1)]}", {
      subject_id: input.candidate_id ?? input.job_requisition_id,
    });`).join("\n\n")}

    return ctx.emit("${firstEmit}", {
      subject_id: input.candidate_id ?? input.job_requisition_id,
      ok: true,
    });
  },
});
`;
}

console.log("[Agentic Operator] RAAS data loaded:",
  window.RAAS_AGENTS.length, "agents,",
  window.RAAS_EVENTS.length, "event types,",
  window.RAAS_RUNS.length, "runs,",
  window.RAAS_EVENT_STREAM.length, "events,",
  window.RAAS_TASKS.length, "tasks");
