---
name: report-template
description: 招聘漏斗报告的 HTML 模板设计,确保操作者一目了然地看到决策
audience: reportAgent
---

# 招聘漏斗报告模板 (Report Template)

报告读者:招聘经理 + 业务面试官。语言:简体中文为主,技术名词保留英文。

## HTML 结构 (必须输出完整文档)

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>候选人匹配报告 · {{jd_title}}</title>
  <style>
    body { font-family: -apple-system, "SF Pro Text", "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif;
           background: #0b0d10; color: #e9ecef; max-width: 900px; margin: 32px auto; padding: 24px; }
    h1 { font-size: 22px; margin: 0 0 6px 0; }
    .meta { color: #94a3b8; font-size: 13px; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #1f2937; font-size: 13px; vertical-align: top; }
    th { color: #94a3b8; font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .invite   { background: rgba(34,197,94,.15);  color: #22c55e; }
    .consider { background: rgba(234,179,8,.15);  color: #eab308; }
    .weak     { background: rgba(249,115,22,.15); color: #f97316; }
    .reject   { background: rgba(239,68,68,.15);  color: #ef4444; }
    .score    { font-family: monospace; font-weight: 600; }
    .why      { color: #cbd5e1; line-height: 1.5; }
    h2 { font-size: 15px; margin: 28px 0 8px 0; color: #f8fafc; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #1f2937; color: #64748b; font-size: 11px; }
  </style>
</head>
<body>
  <h1>候选人匹配报告</h1>
  <div class="meta">JD · {{jd_title}} · 评估时间 {{evaluated_at}} · 候选人 {{count}} 名</div>

  <h2>结果速览</h2>
  <table>
    <thead><tr><th>排名</th><th>候选人</th><th>分数</th><th>决策</th><th>核心理由</th></tr></thead>
    <tbody>
      <!-- 一行一个候选人,按 matchScore 降序 -->
      <tr>
        <td>1</td>
        <td><strong>{{candidate_name}}</strong><br><span style="color:#64748b;font-size:11px">{{current_role}}</span></td>
        <td class="score">{{matchScore}}</td>
        <td><span class="badge invite">INVITE</span></td>
        <td class="why">{{why_line}}</td>
      </tr>
    </tbody>
  </table>

  <h2>推荐行动</h2>
  <ul>
    <!-- 一段话,每位 INVITE 候选人单独成项,引用 hiringRecommendation -->
  </ul>

  <div class="footer">
    Northwind Labs · Agentic Operator · 报告由 reportAgent 自动生成,数据来源 RoboHire /api/v1/match-resume
  </div>
</body>
</html>
```

## 行为约束

- 候选人按 `matchScore` 降序排
- 每名候选人 1 行,理由控制在 1-2 句
- "推荐行动" 段落只列 INVITE / CONSIDER 候选人
- 若某候选人 matchScore 缺失,行内 score 显示 "—",决策列显示 `<span class="badge weak">ERROR</span>`,理由列写明原因
- 不要编造候选人姓名 — 必须用输入 payload 的 candidate_name 字段
- 不要编造原文里没有的成就 — 引用 `raw.resumeAnalysis.keyAchievements` 第一条
