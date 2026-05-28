---
name: brief-template
description: HTML template for the InsightLab analyst brief — dark theme, one-screen scannable.
audience: briefAgent
---

# Analyst Brief Template (HTML)

The brief is the only operator-visible artifact. It must be **scannable in 30 seconds** and tell an analyst whether to pursue the topic, track it, or drop it.

## HTML shell (output must be a complete document)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>InsightLab brief · {{primary_topic_label}}</title>
  <style>
    body { font-family: -apple-system, "SF Pro Text", "Helvetica Neue", "Inter", sans-serif;
           background: #0b0d10; color: #e9ecef; max-width: 880px; margin: 32px auto; padding: 24px; }
    h1 { font-size: 22px; margin: 0 0 4px 0; }
    .meta { color: #94a3b8; font-size: 13px; margin-bottom: 22px; }
    .summary { background: #11151a; border: 1px solid #1f2937; border-radius: 6px;
               padding: 14px 16px; font-size: 14px; line-height: 1.55; color: #e2e8f0;
               margin-bottom: 22px; }
    h2 { font-size: 14px; margin: 24px 0 10px 0; color: #cbd5e1; text-transform: uppercase;
         letter-spacing: 0.07em; font-weight: 500; }
    .tagrow { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    .tag { display: inline-block; padding: 3px 9px; border-radius: 12px; font-size: 11px;
           font-weight: 600; background: rgba(208,255,0,.10); color: #d0ff00;
           border: 1px solid rgba(208,255,0,.25); }
    .tag.secondary { background: rgba(148,163,184,.10); color: #94a3b8; border-color: rgba(148,163,184,.25); }
    .entities { display: grid; grid-template-columns: 100px 1fr; gap: 4px 12px; font-size: 13px;
                color: #cbd5e1; margin-bottom: 18px; }
    .entities .label { color: #94a3b8; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; padding-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0 20px 0; }
    th, td { padding: 9px 12px; text-align: left; border-bottom: 1px solid #1f2937;
             font-size: 13px; vertical-align: top; }
    th { color: #94a3b8; font-weight: 500; font-size: 11px; text-transform: uppercase;
         letter-spacing: 0.05em; }
    .conf { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .conf.high   { background: rgba(34,197,94,.15);  color: #22c55e; }
    .conf.medium { background: rgba(234,179,8,.15);  color: #eab308; }
    .conf.low    { background: rgba(249,115,22,.15); color: #f97316; }
    .rec { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px;
           font-weight: 600; letter-spacing: 0.03em; }
    .rec.investigate { background: rgba(34,197,94,.18);  color: #22c55e; }
    .rec.track       { background: rgba(96,165,250,.18); color: #60a5fa; }
    .rec.discard     { background: rgba(148,163,184,.15); color: #94a3b8; }
    ul { margin: 8px 0 18px 0; padding-left: 22px; color: #cbd5e1; }
    li { margin: 4px 0; line-height: 1.5; font-size: 13px; }
    .query { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px;
             color: #d0ff00; }
    .footer { margin-top: 28px; padding-top: 14px; border-top: 1px solid #1f2937;
              color: #64748b; font-size: 11px; }
  </style>
</head>
<body>
  <h1>{{summary_one_liner}}</h1>
  <div class="meta">
    InsightLab analyst brief · <span class="rec {{rec_class}}">{{downstream_recommendation}}</span>
    · generated {{generated_at}}
  </div>

  <div class="summary">{{article_snippet_or_one_liner}}</div>

  <h2>Topics</h2>
  <div class="tagrow">
    <span class="tag">{{primary_topic_label}}</span>
    <!-- one .tag.secondary per secondary topic -->
  </div>

  <h2>Entities</h2>
  <div class="entities">
    <span class="label">Orgs</span><span>{{org_list_or_em_dash}}</span>
    <span class="label">People</span><span>{{person_list_or_em_dash}}</span>
    <span class="label">Products</span><span>{{product_list_or_em_dash}}</span>
    <span class="label">Places</span><span>{{place_list_or_em_dash}}</span>
    <span class="label">Metrics</span><span>{{metric_list_or_em_dash}}</span>
  </div>

  <h2>Key claims</h2>
  <table>
    <thead>
      <tr><th>#</th><th>Claim</th><th>Confidence</th><th>Verify with</th></tr>
    </thead>
    <tbody>
      <!-- one row per claim from claims[] -->
      <tr>
        <td>{{id}}</td>
        <td>{{claim}}<br><span style="color:#64748b;font-size:11px">source: {{source_in_article}}</span></td>
        <td><span class="conf {{confidence}}">{{confidence}}</span></td>
        <td>
          <!-- one .query line per verification query -->
          <div class="query">{{verification_query}}</div>
        </td>
      </tr>
    </tbody>
  </table>

  <h2>Open questions</h2>
  <ul>
    <!-- one <li> per open_questions item; if empty, render <li style="color:#64748b">None — claims fully resolved by article.</li> -->
  </ul>

  <div class="footer">
    InsightLab · Agentic Operator · brief generated by briefAgent · all claims paraphrase the source article verbatim.
  </div>
</body>
</html>
```

## Recommendation badge class

Lowercase the `downstream_recommendation` (e.g. `INVESTIGATE` → `investigate`) and use it as the CSS class on `.rec`.

## Behavior constraints

- **Self-contained** — every style inlined in `<style>`, no external CSS or fonts.
- The `<h1>` reuses the `summary_one_liner` from the tagging payload. No invented text.
- Topic labels come from the taxonomy table — never display the code (`ai-safety`); always the human label ("AI Safety & Alignment").
- Empty entity rows render `—` instead of an empty `<span>`.
- Claims table: at least 3 rows (must match input claim count exactly).
- Open questions: at least 1 `<li>`; if upstream sent an empty array, render the explicit "None — claims fully resolved" line.
- Never quote more than ~15 words verbatim from the source article.
