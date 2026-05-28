# 刘芳 (Liu Fang)

后端工程师 · 杭州 · liufang.dev@163.com · 4 年工作经验

## 个人简介

4 年 Python 后端经验,主要在金融科技 (互联网保险) 领域。近半年开始尝试用 LLM 做内部工具,上线了一个面向客服的问答机器人,但还没有完整的评估体系。希望能转到一个更"AI-native"的环境,补齐前端和模型工程的短板。

## 技能 (Skills)

- **后端**: Python (Django、FastAPI、Flask)、PostgreSQL、Redis、Celery、Docker
- **前端**: React (学过课程 + 副业,无生产经验)、HTML/CSS、原生 JavaScript
- **LLM**: OpenAI SDK (chat completions、基础 function calling,~6 个月生产)、智谱 GLM-4 (POC 阶段)
- **数据**: PostgreSQL (中级——会 join、index,未做过分区)、ClickHouse 基础
- **基础设施**: 阿里云 (ECS、RDS)、Docker、基础 GitHub Actions;未独立拥有过生产 Kubernetes
- **可观测性**: Sentry、基础的 pino 风格结构化日志

## 工作经历

### 众安保险 · 保险中台技术部 · 后端工程师 · 2022.03 - 至今 (3 年)

- 负责费率计算引擎:Django + Postgres,日处理 ~400 万次询价。
- 公司里的 **第一个 AI 功能** (2024 Q4 上线) 由我搭建:面向客服的智能助手,基于 OpenAI GPT-4 + 内部 FAQ 知识库回答问题。Jupyter 里迭代的 prompt,起了个 FastAPI 微服务,~150 名内部用户在用。简单的 retry,没有正经的 eval harness——这个还在 TODO 上。
- 维护核心费率库的 Postgres schema (40+ 张表),2023 年主导了从 MySQL 迁过来的工作。
- 月度 on-call 1 次。

### 同程旅行 · 度假事业部 · 初级 -> 中级 · 2020.07 - 2022.02 (1.5 年)

- 入职即是第二名后端。落地了酒店供应商门户后端 (Django REST),认证体系,以及报价 API 的 v1。
- 用原生 React (没 Next.js / TypeScript) 给内部 ops 团队搭了管理后台。

## 副业 / 业余项目

- **rate-cards-viewer** — 小型 React + Vite 应用,用来可视化费率库 schema。自用,~200 行 TypeScript。
- 每个周末跟着 Anthropic 的 prompt engineering 课程学习。

## 教育背景

- 浙江工业大学 · 软件工程学士 · 2016-2020,GPA 3.4/4.0

## 其他

- 普通话母语,英文阅读 + 邮件无障碍 (CET-6: 610),口语进阶中
- 可以接受 on-call
- 目前在杭州,可以接受北京/上海每月出差 1-2 次,不愿全职搬迁
