# 全栈 AI 工程师 招聘需求 (Hiring Requirements)

**公司:** Northwind Labs (B 轮 AI 基础设施初创)
**职位:** 全栈 AI 工程师 (Fullstack AI Engineer)
**所在地:** 北京 / 上海 / 远程 (优先北京双周到岗一次)
**汇报对象:** 产品工程负责人
**薪资范围:** 60-90K · 14-16 薪 + 期权
**编制:** 招 2 人 (高级/资深各 1)

## 团队与项目背景

Northwind Labs 正在为企业数据团队构建一站式 AI 工作台 —— 集 prompt 工程、agent 编排、评估 dashboard 于一体的产品 (可类比"为数据团队打造的 Notion + LangSmith")。本职位由创始团队直接带教,深度参与产品演进,每周向上万名活跃用户发布新功能。

## 你将负责

- **全栈特性交付**: 从 React (Next.js 14+ App Router) 前端 ↔ TypeScript/Node 后端 ↔ Python ML 微服务,端到端拥有完整功能闭环。
- **LLM 驱动的 agent 工作流**: 工具使用 (tool use) 循环、结构化输出、retry、cost 跟踪、评估。熟练使用 Anthropic 和 OpenAI SDK 是基本要求。
- **RAG pipeline**: 文档切片 (chunking)、embedding、向量库 (pgvector 优先,Pinecone/Weaviate 亦可),熟悉 BM25 / dense / hybrid 检索的取舍。
- **生产环境运维**: PostgreSQL (会读 EXPLAIN,会写迁移)、Redis、AWS 或阿里云、Docker、基础 Kubernetes。
- **可观测性**: pino / OpenTelemetry、Grafana、报警体系。你写的代码必须自带监控。
- **与设计协作**: AI 产品独有的 UX 模式 (streaming、citation、置信度提示等)。

## 硬性要求 (Must Have)

1. **本科及以上学历** (计算机/软件/电子信息/数学等理工科,统招优先,海归同等)。
2. **4 年以上正职软件工程经验**,其中:
   - 至少 2 年生产环境 **React/TypeScript 前端**经验
   - 至少 2 年生产环境 **后端服务**经验 (Node、Python、Go 均可)
3. 在生产环境中实际**调用过 LLM API** (Anthropic、OpenAI、智谱、DeepSeek、Qwen 等均可) 并处理过 streaming/retry/cost 三件事。
4. 熟练 SQL,Postgres 优先。具备 schema 设计 + 至少一种迁移工具 (Drizzle / Prisma / Alembic 等) 经验。
5. 至少使用过一种**向量数据库** (pgvector / Pinecone / Weaviate / Chroma / Qdrant / Milvus / Zilliz) 并理解 embedding 维度选型。
6. 中英文均能撰写技术文档。能与 PM、设计师高效协作。
7. 可以接受每季度 1 周左右的 on-call 轮值。

## 加分项 (Nice to Have)

- 使用或构建过 **agent 框架** (LangChain / LlamaIndex / Dify / AutoGen / 自研 agent 平台)。
- **MCP (Model Context Protocol)** 实战 —— 写过 server 或 client。
- 大规模 prompt engineering 经验 (eval pipeline、回归测试、A/B 测试模型版本)。
- 开源项目维护或活跃的 GitHub 贡献。
- DevX 工程经验 —— 做过让团队提效的工具。
- 数据工程背景 —— dbt / Airflow / Dolphinscheduler 等。
- 国内一二线大厂 (字节/腾讯/阿里/美团/华为/字节/快手/百度/京东/拼多多/小红书等) 中后台核心系统经验。

## 不接受 (Disqualifiers)

- 纯外包或派遣经历 > 70% (我们看重产品归属感)
- 简历主要展示嵌入式 / 客户端 (iOS/Android) / 游戏 (Unity) 等与本岗位脱节的技术栈,且无明显转型证据
- 5+ 年仍无独立模块负责经验

## 面试流程

1. 30 分钟 hiring manager 初面
2. 60 分钟系统设计 + LLM 应用设计讨论
3. 90 分钟现场结对编程 (自选语言,通常做一个小型 RAG 或 agent 功能)
4. 文化 / 价值观面 (45 分钟)
5. 创始人终面 (30 分钟,offer 阶段)

面试编码环节我们会按行业标准付费。
