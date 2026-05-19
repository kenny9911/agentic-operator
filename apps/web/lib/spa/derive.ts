/**
 * Derivation helpers shared across data sources.
 *
 * Workflow JSON gives us the agents + events graph. The v1_1 SPA needs richer
 * shapes (stage index, title, runs, tasks, event stream, etc.) which we
 * compute here so JSON and Neo4j sources can both reuse the logic.
 */

import type {
  SpaAgent,
  SpaCandidate,
  SpaDeployment,
  SpaEvent,
  SpaEventStreamItem,
  SpaReq,
  SpaRun,
  SpaStage,
  SpaTask,
  SpaTenant,
} from "./types";

export const STAGES: SpaStage[] = [
  { id: 0, label: "Intake" },
  { id: 1, label: "Analyze" },
  { id: 2, label: "JD" },
  { id: 3, label: "Publish" },
  { id: 4, label: "Resume" },
  { id: 5, label: "Match & Interview" },
  { id: 6, label: "Package" },
  { id: 7, label: "Submit" },
];

export function stageFromId(id: string): number {
  const m = id.match(/^(\d+)/);
  const n = m && m[1] ? parseInt(m[1], 10) : 0;
  if (n <= 1) return 0;
  if (n <= 3) return 1;
  if (n <= 5) return 2;
  if (n <= 7) return 3;
  if (n <= 9) return 4;
  if (n <= 12) return 5;
  if (n <= 15) return 6;
  return 7;
}

