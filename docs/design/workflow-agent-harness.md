# Workflow handoffs and Agent Harness

Connecting two agents compiles an executable data contract. The sender publishes
its named outputs as event fields. The receiver gets typed input ports and
event-specific bindings, and its prompt automatically includes those inputs as
data. Draft tests and published executions use the same Workflow Agent Harness.

## Creating a workflow

1. Create a blank workflow or describe the workflow in the existing generator.
2. Add an agent and write its task under **What should this agent do?**
3. Describe its result under **What should this agent return?** New automated
   steps start with a named string result and a JSON output contract.
4. Connect the sender's output handle to the receiver's input handle. No JSON
   editing is needed. The receiver shows the originating agent, output, and
   reference, such as `{{inputs.from_research_result_abc123}}`.
5. Use **Run → Current draft test**, provide the entry message, and inspect
   each agent's inputs, output, and validation result.
6. Save the draft and publish when ready to make the version live.

The current browser draft is the test target, including unsaved changes.
Saving preserves the generated ports, bindings and provenance in the immutable
workflow version. Publishing retains the existing version and deployment gates.

## Connection contract

`connectWorkflowAgents` in `@agentic/contracts` is a pure compiler used by the
canvas and workflow generator. It returns new definitions and preserves unknown
extension fields. Existing direct output mappings are reused when safe; new
payload fields use stable, bounded identifiers. Runtime envelope fields are
never chosen as business-value destinations.

Each generated receiver input copies the source output's JSON Schema and
sensitivity and carries `workflow_handoff` provenance: source agent id/name,
output id, event name, and whether the output is required. A matching existing
value input can also be bound automatically when its schema is identical or
unconstrained. Arbitrary semantic matching between differently named required
business inputs is not guessed.

Generated ports are optional at the agent level. The harness enforces required
values for the active connection before any model or tool call. This lets an
agent keep an external entry event and several independent incoming connections.
If it otherwise requires an interactive prompt, the connection supplies an
event-specific task prompt, preserving authored overrides and external input
requirements.

**Each incoming event starts its own receiver run.** A graph `A → C ← B` does
not imply that C waits for both agents or collects results from previous runs.
There is no cross-run or cross-tenant lookup in the handoff context.

Reconnect is idempotent and retains edited schemas, nested paths, constants,
and templates. Renaming a producer requires reconnecting to refresh its source
reference. Removing a producer removes only its generated receiver inputs and
their mappings. Validation identifies deleted producers/outputs, disconnected
events, stale names, missing mappings, and incompatible direct schema types.
Complex schemas and nested mappings are validated against actual values at run
time.

When connecting an older untyped agent, its raw output shape and original
single-event branch selection are retained. Original events preserve their
business fields, carried inputs and raw `last_result`; newly added connections
receive its successful result. Legacy plans with explicit emission/subflow actions or an
embedded `_emits` list require migration to an explicit v2 plan first. The
harness refuses these ambiguous migrations rather than turning conditional
branches into unconditional fan-out.

## Shared execution boundary

`WorkflowAgentHarness` in `@agentic/runtime` owns:

- Binding and validation of named inputs and active handoffs.
- Source/run receipts and the structured execution context.
- Prompt compilation that includes connected results even when a custom user
  template omits them. Result contents remain user-role data.
- Validation and repair of model JSON, with decoded tool/action values kept
  distinct from serialized model responses.
- Exact terminal output selection and final validation after output mappings.
- Preparation of authored downstream event payloads with runtime-owned source
  metadata.

Tools receive `ctx.inputs` and `ctx.upstream[sourceAgentId][outputId]` even when
LLM tool arguments replace `ctx.event.data`. The first action can also use
`ctx.lastResult` for its sole incoming producer; subsequent actions retain the
existing action-to-action carry behavior. An explicit `tool_arguments` mapping
continues to minimize the tool context. Upstream carry is not merged into the
receiver's terminal output.

The published registrar keeps input validation and writes inside Inngest
`step.run`, and event dispatch uses `step.sendEvent`. Inngest retains ownership
of durable retries, cancellation, waits, and delivery. Existing tool allow-lists,
gateway routing, timeouts, output artifacts and run evidence remain in force.
The harness is shared workflow infrastructure; the separate Codex app-server
adapter remains a different execution integration.

## Advanced editing

Expand **Advanced settings** to change input/output schemas, trigger bindings,
output bindings, actions, tools and runtime controls. The complete-definition
editor remains lossless. A receiver binding can select a nested field with a
restricted JSONPath such as `$.analysis.score`, use a constant, or use the
existing restricted template syntax. Schema errors and missing required values
stop the affected run rather than silently supplying empty context.

## Verification

Focused tests cover typed multi-agent execution, custom prompts, actual model
tool dispatch, terminal output isolation, decoded strings, missing and malformed
inputs, reserved source metadata, alternate incoming events, repeated
connections, node deletion, schema/reference validation, save/publish roundtrips,
and guided editor rendering. Test fixtures use the existing isolated database
and test gateways; production has no fallback data mode.

Browser verification on 2026-09-09 used the existing `project4` draft and the
configured real gateway. Draft run `run-1591227a6f6d` passed with two agents,
two actions and four events in 7.41 seconds. The first agent returned
`{"reply":"HANDOFF-VERIFIED-42"}`. The second agent's validated named input
contained that exact value, and its final result referenced it. The workflow
remained unpublished.
