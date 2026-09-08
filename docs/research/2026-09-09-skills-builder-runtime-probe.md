# Skill Builder and real-model runtime verification

Verified 2026-09-09 against the local API on port 3540, portal on 3599, Node 26.8.1 and the configured real Gateway. Browser checks used a separate Chrome context with the existing development authentication mode. No credentials were inserted into a Skill, script or browser fixture.

## Actual user journey

- **Describe → create:** the Builder used the Tenant authoring policy, resolved to `custom/openai/gpt-5.6-luna`. The first proposal had a YAML description containing an unquoted colon; the single bounded repair produced a valid saved Skill and opened its editor. The provenance records both actual calls (7,745 input and 2,632 output tokens), the Creator policy digest and the generated bundle digest. The Skill was `skl-2c291fac6249`, named `skill-builder-verification`.
- **Edit → save:** a new text reference was added in Monaco. The leave-page dialog saved it and returned to the library. Reopening showed revision 2 and the exact content. A seven-byte binary resource (`00 ff 80 0d 0a 50 4b`) was uploaded; revision 3 preserved it. A temporary API restart caused a visible save error, while the local edits remained available and saved successfully after recovery.
- **Publish:** browser confirmation published revision 3 as version 1, `skv-cf33ec69785b`. Runtime availability follows publication, not draft edits.
- **Compare:** two actual `custom/openai/gpt-5.6-luna` calls compared the same observation with and without the saved Skill. The baseline returned two bullets; the Skill response used exactly `Verified`, `Unverified` and `Next checks`, preserved HTTP 200 and did not claim that the unchecked hash had been checked. Usage was 81/74 and 440/38 input/output tokens respectively. The comparison remains **not reviewed**; the agent did not submit a human grade.
- **Export:** the browser downloaded a folder-rooted ZIP. Every exported file matched the saved decoded bytes. The binary SHA-256 was `c30e83df1753c6e73a5e8222bb40058c513935f0f13afc0548a54aef8fa9e99a`.
- **Revise with AI:** a real authoring call revised instructions to permit internal reference reading without performing external checks. It saved revision 4, preserved all three supporting resources byte-for-byte, and recorded 4,193 input/1,409 output tokens. That saved revision was published through the API as version 2, `skv-3aa38e29506b`, digest `8f2d15ad032fc4f52fcaa22275f4ce644f47791ab3f06cf3eddb13326814637c`.
- **Reimport:** the actual ZIP opened in the import editor. Importing its existing name produced an actionable HTTP 409 without losing the preview. Editing only the YAML name to `skill-builder-verification-copy` created draft `skl-5b7993247749`. Every file matched the original bytes except that intentional name change, including the binary resource.

## Real Workflow Test Lab execution

A dedicated draft Workflow, `skills-runtime-verification`, selected and explicitly activated version 2. Its only Agent declared no business Tools. The saved Workflow round-tripped its exact Skill binding. The test requested a verification summary and reads of two bundled references.

The first run failed after an unfinished tool loop. The second returned a plausible answer but its reference reads had all failed: the model supplied both `name` and `id`, while a Zod refinement accepted exactly one. That refinement was not represented by the advertised JSON Schema. This was a failed integration check, despite the second run's valid final answer.

The model-facing schema now exposes one required `id` selector. Trusted SDK callers retain strict name-or-ID compatibility. Prepared messages also identify already active instructions so the model need not activate them again. Test Lab now returns visible, bounded Skill access receipts and the actual terminal error message, without returning resource bodies or opaque provider reasoning as access evidence.

After the fix, run `run-5a5efa94e602` passed in 4,707 ms, with 4,019 input and 244 output tokens. Its child execution `run-472720b54d67` recorded:

| Operation                                              | Exact version         | Result                                                                                    |
| ------------------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------- |
| Explicit activation                                    | `skv-3aa38e29506b`    | Captured digest matched the published revision                                            |
| `skills.read_resource` → `references/manual-review.md` | Same version/digest   | Success, 91 bytes                                                                         |
| `skills.read_resource` → `references/checklist.md`     | Same version/digest   | Success, 1,334 bytes                                                                      |
| Final structured output                                | Same captured session | Valid `reply`, required three sections, HTTP 200, `run-check-007` and `1.250 s` preserved |

The Test Lab emits actual model observations but simulates workflow scheduling and human waits. This does not claim a production broker replay or a human task-quality review. Durable snapshots, trusted broker lineage, replay checkpoints and child restrictions are covered by separate runtime/SQLite integration suites.

## Browser regressions

Six committed Playwright cases exercise the actual React/Monaco UI against isolated per-context API fixtures: nested modal Escape/Tab/focus, pending-upload save gating and merging, deletion during replacement, model-discovery form validity, saved AI revision synchronization and resource retention, and rejected oversized paste restoring the accepted buffer. All six passed together after fixes. Fixtures do not call models or write the live database.

Browser testing found and fixed two shared Monaco synchronization issues: programmatic updates emitted user changes, and passive synchronization could overwrite rapidly typed text with a lagging value. The editor now separates programmatic updates from user edits, synchronizes before another browser event, and uses current file/bundle state when merging.

## Maintenance, help and cleanup

The browser restored version 1 into new draft revision 5; its exact four files matched the original saved bundle and the latest published version remained version 2. In the Workflow editor, changing the selection to version 1 and saving produced the exact pinned binding in the API response. The contextual Skills help opened correctly; Chinese help and the file editor at a 390-pixel viewport had one main landmark and no document-level horizontal overflow.

Both verification Skills were archived after the checks, retaining their versions and comparison records. The unpublished verification Workflow was deleted. Existing business Workflow deployments were not replaced or published by these tests.

## Environment and limits

Migrations 0080–0082 were applied after verified SQLite backups and only while no runs were active. The existing development stack was restarted and returned ready. Test data comes from the actual requests above; no synthetic fallback or demo mode was introduced.

This verifies one configured real model route and representative UI flows, not quality across every Provider or every user task. Separate [script-runner](2026-09-09-skill-runner-probe.md), [CodeAct](2026-09-09-codeact-skills-probe.md) and [Codex](2026-09-09-codex-skills-probe.md) records distinguish real containers, native discovery and deterministic fixtures. Platform deployment approvals and production image allowlists were not changed by these local probes.
