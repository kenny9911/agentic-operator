# Official Skill collection: local import verification

Verified 2026-09-09 against the local running Agentic Operator API on port 3540,
using the workspace's pinned Node 26.8.1 runtime. These observations describe
this checkout and local database; no production deployment was performed.

## Completed collection and publication

The collection at [`skills-library/`](../../skills-library/README.md) contains
52 official bundles: 14 Anthropic examples, 36 permissively licensed examples
from the deprecated OpenAI Skills repository, and two current OpenAI developer
skills from its Plugins repository. Source commits, reviewed licenses, retained
notices, exclusions, and checksums are recorded locally. The offline integrity
check covers 1,002 original/adapted files totaling 12,488,772 bytes.

The maintained platform Skill Creator v2 is retained separately under
`skills-library/local/skill-creator`. Its digest is
`9e69be4ba5c7611e6b617aac852a7cba483ed7e21f3259dbef6c0e62e8708d62`.
Together, these 53 bundles were imported and published through the existing
authenticated API as shared Skills.

- Final API import: all 53 published, zero blocked entries.
- Repeated application: 53 unchanged, zero new publications.
- API catalog readback under `__system`, `raas`, and `power-purchase`: every one
  of the 53 expected shared Skills visible, no missing names.
- Local Creator snapshot refresh repeated without changes; digest unchanged.

The first batch reached the API's write-rate limit after 50 publications. A
subsequent idempotent import published the remaining three. The CLI now honors
an explicit API `rate_limited` response and `Retry-After` of up to 60 seconds,
with at most two retries. It does not retry ambiguous network failures.

## Portability adjustments

Anthropic's Claude API description exceeded the portable 1,024-character
limit. An explicitly reviewed adaptation shortens that discovery description,
retains the complete original `SKILL.md` in the bundle, and labels the modified
file. The upstream snapshot remains unchanged.

The OpenAI Cloudflare deployment bundle includes 312 files. The platform's
file-count limit is now 512, preserving the complete bundle. Existing 5 MiB
per-file and 20 MiB per-bundle limits remain in force. Tests cover admission at
512, rejection at 513, and a full directory-to-ZIP round trip.

Imports namespace names and add source provenance to frontmatter, with a
modification notice. Reference and binary file bytes are preserved. File and
bundle digests are checked before import. Source sync protects local edits,
rejects links and unsafe paths, and restores the prior collection if installation
or post-install validation fails.

## Verification evidence

| Check | Result |
| --- | --- |
| Downloader integrity, rollback, licensing, adaptation, digest tests | 16 passed |
| Managed catalog import and runtime integration tests | 8 passed |
| Portable Skills package suite, including v2 creator bundle | 180 passed |
| Contracts suite, including file-count boundaries | 102 passed |
| Creator service tests | 23 passed |
| Managed library tests | 25 passed |
| Web model picker/request tests | 8 passed |
| API and web TypeScript checks | Passed |
| Official skill entrypoint validator for creator v2 | Passed |

The importer/runtime integration test publishes a shared bundle, selects its
exact version through a non-system tenant's workflow and agent bindings,
captures a durable run snapshot, updates the source, deletes the local input,
and reconstructs the original session. It verifies the original instructions,
reference content, and binary bytes remain available through the runtime.

## Pro creation and quality limits

The creator policy was authored by a real configured Pro model and retained as
the exact returned policy bundle. The default route is
`custom/openai/gpt-5.6-sol-pro`; schema repair stays on that route. A real HTTP
generation without an explicit route returned a saved draft and raw
provider-reported `openai/gpt-5.6-sol-pro` evidence. The verification draft was
archived after readback. See the [provider and authoring evidence](2026-09-09-skill-creator-pro.md).

An independent exercise used v2 to revise an invoice-review skill, preserve
binary assets and metadata, and check output against an independent arithmetic
oracle. It also exercised a fresh input variant, missing capability, and a
non-trigger request. See the [forward exercise](2026-09-09-skill-creator-v2-independent-check.md).

These checks establish successful ingestion, shared discovery, captured runtime
resource use, and Pro-backed authoring in this environment. They do not establish
that every upstream skill's external tools are installed, that every skill has
been executed end to end, or that this creator is universally superior. Skill
guidance continues to operate within the selected agent's existing capabilities.

## Skills page follow-up

The live RAAS page initially displayed only about six rows because the portal
shell clips its viewport and the Skills view did not own a scroll container.
The API and browser had the catalog; the rows and pagination below the fold
were inaccessible with normal scrolling. The Skills view now has a bounded
height and vertical scrolling. Native Chrome verification reproduced the
failure, then reached the previously hidden rows and used Load more to load all
54 available skills (53 shared and one RAAS-owned skill).

The page now shows the loaded count, indicates when another page is available,
explains shared availability in the current tenant context, and offers Refresh.
The list refreshes on focus when stale so imports outside this browser can be
discovered. `/portal/raas/skills` identifies the active workspace; shared skills
remain owned by the system library and usable across tenants.

A wheel-scroll/pagination/scope/refresh regression was added to the existing
Playwright suite. This follow-up used native Chrome for live browser verification;
the new Playwright case was not executed during this session.
