# CodeAct Skills integration evidence

Date: 2026-09-09. Workspace runtime: Node 26.8.1. This note records implementation verification, not a model-quality evaluation or Docker-isolation certification.

## Host and SDK contract

`RunGeneratedCodeOptions.skillSession` is an optional, trusted `SkillSession` resolved by the calling host. It is not part of the JSON candidate execution request or signed remote execute command. Generated input cannot supply a resolver, authorization policy, activation origin, or alternate catalog.

Generated handlers receive four read-only methods:

```ts
const page = await ctx.skills.list({ limit: 20 });
const selected = { id: page.skills[0].id };
const loaded = await ctx.skills.load(selected);
const resources = await ctx.skills.listResources(selected);
const reference = await ctx.skills.readResource(
  selected,
  resources.resources[0].path,
);
```

The methods use dedicated approved RPC names: `skills.list`, `skills.load`, `skills.listResources`, and `skills.readResource`. The local candidate bootstrap, diagnostic worker facade, container protocol validation, signed remote callback validation, SDK contract/runtime guard, and Factory compile/lint surface include these operations. Unbound access fails explicitly. The diagnostic worker remains denied as a production security boundary.

The fifth SDK method, `ctx.skills.runScript({ id, scriptPath, interpreter, args?, stdin? })`, uses the existing business Tool RPC for `skills.run_script`. It requires the immutable business Tool allowlist and a separate host script capability; a Skill session alone does not permit execution. The host supplies the exact activated bundle, execution identity, approved runner image, interpreter policy and budgets. None of those authorities are fields in the generated request.

The host uses the existing strict Skill tool descriptors with `activationOrigin: "model"`. Explicit-only activation, extra origin/authority fields, unknown selectors, unsafe resource paths, unactivated reads, and resource-budget excess fail. Binary resources remain base64 with decoded byte counts; reading a script never executes it. Existing `ctx.tool("skills.list_skills" | "skills.load_skill" | "skills.list_resources" | "skills.read_resource", args)` calls route through the reserved host implementation before business Tool dispatch. No tenant/global override can impersonate these intrinsics, even when no session is bound. Business Tool permissions and effect checks retain their independent allowlist.

Every default gateway reasoning call receives `prepareSkillMessages` output. A custom host should implement `reasonPrepared({ systemPrompt, input, messages })`, send the prepared messages intact, and retain its existing routing/response semantics. This adapter takes precedence whenever supplied. A legacy custom `reason` adapter continues to work without Skills; with a Skill session it fails with `skills_reason_adapter_unsupported`, instead of silently omitting guidance.

Sandbox `spawn` inherits the parent's exact catalog by default. `options.skillIds` may narrow that catalog, including to an empty set; it cannot add IDs. The child receives a fresh fork that preserves immutable versions and policies. A custom host spawn adapter receives the trusted child session separately as fourth argument `{ skillSession }`; that host is responsible for threading it into its child runtime. Production spawning remains disabled. Session references never appear in generated spawn arguments.

`GeneratedCodeExecutionResult.skillAccesses` records successful access operations and, when applicable, exact Skill ID/version/digest, resource path, and decoded returned bytes. It contains no instruction or resource bodies. Internal child CodeAct results contribute their own access records. The host caller owns persistence of these records and its durable session checkpoint.

## Executed checks

From the repository root under the pinned runtime:

```sh
source ~/.nvm/nvm.sh
nvm use 26.8.1
corepack pnpm --filter @agentic/runtime typecheck
corepack pnpm --filter @agentic/agent-sdk typecheck
corepack pnpm --filter @agentic/agent-factory typecheck
corepack pnpm --filter @agentic/runtime exec vitest run src/codeact-skills.test.ts src/codeact-skills-remote.test.ts src/codeact-container.test.ts src/codeact-invoke-binding.test.ts src/codeact-worker-security.test.ts
corepack pnpm --filter @agentic/agent-factory exec vitest run src/codegen-skills.test.ts src/codegen-typecheck.test.ts src/code-lint.test.ts src/system-prompt.test.ts
```

All three typechecks passed. The focused runtime suites passed 30/30 tests; the Factory suites passed 53/53 tests.