export function titleFromName(name: string): string {
  if (!name) return "";
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

export function deriveEventCategory(name: string): string {
  if (/_FAILED$|_ALERT$|_ERROR$|_CONFLICT$|PARSE_ERROR$|_BLOCKED$/.test(name))
    return "alert";
  if (
    /_INCOMPLETE$|_RETRY$|_MISSING|_LOGGED$|_DOWNLOADED$|_APPROVED$|_REJECTED$/.test(
      name,
    )
  )
    return "human";
  if (
    /_SUBMITTED$|_PUBLISHED$|INVITATION_SENT$|AI_INTERVIEW_COMPLETED$/.test(name)
  )
    return "external";
  if (/^SCHEDULED_/.test(name)) return "system";
  if (/_SYNCED$/.test(name)) return "data";
  return "agent";
}

export function deriveEventColor(name: string): string {
  if (/_FAILED$|_ALERT$|_ERROR$|PARSE_ERROR$/.test(name)) return "red";
  if (/_INCOMPLETE$|_MISSING|_CONFLICT$|_BLOCKED$|_REJECTED$/.test(name))
    return "amber";
  if (
    /_COMPLETED$|_READY$|_PASSED$|_APPROVED$|_GENERATED$|_OPTIMIZED$|_SUBMITTED$|_PUBLISHED$/.test(
      name,
    )
  )
    return "green";
  if (/_LOGGED$|_SYNCED$|_RETRY$|_DOWNLOADED$|_ASSIGNED$|INVITATION_SENT$/.test(name))
    return "blue";
  if (/_FAILED$|^SCHEDULED_/.test(name)) return "muted";
  return "muted";
}

/** Collect every event name referenced by any agent's trigger / triggered_event. */
export function collectEvents(agents: SpaAgent[]): SpaEvent[] {
  const set = new Set<string>();
  for (const a of agents) {
    a.triggers.forEach((e) => set.add(e));
    a.emits.forEach((e) => set.add(e));
  }
  return Array.from(set)
    .sort()
    .map((name) => ({
      name,
      category: deriveEventCategory(name),
      color: deriveEventColor(name),
    }));
}

// ─── Sample subjects (stable, used to seed runs/events/tasks) ────────────────

export const SAMPLE_REQS: SpaReq[] = [
  {
    id: "REQ-2041",
    title: "Senior Backend Engineer · WXG",
    client: "Tencent",
    city: "Shenzhen",
    level: "T7",
    openings: 3,
  },
  {
    id: "REQ-2039",
    title: "Data Platform PM · CSIG",
    client: "Tencent",
    city: "Beijing",
    level: "T8",
    openings: 1,
  },
  {
    id: "REQ-2037",
    title: "iOS Engineer · IEG",
    client: "Tencent",
    city: "Shanghai",
    level: "T6",
    openings: 2,
  },
  {
    id: "REQ-2033",
    title: "Growth Designer · PCG",
    client: "Tencent",
    city: "Shenzhen",
    level: "T6",
    openings: 1,
  },
  {
    id: "REQ-2028",
    title: "ML Researcher · TEG",
    client: "Tencent",
    city: "Beijing",
    level: "T9",
    openings: 2,
  },
  {
    id: "REQ-2024",
    title: "Frontend Engineer · WXG",
    client: "Tencent",
    city: "Guangzhou",
    level: "T6",
    openings: 4,
  },
];

export const SAMPLE_CANDIDATES: SpaCandidate[] = [
  { id: "CAN-88412", name: "Zhao Wenjun", role: "Backend Engineer", years: 6, school: "ZJU" },
  { id: "CAN-88407", name: "Liang Yifei", role: "Product Manager", years: 8, school: "Tsinghua" },
  { id: "CAN-88401", name: "Chen Haoran", role: "iOS Engineer", years: 5, school: "Fudan" },
  { id: "CAN-88394", name: "Wu Mengxi", role: "Designer", years: 4, school: "CAFA" },
  { id: "CAN-88388", name: "Sun Jiacheng", role: "ML Engineer", years: 9, school: "PKU" },
  { id: "CAN-88382", name: "Lin Xueying", role: "Frontend Engineer", years: 3, school: "BUPT" },
  { id: "CAN-88377", name: "Hu Zixuan", role: "Backend Engineer", years: 7, school: "SJTU" },
  { id: "CAN-88369", name: "Ma Qiwen", role: "Designer", years: 6, school: "CAA" },
];

export const SAMPLE_TENANTS: SpaTenant[] = [
  {
    id: "raas",
    name: "RAAS",
    subtitle: "Recruitment-as-a-Service",
    color: "#d0ff00",
    active: true,
    agentCount: 0,
    runs24h: 1842,
  },
  {
    id: "support",
    name: "SupportFlow",
    subtitle: "Tier-1 ticket triage",
    color: "#7c9eff",
    active: false,
    agentCount: 11,
    runs24h: 312,
  },
  {
    id: "finance",
    name: "FinanceClose",
    subtitle: "Monthly close orchestration",
    color: "#f5c46b",
    active: false,
    agentCount: 8,
    runs24h: 47,
  },
];

// ─── Synthesized runtime data (when no DB-backed runs are available) ─────────
// These mirror the synthesis in agentic-operator_v1_1/data.js so the SPA has
// representative content. Once the real backend runs feed into here, this
// block can be replaced with DB queries.

function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function uid(prefix: string, n: number) {
  return prefix + "-" + String(n).padStart(5, "0");
}

export function synthesizeRuns(
  agents: SpaAgent[],
  reqs: SpaReq[],
  candidates: SpaCandidate[],
): SpaRun[] {
  const now = Date.now();
  const rnd = makeRng(42);
  const pick = <T>(arr: T[]) => arr[Math.floor(rnd() * arr.length)]!;
  const runs: SpaRun[] = [];

  const activeAgentIds = [
    "10-2",
    "9-1",
    "12",
    "14-1",
    "16",
    "7-1",
    "2",
  ].filter((id) => agents.some((a) => a.id === id));

  activeAgentIds.forEach((aid, i) => {
    const a = agents.find((x) => x.id === aid);
    if (!a) return;
    const startedAt = now - (Math.floor(rnd() * 90_000) + 5_000);
    const isReqSubject = a.stage <= 3;
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
      triggerEvent: a.triggers[0] ?? null,
      subject: isReqSubject ? pick(reqs).id : pick(candidates).id,
      steps: a.steps.map((s, si) => ({
        name: s,
        status: si < a.steps.length - 1 ? "ok" : "running",
        startedAt: startedAt + si * 4000,
        durationMs: si < a.steps.length - 1 ? 1200 + Math.floor(rnd() * 3000) : null,
      })),
      tokensIn: 1200 + Math.floor(rnd() * 8000),
      tokensOut: 200 + Math.floor(rnd() * 1500),
      model: a.model,
    });
  });

  const agentActors = agents.filter((x) => x.actor === "Agent");
  if (agentActors.length === 0) return runs.sort((a, b) => (b.startedAt as number) - (a.startedAt as number));

  const errSamples = [
    "ChannelAPI timeout after 30s",
    "RMS adapter: 401 invalid credentials",
    "PDF compose: missing portfolio reference",
    "LLM rate-limited (429), exhausted retries",
    "Lock conflict on CAN-88401: held by recruiter Wu Hao",
  ];

  for (let i = 0; i < 60; i++) {
    const a = pick(agentActors);
    const dur = 800 + Math.floor(rnd() * 24_000);
    const endedAt = now - Math.floor(rnd() * 3_500_000);
    const startedAt = endedAt - dur;
    const failed = rnd() < 0.08;
    const subjects = [...reqs, ...candidates];
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
      triggerEvent: a.triggers[0] ?? null,
      subject: pick(subjects).id,
      emittedEvent: failed ? null : a.emits[0] ?? null,
      error: failed ? pick(errSamples) : null,
      steps: a.steps.map((s, si) => ({
        name: s,
        status: failed && si === a.steps.length - 1 ? "failed" : "ok",
        startedAt: startedAt + si * (dur / Math.max(1, a.steps.length)),
        durationMs: Math.floor(dur / Math.max(1, a.steps.length)),
      })),
      tokensIn: 800 + Math.floor(rnd() * 6000),
      tokensOut: 100 + Math.floor(rnd() * 1200),
      model: a.model,
    });
  }

  return runs.sort((a, b) => (b.startedAt as number) - (a.startedAt as number));
}

