# Emma Rodriguez

Senior Fullstack AI Engineer · Brooklyn, NY · emma.rodriguez@example.com · github.com/emmarodriguez · 6 years experience

## Summary

Senior fullstack engineer with 6 years of production experience and the last 3.5 years focused on shipping LLM-powered products end-to-end. Comfortable across React/TypeScript, Node, Python, and the operational layer. Built and shipped two RAG-backed B2B SaaS products that scaled past 10k weekly users. Active open-source maintainer (1.8k GitHub stars across personal repos) and frequent speaker on practical agent orchestration.

## Skills

- **Frontend**: React 18+, Next.js 14 App Router, TypeScript, TanStack Query, Tailwind, shadcn/ui, Radix
- **Backend**: Node (Fastify, Express), Python (FastAPI), Go (intermediate)
- **LLM / AI**: Anthropic SDK (Claude Sonnet/Haiku/Opus, tool use, streaming, prompt caching), OpenAI SDK (function calling, structured outputs, batch API), open-source models via Ollama / vLLM, prompt-engineering eval harnesses, **MCP server + client implementation**, agent orchestration (built an in-house framework similar to LangGraph), LangChain (production use 2023-2024)
- **Vector / RAG**: pgvector at 500M+ embeddings, Pinecone, Weaviate, hybrid BM25+dense retrieval, ColBERT reranking, evaluation with RAGAS + custom harnesses
- **Data**: PostgreSQL (read EXPLAIN, partitioning, logical replication), Drizzle ORM, Prisma, Redis (Streams, Pub/Sub), Snowflake, dbt
- **Infra**: AWS (ECS, RDS, S3, Lambda), GCP (Cloud Run, BigQuery), Docker, basic Kubernetes (operate, not author), Terraform, GitHub Actions
- **Observability**: pino, OpenTelemetry, Grafana, Honeycomb, Sentry; built two production alert systems from scratch

## Experience

### Staff Engineer — Mercer AI (B2B SaaS, ML observability) · 2023-now (2.5 yr)

- Tech-lead for the workbench: Next.js 14 App Router frontend (~80k LOC), Node API on Fastify (~50k LOC), Python feature-store service.
- Designed and shipped the **agent runtime**: a tool-use loop driving Anthropic Claude and OpenAI GPT-4 against ~40 internal tools, with retry/budget hooks and per-tenant cost tracking. ~3M agent runs / month in production.
- Built the **RAG layer** over customer documentation: pgvector at 50M embeddings, hybrid search, response synthesis with citations. P95 retrieval latency 180ms.
- Owned migration from REST→OpenAPI-typed-client + the corresponding TanStack Query layer. Cut frontend bug rate ~35% per the QA team.
- Shipped a homegrown **MCP server** exposing our customer's data-catalog tools, used internally by our AI engineers.
- On-call rotation for the platform; designed the alerting taxonomy + SLO doc.

### Senior Fullstack Engineer — Citadel Notes (productivity startup) · 2021-2023 (2 yr)

- Joined as employee #4. Shipped the original AI-assist feature: GPT-3.5/4 powered note summarization + Q&A grounded in user's vault (early RAG using Weaviate, then migrated to pgvector for cost).
- Owned the entire frontend (React + Tailwind, 100% TypeScript) and the Node API tier.
- Built the evaluation harness still in use: 600+ regression cases re-run on every model bump.
- Grew the team from 4 → 14 engineers; mentored 3 junior eng.

### Fullstack Engineer — Datadog (Logs UI team) · 2019-2021 (1.5 yr)

- React + Redux frontend for the Logs Explorer; Go backend microservices.
- Shipped saved searches, alerting from log queries, and the embedded notebooks feature.

## Open source

- **rgs** (1.2k stars) — type-safe RAG orchestration kit in TypeScript. I use it in production.
- **mcp-tools** (400 stars) — collection of MCP servers (Postgres, GitHub Search, Slack) I run for my team.
- **eval-grid** (200 stars) — minimal harness for prompt regression eval.

## Talks

- "Agents that don't break the bank: tool-use loops with budget hooks" — AI Engineer Summit 2025
- "From REST to MCP: a year of operating tool servers in production" — MCP Day SF 2025

## Education

- B.S. Computer Science, Carnegie Mellon University (2019)
