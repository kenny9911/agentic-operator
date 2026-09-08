# Skill script runner: real-container verification

Verified locally on 2026-09-09 with Docker Desktop Engine 29.4.3, Linux arm64 containers and host Node 26.8.1. Docker was initially stopped; it was started for this verification. The prior unavailable-daemon result is superseded by this probe.

## Build identity

- Official Node base: `node@sha256:f105cb6a6b56d32ea0295fcd100e4f06afa29ac51396315497f37eb9dc2b2848`, resolved from the arm64 entry of `docker manifest inspect node:26.8.1-bookworm-slim`. A read-only, network-disabled container independently returned `v26.8.1`.
- Debian package pin: `python3=3.11.2-1+b1`, verified against the [Debian Bookworm package catalog](https://packages.debian.org/bookworm/python3) and successfully resolved during the build. The [official Node image](https://hub.docker.com/_/node) supplies the base distribution and runtime.
- Build command: `node deploy/skill-runner/build.mjs --node-image node@sha256:f105cb6a6b56d32ea0295fcd100e4f06afa29ac51396315497f37eb9dc2b2848 --python-version 3.11.2-1+b1 --tag agentic-skill-runner:skills-verification`.
- Built local image: `sha256:d3f4975a3bdfd1fd1e3de94e719b09772ce7182994ba1e66a94a5598cf9f2bc8`.
- Execution socket: `/Users/kenny/.docker/run/docker.sock` (host-only; never mounted into an execution container).

The test fixture explicitly allow-listed this exact image for its disposable probes. This does not enable script execution for any production tenant.

## Evidence

Command, with the two environment variables set to the exact image and socket above:

```sh
SKILL_RUNNER_SMOKE_IMAGE="$VERIFIED_IMAGE" \
SKILL_RUNNER_DOCKER_SOCKET="$EXECUTION_SOCKET" \
  corepack pnpm --filter @agentic/skill-runner test
```

Result: **60 tests passed, zero skipped**, including seven real-container tests:

1. Node ran as UID 65532; skill mount and root writes failed; literal arguments and stdin survived; binary scratch artifact bytes were returned unchanged; both containers and the temporary volume were removed.
2. Python read stdin and imported an admitted sibling resource.
3. Outbound HTTPS could not connect.
4. A runaway loop was terminated within its timeout, with cleanup verified.
5. Excessive stdout returned the output-limit failure and stayed inside its byte cap.
6. Excessive artifact count returned the artifact-limit failure without exposing partial artifacts.

7. The supervisor starts with `--disable-sigusr1`; a child exiting with code 17 remains a failed execution with code 17, and cleanup is verified.

The remaining 53 tests exercise admission, authorization, integrity, daemon inspection, bounded protocol parsing, cancellation, cleanup failures and the Unix-socket transport. They do not replace the container checks.

The verified image includes a defensive Node supervisor flag that prevents SIGUSR1 from activating its inspector. An earlier local image was superseded after independent review found that inspector activation could compromise reported child results within the container. Only the image identity above is covered by the final checks.

## Limits

This is a local Linux arm64 image test. Other deployment architectures must build, review and test their own immutable image. Runtime execution does not install packages or pull images. Tenant authorization and agent Tool allow-lists remain separate from image admission; a Skill cannot grant itself execution permission. The deployment still owns reconciliation after an abrupt launcher or daemon crash. No business integration or tenant credential was exposed to these probes.
