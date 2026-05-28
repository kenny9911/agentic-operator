---
name: match-rubric
description: 把 RoboHire matchResumeApi 返回的 0-100 分,翻译成可执行的人事决策类别
audience: batchMatchAgent, reportAgent
---

# Match 评分解读 (Match Rubric)

RoboHire 的 `/api/v1/match-resume` 返回的核心字段:

- `matchScore` (0-100) — 已通过 `matchResumeApi` 工具归一化到顶层
- `verdict` — 字符串,可能是 "Strong Match" / "Moderate Match" / "Weak Match" / "Not a Match"
- `hiringRecommendation` — "Strongly Recommend" / "Recommend" / "Do Not Recommend"
- `summary` — 一句话理由
- `raw` — 完整原始响应,内含 `mustHaveAnalysis`、`niceToHaveAnalysis`、`skillMatchScore`、`overallMatchScore.breakdown` 等

## 决策矩阵

| matchScore | 决策标签 | 操作 | 颜色 (HTML 报告用) |
|---|---|---|---|
| ≥ 85 | INVITE | 立即安排面试 | `#22c55e` 绿 |
| 70-84 | CONSIDER | 进 talent pool,JD 调整后回访 | `#eab308` 黄 |
| 50-69 | WEAK | 不主动推进,留档备查 | `#f97316` 橙 |
| < 50 | REJECT | 礼貌拒信 | `#ef4444` 红 |

## 注意

- 不要直接把 RoboHire 的 `verdict` 字符串当成决策类别 — verdict 是 RoboHire 的语言模型主观判断,不一定与上表对齐。**永远以 `matchScore` 为准**。
- 若 matchScore 为 null/缺失,标记为 ERROR 类别,在报告里单独说明 "评分未返回",不要默认归类。

## 用于报告的字段

每个候选人的报告 row 必须包含:
- 候选人姓名 (从输入 payload 里取,RoboHire 不可靠地从 resume 里抽)
- matchScore + verdict
- 决策标签 (INVITE / CONSIDER / WEAK / REJECT)
- 1-2 行的"为什么"理由 — 优先引用 `raw.mustHaveAnalysis.candidateEvaluation.matchedSkills` 或 `unmatchedSkills`
- 顶层亮点 (top achievement),从 `raw.resumeAnalysis.keyAchievements` 第一条取
