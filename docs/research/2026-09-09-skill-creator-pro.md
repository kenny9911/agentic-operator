# Skill Creator Pro authoring and verification

Date: 2026-09-09, Asia/Singapore.

The maintained [Skill Creator](../../packages/skills/builtin/skill-creator/SKILL.md)
is now policy version `2`. A real OpenAI GPT-5.6 Sol Pro call through the
workspace's existing `custom` gateway produced the complete updated bundle.
The returned files were applied without editorial rewriting. This establishes
Pro authorship and validated packaging, not universal superiority.

## Authoring evidence

| Field | Observation |
| --- | --- |
| Requested route | `custom/openai/gpt-5.6-sol-pro` |
| Returned provider/model | `custom` / `openai/gpt-5.6-sol-pro` |
| Provider request ID | `gen-1788907102-xrztZm1FeNBOSy9KWtVa` |
| Reasoning requested | `high` |
| Request output cap / timeout | 16,000 tokens / 300,000 ms |
| Measured latency | 240,565 ms |
| Provider-reported input / output usage | 30,857 / 16,379 tokens |
| Generation attempts | 1; completed with `stop` |
| Original policy digest | `f707f3fbd4966b416f497c868c2bd7586d82df9f748a50bba7e5eac9a4da1aa2` |
| Generated bundle digest | `9e69be4ba5c7611e6b617aac852a7cba483ed7e21f3259dbef6c0e62e8708d62` |

The request and complete parsed result are retained locally in
`data/skill-creator-research/author-policy.input.json` and
`data/skill-creator-research/author-policy.result.json`. The original bundle is
in `data/skill-creator-research/baseline-policy/`. The call used the existing
platform gateway with real tenant attribution and existing endpoint-bound
credentials. Its usage records are in an isolated SQLite snapshot,
`data/skill-creator-research/usage.db`, with a separately acquired writer lease;
the authoring probe did not write a production draft. This standalone probe
used the existing RAAS tenant ID and a descriptive research actor label; it
was not an authenticated HTTP request from that actor. The final HTTP check
uses the API's own authenticated context. Credentials, raw model
reasoning, and database contents were not included in the authoring prompt.

Provider-reported usage is retained exactly rather than inferred from the
requested cap. The successful probe predates the additional raw-response
attestation checks described below; its record contains the gateway-normalized
model, provider request ID and usage. Final service responses separately retain
raw provider model/mode fields to distinguish them from normalized controls.

## What changed

The revised entrypoint preserves the existing narrow authoring scope and
adds explicit handling of one-off tasks, supported frontmatter preservation,
and the distinction between examples used for development and genuinely held-out
assessment cases. Its new [evaluation guide](../../packages/skills/builtin/skill-creator/references/evaluation.md)
separates package validity, discovery, task behavior and executable support. It
describes fair baseline comparisons and appropriate blind evaluation, and binds
quality claims to measured cases, model routes, settings and rubrics. The
existing output-contract file remains byte-for-byte unchanged.

These are original platform instructions informed by the first-party
[OpenAI Skill Creator](https://github.com/openai/skills/tree/main/skills/.system/skill-creator)
and [Anthropic Skill Creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator).
Vendor-specific execution commands and their heavyweight evaluation loops were
not transplanted into the platform authoring service.

## Model routing and honest evidence

The creator's default is `custom/openai/gpt-5.6-sol-pro`, verified against the
configured gateway's authenticated live model inventory and the successful
call above. The default and its single permitted format repair use the same
explicit route. They cannot fall through to ordinary tenant chat settings.
Operators can set `SKILL_CREATOR_MODEL_ROUTE`; native OpenAI base models also
need `SKILL_CREATOR_REASONING_MODE=pro`. Deliberate editor route choices remain
available. Other agents and workflows retain their existing model settings.

OpenAI documents native Pro as a reasoning mode independent of reasoning
effort, while a routing provider may expose a separate `-pro` model identifier.
The native schema and Astra capabilities are documented in the
[OpenAI reasoning guide](https://developers.openai.com/api/docs/guides/reasoning#reasoning-mode)
and [latest-model guide](https://developers.openai.com/api/docs/guides/latest-model).
The local gateway advertises Sol Pro; it did not advertise Astra Pro when
checked. OpenRouter's public inventory did advertise Astra Pro, but its actual
call failed with an account/provider `403` authorization response. That route
was not retained as the default. Direct OpenAI model discovery returned `401`.

Independent code review found that the gateway adapters can echo requested
model IDs and reasoning controls when a provider omits them. The creator now
accepts a requested Pro result only when the raw provider response identifies
a Pro model or reports `reasoning.mode=pro`. `reportedModel` and
`reportedReasoningMode` retain that observation separately from normalized
`model` and effective `reasoning`. Missing or standard-mode evidence fails
visibly and does not trigger a fallback call.

## Verification and limits

The final HTTP verification sent an actual `POST /v1/skills/generate` request
to the running API with no `modelRoute`, under the authenticated RAAS user.
It returned `201` and a saved tenant draft, `citation-evidence-check`
(`skl-0122f19335d6`). It used policy `2`, the exact default
`custom/openai/gpt-5.6-sol-pro`, and raw
`reportedModel=openai/gpt-5.6-sol-pro`. Provider request
`gen-1788907452-nHBVuJeEs5x3FLJCIop6` completed in 78,746 ms with
21,035 input and 7,632 output tokens reported. A subsequent `GET` confirmed
that the complete generation provenance was persisted unchanged. The resulting
verification draft was then archived with the API's revision and publication
checks, leaving it recoverable without adding an active library item.

The complete request, creation response, persisted response and archive result
are retained as `data/skill-creator-research/default-http-*.json`. The returned
one-file skill stays within its requested 45-line cap, restricts claims to
supplied source excerpts, distinguishes partial support and contradictions,
and proposes three unexecuted tests. This verifies real default Pro authoring,
raw provider evidence and saved-draft behavior; it does not measure execution
quality of the resulting citation-review skill.

Creator unit coverage exercises Pro defaults, same-route repair, explicit
editor choices, provider failures, missing raw Pro evidence, unchanged binary
resources, bounded context, cancellation and tenant/actor attribution. Managed
library tests exercise draft persistence, revision conflicts and comparison
records. Package validation checks the complete generated bundle and linked
evaluation resource.

The separate independent forward test and any final portal/API generation
records should be read alongside this note. Neither Pro compute nor structural
validation establishes that every generated Skill is correct, triggers
appropriately, or outperforms the previous policy. Comparative claims require
actual aligned baseline runs on representative held-out cases; scripts and
external integrations need their own runtime evidence.
