# Agentic Operator Skill Collection

Official upstream Skill bundles retained locally for the platform's agents and
workflows. Start with [the inventory](catalog.json), [reviewed sources](sources.json),
and [the source research](../docs/research/2026-09-09-official-skills-library.md).

This folder is the platform collection. The repository's `.agents/skills/` folder
continues to serve development assistants working on this repository.

This is a **shared source collection**, checked into Git; tenant-authored skills
are never written here. The API materializes the managed library under
`data/shared/skills/<skill-id>/` and tenant skills under
`data/tenants/<tenant-slug>/skills/<skill-id>/`. These runtime roots follow
`AGENTIC_DATA_ROOT` and `AGENTIC_TENANTS_DIR` when configured. Each skill has
`current.json` with its owner, current draft, and publication references, plus
the complete files under `bundles/<content-digest>/`. Stable IDs keep a renamed
skill in the same owner directory. Runtime copies remain outside Git.

## Collection layout

| Path | Purpose |
| --- | --- |
| `upstream/anthropic/` | Unmodified, licensed bundles from `anthropics/skills`. |
| `upstream/openai/` | Unmodified, licensed bundles from the deprecated `openai/skills` catalog. |
| `upstream/openai-plugins/` | Selected current examples from `openai/plugins`. |
| `adapted/` | Explicit compatibility adaptations, with original instructions retained. |
| `local/skill-creator/` | Snapshot of the platform's maintained creator policy, available as a shared Skill. |
| `sources.json` | Reviewed GitHub repositories, exact commit pins, selected paths, license hashes, and exclusions. |
| `sources.lock.json` | File hashes and catalog integrity record. |
| `catalog.json` | Import coordinates and stable names; source folders stay unchanged. |

Only Skills whose copying terms were verified as Apache-2.0 or MIT are fetched by
the upstream downloader. Individual license files and repository notices travel
with their sources. OpenAI's older catalog remains useful as a pinned archive;
new research should start with its current successor, `openai/plugins`.

Anthropic's `docx`, `pdf`, `pptx`, and `xlsx` bundles have restrictive terms and
are recorded as exclusions. `doc-coauthoring` and the template have no explicit
license file covering their bundles. OpenAI's older Figma skills use separate
Figma terms. Source URLs and the reason for each exclusion are in `sources.json`.
The collection includes OpenAI's permissively licensed PDF skill.

## Refresh and import

Use the workspace's pinned Node runtime (`nvm use`) and Python 3. The importer
uses the running API, preserving its database writer lease and normal RBAC.

```bash
pnpm skills:check             # Verify local files and catalog without network access
pnpm skills:discover          # Read current source inventories; changes no files or pins
pnpm skills:sync              # Fetch exactly the reviewed pins; run no downloaded scripts
pnpm skills:import            # Preview shared imports; no database changes
pnpm skills:import --apply    # Import and publish compatible bundles
pnpm skills:reconcile         # Rebuild shared/tenant directories from the running API
```

The API URL defaults to `http://127.0.0.1:3540`. Override it with
`--api-url https://your-api.example` or `AGENTIC_API_BASE_URL`. For authenticated
APIs, supply `AGENTIC_API_TOKEN` through your local secret environment; the account
must be a platform superadmin to publish shared Skills. Local development uses
the configured development identity.

The importer adds vendor namespaces, preserving original names in metadata:
`anthropic-mcp-builder`, `openai-pdf`, and `openai-build-chatgpt-app`. Upstream
instructions, reference files, scripts, and binary assets remain together.
Import provenance records the source URL, commit, original name, license, and
bundle digest. Repeating an identical import creates no new publication. Updates
retain immutable old versions and stop on edited drafts, archived entries, or
unrelated records with conflicting names. A blocked entry is reported explicitly.

The Claude API bundle has an explicitly reviewed description override because
its upstream discovery description exceeds the portable 1,024-character limit.
The complete original `SKILL.md` remains available in the adapted bundle and in
the untouched upstream snapshot. Cloudflare's full 312-file bundle is retained;
the platform admits at most 512 files while retaining its existing byte limits.

## Use in agents and workflows

1. Open **Skills** in the portal to inspect the published shared collection.
2. In an Agent or Workflow's Skills selector, inherit the available library or
   select relevant Skills. Pin versions when reproducibility matters.
3. Use explicit start activation when the Skill must be loaded immediately.
   Otherwise its description lets the agent discover and activate it as needed.
4. Start a new run. Existing runs retain their original captured versions.

All tenants can discover published shared Skills. A shared Skill supplies
instructions and bundled resources; it does not install applications, grant
business Tools, provide API keys, or override tenant permissions. Skills written
for Codex, Claude Code, a browser, or a third-party connector may require host
capabilities that the selected agent does not have. Inspect their prerequisites
and verify a representative task before relying on the result. Script execution
uses the platform's existing capability and execution policy.

Blank creation, imports, and AI authoring all use the same owner-based directory
writer. Saving, publishing, restoring, and archiving refresh its manifest.
Only platform superadmins can run cross-tenant reconciliation; the API also
reconciles existing records at startup. File write failures roll back the edit;
SQL commit failures restore the previous directory manifest. The database stays
authoritative for access checks, immutable versions, and captured run resources.
Directly editing a projected bundle does not change an agent's instructions and
causes integrity verification to fail; make edits through the Skills editor.

The platform creator is published separately as `agentic-skill-creator`; the
upstream creator examples remain available for comparison. The built-in authoring
service reads `packages/skills/builtin/skill-creator`, so updating that policy
requires refreshing the local collection snapshot and publishing its next
version with `pnpm skills:snapshot-creator` followed by `pnpm skills:import --apply`.
See [the creator/runtime guide](../docs/user-guides/skills.md).

## Add trustworthy sources

1. Verify ownership from the vendor's official website or documentation. A popular
   repository or marketplace listing alone does not establish authorship.
2. Read the complete bundle, its per-skill and inherited license files, and any
   notices. Record capabilities, runtime assumptions, and likely usage examples
   in a cited note under `docs/research/`.
3. Add only reviewed repository/path pairs to `sources.json`, with a full commit
   revision and SHA-256 of the reviewed license. Preserve third-party authorship
   even when the skill is hosted in an official vendor's repository.
4. Sync, inspect the source diff, run `skills:check`, preview imports, then publish.
   Updating a revision requires reviewing changed license bytes and requirements.
5. Compare results on realistic trigger, non-trigger, resource-use, and failure
   cases. Record observed evidence separately from proposed tests.

Discovery is manual and read-only. It neither automatically trusts new sources
nor silently publishes changed upstream instructions.
