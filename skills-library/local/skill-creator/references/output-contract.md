# Skill Builder output contract

Return a single JSON object matching the supplied `SkillCreatorOutputSchema`.
Do not wrap it in Markdown or include additional prose. Its fields are:

| Field | Content |
| --- | --- |
| `files` | Proposed text file additions or replacements. Each is `{ "path": "SKILL.md", "encoding": "utf8", "content": "…" }`. Include a complete `SKILL.md`, not a diff or excerpt. |
| `assumptions` | Strings stating consequential inferred choices or unresolved requirements. Use an empty array when none apply. |
| `suggestedTests` | Proposed cases, each with a unique string `id`, string `prompt`, `shouldTrigger` (boolean), and nonempty `expectedCriteria` (string array). Default to two or three; never exceed ten. |
| `changeSummary` | Concise strings describing what the candidate draft adds or changes. These describe edits, not validation results. |

All paths are relative to the skill root, such as `SKILL.md` or
`references/scoring.md`. Do not include the skill directory prefix, absolute
paths, `..`, backslashes, duplicate paths, or paths to host configuration.
Each file contains real UTF-8 text. Do not return binary encodings, invented
attachment bytes, or placeholders that purport to be executable resources.

For revisions, `files` contains candidate text additions/replacements, not
permission to delete omitted resources. Retain existing binary and unrelated
files. The host merges the proposal against the supplied starting draft and
validates the resulting package; removals require a separate explicit editor
operation. If the request requires a removal, identify the requested removal
in `assumptions` rather than simulating it with an empty replacement.

Each test prompt is input for a later run. `shouldTrigger` and
`expectedCriteria` are evaluator expectations and must not be inserted into
that run's agent instructions. A near-miss case checks that the skill stays
unselected while the agent still responds appropriately to the user's task.
Do not use a test object to report a completed evaluation.

The host validates structure, package limits, frontmatter, and resource paths;
it reports malformed model output as a generation failure. Do not substitute
an invented successful result when generation, validation, or a real
evaluation fails.
