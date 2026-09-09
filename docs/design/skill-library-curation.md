# Business and agentic-tool skill curation

The managed import collection contains 17 retained skills: three Anthropic,
13 OpenAI and the maintained Agentic creator. The other 36 downloaded bundles
are removed. This is a scope decision for platform agents and workflows; it
does not remove project-authored business or ontology instructions or change
the repository's separate development-assistant skill installation.

`skills-library/curation.json` records each retained and removed catalog ID,
managed name, source identity, revision, digest and rationale. Retained skills
cover business communications, work and knowledge management, meetings,
document/media production, browser/desktop tools and skill/goal authoring.
Creators and the installer are retained as agentic tools. Playwright CLI is
retained for business browser automation; interactive app testing is excluded.
Development, provider API/SDK implementation, framework, repository security,
GitHub, deployment, DevOps and unrelated creative-customization guidance are
outside this collection.

The sync script requires exact agreement between retained curation IDs and
source selection; it also verifies names, source IDs and upstream paths.
Generated catalogs are checked against the same decisions, including maintained
entries. The lock binds the source manifest, curation manifest, catalog and
individual file bytes. Old removed selections therefore fail before downloads
or publication. Discovery reports known excluded paths separately.

For a scope-only change, `python3 scripts/sync-skill-catalog.py --offline`
reuses the verified current snapshot without network access. It admits neither
new sources nor changed revisions. A normal online sync can fetch an explicitly
reviewed revision. Both paths validate the previous managed tree, stage the next
snapshot and roll back publication failures. Unknown or modified source files
cause a failure rather than being erased. Retained licenses, notices, resources
and executable modes remain intact.

## Reconcile previous managed imports

Source pruning does not delete live Skill records. The curation manifest supplies
the managed IDs and source fingerprints for a separate normal API lifecycle
operation. A record must match `metadata.agentic-import-format: catalog-v1`,
`agentic-catalog-id`, `agentic-source-id` and `agentic-upstream-path`, with its
recorded upstream identity and source digest checked before removal. Matching a
display name alone is insufficient. Do not archive tenant-authored records or
silently discard an edited draft.

Run `corepack pnpm skills:retire` to preview matching records, then add `--apply`
to disable and archive eligible previously managed imports through the running
API. Availability is checked on subsequent runtime access, including old run
snapshots; archiving alone does not revoke that access. Normal writes reconcile
the owner directory projections. Report any identity or edited-draft conflict. Preserve
immutable publications and existing run captures; they remain historical
evidence. The curation manifest records the requested reconciliation policy,
not a claim that any live database operation has run.

Onto-work retains only the four entries already in its shared subset that pass
this scope review: Internal Comms, the two upstream creator references and PDF.
It does not globally install the other retained Agentic Operator skills.
