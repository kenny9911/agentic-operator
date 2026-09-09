# Anthropic skills follow-up

Checked: 2026-09-09. Question: does the current official Anthropic collection contain useful, clearly licensed skills missing from Agentic Operator's local library?

**Finding: no new eligible download was found.** The current `main` revision remains `41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f`, committed on 2026-09-03 at 16:37:13 UTC, exactly matching the local source pin. Its nineteen skill directories include fourteen with explicit Apache-2.0 license files, all already selected locally, four restricted document skills, and one skill with no identified license grant. A separate template also lacks an identified license. [Official repository](https://github.com/anthropics/skills), [pinned commit](https://github.com/anthropics/skills/commit/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f), [pinned source tree](https://github.com/anthropics/skills/tree/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f)

## Existing coverage and useful applications

The following inventory was checked against the Git tree and `skills-library/sources.json`. Usefulness judgments are recommendations based on each upstream skill's stated purpose, not measured performance claims.

| Skill directory under `skills/` | Local selection | Suggested use |
| --- | --- | --- |
| `academy-guide` | Present; Apache-2.0 | Claude learning resources and onboarding. |
| `algorithmic-art` | Present; Apache-2.0 | Generative visual experiments. |
| `brand-guidelines` | Present; Apache-2.0 | Anthropic's visual identity; keep its specific brand scope. |
| `canvas-design` | Present; Apache-2.0 | Posters and static visual compositions. |
| `claude-api` | Present; Apache-2.0 | Agents implementing Anthropic SDK/API integrations. |
| `discernment-nudge` | Present; Apache-2.0 | Optional reflective follow-up questions. |
| `doc-coauthoring` | Excluded; no identified license grant | Potentially useful for specifications, proposals, and collaborative documents. |
| `docx` | Excluded; restricted | Word document work, subject to the upstream service-specific terms. |
| `frontend-design` | Present; Apache-2.0 | Frontend implementation and visual design. |
| `internal-comms` | Present; Apache-2.0 | Reusable communication formats. |
| `mcp-builder` | Present; Apache-2.0 | Development of MCP tools and servers. |
| `pdf` | Excluded; restricted | PDF processing, subject to the upstream service-specific terms. |
| `pptx` | Excluded; restricted | Presentation work, subject to the upstream service-specific terms. |
| `skill-creator` | Present; Apache-2.0 | Authoring, evaluating, and improving skills. |
| `slack-gif-creator` | Present; Apache-2.0 | GIF assets for communication. |
| `theme-factory` | Present; Apache-2.0 | Consistent visual themes for artifacts. |
| `web-artifacts-builder` | Present; Apache-2.0 | More complex web artifacts. |
| `webapp-testing` | Present; Apache-2.0 | Browser verification workflows. |
| `xlsx` | Excluded; restricted | Spreadsheet work, subject to the upstream service-specific terms. |

Inventory and purposes: [all skill directories](https://github.com/anthropics/skills/tree/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills), [official marketplace groupings](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/.claude-plugin/marketplace.json). In addition, [`template/SKILL.md`](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/template/SKILL.md) is an unfilled example, not an additional useful production workflow.

For this platform, the strongest existing candidates for active adoption are `skill-creator`, `mcp-builder`, `webapp-testing`, `frontend-design`, and `internal-comms`, with `claude-api` restricted to agents working on Anthropic integrations. Their stated workflows address repeatable authoring, integration, verification, design, and communication tasks. Actual execution still depends on available tools and the consuming agent's bindings. [Creator workflow](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/skill-creator/SKILL.md), [MCP builder](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/mcp-builder/SKILL.md), [web testing](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/webapp-testing/SKILL.md)

## Why doc-coauthoring remains excluded

The missing workflow is useful: it supports gathering context, iterating on a document, and testing whether readers can understand it. However, the following inspected sources do not establish permission to vendor it into this platform:

1. Its `SKILL.md` declares name and description, without a license field, and its directory has no license file. [Document and directory](https://github.com/anthropics/skills/tree/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/doc-coauthoring)
2. The repository has no root `LICENSE`, and its README only identifies many skills as Apache-2.0. That wording does not assign a license to this particular directory. [Repository README](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/README.md)
3. `THIRD_PARTY_NOTICES.md` identifies imageio/imageio-ffmpeg, FFmpeg, Pillow, and named fonts. It contains BSD, GPL, MIT-CMU, and SIL terms for those components; it does not name `doc-coauthoring` or provide an Apache grant for the repository's original skill instructions. [Third-party notices](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/THIRD_PARTY_NOTICES.md)
4. The marketplace lists `doc-coauthoring` in `example-skills`, but the marketplace manifest supplies no license grant. Installation grouping is insufficient evidence to infer Apache coverage. [Marketplace manifest](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/.claude-plugin/marketplace.json)

The supported conclusion is that explicit permission remains unresolved. Retain the source link and exclusion reason; reconsider if Anthropic adds a license or supplies a separate applicable grant. This follow-up did not copy that skill into the local catalog.

## Restricted document skills

The four document skill license files remain identical, with SHA-256 `79f6d8f5b427252fa3b1c11ecdbdb6bf610b944f7530b4de78f770f38741cfaa`. Their additional restrictions address retaining copies outside Anthropic Services, reproduction, derivatives, and distribution. Those published terms do not support treating the bundles as permissively licensed local imports. [DOCX](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/docx/LICENSE.txt), [PDF](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/pdf/LICENSE.txt), [PPTX](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/pptx/LICENSE.txt), [XLSX](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/xlsx/LICENSE.txt)

## Verification performed

- Resolved `main` through the GitHub commit API and inspected its complete recursive tree; the response was not truncated.
- Fetched and compared all fourteen permissive license files with the individually pinned license hashes in the local manifest. All matched, including the distinct `frontend-design` license bytes.
- Compared every selected local Anthropic source file with its upstream Git blob hash: **232 files, 7,529,212 bytes, zero missing files, zero changed files, zero extra files**. These include the fourteen complete bundles, README, and third-party notices.
- Rechecked the missing skill's frontmatter, its directory, repository root, README, marketplace manifest, and third-party notices instead of inheriting another skill's license.
- Executed no upstream scripts and made no catalog, import, or database changes. This verification establishes source coverage and integrity; tenant import status and runtime behavior are separate platform checks.

Recommended next step: improve shared-library organization and tenant selection using the existing fourteen verified bundles. Re-downloading unchanged upstream content would not add capability. Keep original licenses and third-party notices with the reusable sources, and preserve source identities when a tenant adopts a skill.
