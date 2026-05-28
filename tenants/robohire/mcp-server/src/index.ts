/**
 * Mock RoboHire-flavored MCP server.
 *
 * Speaks the MCP stdio protocol (the same one @anthropic-ai/mcp-cli and
 * the cursor/Claude desktop clients consume) so the @agentic/mcp client
 * can stand it up locally, list tools, and call them via the standard
 * `tools/call` request.
 *
 * Tools exposed:
 *   - search_candidates    — fake candidate search keyed off a job title
 *   - score_resume         — pretend rubric score for a candidate vs a JD
 *   - get_job_requisition  — fake job-req detail lookup
 *
 * Returns are deterministic (seeded) so the integration test asserts
 * exact strings.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const SAMPLE_CANDIDATES = [
  {
    id: "cand_010",
    name: "Yuki Tanaka",
    title: "Senior Backend Engineer",
    location: "Tokyo, JP",
    years_experience: 8,
    skills: ["Go", "PostgreSQL", "Kubernetes", "gRPC"],
  },
  {
    id: "cand_021",
    name: "Mateo García",
    title: "Staff Software Engineer",
    location: "Barcelona, ES",
    years_experience: 11,
    skills: ["Python", "AWS", "MLOps", "Kafka"],
  },
  {
    id: "cand_034",
    name: "Aisha Patel",
    title: "Backend Tech Lead",
    location: "Remote (UK)",
    years_experience: 9,
    skills: ["TypeScript", "Postgres", "Kubernetes", "Distributed Systems"],
  },
];

const SAMPLE_JOBS = {
  jr_001: {
    id: "jr_001",
    title: "Senior Backend Engineer",
    department: "Platform",
    location: "Remote (global)",
    must_have: ["Distributed systems", "5+ yr backend", "Postgres or similar OLTP"],
    nice_to_have: ["Go", "Kubernetes operators", "Open-source maintainership"],
    headcount: 2,
  },
  jr_002: {
    id: "jr_002",
    title: "MLOps Engineer",
    department: "ML Platform",
    location: "Hybrid (NYC)",
    must_have: ["Python", "model deployment pipelines", "GPU infra"],
    nice_to_have: ["Kubeflow", "Triton Inference Server"],
    headcount: 1,
  },
};

const server = new Server(
  { name: "robohire-mock-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_candidates",
      description:
        "Search the (mock) RoboHire candidate database. Returns 3 deterministic sample candidates filtered loosely by the provided job_title token.",
      inputSchema: {
        type: "object",
        properties: {
          job_title: { type: "string", description: "Job title or keyword to match." },
          limit: { type: "number", description: "Max candidates to return.", default: 3 },
        },
        required: ["job_title"],
      },
    },
    {
      name: "score_resume",
      description:
        "Score one candidate against a job. Returns a deterministic rubric score 0-100 with category breakdown.",
      inputSchema: {
        type: "object",
        properties: {
          candidate_id: { type: "string" },
          job_requisition_id: { type: "string" },
        },
        required: ["candidate_id", "job_requisition_id"],
      },
    },
    {
      name: "get_job_requisition",
      description:
        "Fetch a mock job requisition by id. Returns must-have / nice-to-have lists.",
      inputSchema: {
        type: "object",
        properties: {
          job_requisition_id: { type: "string" },
        },
        required: ["job_requisition_id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;

  if (name === "search_candidates") {
    const jobTitle = String((args as { job_title?: string }).job_title ?? "").toLowerCase();
    const limit = Number((args as { limit?: number }).limit ?? 3);
    const matches = SAMPLE_CANDIDATES.filter((c) =>
      jobTitle ? c.title.toLowerCase().includes(jobTitle) || jobTitle.split(" ").some((tok) => c.skills.join(" ").toLowerCase().includes(tok)) : true,
    ).slice(0, limit);
    const filtered = matches.length > 0 ? matches : SAMPLE_CANDIDATES.slice(0, limit);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ query: { job_title: jobTitle, limit }, candidates: filtered }, null, 2),
        },
      ],
    };
  }

  if (name === "score_resume") {
    const a = args as { candidate_id?: string; job_requisition_id?: string };
    // Deterministic pseudo-score based on candidate + job id hash.
    const seed = `${a.candidate_id ?? ""}|${a.job_requisition_id ?? ""}`;
    const score = 50 + (Array.from(seed).reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 50);
    const rubric = {
      candidate_id: a.candidate_id ?? "(unknown)",
      job_requisition_id: a.job_requisition_id ?? "(unknown)",
      overall_score: score,
      categories: {
        must_have_coverage: Math.min(100, score + 5),
        nice_to_have_coverage: Math.max(0, score - 15),
        recency: Math.min(100, score + 2),
      },
      verdict: score >= 80 ? "STRONG_FIT" : score >= 65 ? "POSSIBLE_FIT" : "WEAK_FIT",
    };
    return {
      content: [{ type: "text", text: JSON.stringify(rubric, null, 2) }],
    };
  }

  if (name === "get_job_requisition") {
    const id = String((args as { job_requisition_id?: string }).job_requisition_id ?? "jr_001");
    const job = (SAMPLE_JOBS as Record<string, unknown>)[id] ?? {
      error: "not_found",
      id,
      hint: `Known ids: ${Object.keys(SAMPLE_JOBS).join(", ")}`,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(job, null, 2) }],
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify({ error: "unknown_tool", name }) }],
    isError: true,
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
