---
name: claim-extraction
description: Extract the most consequential factual claims from an article and propose verification queries.
audience: claimExtractAgent
---

# Claim Extraction

`claimExtractAgent` receives an `ARTICLE_TAGGED` event carrying both the original article text and the topic/entity tagging produced upstream. The agent must:

1. Identify the **3–7 most consequential factual claims** in the article. "Consequential" means a sane analyst would want to verify before acting on it.
2. For each claim, classify confidence and propose verification queries.
3. Emit a JSON object the downstream `briefAgent` can render verbatim.

## What counts as a claim

- A quantitative statement ("market grew 47% YoY").
- A causal statement ("X caused Y").
- An attribution ("according to [org], …").
- A predictive statement about the future tied to a specific timeline.
- An assertion about competitive positioning ("now the largest deployer of …").

Editorial opinions, hedged ("could", "might"), and definitional sentences are **not** claims.

## Confidence ladder

| value     | when to use                                                                  |
|-----------|------------------------------------------------------------------------------|
| `high`    | Specific number, named source, recent date — easy to verify in public data.  |
| `medium`  | Source attributed but no primary citation; or quantitative without method.   |
| `low`     | Unsourced assertion, vague attribution ("industry insiders say"), futurism.  |

## Verification queries

For each claim, list 1–3 short search-style queries an analyst would run. Make them specific enough that a researcher could paste them into a search engine without rewording.

## Required output

```json
{
  "claims": [
    {
      "id": "c1",
      "claim": "Verbatim or near-verbatim quote of the claim (one sentence).",
      "confidence": "high|medium|low",
      "source_in_article": "byline / attribution as it appears, or 'unattributed'",
      "verification_queries": [
        "specific search-style query 1",
        "specific search-style query 2"
      ]
    }
  ],
  "open_questions": [
    "Question an analyst should pursue but the article doesn't answer."
  ],
  "downstream_recommendation": "INVESTIGATE | TRACK | DISCARD"
}
```

## Constraints

- 3 ≤ `claims.length` ≤ 7.
- `confidence` must be one of `high`, `medium`, `low` — no other values.
- `verification_queries` arrays each have 1–3 items, never empty, never more.
- `open_questions` may be `[]` if there are none.
- `downstream_recommendation`:
  - `INVESTIGATE` if any claim is high-confidence AND consequential
  - `TRACK` if all claims are low/medium confidence but the topic matters
  - `DISCARD` if the article is editorial/opinion with no factual hooks
- No invented quotes — every claim's `claim` field must paraphrase or quote text actually present in the article.
