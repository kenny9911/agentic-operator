# Portable Skills and agent harness research

Research date: 2026-09-09. Scope: Anthropic authoring guidance and skill-creator, the Agent Skills specification, DeepSeek Harness, the pinned Codex harness, and Pi. This is design evidence and recommendations, not a claim that every recommendation is implemented.

## Finding

Use the open Agent Skills directory format as the exchange format, with a tenant-scoped catalog and a common runtime resolver. Keep the skill lifecycle independent of the selected model provider. Implement discovery, activation, resource access, version selection, and audit records in Agentic Operator; adapt those primitives to each execution harness. Skills supply procedures and supporting resources. The existing tool, credential, tenant, and execution policies must continue to supply authority.

DeepSeek Harness is a real, official product in developer preview as of this research. It is distinct from DeepSeek's model API. Pi and Codex provide useful implementation precedents, but none of these products substitutes for Agentic Operator's tenant boundaries or durable workflow contract. [DeepSeek official announcement](https://deepseek.com/harness/en/), [Pi](https://pi.dev/), [OpenAI skills documentation](https://learn.chatgpt.com/docs/build-skills).

## Sources and reproducibility

Only first-party documentation, the open specification, official source repositories, and this repository were used. Pages were fetched and read, not accepted from search snippets. Source snapshots inspected:

- Anthropic `anthropics/skills`: commit `41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f`, including `skills/skill-creator/SKILL.md` and its license.
- DeepSeek `deepseek-ai/deepseek-harness`: commit `5dda764ed3aa172535a7967b06ff95d9cbfe536a`, including the skills subsystem, registry source, filesystem provider, model-facing loader, and subagent subsystem.
- Agentic Operator: [Codex version pin](../../codex.version) is `0.150.1`; [generated protocol](../../packages/codex-protocol/generated/v2/SkillsListParams.ts) is authoritative for the integration installed here.
- Pi: current first-party skills documentation and product architecture page. No Pi binary was installed or benchmarked.

The repository already has related background in [Agent Factory research](../agent-factory-research-backing.md) and [Codex harness design](../design/codex-harness.md). This dated note keeps the new skills investigation together without rewriting those historical documents.

## Portable format

A skill is a directory containing exactly named `SKILL.md`; optional directories conventionally include `scripts/`, `references/`, and `assets/`. The file starts with YAML frontmatter and continues with Markdown instructions. Required fields are `name` and `description`; optional standardized fields include `license`, `compatibility`, string-valued `metadata`, and experimental `allowed-tools`. The name is 1–64 characters, lowercase alphanumeric with single internal hyphens, and must match the directory; description is 1–1024 characters; compatibility, when present, is at most 500 characters. [Agent Skills specification](https://agentskills.io/specification).

The specification recommends three disclosure stages: metadata first, the selected instructions next, supporting files when needed. Keep `SKILL.md` below 500 lines and preferably below 5,000 tokens. References are relative to the skill root; avoid deep reference chains. A resource can be a script or a binary template, so a text-only editor is insufficient for complete package round trips. The last sentence is an implementation implication of the format. [Agent Skills specification](https://agentskills.io/specification).

Client integration guidance explicitly permits an API-backed registry and a dedicated activation tool when the agent cannot read a filesystem. It supports explicit user invocation as well as model selection from descriptions; model judgment is the common selection mechanism. Filter inaccessible skills out of discovery, record diagnostics, load resources lazily, preserve active instructions during compaction, and avoid duplicate injection. It also describes optional execution in a separate subagent. Cosmetic interoperability issues may be warnings, while missing descriptions and unparseable YAML prevent loading. [Agent Skills client implementation guide](https://agentskills.io/client-implementation/adding-skills-support).

Recommended import behavior: accept a standard ZIP or individual `SKILL.md`, preview diagnostics, and normalize the export to one skill directory. Do not silently rewrite imported instructions. Preserve unknown optional files and metadata so a package can return to its source harness. Keep Agentic Operator ownership, publication, revisions, and permission configuration outside the portable instruction body.

## Anthropic: authoring and the Skill Builder

Anthropic recommends concise instructions that contribute knowledge the model needs, specificity proportionate to a task's fragility, clear trigger descriptions, concrete examples, and testing on every intended model. Procedural steps should have feedback and verification. Detailed references should be easy to find. Scripts should handle expected failures, document dependencies and parameters, and clearly distinguish “execute this” from “read this for explanation.” These recommendations should become builder guidance and editor diagnostics, not just a link in a help page. [Anthropic authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).

The inspected official skill-creator follows an iterative process: capture capability, triggering context, outputs and dependencies; draft a skill; try a few realistic tasks with and without the skill; review results; revise. It separates output evaluation from description-trigger evaluation and proposes both positive and near-miss negative trigger cases. Independent comparison can judge outputs without knowing their source version. Its specific Claude runners and local review scripts are product-specific; Agentic Operator should apply the method using its own gateway and artifacts. [Anthropic skill-creator source, pinned](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/skill-creator/SKILL.md).

Anthropic's March 2026 update explicitly treats tests, benchmarks and description refinement as maintenance tools as models evolve. Instruction quality and trigger reliability are separate concerns: a well-written procedure can still be missed, and an overly broad description can activate on the wrong task. [Anthropic skill-creator update](https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills).

The inspected skill-creator directory includes an Apache-2.0 license. An adaptation that copies upstream material should retain its provenance and notices; a newly written builder instruction can cite the methodology without presenting itself as an Anthropic product. [Upstream license](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/skill-creator/LICENSE.txt).

The Claude API's native Skills feature uses container skills and code execution. That is a provider-specific execution route, not a prerequisite for interpreting portable instructions through another model. An Operator skill should remain usable with the common resolver even when a provider has no native Skills API. [Claude Skills API guide](https://platform.claude.com/docs/en/build-with-claude/skills-guide).

Recommended builder experience:

1. The user describes a capability, inputs and expected output in ordinary language. Reuse supplied context; ask only for missing decisions that materially affect the result.
2. A platform-maintained skill-creator instruction runs through the selected configured gateway model. It generates a portable draft, resource files when justified, and suggested examples with success criteria.
3. Open the generated package directly in the editor. Show the file tree, Markdown preview, validation messages, compatibility requirements and change summary. Keep generated text editable before activation.
4. Save drafts independently of making a revision available to agents. Publishing validates the complete package and creates an immutable revision. A later edit starts from that revision without changing an active run.
5. Offer example runs and comparisons against the previous revision or no skill. Label deterministic checks, model judgments and user reviews separately. Show actual provider/model, revision, outputs, costs and failures; never fabricate a successful evaluation.

These five steps are proposed product behavior, combining the evidence above with Agentic Operator's existing separation of the web UI, API and runtime.

## DeepSeek Harness

DeepSeek's official Harness announcement describes a Cordis kernel with interchangeable plugins for models, skills, tools, sessions, sandboxes, storage, loops and scheduling. Standard mode includes skills, subagents and workflows. Its append-only trajectory records context injections alongside tool and subagent activity. The announcement labels the product a developer preview and warns its APIs will evolve. Treat these as architectural precedents, not a stability guarantee. [Official DeepSeek Harness](https://deepseek.com/harness/en/).

The inspected skills subsystem separates a registry, providers and a model-facing consumer. Providers can expose local, remote or embedded resources. Registry lookup is scoped; nearest scope wins duplicate names, with deterministic ranking within a scope. It distinguishes a complete catalog from an incomplete observation so transient provider failure does not incorrectly retire known skills. Catalog summaries and full definitions are separate. Model and user invocation are independently represented. [DeepSeek skills subsystem, pinned](https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/docs/subsystems/skills.md).

The filesystem provider supports directory bundles and top-level Markdown entries, but intentionally excludes recursive nested skill discovery. It recognizes `.agents/skills` alongside DSH-specific roots and has an `includeDefaultRoots: false` isolation setting. Its loader rereads current bodies, and filesystem changes invalidate catalog discovery. These are implementation choices, not portable-format requirements. [DeepSeek filesystem provider, pinned](https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/skill/skill-filesystem/README.md).

The model-facing consumer publishes a bounded metadata catalog and a `skill` loader. Explicit `/name` input and model loading yield the same instruction representation. A visibility or membership change appends a complete replacement catalog, including an empty replacement after removal. The tool rejects unknown, invalid or model-disabled skill names. [DeepSeek skill consumer, pinned](https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/skill/tool-skill/README.md).

The subagent subsystem separates provider capability validation from execution ownership. Spawned children receive distinct scopes; forked history uses the parent's balanced completed-turn prefix. Delegation depth is persisted, and accepted child runs have paired lifecycle events. History inheritance is explicitly separate from authority inheritance. [DeepSeek subagent subsystem, pinned](https://github.com/deepseek-ai/deepseek-harness/blob/5dda764ed3aa172535a7967b06ff95d9cbfe536a/docs/subsystems/subagent.md).

The DeepSeek API separately documents tool calls: the model requests a tool, application code executes it, and returns the tool result. Selecting the DeepSeek provider therefore does not itself install the DeepSeek Harness or provide its registry, sandbox or scheduling. [DeepSeek Tool Calls](https://api-docs.deepseek.com/guides/tool_calls/).

Recommended application here: adopt registry/provider/consumer separation and explicit invocation checks. Persist the selected content digest in runtime events. Prefer immutable run snapshots to live body rereading for durable workflows, because replay must not pick up an unrelated edit halfway through an execution.

## Codex: respect the installed protocol

Official OpenAI documentation confirms that Codex uses the open format, starts from metadata, and supports explicit and implicit activation. Its current initial catalog has a context budget and may shorten descriptions or omit entries, so essential triggers should come first. Optional appearance/dependency files are extensions rather than requirements for the portable core. [OpenAI Build skills](https://learn.chatgpt.com/docs/build-skills).

The current app-server documentation describes `skills/list`, cache refresh, explicit `{type: "skill", name, path}` turn input, skill configuration, and catalog change notifications. It also documents extra-root features that are newer than this repository's generated schema. [OpenAI App Server](https://learn.chatgpt.com/docs/app-server).

Local verification, rather than latest-document assumptions:

| Integration surface | Verified in pinned `0.150.1` |
| --- | --- |
| Discovery | [`SkillsListParams`](../../packages/codex-protocol/generated/v2/SkillsListParams.ts) contains `cwds` and `forceReload` only. |
| Explicit activation | [`UserInput`](../../packages/codex-protocol/generated/v2/UserInput.ts) includes the `skill` variant with `name` and `path`. |
| Enable/disable | [`SkillsConfigWriteParams`](../../packages/codex-protocol/generated/v2/SkillsConfigWriteParams.ts) includes path or name selectors plus `enabled`. |
| Metadata | [`SkillMetadata`](../../packages/codex-protocol/generated/v2/SkillMetadata.ts) includes path, scope, enabled, interface and dependencies; its generated comment references `SKILL.json`. |
| Client boundary | [`AppServerClient`](../../packages/codex-harness/src/app-server-client.ts) is the single wire-protocol owner, with a generic request method. |
| Process boundary | [`CodexHome`](../../packages/codex-harness/src/codex-home.ts) writes private configuration, disables shell environment inheritance, and uses a Responses-wire gateway provider. |

The current authoring page discusses `agents/openai.yaml`, while the current app-server page and pinned metadata comment refer to `SKILL.json`. Do not silently translate or discard either during import. Preserve them as optional files; verify any active use against the pinned runtime. The same rule applies to `perCwdExtraUserRoots` and `skills/extraRoots/set`: they must not be used merely because the latest docs mention them.

Recommended Codex adapter: materialize only the run's authorized skill revision files under a controlled skill root in the isolated execution environment, verify discovery with pinned `skills/list`, and send explicit skill input when the workflow selects a skill. Resolve paths on the server, not from model-supplied absolute paths. Keep all protocol calls inside `packages/codex-harness` and retain its model-gateway and child-environment constraints. A private `CODEX_HOME` alone is not evidence that every possible host discovery root is isolated; the runtime environment must establish that boundary.

## Pi

Pi's official skills documentation implements the Agent Skills format with lenient diagnostics. It extracts name and description into the prompt, reads `SKILL.md` on demand with `read` or `bash`, and offers `/skill:name` for explicit activation. It supports shared `.agents/skills` locations and configured roots from other harnesses. It deliberately allows name/directory mismatches; missing descriptions or malformed skill files are skipped. `disable-model-invocation` hides a skill from automatic discovery. Pi explicitly notes that models sometimes fail to load a relevant skill, making explicit invocation useful. [Pi skills documentation](https://pi.dev/docs/latest/skills).

Pi calls itself a minimal harness. Its core intentionally leaves features such as subagents, permission flows and MCP integration to extensions, packages or surrounding infrastructure. It exposes interactive, print/JSON, RPC and SDK integration modes. Consequently, importing a Pi-compatible skill is not equivalent to acquiring a production sandbox or a subagent scheduler. [Pi architecture and integration modes](https://pi.dev/).

Recommended application here: retain the small portable instruction package and explicit invocation fallback. Implement Operator's own durable subagent and permission contract rather than inferring it from a skill's origin.

## Runtime design implications for Agentic Operator

The following are project-specific engineering recommendations derived from the comparisons, not promises made by the cited vendors.

**One catalog contract.** Store tenant ownership, stable identity, editable drafts, published revision, content digest and package files in the API-owned data layer. Platform-maintained skills may be shared through an explicit platform scope; a tenant's ordinary skills must never become globally visible merely because all workflows support skills. Define and display collision precedence.

**Separate availability and attachment.** Every supported agent runtime can access its tenant's enabled catalog. Workflow and agent bindings select which skills to advertise or require, with explicit exclusions. Required bindings fail visibly when unavailable; optional discovery should not break a workflow that uses no skill. Record the resolved revision set before execution. Subagents receive an explicit subset under the parent's authority ceiling.

**One activation and resource service.** Both manifest agents and code-defined agents need the same resolution semantics. Tool-capable models can call a small loader and a bounded resource reader. Explicit bindings can preload required instructions for an instruction-only model path. Do not claim autonomous discovery when the configured model cannot request tools. Resource reads should identify a skill revision and relative path rather than accept arbitrary host paths.

**No new permissions through prose.** Imported Markdown, `allowed-tools`, compatibility notes and optional harness files cannot grant credentials or expand the manifest tool allow-list. A skill that asks for unavailable tooling should produce actionable diagnostics. The editor should distinguish a portable package's contents from the capabilities enabled for a particular run.

**Scripts require an execution contract.** Preserve scripts on import/export, but execute them only through an existing bounded sandbox/tool route. Define allowed interpreters, argument handling, network access, timeout, output limits, filesystem mounts and approved credential references. Never interpolate a model-authored script path into a host shell command or run uploaded code in the API process. A read-only resource interface is useful support, but is not full executable-skill support; expose that distinction honestly.

**Package integrity.** Validate ZIP paths before extraction: reject absolute paths, traversal, ambiguous separators, duplicate normalized paths, symlink/hardlink escapes and excessive expansion. Bound archive bytes, expanded bytes, entry count and individual files. Retain binary assets byte-for-byte. Export a standard root folder with `SKILL.md`, resources and applicable license files. Use staged validation before replacing a saved draft.

**Durability and observability.** Include skill identity, revision/digest, source scope, activation origin, resource paths and execution outcomes in run evidence. Keep credentials and complete confidential instructions out of generic logs. Inngest replay must reuse the persisted revision, and mutations must remain inside its durable step boundaries. Preserve or reconstruct active instructions after compaction without changing their version.

**Builder evaluation.** Add tests that should trigger and near misses that should not. Compare the same task and inputs with and without the skill, and compare revisions on intended provider/model combinations. Evaluate actual outputs and task completion, not just a skill-load event. Keep evaluator context separate from the generator where practical, retain costs/latency, and distinguish a lint pass from execution evidence.

## Acceptance evidence and user help

Before claiming complete support, verify a real end-to-end flow: create from a capability request using a configured model, open and edit the draft, publish, attach to an agent/workflow, observe activation, read a packaged reference, produce the expected result, export, reimport, and reproduce the package. Include a script case only on a genuinely enabled execution route.

The automated regression set should cover cross-tenant denial for discovery/load/resource/export, immutable run revision selection during concurrent edits, agent/subagent scope limits, archive attacks, binary round trips, invalid YAML, unsupported dependencies, model errors and compaction/replay behavior. Test the manifest, BaseAgent and any deployed harness adapter independently; a single happy-path model call cannot establish coverage for every provider.

Online help should explain what a skill is, how to describe a capability, editor files and validation, drafts versus published versions, importing/exporting, attaching and explicitly invoking a skill, examples/evaluations, and troubleshooting missed triggers or unavailable tools. Include a short compatibility table reflecting the actual configured runtime. Make help available beside the relevant editor and binding controls, with a full guide in the documentation navigation.

Remaining uncertainty: no comparative benchmark was run across Claude, DeepSeek, Codex and Pi; their architectural documentation does not establish equal task quality. DeepSeek Harness remains a preview. Current Codex documentation is ahead of the installed protocol in specific areas. Portable files enable reuse, while behavior still depends on model quality, available tools, environment and application policy.