export function synthesizeEventStream(
  events: SpaEvent[],
  agents: SpaAgent[],
  reqs: SpaReq[],
  candidates: SpaCandidate[],
): SpaEventStreamItem[] {
  const now = Date.now();
  const rnd = makeRng(7);
  const pick = <T>(arr: T[]) => arr[Math.floor(rnd() * arr.length)]!;
  const stream: SpaEventStreamItem[] = [];

  for (let i = 0; i < 140; i++) {
    const ev = pick(events);
    if (!ev) continue;
    const sourceAgent = agents.find((a) => a.emits.includes(ev.name));
    const downstreamAgents = agents.filter((a) => a.triggers.includes(ev.name));
    const isCandidateSubject =
      /^(RESUME|MATCH|EVALUATION|PACKAGE|INTERVIEW|APPLICATION|AI_|SUBMISSION)/.test(
        ev.name,
      );
    stream.push({
      id: uid("evt", 10000 + i),
      name: ev.name,
      category: ev.category,
      color: ev.color,
      at: now - Math.floor(rnd() * 3_600_000),
      source: sourceAgent?.id ?? "external",
      sourceTitle: sourceAgent?.title ?? "External",
      downstream: downstreamAgents.map((a) => a.id),
      subject: isCandidateSubject ? pick(candidates).id : pick(reqs).id,
      payloadBytes: 120 + Math.floor(rnd() * 4800),
    });
  }
  return stream.sort((a, b) => (b.at as number) - (a.at as number));
}

