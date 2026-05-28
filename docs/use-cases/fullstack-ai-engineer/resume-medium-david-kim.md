# David Kim

Backend Engineer · Austin, TX · david.kim@example.com · 5 years experience

## Summary

Backend engineer with 5 years of production experience, primarily Python/Django. Recently (~6 months) started building LLM-powered features at work — shipped one chat-style assistant with the OpenAI SDK to internal users. Some React from side projects, but not production. Looking to grow into more of a fullstack/AI role.

## Skills

- **Backend**: Python (Django, FastAPI), PostgreSQL, Redis, Celery, Docker
- **Frontend**: React (tutorials + side projects; no production shipping), HTML/CSS, vanilla JavaScript
- **LLM**: OpenAI SDK (chat completions, basic function calling, ~6 months prod), prompt iteration via Jupyter
- **Data**: PostgreSQL (intermediate — comfortable with joins, indexes; haven't done partitioning), some BigQuery
- **Infra**: AWS (EC2, RDS), Docker, basic GitHub Actions; never owned production Kubernetes
- **Observability**: Sentry, basic pino-style structured logging

## Experience

### Senior Backend Engineer — Argo Logistics (freight SaaS) · 2022-now (3 yr)

- Owner of the rates calculation engine: Django + Postgres, processes ~5M rate quotes/day for trucking customers.
- Built the **first AI feature** at the company (Q4 2024): a customer-support assistant that uses OpenAI GPT-4 to answer questions grounded in the rates documentation. Wrote the prompt iteration loop in a Jupyter notebook, shipped a small FastAPI service backing it, ~120 internal users. Wired basic retries; no proper eval harness yet — that's on my TODO list.
- Maintain the rates Postgres schema (40+ tables); led the migration from MySQL in 2023.
- On-call once per month for the rates service.

### Backend Engineer — Argo Logistics · 2020-2022 (2 yr)

- Joined as the second backend engineer. Shipped the carrier portal backend (Django REST), the auth layer, and the first version of the rates API.
- Built admin tools in vanilla React (no Next.js, no TypeScript) for internal ops.

## Side projects

- **rate-cards-viewer** — small React + Vite app that visualizes the rates schema. Personal use, ~200 LOC of TypeScript.
- Working through Anthropic's prompt engineering course on weekends.

## Education

- B.S. Computer Engineering, UT Austin (2020)
