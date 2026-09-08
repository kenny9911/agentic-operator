# Official skills library: sources, portability, and creator quality

Researched: 2026-09-09. Scope: first-party Anthropic and OpenAI skill collections, their checked-in license evidence, portable ingestion, and Pro model authoring. This note records source observations and implementation recommendations; a downloaded bundle, successful import, or benchmark result must be verified separately.

## Source inventory

Counts below were computed from each pinned Git tree by finding files named `SKILL.md`; they are inventory counts, not counts of skills proven to execute in Agentic Operator.

| Official source | Pinned revision | Inventory | Status and useful areas |
| --- | --- | --- | --- |
| [anthropics/skills](https://github.com/anthropics/skills) | [`41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f`](https://github.com/anthropics/skills/tree/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f), committed September 3 | 19 skills under `skills/`, plus one template | Current examples spanning design, communications, Claude API, MCP development, testing, authoring, and documents. |
| [openai/skills](https://github.com/openai/skills) | [`49f948faa9258a0c61caceaf225e179651397431`](https://github.com/openai/skills/tree/49f948faa9258a0c61caceaf225e179651397431), committed June 24 | 44 skills: 39 curated and 5 system | README explicitly deprecates this catalog in favor of `openai/plugins`. Still useful as a pinned source for skill-creator, skill-installer, PDF, GitHub, security, and developer workflows. |
| [openai/plugins](https://github.com/openai/plugins) | [`d416fd5a43426019986b1e489506db3db66dee3d`](https://github.com/openai/plugins/tree/d416fd5a43426019986b1e489506db3db66dee3d), committed September 8 | 535 `SKILL.md` files repository-wide; 534 under `plugins/` | Current curated plugin examples, including partner-authored content. Contains nested skill references and a test fixture, so raw file count overstates independently installable entry points. |

OpenAI's current examples package skills alongside plugin manifests and optional MCP/app configuration. Representative families include web/mobile development, data analytics, life science, design, Notion, Figma, deployment, and business systems. A repository hosted by OpenAI can include third-party authorship and terms; publisher, author, and license should be separate catalog fields. [Current repository structure](https://github.com/openai/plugins/blob/d416fd5a43426019986b1e489506db3db66dee3d/README.md)

## License findings that affect local retention

**Anthropic:** fourteen of the nineteen skill directories contain Apache-2.0 license text. The exceptions are the four document skills below and `doc-coauthoring`. Neither `doc-coauthoring` nor the template has a local license file; there is no repository root license. The README says many skills are Apache-2.0, which does not identify a license grant for an otherwise unlicensed directory. Keep those entries as research candidates until explicit permission is established. [Pinned tree](https://github.com/anthropics/skills/tree/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f), [README license distinction](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/README.md)

The `docx`, `pdf`, `pptx`, and `xlsx` licenses contain specific restrictions, including a prohibition on retaining copies outside Anthropic Services, copying except for temporary authorized service use, derivatives, and distribution. For example: “Extract these materials from the Services or retain copies of these materials outside the Services.” These are not permissive open-source bundles suitable for the proposed local vendor collection on the published license evidence. Record links and the exclusion reason instead of copying their contents into the library. [DOCX license](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/docx/LICENSE.txt), [PDF license](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/pdf/LICENSE.txt), [PPTX license](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/pptx/LICENSE.txt), [XLSX license](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/xlsx/LICENSE.txt)

Preserve relevant third-party notices with the eligible Anthropic bundles. The repository notices separately identify bundled software and fonts under BSD, GPL, MIT-CMU, and SIL terms; a skill's Apache file should not erase those component notices. [Third-party notices](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/THIRD_PARTY_NOTICES.md)

**Legacy OpenAI catalog:** scanning all forty-four local license files found 31 Apache-2.0, 5 MIT, and 8 Figma-specific terms. This supports an initial 36-skill permissive collection, retaining each original license. The Figma licenses reference Figma Developer Terms and should have a distinct terms-review status. [Apache example](https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.system/skill-creator/LICENSE.txt), [MIT example](https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/notion-knowledge-capture/LICENSE.txt), [Figma terms](https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/figma/LICENSE.txt)

**Current OpenAI plugins:** there is no root license. An ancestor-license scan of the 534 `SKILL.md` files under `plugins/` found:

| Evidence | Files covered | Collection treatment |
| --- | ---: | --- |
| MIT license file within skill or ancestor bundle | 103 | Eligible subject to preserving notices and identifying the actual plugin author. |
| Apache-2.0 license file within skill or ancestor bundle | 7 | Eligible subject to preserving notices. |
| Custom license file | 13 | Twelve Figma skills and one internal-use earnings-preview; separate review. |
| License declaration in frontmatter only | 21 | Preserve the declaration and review supporting notices before ingestion; includes a fixture. |
| Neither ancestor license file nor frontmatter declaration | 390 | Research-only until a license source is established. |

This scan is explicit evidence coverage, not a legal determination that every file in a covered bundle has identical terms. Sources: [pinned repository tree](https://github.com/openai/plugins/tree/d416fd5a43426019986b1e489506db3db66dee3d), [Figma license](https://github.com/openai/plugins/blob/d416fd5a43426019986b1e489506db3db66dee3d/plugins/figma/LICENSE.txt), [earnings-preview license](https://github.com/openai/plugins/blob/d416fd5a43426019986b1e489506db3db66dee3d/plugins/public-equity-investing/skills/earnings-preview/LICENSE.txt).

Complete MIT-licensed bundle roots include [Expo](https://github.com/openai/plugins/blob/d416fd5a43426019986b1e489506db3db66dee3d/plugins/expo/LICENSE), [Supabase](https://github.com/openai/plugins/blob/d416fd5a43426019986b1e489506db3db66dee3d/plugins/supabase/LICENSE), [Temporal](https://github.com/openai/plugins/blob/d416fd5a43426019986b1e489506db3db66dee3d/plugins/temporal/LICENSE), [Zoom](https://github.com/openai/plugins/blob/d416fd5a43426019986b1e489506db3db66dee3d/plugins/zoom/LICENSE), [Superpowers](https://github.com/openai/plugins/blob/d416fd5a43426019986b1e489506db3db66dee3d/plugins/superpowers/LICENSE), [Boltz CLI](https://github.com/openai/plugins/blob/d416fd5a43426019986b1e489506db3db66dee3d/plugins/boltz-api-cli/LICENSE), and [Mixpanel headless](https://github.com/openai/plugins/blob/d416fd5a43426019986b1e489506db3db66dee3d/plugins/mixpanel-headless/LICENSE). Other eligible directories use per-skill licenses; do not apply one sibling's license across its whole plugin.

## Portability and ingestion recommendations

The open Agent Skills specification defines a directory with `SKILL.md`, YAML `name` and `description`, and optional resources. Optional fields include license, compatibility, metadata, and experimental allowed-tools. Relative resource paths and progressive disclosure are part of the format. Preserve scripts, assets, and references together; importing only the Markdown loses the workflow's supporting material. [Agent Skills specification](https://agentskills.io/specification)

OpenAI adds optional `agents/openai.yaml` UI metadata and dependency declarations. Codex initially exposes names and descriptions, then loads the selected instructions; an overly large initial catalog can be truncated or partially omitted. Skill folders in `.agents/skills` serve Codex discovery, while a custom platform still needs its own runtime integration. [OpenAI skill loading and metadata](https://learn.chatgpt.com/docs/build-skills)

Recommended Agentic Operator contract:

1. Store immutable upstream bundles under `skills-library/upstream/<source>/`, with source URL, full revision, path, license evidence, acquisition date, and content digest in a lock file. Keep local adaptations outside upstream copies.
2. Import through the existing tenant-aware skill lifecycle. Use a stable source-plus-path identifier so two publishers' `skill-creator` or `pdf` names cannot overwrite one another.
3. Record compatibility separately from import status: instruction-only; executable resources required; external connector required; or host-specific tools required. A successful parse cannot establish runtime compatibility.
4. Load a bounded relevant catalog first and selected skill instructions/resources on demand. Resolve all local resource reads within the imported bundle root.
5. Treat skill tool references as requests for existing capabilities. They do not extend an agent's manifest tool allow-list or supply service credentials.
6. Refresh by pinned reviewable update: compare upstream commits, licenses, dependencies, and file changes; preserve the previous revision for rollback. Adding trustworthy sources should use the same provenance and evaluation process.

These are project integration recommendations inferred from the format and the repository's tenant/tool boundaries, not guarantees made by upstream repositories.

Specific host dependencies matter. Anthropic's creator description optimizer invokes `claude -p`; its comparison flow assumes independent subagents. Its review viewer can produce a static file when no browser server is available. OpenAI's creator generates `agents/openai.yaml` using Python scripts. Those mechanics require adapters or a documented unsupported status when executed by another harness. [Anthropic creator](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/skill-creator/SKILL.md), [OpenAI creator](https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.system/skill-creator/SKILL.md)

## Creator quality and Pro authoring

The most useful combination is OpenAI's focused packaging discipline and Anthropic's comparative evaluation loop. OpenAI emphasizes compact instructions, concrete examples, appropriate freedom, reusable scripts only when needed, and validation. Anthropic compares identical prompts with the candidate skill and a baseline, grades observable assertions, records time and tokens, and supports blind comparison. Its description optimizer uses positive and negative trigger prompts with a held-out split. [OpenAI authoring workflow](https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.system/skill-creator/SKILL.md), [Anthropic evaluation workflow](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/skill-creator/SKILL.md)

Anthropic's authoring guidance also recommends evaluating skills with the models intended to consume them, keeping instructions concise, and designing evaluations before elaborating the skill. A stronger authoring model cannot establish that a downstream model will follow the resulting bundle. [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

For the platform creator, define measurable release evidence rather than an untestable “best” claim:

- Valid bundle and resolvable resources; no undeclared tools or dependencies.
- Positive and negative trigger cases, including realistic adjacent tasks.
- Same-model candidate-versus-baseline comparisons on held-out tasks; preserve the earlier creator version for comparison.
- Observable task success, artifact validity, and human review for qualities that automated assertions cannot measure.
- Recorded provider, exact model identifier, Pro setting, effort, request/run IDs, token usage, elapsed time, failure cases, and grader version.
- Run a representative generated skill through both agent invocation and workflow execution before calling the creator proven in this platform.

These are proposed acceptance criteria; this research has not executed those benchmarks.

### Verified current OpenAI Pro protocol

OpenAI's current Astra guide explicitly lists Pro mode and Structured Outputs among GPT-6 Astra's supported capabilities. The model ID is `gpt-6-astra`. Its model page lists reasoning efforts `low`, `medium`, `high`, `xhigh`, and `max`; `none` is unsupported. Astra tool calling requires Responses. [Astra guide](https://developers.openai.com/api/docs/guides/latest-model), [Astra model reference](https://developers.openai.com/api/docs/models/gpt-6-astra)

Native Pro execution is configured by `reasoning.mode: "pro"` in Responses; it is independent of `reasoning.effort`. The reasoning guide demonstrates this with the GPT-5.6 family. Combined with the Astra guide's stated compatibility, the native configuration for an Astra creator is:

```json
{
  "model": "gpt-6-astra",
  "reasoning": { "mode": "pro", "effort": "high" }
}
```

This applies the documented compatible Pro schema to Astra. Pro performs additional model work and bills aggregated usage at the selected model's token rates; bound output and persist actual usage. `high` is a defensible initial effort, with `max` justified by comparative evaluations. A legacy `-pro` model name is not needed for the native API. [Reasoning mode and cost behavior](https://developers.openai.com/api/docs/guides/reasoning#reasoning-mode), [Astra compatibility](https://developers.openai.com/api/docs/guides/latest-model)

GPT-5.6 Sol also supports Structured Outputs and native Responses, making `gpt-5.6-sol` plus `reasoning.mode: "pro"` another documented route. In contrast, the older GPT-5.4 Pro reference says Structured Outputs and hosted skills are unsupported, so selecting that older model merely for its suffix would impose avoidable restrictions. [Sol model reference](https://developers.openai.com/api/docs/models/gpt-5.6-sol), [GPT-5.4 Pro reference](https://developers.openai.com/api/docs/models/gpt-5.4-pro)

OpenRouter's provider model IDs and account access require a separate live provider catalog check; official OpenAI documentation does not establish OpenRouter aliases. Store the actual served model and route after generation. A documented model capability does not by itself prove this workspace has credentials or entitlement to invoke it.