export function synthesizeTasks(agents: SpaAgent[]): SpaTask[] {
  // Build a small task inbox using human-actor agents in the workflow.
  const humanAgents = agents.filter((a) => a.actor === "Human");
  const byId = (id: string) => humanAgents.find((a) => a.id === id);

  const tasks: SpaTask[] = [];
  const now = Date.now();
  const push = (t: SpaTask) => {
    tasks.push(t);
  };

  if (byId("5"))
    push({
      id: "TASK-9012",
      type: "jdReview",
      title: "Review JD: Senior Backend Engineer · WXG",
      agentId: "5",
      awaitingFrom: "Delivery Manager · Liu Wei",
      subject: "REQ-2041",
      createdAt: now - 18 * 60_000,
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
    });

  if (byId("15"))
    push({
      id: "TASK-9011",
      type: "packageReview",
      title: "Approve package: Zhao Wenjun → REQ-2041",
      agentId: "15",
      awaitingFrom: "HSM · Chen Mengjie",
      subject: "CAN-88412",
      createdAt: now - 7 * 60_000,
      priority: "high",
      payload: {
        candidate: "Zhao Wenjun",
        matchScore: 87,
        missingItems: [],
        highlights: [
          "6yr Java/Go, ex-Meituan core search",
          "Led 200-QPS → 8k-QPS migration",
        ],
      },
    });

  if (byId("9-2"))
    push({
      id: "TASK-9010",
      type: "resumeFix",
      title: "Resume parse error: CAN-88394",
      agentId: "9-2",
      awaitingFrom: "Recruiter · Wu Hao",
      subject: "CAN-88394",
      createdAt: now - 41 * 60_000,
      priority: "med",
      payload: {
        error: "OCR: scanned PDF, layout columns merged. Please re-export or re-upload.",
        file: "wu_mengxi_resume.pdf",
      },
    });

  if (byId("3-2"))
    push({
      id: "TASK-9009",
      type: "requirementReClarification",
      title: "Re-clarify with client: REQ-2028 (ML Researcher)",
      agentId: "3-2",
      awaitingFrom: "Delivery Manager · Liu Wei",
      subject: "REQ-2028",
      createdAt: now - 92 * 60_000,
      priority: "med",
      payload: {
        questions: [
          "Required: NeurIPS/ICML first-author papers, or sufficient if cited?",
          "Hard cap on years of experience? Open to recent PhD with 2 yrs internship?",
          "Is Beijing relocation supported or must be in-region already?",
        ],
      },
    });

  if (byId("14-2"))
    push({
      id: "TASK-9008",
      type: "packageSupplement",
      title: "Supplement package: portfolio missing for CAN-88394",
      agentId: "14-2",
      awaitingFrom: "Recruiter · Wu Hao",
      subject: "CAN-88394",
      createdAt: now - 130 * 60_000,
      priority: "low",
      payload: { missing: ["portfolio.pdf", "design_case_study.pdf"] },
    });

  if (byId("7-2"))
    push({
      id: "TASK-9007",
      type: "manualPublish",
      title: "Manual publish to BOSS Zhipin: REQ-2037",
      agentId: "7-2",
      awaitingFrom: "Recruiter · Wu Hao",
      subject: "REQ-2037",
      createdAt: now - 175 * 60_000,
      priority: "low",
      payload: { channel: "BOSS Zhipin", reason: "No API; helper page generated" },
    });

  return tasks;
}

