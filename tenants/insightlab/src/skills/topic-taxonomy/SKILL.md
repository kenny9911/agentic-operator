---
name: topic-taxonomy
description: Categorize an article along the InsightLab topic taxonomy and extract named entities.
audience: topicTagAgent
---

# Topic Taxonomy

When `topicTagAgent` receives an `ARTICLE_SUBMITTED` event it must:

1. Assign **one primary topic** from the canonical taxonomy.
2. Optionally assign **up to 3 secondary topics** (drawn from the same list).
3. Extract **named entities** grouped by type.
4. Emit a structured JSON payload that downstream agents (`claimExtractAgent`, `briefAgent`) can consume verbatim.

## Canonical taxonomy

| code            | label                          | scope                                                                 |
|-----------------|--------------------------------|-----------------------------------------------------------------------|
| `ai-safety`     | AI Safety & Alignment          | alignment research, RLHF, interpretability, model evaluations         |
| `ai-systems`    | AI Systems & Infrastructure    | training infra, serving, agents, tool-use, distributed runtimes       |
| `policy-reg`    | Policy & Regulation            | government action, executive orders, standards bodies, treaties       |
| `enterprise`    | Enterprise Adoption            | deployments inside Fortune-1000 companies, ROI, productivity studies  |
| `consumer`      | Consumer Products              | chat apps, assistants, creative tools, end-user UX                    |
| `research`      | Foundational Research          | new architectures, scaling laws, reasoning, benchmarks                |
| `infra-chip`    | Compute & Silicon              | GPUs, accelerators, supply chain, datacenter buildouts                |
| `markets`       | Markets & Funding              | rounds, IPOs, acquisitions, equity research                           |
| `geopolitics`   | Geopolitics & Trade            | export controls, sanctions, sovereign-AI initiatives                  |
| `labor`         | Labor & Talent                 | hiring, layoffs, compensation, workforce displacement                 |
| `science`       | Science Applications           | biology, materials, climate, healthcare model use                     |
| `media`         | Media & Information Integrity  | deepfakes, watermarking, copyright, journalism                        |

Reject any topic that isn't on the list — pick the *closest* code and note the mismatch in `note`.

## Entity types

- `org` — companies, labs, agencies (e.g. "Anthropic", "NIST", "EU Commission")
- `person` — named individuals
- `product` — model or product names (e.g. "Claude 4.5", "GPT-5", "DGX H100")
- `place` — countries, cities, regions
- `metric` — quantitative claims with units (e.g. "32% productivity gain", "175B parameters")

## Required output

A single JSON object — the model **must not** wrap it in prose:

```json
{
  "primary_topic": "<code>",
  "secondary_topics": ["<code>", "..."],
  "entities": {
    "org":     ["..."],
    "person":  ["..."],
    "product": ["..."],
    "place":   ["..."],
    "metric":  ["..."]
  },
  "summary_one_liner": "A single sentence (<= 30 words) describing what the article says.",
  "note": "optional — fill only if the article doesn't cleanly fit any code"
}
```

## Constraints

- `primary_topic` is required, MUST be a valid code from the table.
- `secondary_topics` is an array (possibly empty); never duplicate `primary_topic` in it.
- Entity arrays may be empty `[]` but the keys must all be present.
- No hallucinated entities — if "Anthropic" isn't in the article, don't list it.
- The one-liner must paraphrase, not quote.
