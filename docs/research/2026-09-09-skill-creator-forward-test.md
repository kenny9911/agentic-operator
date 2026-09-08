# Skill Creator forward-test record

Date: 2026-09-09. The maintained platform policy is
[Skill Creator](../../packages/skills/builtin/skill-creator/SKILL.md), policy
version `1`, with its [output contract](../../packages/skills/builtin/skill-creator/references/output-contract.md).

The policy is original guidance informed by the cited
[Anthropic and harness research](2026-09-09-skills-and-agent-harnesses.md).
It applies concise capability descriptions, progressive resources, realistic
examples, and separate trigger/output evaluation. No upstream skill body or
Claude-specific runner was copied.

## Independent creator exercise

A fresh subagent received only the policy, its output contract, and three raw
requests with available target capabilities and existing files. It did not
receive the author's earlier candidates or review conclusions. It generated
three complete JSON proposals. These are independent uses of the creator
instructions, not executions of the resulting business Skills.

The parent reviewed the actual proposals against each original request and
ran them through the implemented `SkillCreatorOutputSchema` and
`applySkillCreatorProposal` under Node `26.8.1`. All three merged bundles passed
strict package validation with no diagnostics. For the narrow revision, the
check also compared original frontmatter and every omitted resource's bytes.

| Case and retained artifacts | Observed creator behavior | Package evidence |
| --- | --- | --- |
| [Purchase-order request](../../packages/skills/test/fixtures/creator-forward/purchase-order-exceptions.input.json), [proposal](../../packages/skills/test/fixtures/creator-forward/purchase-order-exceptions.output.json) | Preserves the two required flagging conditions, uses the supplied report date, separates invalid rows, sorts overdue rows, and retains the no-email/no-update boundary. Tie ordering is disclosed as an assumption. | One-file valid bundle; three proposed cases. |
| [PDF intake request](../../packages/skills/test/fixtures/creator-forward/invoice-pdf-dependency.input.json), [proposal](../../packages/skills/test/fixtures/creator-forward/invoice-pdf-dependency.output.json) | States that the configured inbox reader returns bytes and cannot extract PDF text. PDF-only requests receive a missing-capability outcome; supplied text has an explicit JSON workflow. No extraction or provider test is claimed. | One-file valid bundle; three proposed cases. |
| [Narrow revision request](../../packages/skills/test/fixtures/creator-forward/narrow-revision-preserves-assets.input.json), [proposal](../../packages/skills/test/fixtures/creator-forward/narrow-revision-preserves-assets.output.json) | Changes the overdue calculation to the supplied report date while retaining unrelated instructions. Omitted thresholds, template and binary brand mark remain in the merged bundle. | Four-file valid merged bundle; unchanged metadata and resource bytes; three proposed cases. |

The synthetic inputs and complete independent outputs are retained as test
fixtures. They are not production Tenant data or seeded runtime records.

## Artifact identities

| Case | Proposal JSON SHA-256 | Merged bundle digest |
| --- | --- | --- |
| Purchase-order exceptions | `10747fe4729b86058f40888cdb0332a7da5ddc67d492b4e6b707ef674cc66eae` | `049a839ddc24506a2ea113694fc2ebc9fcbea1cc365f7db9984038e180b14910` |
| PDF dependency | `19d6461d4702c7e1d0468cbba22d143f96ebaefe474a3a6c15a6099afb5588aa` | `cfa7bca67cbd9248e500dfa8afbf20bd3efd3ea2b6e808749bb8414f3d73d317` |
| Narrow revision | `b1be22027a432cb73b46e1bf5f32ab4683656b3c7f208b1a53aca7478bd6a138` | `53681c6c179cea8ff2ed9086c599178b34855256c281873c9ba36498a344608a` |

The maintained policy separately passes the local skill-creator
`quick_validate.py` and the Operator bundle validator. The three earlier
author-generated dry runs were only static preparation; they are not counted
as independent evidence above.

## What remains unverified

This exercise establishes useful creator behavior on three requests and the
actual proposal merge/validation behavior. It does not establish trigger
accuracy, correctness of generated business outputs, equivalent behavior
across Providers, or an end-to-end Skill Builder experience.

The invoice request is still operationally blocked for PDF-only processing in
the supplied target environment. An honest draft describing that dependency is
not evidence of executable PDF support. The requested PDF capability must be
configured before that business task can complete.

For platform acceptance, execute the generated Skills separately: expose only
metadata for selection, run positive and near-miss requests, inspect outputs,
and compare against no Skill or a previous version on intended Model Routes.
Keep evaluator criteria outside the Agent's instructions. Record the served
Provider/model, immutable Skill version, real outputs, errors, latency and
cost. The portal/API journey must also prove that creation opens an editable
draft and that saving a revision preserves the same omitted resource bytes.
