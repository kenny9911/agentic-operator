# Fullstack AI Engineer — Job Description

**Company:** Northwind Labs (Series B AI infrastructure startup)
**Location:** Remote (US/EU friendly), with quarterly on-sites in San Francisco
**Reports to:** Head of Product Engineering
**Compensation:** Competitive base + meaningful equity + health/dental

## About the role

We're building an end-to-end AI workbench for enterprise data teams — think "Notion for prompt engineering + agent orchestration + eval dashboards." You will be a hands-on builder, owning features from the React frontend through the Python/Node backend down to the LLM provider layer. You'll work directly with our founding engineers and ship to thousands of users every week.

## What you'll do

- Design and ship full-stack features — modern React (Next.js 14+ App Router preferred) + a TypeScript/Node API tier + Python ML services where appropriate.
- Build and operate **LLM-powered agentic workflows**: tool-use loops, structured output, evals, retries, cost tracking. Hands-on with the Anthropic and OpenAI SDKs is expected.
- Stand up **RAG pipelines**: chunking, embeddings, vector stores (pgvector or Pinecone), retrieval evaluation. You should be comfortable choosing between BM25 / dense / hybrid retrieval.
- Operate the production stack: PostgreSQL (you should be confident reading EXPLAIN plans and writing migrations), Redis, AWS or GCP, Docker, basic Kubernetes.
- Own observability — pino/OpenTelemetry, dashboards, alerts. We expect you to instrument what you ship.
- Collaborate with the design team on UX patterns specific to AI products (streaming responses, citations, "model confidence" affordances, etc.).

## Must have

- 4+ years professional software engineering experience, of which at least 2 years writing **production frontend code in React/TypeScript** AND at least 2 years writing **production backend services** (Node, Python, or Go).
- Shipped a real product feature that called **LLMs (OpenAI, Anthropic, or open-source)** in production — including handling streaming, retries, and cost.
- Solid SQL — Postgres preferred. Comfortable with schema design and at least one migration tool (Drizzle, Prisma, Alembic, etc.).
- Experience with at least one **vector database** (pgvector, Pinecone, Weaviate, Chroma, Qdrant) and an embedding model.
- Writes clear technical specs and partners well with PMs and designers. We're a small team — clarity scales us.
- Comfortable being on-call ~one week per quarter.

## Nice to have

- Experience with **agentic frameworks** (LangChain, LlamaIndex, AutoGen, our own Agentic Operator…) or having built one yourself.
- Experience with **MCP (Model Context Protocol)** — building servers or clients.
- Background in **prompt engineering at scale** (eval pipelines, regression suites, A/B'ing model versions).
- Open-source maintainership or active GitHub footprint.
- DevX work — building tooling that makes other engineers faster.
- Background in data engineering / ETL — dbt, Airflow, or similar.

## Interview process

1. 30-min intro chat (hiring manager)
2. 60-min systems + LLM design discussion
3. 90-min pair-coding (your choice of stack) — usually a small RAG or agent feature
4. Culture / values panel (45 min)
5. Founder chat (30 min, offer-stage)

We pay candidates for the pair-coding session.
