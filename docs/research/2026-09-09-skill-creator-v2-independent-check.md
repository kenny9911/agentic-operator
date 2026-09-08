# Skill Creator v2 independent consumer check

Date: 2026-09-09. The v2 Creator produced a useful invoice-review revision in
this bounded exercise: it preserved the original identity, metadata, reference
rules and binary branding file; identified missing PDF/ERP capabilities; and
produced a portable three-file bundle with no validation diagnostics.

This was a separate Codex subagent consuming the actual
[maintained policy](../../packages/skills/builtin/skill-creator/SKILL.md), its
output contract, and evaluation guide. The subagent authored one proposal and
rehearsed the resulting procedure on real local CSV fixture files. No
additional provider call or production Tenant run was made for this check.
The Pro call that authored the v2 policy is separate evidence.

## Input and observed output

The request revised an existing invoice-review Skill against five supplied
invoice rows, three purchase orders containing four lines, and three receipt
rows. The target had no tools. The starting bundle contained `SKILL.md`, an
approved-rules reference, and a supplied PNG branding asset. The requested
behavior included duplicate invoices, quantity/price differences, arithmetic
checks, traceable source keys and an honest PDF-only dependency outcome.

| Exercise | Observable result |
| --- | --- |
| Revision and merge | Only `SKILL.md` was proposed for replacement. Name, description and `output-owner` metadata were unchanged. The approved rules and PNG bytes remained identical. |
| Five-invoice review | The consumer reported seven issues: two duplicate-invoice findings, two received-quantity shortfalls of 2, a USD 1.00 unit-price difference with USD 3.00 line effect, one missing receipt and a USD 1.00 arithmetic discrepancy. Every issue cited source keys. |
| Post-freeze boundary variant | Three new invoice rows produced one missing-receipt finding. A correct row and a row exactly USD 0.01 from its computed amount produced no exception under the supplied tolerance. |
| PDF-only request | The consumer requested extracted invoice/PO/receipt tables or a configured extraction capability. It did not claim an ERP lookup or an invoice approval. |
| Design near miss | The consumer left the invoice-review Skill unselected and responded to the accounts-payable logo request as a design task. |

A separate deterministic check recomputed all numeric findings directly from
the CSV files using Python `Decimal`, compared issue identities and deltas,
and verified coverage of every invoice. The package verifier ran the proposal
through the real `applySkillCreatorProposal`, checked exact retained resource
bytes and metadata, and confirmed three proposed test cases and no generated
scripts. The maintained policy's full-bundle regression check was also updated
to include all of its references; all 180 `@agentic/skills` tests passed.

## Evidence and limitations

The fixtures, complete proposal, merged bundle, consumer outputs and verifier
are retained locally under
[`data/skill-creator-research/independent-forward-v2`](../../data/skill-creator-research/independent-forward-v2).
Key artifacts are the
[request](../../data/skill-creator-research/independent-forward-v2/creator-request.json),
[proposal](../../data/skill-creator-research/independent-forward-v2/creator-proposal.json)
and [verification record](../../data/skill-creator-research/independent-forward-v2/verification.json).
These are synthetic evaluation files, not production records.

| Identity | SHA-256 |
| --- | --- |
| Creator v2 bundle | `9e69be4ba5c7611e6b617aac852a7cba483ed7e21f3259dbef6c0e62e8708d62` |
| Proposal JSON | `a201287a7a2cf22ef0aa7a1e5174e2521c89062ceb789739cef554d5fbbc751b` |
| Merged invoice-review bundle | `314567c30d41ccdfaa8fe69e4213a0b0426a3b353374668828ea0af223a281b2` |
| Preserved PNG | `17da356d195d4e3fa24f9becbee6b8d9e60e13005762b5ab0809c520c76da6ee` |

This is one author/consumer rehearsal with deterministic output checks. The
consumer was not blinded, the creation inputs were development examples, and
the post-freeze variant is not presented as an independent held-out benchmark.
The near-miss decision is an observed rehearsal, not a measured discovery
accuracy rate. The check does not establish superiority over v1, universal
quality, cross-model performance, executable PDF support or a production
invoice-processing capability.