export const SAMPLE_LOG = `
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

// ─── Agent field synthesizers (used when workflow JSON leaves fields empty) ──
// Mirror the prototype's data.js so views render with representative content.
// Real values from workflow_v1.json always take precedence.

export function sampleInputDataFor(a: SpaAgent): Record<string, unknown> {
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
      trigger_event: a.triggers[0] ?? null,
      correlation_id: "corr_2026_05_18_001",
    };
  }
  if (a.stage <= 3) {
    return {
      job_requisition_id: "REQ-2041",
      client_id: "Tencent",
      recruiter_id: "U-WUHAO",
      channels: ["Zhilian", "Liepin", "BOSS"],
      trigger_event: a.triggers[0] ?? null,
    };
  }
  return {
    candidate_id: "CAN-88412",
    job_requisition_id: "REQ-2041",
    client_id: "Tencent",
    tenant: "raas",
    trigger_event: a.triggers[0] ?? null,
    correlation_id: "corr_2026_05_18_001",
  };
}

export function sampleOntologyFor(a: SpaAgent): string {
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

const TOOL_PURPOSE: Record<string, string> = {
  "db.query": "fetch rows from the run-state database",
  "db.upsert": "write or update rows in the run-state database",
  "db.lock": "acquire a distributed lock on a subject",
  "db.update": "update an existing row",
  "http.fetch": "make an HTTP request with retry & timeout",
  "llm.generate": "make a direct LLM call (escape hatch — prefer typed helpers)",
  "llm.evaluate": "score an input against a rubric using an LLM judge",
  "scoring.match": "score a resume↔requisition match",
  "blacklist.lookup": "check candidate against client blacklists",
  "ocr.parse": "extract text + structure from a PDF",
  "nlp.extract": "extract entities / typed fields from text",
  "pdf.compose": "render markdown into a PDF",
  "pdf.export": "serialize a candidate package into PDF",
  "compliance.check": "verify a package meets client compliance rules",
  "email.send": "send transactional email",
  "wechat.notify": "send a WeChat Work bot message",
  "ats.adapter": "submit a candidate package to a client ATS",
  "browser.automation": "drive a headless browser when no API exists",
  "rms.adapter": "talk to a client requisition system",
  "history.stats": "fetch historical sourcing stats",
  "market.lookup": "fetch market salary / talent supply data",
  "candidate.reflux": "check candidate reflux history",
  "template.load": "load a structured template",
  "template.render": "render a template with run data",
  "notify.recruit-ide": "send a task to the recruiter IDE",
  "asr.transcribe": "transcribe audio to text",
  "scoring.rubric": "score against a rubric",
  "zhilian.api": "publish/fetch on Zhilian",
  "liepin.api": "publish/fetch on Liepin",
  "boss.helper-render": "render a paste-ready BOSS Zhipin posting helper",
};

function toolSchemaFor(t: string) {
  if (t.startsWith("db.")) {
    return {
      subject_id: { type: "string", description: "RAAS entity id (REQ-* or CAN-*)" },
      table: { type: "string", description: "Run-state table name" },
      where: { type: "object", description: "Optional filter clauses" },
    };
  }
  if (t === "blacklist.lookup") {
    return {
      subject_id: { type: "string", description: "Candidate id, e.g. CAN-88412" },
      client_id: { type: "string", description: "Client id, e.g. Tencent" },
    };
  }
  if (t === "scoring.match") {
    return {
      subject_id: { type: "string", description: "Candidate id" },
      jd_id: { type: "string", description: "Job requisition id" },
      weights: { type: "object", description: "Optional weight overrides" },
    };
  }
  if (t === "http.fetch") {
    return {
      subject_id: { type: "string", description: "Correlation id for logging" },
      url: { type: "string" },
      method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"] },
      body: { type: "object" },
    };
  }
  return {
    subject_id: { type: "string", description: "Correlation id" },
    payload: { type: "object", description: "Tool-specific input" },
  };
}

const DEFAULT_TOOLS_BY_NAME: Record<string, string[]> = {
  syncFromClientSystem: ["http.fetch", "rms.adapter", "db.upsert"],
  analyzeRequirement: ["db.query", "market.lookup", "history.stats"],
  clarifyRequirement: ["notify.recruit-ide", "db.update"],
  createJD: ["llm.generate", "template.load"],
  assignRecruitTasks: ["db.query", "scoring.match"],
  publishJD: ["zhilian.api", "liepin.api", "boss.helper-render"],
  processResume: ["ocr.parse", "nlp.extract", "db.lock"],
  ruleCheckerForClientResume: ["db.query", "compliance.check"],
  matchResume: ["db.query", "scoring.match", "blacklist.lookup"],
  inviteInternalInterview: ["email.send", "wechat.notify"],
  evaluateInterview: ["asr.transcribe", "llm.evaluate", "scoring.rubric"],
  refineResume: ["template.render", "pdf.export"],
  generateRecommendationPackage: ["pdf.compose", "compliance.check"],
  submitToClientPortal: ["ats.adapter", "browser.automation"],
};

export function defaultToolsForAgent(a: SpaAgent): string[] {
  return DEFAULT_TOOLS_BY_NAME[a.name] ?? [];
}

export function sampleToolUseFor(a: SpaAgent): unknown {
  if (a.actor === "Human") return [];
  const tools = a.tools.length > 0 ? a.tools : defaultToolsForAgent(a);
  return tools.slice(0, 4).map((t) => {
    const n = t.replace(/\W+/g, "_");
    return {
      name: n,
      description: `Wraps the ${t} runtime tool. Use to ${TOOL_PURPOSE[t] ?? "invoke " + t}.`,
      input_schema: {
        type: "object",
        properties: toolSchemaFor(t),
        required: ["subject_id"],
      },
    };
  });
}

export function sampleTypeScriptFor(a: SpaAgent): string {
  if (a.actor === "Human") return "";
  const tools = a.tools.length > 0 ? a.tools : defaultToolsForAgent(a);
  const emits = (a.emits ?? []).slice(0, 2);
  const firstEmit = emits[0] ?? "EVENT_DONE";
  const steps = a.steps.length > 0 ? a.steps : ["doWork"];

  const stepsBody = steps
    .map((s, i) => {
      const tool = tools[i % Math.max(1, tools.length || 1)] ?? "llm.generate";
      return `    // ${i + 1}. ${s}\n    const r${i} = await ctx.use("${tool}", {\n      subject_id: input.candidate_id ?? input.job_requisition_id,\n    });`;
    })
    .join("\n\n");

  return `import { defineAgent } from "@agentic/runtime";

/**
 * ${a.name} — ${a.title}
 *
 * ${a.description}
 *
 * Triggered by: ${(a.triggers ?? []).join(", ") || "manual"}
 * Emits:        ${(a.emits ?? []).join(", ") || "—"}
 */
export const ${a.name} = defineAgent({
  name: "${a.name}",
  model: "${a.model || "claude-sonnet-4-5"}",

  async run(ctx, input) {
${stepsBody}

    return ctx.emit("${firstEmit}", {
      subject_id: input.candidate_id ?? input.job_requisition_id,
      ok: true,
    });
  },
});
`;
}