The runtime tests launch the actual `codeact-candidate-bootstrap.cjs` with the pinned Node executable and an empty environment. The container adapter performs its normal TypeScript compilation and sends its normal JSON-lines command to this real child process. The test transport simulates Docker configuration/inspection/cleanup evidence; it does not launch a container. This verifies the actual generated-handler SDK facade and host RPC connection, including text/binary reads, version/byte telemetry, discovery-before-load, repeated reasoning after activation, custom adapter semantics, forbidden activation/path/origin attempts, business-tool denial, exact child narrowing, and production spawn denial.

The remote test replaces HTTP transport and sends signed callback messages through the actual `executeProductionCodeActRemote`/`handleProductionCodeActRpc` code. It checks all four Skill methods, invalid signatures and execution identity, unknown methods, replay caching, context teardown, and absence of session/bundle authority from the execute command. Its terminal is deliberately a probe failure; it does not fabricate a successfully executed production container.

## Deployment and evidence limits

The initial tests above used simulated Docker transport. Docker later became available, and the following local container checks supersede that earlier availability limit. No provider model was called; gateway/custom reasoning results in the earlier unit tests remain deterministic fixtures.

## Real local Docker and SDK verification

Docker Engine `29.4.3`, Linux arm64. The existing `apps/api/Dockerfile` target `codeact-candidate` was built from the current worktree with the approved official Node base `node@sha256:f105cb6a6b56d32ea0295fcd100e4f06afa29ac51396315497f37eb9dc2b2848`.

| Local artifact                                                  | Verified identity                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Candidate image `agentic-codeact-candidate:skills-verification` | `sha256:dec10d1e747500f0fdfae867d5f81ab63ed7534990c91e87b2f64b10c4c71775` |
| Candidate Node runtime / user                                   | `v26.8.1` / UID `65532`                                                   |
| Bootstrap SHA-256, identical in source and image                | `3ffa57432785736c09109541b56e66ea349507d8dce04f9de24d9a1d87f756ef`        |
| Separately approved local Skill runner image                    | `sha256:d3f4975a3bdfd1fd1e3de94e719b09772ce7182994ba1e66a94a5598cf9f2bc8` |

The existing `packages/runtime/src/codeact-container.integration.test.ts` passed **1/1** against the real Docker socket. It observed the actual non-root candidate, absence of the host secret canary and secret mounts, strict container configuration, and removal plus absence verification.

The new `apps/api/test/codeact-skills.docker.test.ts` passed **4/4** against real containers:

- The generated handler used native `ctx.skills.list`, `load`, `listResources` and `readResource`. Text and binary bytes, immutable version/digest access records, activation origin and candidate cleanup were checked.
- `runScript` without the business Tool allowlist failed. Catching that RPC error inside generated code did not turn the host execution receipt into success.
- Allowing the business Tool while omitting the independent host script capability still failed, with container cleanup verified.
- With a fixed test host identity and separately approved local runner capability, native `runScript` executed the packaged Node script in the runner container. Its literal argument, stdin and UID were observed; a three-byte `00 ff 80` artifact survived exactly. Candidate removal, script staging/execution container removal, temporary volume absence and the shared script call budget were verified.

Run the opt-in suites using reviewed local image IDs and your Docker socket. Missing opt-in skips; supplied invalid images or sockets fail:

```sh
export FACTORY_CODEACT_REAL_DOCKER=1
export FACTORY_CODEACT_CANDIDATE_IMAGE=sha256:dec10d1e747500f0fdfae867d5f81ab63ed7534990c91e87b2f64b10c4c71775
export FACTORY_CODEACT_DOCKER_SOCKET=/Users/kenny/.docker/run/docker.sock
export SKILL_RUNNER_SMOKE_IMAGE=sha256:d3f4975a3bdfd1fd1e3de94e719b09772ce7182994ba1e66a94a5598cf9f2bc8
corepack pnpm --filter @agentic/runtime exec vitest run src/codeact-container.integration.test.ts
corepack pnpm --filter @agentic/api exec vitest run --config test/codeact-skills.docker.config.ts
```

These are local test executions using an in-memory host session, not production runs or model-quality evaluations. The script artifact was returned and checked in the test; this probe does not claim database artifact persistence or remote executor authentication. No provider request, production allowlist change, image publication or deployment occurred. The local image carries an unverified-local-build label, not a release attestation.

The candidate image bakes in the bootstrap. A deployment must publish and approve the reviewed image digest through its existing release process; an already deployed image does not gain new SDK methods from a source change. Operating-system configuration and cleanup observed here do not prove isolation against every possible container escape.
