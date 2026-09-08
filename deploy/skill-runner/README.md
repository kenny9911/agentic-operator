# Isolated Skill script image

This image supplies the fixed staging supervisor, Node **26.8.1**, and a
separately pinned Debian `python3` package. It is independent of the CodeAct
Node Agent protocol and does not contain Codex, gateway credentials, the
workspace, or tenant files. No Skill script runs during image build or staging.

Build from an approved Debian-based Node image digest and an exact Python
package version available for that base distribution:

```sh
node deploy/skill-runner/build.mjs \
  --node-image "$REVIEWED_NODE_IMAGE_DIGEST" \
  --python-version "$REVIEWED_PYTHON_DEBIAN_VERSION"
```

The helper rejects mutable base tags. The Dockerfile also checks Node's exact
runtime version before installing Python. OS package resolution occurs only
during this explicit image build. Review the resulting image and configure
its printed `sha256:…` identity in the host's approved image list. Runtime
execution never pulls an image or installs a dependency. `--check` validates
build arguments without invoking Docker. This repository does not supply a
fabricated digest or silently approve a newly built image.

The launcher creates a fresh Docker-managed volume. A non-root staging
container populates it with admitted bytes, verifies their content digest, and
exits. A second non-root container mounts that volume read-only at `/skill`
and gets size-limited writable tmpfs at `/scratch`. Both use a read-only root
filesystem, no network, dropped Linux capabilities, no new privileges, CPU,
memory and process limits. There are no host bind mounts or Docker socket
mounts in either container. Docker documents volume population, separate
volume cleanup, and read-only volume mounts in its [volume
guide](https://docs.docker.com/engine/storage/volumes/); tmpfs sizing and
ownership options are covered in its [tmpfs
guide](https://docs.docker.com/engine/storage/tmpfs/).

Scripts receive literal arguments and bounded stdin. They can read their own
bundle through `SKILL_ROOT=/skill` and write deliverables beneath
`OUTPUT_DIR=/scratch/artifacts`. The launcher returns admitted artifacts as
base64 with host-computed digests. All stdout, stderr and artifact contents
remain untrusted script output. The host authorizer decides whether this
particular run may execute this particular immutable script; Skill metadata
does not grant that capability or any business Tool access.

The Docker Engine socket belongs only to the trusted launcher. Use an
isolated, operator-managed execution daemon. Named volumes consume daemon
storage while an execution is running; the staging protocol limits their
admitted bytes to 20 MiB. Writable script output stays in bounded tmpfs.
Cleanup removes and verifies absence of both containers and the volume,
including cancellation and failed runs. Cleanup uncertainty makes the run
fail; it is never reported as a verified successful execution.

Crash recovery for abrupt launcher/daemon termination must be owned by the
deployment's resource reconciler. Resources carry `io.agentic.role` and
`io.agentic.execution-id` labels to identify a specific attempt. Do not delete
live resources merely because they share a role label. The in-process runner
does not claim it can execute cleanup after its host has died.

## Enable the API host capability

Apply database migrations through **0082** before enabling this capability.
Without `AGENTIC_SKILL_SCRIPT_POLICY`, script execution is disabled. The
operator supplies this JSON through the API process environment:

```json
{
  "image": "<reviewed sha256 image identity>",
  "approvedImages": ["<reviewed sha256 image identity>"],
  "tenantSlugs": ["your-tenant"],
  "interpreters": ["node", "python"]
}
```

Replace both illustrative image placeholders with an installed, reviewed
`sha256:` identity containing 64 lowercase hexadecimal digits, or a registry
reference pinned with `@sha256:`. The selected image must also occur in
`approvedImages`. Mutable tags, unknown policy fields and unapproved images
are rejected. This policy enables only the named Tenants and interpreters.
It is host configuration; do not put it in a Skill or manifest Tool config.

`AGENTIC_SKILL_SCRIPT_DOCKER_SOCKET` selects the operator-owned absolute
Docker socket path; the default is `/var/run/docker.sock`. The socket is
never exposed to scripts. Apply configuration through the usual controlled
API restart. Runtime never pulls images. The local smoke-test image is not
an automatic production approval.

The Agent must also declare `skills.run_script` in its ordinary `tool_use`
allowlist, and an action-level `allowed_tools` selection must retain it.
The Skill must be published, admitted to the run's captured scope, and
active. Neither this business Tool declaration nor a Skill's `allowed-tools`
metadata creates the host capability. Workflow Test Lab's synthetic runs do
not receive script execution capability; use an authorized real run for
integration verification.

```json
{
  "tool_use": [{ "name": "skills.run_script" }]
}
```

The model Tool input contains only `id`, `scriptPath`, `interpreter`, optional
literal `args`, and optional text `stdin`. `scriptPath` must be an admitted
file below `scripts/`. Generated CodeAct code uses the same gate:

```ts
const result = await ctx.skills.runScript({
  id: selectedSkillId,
  scriptPath: "scripts/build-report.py",
  interpreter: "python",
  args: ["--format", "summary"],
  stdin: JSON.stringify(suppliedRecords),
});
```

Use the current CodeAct candidate image containing this SDK RPC method.
CodeAct's Tool policy and production admission checks still apply. There is
no credential field, network opt-in, shell command, dependency installation
or business Tool bridge. Scripts receive no host/model credentials. Pass
only intended task data in arguments/stdin. Their fixed environment contains
`PATH`, scratch-only `HOME`/`TMPDIR`, `SKILL_ROOT`, `OUTPUT_DIR`, and Python
bytecode/buffering settings.

### API host limits and durable accounting

These are the API host defaults, which are deliberately narrower than some
standalone package defaults:

| Limit | API host value |
| --- | --- |
| Script execution | 30 seconds per attempt |
| Staging and each authorization check | 15 seconds each |
| CPU, memory, processes | 1 CPU, 256 MiB, 64 processes |
| Writable scratch | 64 MiB tmpfs |
| Arguments / stdin | 32 arguments, 16 KiB total argument bytes / 256 KiB stdin |
| Combined stdout and stderr | 64 KiB per attempt |
| Artifacts | 32 files, 1 MiB per file and 1 MiB total |
| Durable root execution budget | 4 attempts, 120 seconds reserved script time, 1 MiB cumulative invocation JSON bytes, 8 MiB reserved output ceiling |

Each attempt reserves 30 seconds and 1,088 KiB output before Docker I/O.
Input accounting uses UTF-8 bytes of the complete invocation JSON. The
immutable `skill_script_reservations` ledger groups attempts by the trusted
root Run Skill Snapshot and retains the actual Run/Agent/Skill/version,
input digest and policy digest. Related durable children and process retries
spend that same budget. In-process forks also share the session ledger.
Failed or interrupted attempts retain their reservation; neither retries nor
cleanup refund it. A reservation without a completed execution artifact
means the attempt's outcome is unknown, not successful. Start a new approved
root run when the budget is exhausted.

The explicit administrative `db:wipe-runtime` operation clears runtime
reservations, invocation grants, snapshots and legacy byte captures along
with their Runs. It preserves the managed Skill library, draft history,
publications and evaluations. The database wipe restores retention triggers
and checks foreign keys in the same transaction; a failure rolls back that
database transaction. This is a maintenance operation, not a way for an
Agent or retry to replenish its budget.

Checkpoints retain script usage and the exact host policy digest. Missing,
malformed, rolled-back or changed-policy checkpoints fail closed. Changes to
host policy can therefore prevent an old run from resuming. Current Tenant,
Run status and source authorization are checked again before dispatch, and
the host polls Run cancellation while the container is active.

The API saves admitted binary artifacts and a bounded execution record as
run-level `skill_script` artifacts under `AGENTIC_ARTIFACTS_DIR`. The Tool
returns artifact IDs, names, byte counts and content digests instead of
repeating binary contents in model context. Inspect `ok`, `failure`, exit
status and cleanup evidence before using output. A process returning zero
does not establish that its task result is correct.

## Verification

```sh
corepack pnpm --filter @agentic/skill-runner test
corepack pnpm --filter @agentic/skill-runner typecheck
```

The ordinary suite checks host authorization, version integrity, bounded
protocols, cancellation, cleanup, immutable input, policy inspection, Unix
socket transport and the fixed supervisor's data helpers. It also verifies
that the supervisor refuses to run as an ordinary host process.

Set both values below to enable seven real-container tests. Once enabled, an
unavailable daemon or image fails the tests rather than silently skipping:

```sh
SKILL_RUNNER_SMOKE_IMAGE="$APPROVED_SKILL_RUNNER_IMAGE" \
SKILL_RUNNER_DOCKER_SOCKET="$EXECUTION_DOCKER_SOCKET" \
  corepack pnpm --filter @agentic/skill-runner test
```

These verify Node and Python execution, read-only mounts, scratch artifacts,
non-root identity, network denial, disabled supervisor debug signals, truthful nonzero exits, timeout, output and artifact limits, and
cleanup. On 2026-09-09 all **60 tests passed, including all seven real-container
checks**, after Docker Desktop was started and a pinned Linux arm64 image was
built. The [probe record](../../docs/research/2026-09-09-skill-runner-probe.md)
records the exact base and built image identities. Production deployments
must configure their own reviewed image and execution capability; the local
test does not enable execution for a Tenant.

The API host integration has a separate isolated SQLite suite. Enable its
real-container case with explicitly approved test configuration:

```sh
AGENTIC_TEST_SKILL_SCRIPT_IMAGE="$APPROVED_SKILL_RUNNER_IMAGE" \
AGENTIC_TEST_DOCKER_SOCKET="$EXECUTION_DOCKER_SOCKET" \
  corepack pnpm --filter @agentic/api exec vitest run \
    --config test/skill-script-runtime.isolated.config.ts
```

On 2026-09-09 all five host tests passed, including real Docker execution
through a SkillSession, binary artifact/evidence persistence and verified
cleanup. The suite also covers immutable reservations before external I/O,
descendant/retry/concurrent budget enforcement, and denied Tenant/source/Run
authorization. It uses an in-memory database and does not enable production
Tenant policy.
