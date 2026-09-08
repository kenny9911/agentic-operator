# @agentic/skill-runner

A host-owned execution foundation for scripts in immutable Agent Skills
bundles. This package does not register a model tool, resolve a mutable
publication, or alter an Agent's business Tool allow-list. Hosts must first
authorize the run's Skill and script capability.

```ts
import { DockerSocketSkillScriptTransport, SkillScriptRunner } from "@agentic/skill-runner";

const runner = new SkillScriptRunner({
  image: executionConfig.reviewedImageDigest,
  approvedImages: executionConfig.approvedImageDigests,
  interpreters: ["node", "python"],
  transport: new DockerSocketSkillScriptTransport({
    socketPath: executionConfig.dockerSocketPath,
  }),
  authorize: ({ identity, skill, scriptPath, interpreter }) =>
    capabilities.canExecuteSkillScript(identity, skill, scriptPath, interpreter),
});

const result = await runner.run({
  identity: { tenantId, agentId, runId },
  skill: { id: skillId, versionId, name, contentDigest },
  bundle: immutableBundle,
  scriptPath: "scripts/build-report.py",
  interpreter: "python",
  args: ["--format", "summary"],
  stdin: JSON.stringify(approvedInput),
  signal: runAbortSignal,
});
```

`identity`, `skill`, `bundle`, the capability callback, image list and socket
configuration come from trusted host state. Model arguments must not install
them. The callback is required and runs before staging and again immediately
before execution. Missing permission, mutable/unapproved images, missing
Docker, changed bundle bytes or weaker daemon policy fail closed.

The result contains `ok`, a typed `failure` when unsuccessful, bounded UTF-8
`stdout` and `stderr`, script `exitCode`, and binary-preserving artifacts.
Evidence identifies the Run, Agent, Tenant, exact Skill version/digest, script
digest, approved image and daemon image ID, policy digest, timestamps, daemon
exit/OOM state when observed, and individually verified cleanup results. A
script exit code is not a judgment that its output satisfies the user's task.
On timeout or cancellation the container can stop before the supervisor
returns its buffered output; those streams may consequently be empty.

Default limits are 30 seconds for execution, 15 seconds for staging and each
authorization check, 256 MiB memory, one CPU, 64 processes, 64 MiB scratch,
256 KiB stdin, 512 KiB combined stdout/stderr, 32 arguments/16 KiB argument
bytes, and 32 artifacts with 2 MiB per file/8 MiB total. Configuration can
select lower limits or raise them only within the package's fixed maxima.
Docker control requests separately have a 10-second default deadline;
cleanup waits for those bounded requests and verifies absence.

The package preserves Python and Node script dependencies contained in the
read-only bundle. External packages must already exist in the reviewed
image. There is no shell command field, network opt-in, credential injection,
business Tool bridge, or automatic dependency installation. Other interpreters
require a new reviewed image and an explicit implementation change.

See the [image and verification guide](../../deploy/skill-runner/README.md).
On 2026-09-09 the suite passed all 60 tests, including seven real-container
checks with an explicitly approved local image. The API host separately
verified SkillSession dispatch, durable reservations and binary artifact
persistence. These local tests do not enable a production Tenant; consult
the deployment guide for host policy and the narrower API limits.
