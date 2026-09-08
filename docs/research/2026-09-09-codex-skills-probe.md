# Pinned Codex Skill adapter evidence

Date: 2026-09-09. Runtime: Node `26.8.1`, macOS arm64, Codex `0.150.1`
installed under `deploy/codex`. These checks exercised the installed native
binary through the actual
[app-server client](../../packages/codex-harness/src/app-server-client.ts).
They made no model call and did not start a thread or turn.

## Implemented adapter

[`materializeCodexSkills`](../../packages/codex-harness/src/skills.ts) accepts
an already authorized host snapshot: `SkillCatalogEntry` identities and their
complete bundles. It uses the common Skill validators, checks names,
descriptions and content digests, copies caller-owned inputs, and writes a
fresh `CODEX_HOME/skills/<name>/` directory. It never scans a developer's
library or merges another run's files. Binary resources retain their bytes;
files have no execute bit. Existing roots, unsafe paths, path/name collisions,
symlinks and hardlinks fail validation.

The returned `CodexSkillSet` supplies a private `HOME`, `USERPROFILE` and
`XDG_CONFIG_HOME`. `AppServerClient` must use those values, its explicit
working directory, the same private `CODEX_HOME`, and `inheritEnv: false`.
The caller still supplies the existing gateway and business-tool policy;
the adapter adds no credentials, tool permissions, shell access or network
authority.

Before starting a thread, `prepareDiscovery(client, cwd)` disables only native
system skills found inside that private home's `.system` directory and checks
the resulting catalog. Unknown user/repository/admin roots, missing skills,
disabled selected skills, metadata mismatches and discovery errors fail
closed. `verifyDiscovery` repeats the check without changing configuration.
`explicitInput(id)` accepts only a selected opaque catalog ID and returns the
server-resolved `{type: "skill", name, path}` protocol value after successful
discovery. It rechecks materialized bytes and does not accept a model path.

Only generated types present in the installed pin are used:

- [`SkillsListParams`](../../packages/codex-protocol/generated/v2/SkillsListParams.ts):
  `cwds` and `forceReload`.
- [`SkillsConfigWriteParams`](../../packages/codex-protocol/generated/v2/SkillsConfigWriteParams.ts):
  path selector plus `enabled: false` for private native system entries.
- [`UserInput`](../../packages/codex-protocol/generated/v2/UserInput.ts):
  the explicit `skill` variant.

The curated protocol export file was updated; generated files and the version
pin were not edited. Current [OpenAI skill documentation](https://learn.chatgpt.com/docs/build-skills)
describes discovery and invocation policies, while the
[app-server documentation](https://learn.chatgpt.com/docs/app-server) describes
the integration surface. The installed protocol and observed binary behavior
remain authoritative here; no newer extra-root API is assumed.

## Commands and observed results

```bash
corepack pnpm --filter @agentic/codex-harness typecheck
corepack pnpm --filter @agentic/codex-harness test
```

The package test suite passed **14 tests, zero failures, zero skips**, including
the installed-binary test in
[`test/skills.test.ts`](../../packages/codex-harness/test/skills.test.ts).
The native test runs when the packaged runtime exists; an environment without
that installation reports a skip rather than substituting a fake binary.

The no-model test creates temporary homes and a temporary working directory,
materializes two supplied skills (including a YAML block description), starts
the pinned app-server, queries skills, disables native system entries, reads
the materialized reference and binary fixture, and injects a synthetic
repository skill to test rejection. The test asserts that every outbound
protocol method belongs to `initialize`, `initialized`, `skills/list`, or
`skills/config/write`. Temporary state is removed after the client closes.

Observed native behavior:

| Observation                                                                                                                                                                                       | Consequence                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The private home initially contains the supplied skill(s) plus six auto-installed system skills: `imagegen`, `openai-docs`, `plugin-creator`, `review-agent`, `skill-creator`, `skill-installer`. | A fresh `CODEX_HOME` is insufficient to ensure that only the supplied skills are enabled.                                                                                       |
| A path-based `skills/config/write` with `enabled: false`, followed by `skills/list` with `forceReload: true`, reports each system entry disabled.                                                 | Preparation can narrow the enabled native catalog to exactly the authorized snapshot. The files still exist locally.                                                            |
| A skill placed under the temporary working directory's `.agents/skills/` appears in native discovery despite the private homes.                                                                   | Repository discovery is an additional source. The adapter detects and rejects it; production needs a controlled working directory and filesystem boundary.                      |
| Native metadata collapses whitespace in a YAML block description.                                                                                                                                 | The adapter compares whitespace-normalized descriptions while independently requiring exact source-file digests. Valid portable block descriptions are preserved byte-for-byte. |
| macOS reports canonical `/private/var/...` paths for temporary directories created through `/var/...`.                                                                                            | Trusted roots and working directories are canonicalized before exact path comparison. Symlinked skill files and roots remain rejected.                                          |

The remaining tests cover digest and metadata mismatch, duplicate identities,
traversal and case collisions, existing/linked materialization roots, binary
round trips, post-materialization mutation and link substitution, immutable
caller snapshots, unauthorized explicit IDs, missing/disabled discovery,
environment mismatch and discovery failure.

## Boundaries that remain with the host

This is a library adapter, not an enabled production Codex execution path.
The low-level materializer does not resolve tenant ownership, select publication
versions, persist run snapshots, wire OntoCode workers, or execute bundled
scripts.

The host-only API service `codex-skill-runtime.ts` now connects that adapter to
the durable managed Run snapshot reader. It copies the tenant/run/agent identity
and snapshot reference, resolves authorized immutable sources, and serializes
authorization plus native discovery checks before returning explicit inputs.
Those inputs are limited to the frozen snapshot's activation IDs. It cannot be
hydrated from an ordinary JSON invocation payload. Its isolated suite passed
**9/9**, including a second actual installed-binary discovery test that asserts
no thread, turn or model request. See
[the bridge design](../design/codex-harness.md#frozen-run-skill-bridge).
This bridge still does not enable selectable production Codex execution;
Manifest, BaseAgent and CodeAct continue through their gateway execution paths.

`CODEX_HOME` and environment isolation do not sandbox the process. A discovery
check also cannot prevent a concurrent writer from replacing files after the
check. Production must isolate the process from developer/admin configuration
and unrelated project roots, protect skill bytes during turns, prevent
untrusted modifications to configuration, and restrict any generic file/tool
access to the approved scope. Disabling a skill in discovery is not a file
access control: the native `.system` resources still exist in the private
home. The host must recheck discovery for the same working directory before
subsequent turns and when resuming a process.

The pinned `skills/list` response does not prove how restrictive invocation
policies map to every native activation route. The adapter therefore throws
`UNSUPPORTED_INVOCATION_POLICY` for catalog `model: false`, `explicit: false`,
or portable `disable-model-invocation: true`. Use the provider-neutral host
`SkillSession` activation path for those policies until the native mapping
is verified; the adapter does not silently broaden them.

No claim is made here about model task quality, implicit-trigger reliability,
native explicit-turn execution, script execution, Windows/Linux behavior, or
full tenant/runtime integration. Those require their own execution evidence.
