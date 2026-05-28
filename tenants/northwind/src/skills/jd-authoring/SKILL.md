---
name: jd-authoring
description: 把招聘需求文档转化为高质量的 JD,涵盖必备 sections + 中英表达取舍 + 招聘合规要点
audience: jdAuthorAgent
---

# JD 撰写技能 (JD Authoring)

当 `HIRING_REQUIREMENT_SUBMITTED` 事件到达时,你将以这套规则把"招聘需求"转换为可对外发布的 JD。

## 必备 section (按顺序)

1. **职位标题** — 不加前缀级别字 (Senior/Lead/初级等),括号内的方向限定要保留 (例如 "全栈 AI 工程师 (Agent 平台)")
2. **公司背景** — 1 段话,含公司阶段 (天使/A/B/C 轮),业务方向,团队规模
3. **职位描述** — 4-7 个 bullet,使用动词起头,涵盖技术栈 + 业务场景
4. **硬性要求 (Must Have)** — 5-8 条编号列表;每条要可验证,避免"具有学习能力"这类无法度量的描述
5. **加分项 (Nice to Have)** — 3-6 条;不可与 must have 重复
6. **面试流程** — 编号列表;若需付费写在末尾

## 风格

- 中文 JD 用简体中文,允许少量英文术语 (React、PostgreSQL、Kubernetes 等专业名词不译)
- 字数总长度控制在 600-1100 字 (中文计字)
- 避免性别/年龄/婚育状态等违反招聘合规的措辞
- 不要写"狼性"、"奋斗者"等争议性词汇
- 薪资如果给出范围,要用 "60-90K · 14-16 薪" 这种业内通行写法

## 检查清单 (生成后自检)

- [ ] 没有"性别歧视"或"年龄歧视"措辞
- [ ] Must Have 每条都有量化标准 (年限、技术栈、产出维度)
- [ ] Nice to Have 不超过 6 条 (避免膨胀)
- [ ] 面试流程明确步骤数和大致时长

## 操作步骤

1. 阅读传入的 `HIRING_REQUIREMENT_SUBMITTED.payload.requirements` (markdown 文本)
2. 抽取核心信息:职位、公司、薪资、地点、必备技能、加分技能、面试流程
3. 按上述 6 个 section 重写为标准 JD
4. 调用 `writeJdToDisk({ jd_text, jd_title })` 持久化
5. 在最终 JSON 输出里返回 `{ jdId, jdPath, jd_text, structured_summary }`

## 失败模式

- 输入需求文档为空:emit `{ error: "empty_requirements" }`,不要凭空发挥
- 输入只有英文需求:JD 仍以中文输出 (中国市场默认),但保留英文专业名词
