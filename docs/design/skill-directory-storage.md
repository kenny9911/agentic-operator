# Shared and tenant skill directories

The September 2026 review found that the managed library correctly scoped
database records but did not materialize newly authored skills into owner
directories. The portal URL selects the active tenant; it is not a shared
skill's storage owner.

## Directory contract

```text
skills-library/                         # Reviewed shared source collection, Git
  upstream/ adapted/ local/             # Original/adapted bundles and licenses
data/
  shared/skills/<skill-id>/             # Managed shared skills
    owner.json
    current.json
    bundles/<content-digest>/SKILL.md   # Complete bundle including resources
  tenants/<tenant-slug>/skills/<skill-id>/  # Same layout for tenant skills
```

The data root follows the existing `AGENTIC_DATA_ROOT` resolver. The tenant root
honors `AGENTIC_TENANTS_DIR`, defaulting to `<data-root>/tenants`. Tenant code's
legacy `tenants/<slug>/src/skills` remains tenant-specific and continues through
the existing compatibility loader. Development-assistant skills in
`.agents/skills` are separate from the platform library.

Managed files stay in ignored runtime data. The reviewed shared source archive
stays in Git. Skill IDs keep paths stable across names and draft edits. The
owner is resolved from the persisted tenant ID, not the request's tenant slug;
shared skills must belong to `__system`. All complete text and binary resources
stay inside that owner directory.

## Lifecycle and authority

`SkillLibraryStore` applies the same file writer to creation, import, Pro
generation, draft saves, publication, restoration, and archive changes. Its
`current.json` records the owner, current draft, revision history, and published
version references. Identical bytes share an immutable bundle directory rather
than being recopied for every metadata or publication change. Files use private
permissions and are checked before reuse. Invalid editable YAML is preserved;
publication still requires a valid portable bundle.

SQLite remains authoritative for permissions, version identity, bundle bytes,
and captured run snapshots. Files are never silently imported back into the
database or used to widen an agent's tools, credentials, or skill scope. An old
run continues to load its captured version after later edits or archive changes.

The writer stages and verifies complete bundles, then replaces the manifest
atomically before committing the enclosing SQL transaction. A filesystem failure
rolls back the SQL edit. If SQL commit fails after the manifest swap, a conditional
rollback restores the old manifest; it refuses to overwrite a later writer's
manifest. This is not a distributed transaction across SQL and the filesystem:
a process crash can leave a stale manifest or unselected immutable bundles.
The primary API reconciles all records from SQLite at startup, before registering
the normal runtime. Tenant data and historical version IDs are not migrated.

`POST /v1/skills/storage/reconcile` and `pnpm skills:reconcile` provide the same
idempotent recovery through the running API. Only a platform superadmin with
skill-write permission may invoke the endpoint. It accepts no owner or path
parameters and returns only record/change counts. Missing managed copies are
rebuilt; modified bytes, unsafe links, or unrelated existing content are reported
instead of being overwritten. These paths assume operator-controlled filesystem
roots, not protection against another hostile process with the same OS identity.

## Verification on 2026-09-09

- 46 isolated library tests passed: 25 existing library cases, 10 filesystem
  cases, and 11 storage integration cases. Coverage includes binary resources,
  owner isolation, stale revision checks, I/O failures, a real deferred SQL commit
  failure, archive/restore, missing files, reconciliation permissions, and old
  runtime pins, interrupted manifest writes, and deeply nested admitted bundles.
- 8 catalog import tests and 16 runtime tests passed; API typecheck passed.
- Live startup materialized 57 existing records: 53 shared, 4 tenant-owned,
  including 3 archived records. Reconciliation repeated with zero changes.
- All 54 active RAAS-available publications matched their disk copies:
  933 files and 11,321,195 bytes compared against the API bundles.
- Reimporting the reviewed catalog returned 53 unchanged records, zero blocked
  entries, and no duplicate publications. Offline source verification passed for
  1,002 locked source files and 52 upstream skills.

The [Anthropic follow-up](../research/2026-09-09-anthropic-skills-follow-up.md)
found no newly eligible missing skill. Its fourteen clearly licensed skills were
already retained and imported; their 232 source files match the current pin.
