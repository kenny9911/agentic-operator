# 张伟 (Zhang Wei)

资深全栈 AI 工程师 · 北京海淀 · zhangwei.dev@gmail.com · github.com/zhangwei-eng · 7 年工作经验

## 个人简介

7 年互联网研发经验,近 3 年专注于 LLM 产品的全栈交付。在字节跳动主导过两个 RAG + agent 类 SaaS 产品从 0 到 1,周活 5 万 +。中英文均能撰写技术文档,开源活跃 (GitHub 累计 3.4k stars),曾在 GopherCon Beijing 2025 分享 *《Agent 工作流的预算与重试》*。

## 技能 (Skills)

- **前端**: React 18+ / Next.js 14 App Router / TypeScript / TanStack Query / Tailwind / shadcn/ui / Zustand
- **后端**: Node (Fastify、NestJS、Express) / Python (FastAPI、Django) / Go (中级)
- **LLM 与 AI**: Anthropic Claude SDK (Sonnet/Haiku/Opus,tool use、streaming、prompt caching)、OpenAI SDK (function calling、structured output、batch API)、智谱 GLM-4、Qwen2.5、DeepSeek-V3,开源模型 vLLM / Ollama 本地部署,**MCP server + client 实战**,自研 agent runtime (类似 LangGraph)
- **RAG**: pgvector (5 亿向量量级)、Milvus、Pinecone,BM25 + dense hybrid 检索,bge-large / m3e 中文 embedding,基于 RAGAS + 自研框架的评估
- **数据库**: PostgreSQL (会写 EXPLAIN、分区、逻辑复制)、Drizzle ORM、Prisma、Redis (Streams、Pub/Sub)、ClickHouse、Snowflake、dbt
- **基础设施**: 阿里云 (ACK、RDS、OSS、PolarDB、AnalyticDB)、AWS (ECS、RDS)、Docker、Kubernetes (operator 经验)、Terraform、GitHub Actions、Jenkins
- **可观测性**: pino、OpenTelemetry、Grafana、SkyWalking、Sentry,搭建过两个生产报警体系

## 工作经历

### 字节跳动 · Lark 智能助手团队 · 资深工程师 · 2023.03 - 至今 (3 年)

- 团队 Tech Lead,负责 Lark 内嵌的智能助手产品:Next.js 14 前端 (~10 万行),Node Fastify 后端 (~6 万行),Python feature store。
- 设计并落地 **agent runtime**:tool-use 循环,Claude + GPT-4 调度 60+ 内部工具,接入 budget hook 和按租户成本追踪。生产 ~500 万 agent 调用/月。
- 构建 **RAG 层**:基于 pgvector 的飞书文档检索 (8000 万向量),hybrid 检索 + bge-reranker。p95 检索延迟 220ms。
- 主导 REST → OpenAPI typed-client + TanStack Query 迁移,前端 bug 率下降约 40% (QA 团队度量)。
- 自研一个 **MCP server**,把内部数据目录工具暴露给团队的 AI 工程师使用。
- 平台 on-call 轮值,设计了报警分级与 SLO 文档。

### 美团 · 到家事业部 · 中级 -> 高级工程师 · 2020.07 - 2023.02 (2.5 年)

- 团队第 4 号工程师。落地了 *骑手智能调度* 模块的首个 AI 助手功能:GPT-3.5/4 答疑 + Weaviate-based RAG (后期迁移到 pgvector 降本)。
- 拥有完整前端 (React + Tailwind,100% TypeScript) 和 Node API 层。
- 搭建了至今仍在用的评估 harness:600+ 回归用例,每次模型升级全跑一次。
- 团队从 4 → 15 人,带过 4 名应届校招。

### 阿里巴巴 · 蚂蚁集团 · 风控前端组 · 中级工程师 · 2018.07 - 2020.06 (2 年)

- React + Redux 前端 (风控大盘) + Java 后端微服务联调。
- 上线 *保存查询、查询告警、嵌入式 notebook* 等模块。

## 开源

- **rgs** (1.4k stars) — TypeScript 写的类型安全 RAG orchestration kit,生产环境正在用
- **mcp-tools-cn** (550 stars) — 国内常见服务的 MCP servers 集合 (飞书/钉钉/企业微信/Notion 等)
- **eval-grid** (250 stars) — 最小化的 prompt 回归 eval harness

## 演讲

- *《Agent 工作流的预算与重试》* · GopherCon Beijing 2025
- *《从 REST 到 MCP:运营一年 tool server 的经验》* · 上海 AI 工程师 Meetup 2025

## 教育背景

- 北京大学 · 计算机科学与技术学士 · 2014-2018,GPA 3.8/4.0,获国家奖学金 1 次

## 其他

- 中英文工作环境流利
- 接受 on-call 轮值
- 可在北京 / 上海 / 远程办公