/** Apply synthesized fallbacks for fields the JSON leaves empty. */
export function enrichAgent(a: SpaAgent): SpaAgent {
  const isEmptyObject = (v: unknown) =>
    !v || (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);
  const isEmptyString = (v: unknown) => typeof v !== "string" || v.trim() === "";
  const isEmptyToolUse = (v: unknown) =>
    !v || (Array.isArray(v) && v.length === 0) || (typeof v === "string" && v.trim() === "");

  const enriched: SpaAgent = { ...a };
  if (a.tools.length === 0) enriched.tools = defaultToolsForAgent(a);
  if (isEmptyObject(a.input_data)) enriched.input_data = sampleInputDataFor(enriched);
  if (isEmptyString(a.ontology_instructions))
    enriched.ontology_instructions = sampleOntologyFor(enriched);
  if (isEmptyToolUse(a.tool_use)) enriched.tool_use = sampleToolUseFor(enriched);
  if (isEmptyString(a.typescript_code))
    enriched.typescript_code = sampleTypeScriptFor(enriched);
  return enriched;
}

export function synthesizeDeployments(agents: SpaAgent[]): SpaDeployment[] {
  const now = Date.now();
  const byName = (n: string) => agents.find((a) => a.name === n);
  const deps: SpaDeployment[] = [];
  const push = (
    id: string,
    version: string,
    agent: string,
    status: string,
    by: string,
    at: number,
    note: string,
  ) => {
    if (!byName(agent)) return;
    deps.push({ id, version, agent, status, by, at, note });
  };
  push(
    "dpl-481",
    "raas@2026.05.16-a",
    "matchResume",
    "live",
    "Liu Wei",
    now - 5 * 60_000,
    "Tighten reflux cooldown calc; +bonus weights for WXG",
  );
  push(
    "dpl-480",
    "raas@2026.05.16",
    "matchResume",
    "rolled-back",
    "Liu Wei",
    now - 22 * 60_000,
    "Reverted: over-aggressive reflux block",
  );
  push(
    "dpl-479",
    "raas@2026.05.15-c",
    "createJD",
    "live",
    "Chen Mengjie",
    now - 6 * 3600_000,
    "New JD template for WXG; richer responsibilities",
  );
  push(
    "dpl-478",
    "raas@2026.05.15-b",
    "evaluateInterview",
    "live",
    "Liu Wei",
    now - 9 * 3600_000,
    "Add cultural-fit rubric dimension",
  );
  push(
    "dpl-477",
    "raas@2026.05.15-a",
    "syncFromClientSystem",
    "live",
    "Ops",
    now - 20 * 3600_000,
    "RMS adapter v3: handle deleted reqs",
  );
  push(
    "dpl-476",
    "raas@2026.05.14",
    "processResume",
    "live",
    "Ops",
    now - 38 * 3600_000,
    "OCR fallback chain (Tesseract → Vision API)",
  );
  return deps;
}
