# Agentic Operator

Event-driven multi-agent runtime and operations console. A Tenant's business Events trigger Agents; each firing is a Run made of Steps; a Run calls Tools through a credentialed Gateway, pauses for humans at Tasks, and may end by publishing another Event. Two authoring planes (Agent Studio, and the Agent Factory / OntoCode pipeline) produce Agents that reach a Tenant only through a gated Deployment.

This file is a glossary, not a spec. Definitions say what a thing **is**; how it is implemented lives in the code and in `docs/`.

## Language

### Tenancy

**Tenant**:
The top-level isolation unit. Every user-visible record belongs to exactly one Tenant, and its immutable slug namespaces events, function ids, file paths and URLs.
_Avoid_: workspace, business domain (the product-facing label; say Tenant in code and docs), organisation, namespace

**Membership**:
A user's role inside one Tenant: viewer, operator or admin. A platform superadmin bypasses Tenant roles.
_Avoid_: seat, grant, tenant user

**Permission**:
One entry in the single RBAC catalog. The API enforces Permissions; the portal receives the same set as capabilities to gate buttons.
_Avoid_: scope, right, capability (except for the portal-side projection)

**API Token**:
A Tenant-scoped bearer credential for upstream systems. Only its digest is stored; the plaintext exists once, on the create or rotate response.
_Avoid_: PAT, workspace token, key

**Sandbox Tenant**:
A short-lived `-sb` Tenant with its own Inngest app, broker, keys and namespace, created to run a candidate Agent in isolation before Promotion.
_Avoid_: staging (an internal import target name, never user-facing), test tenant, ephemeral app

**Runtime Profile**:
A Tenant-owned logical execution profile whose executable adapter coordinates live in immutable Runtime Profile Versions. It selects reviewed code, never authorization or data scope.
_Avoid_: execution adapter, environment, profile (bare)

### Events and runs

**Event**:
A named, Tenant-namespaced message that triggers Agents. Every Run starts from one Event and may end by emitting another.
_Avoid_: message, signal, trigger (that is the Agent-side declaration)

**Subject**:
The business entity an Event and its Run are about (a candidate, a requisition, a purchase order). At most one Run per Subject is in flight per Agent, and cancellation is addressed by Subject.
_Avoid_: concurrency key, business key, entity id

**Correlation Id**:
The id minted for the first Run in a chain and inherited by every downstream Event, Run and Step, so a whole chain can be traced.
_Avoid_: trace id, causation id (that names only the parent Event)

**Event Ledger**:
The append-only per-Tenant, per-day record of every Event, which the Event row references rather than duplicates.
_Avoid_: event log, event store (the queryable mirror table), audit log

**Run**:
One execution of one Agent, started by one Event. A Run has a technical status (queued, running, ok, failed, waiting, paused, cancelled) and a separate Business Result.
_Avoid_: execution (a different, client-facing envelope), invocation, job

**Business Result**:
The operator-facing outcome of a Run, judged independently of its status: pending, produced, completed, no*output, invalid or failed. A Run can be ok and still have no output.
\_Avoid*: outcome, verdict, result (bare)

**Step**:
One recorded action of a Run. Each authored Action becomes one Step at runtime.
_Avoid_: stage, phase, node

**Run Log**:
The append-only per-Run file, one JSON object per line, that the live tail streams. Distinct from the Run Trace.
_Avoid_: trace, transcript, console

**Run Trace**:
The structured, durable stream of trace events (inputs, prompts, tool calls) behind Studio history and the live stream.
_Avoid_: log, telemetry, history

**Artifact**:
A per-Step input or output sidecar, or an Agent output file, stored under its Run and deleted with it.
_Avoid_: attachment, output file, blob (a Blob is content-addressed and shared)

**Blob**:
Content-addressed bytes shared across Runs and referenced by a small Blob Ref, used to carry oversized payload fields between Agents.
_Avoid_: attachment, file, artifact

**Business Record**:
A durable business entity written by an Agent (a candidate, a resume, a match result) that must outlive the Runs that produced it.
_Avoid_: entity, record (bare), artifact, instance

### Agents and authoring

**Agent**:
A unit of automation that is triggered by Events and produces Steps. An Agent is either a Manifest Agent or a Code Agent.
_Avoid_: bot, worker, function (the Inngest function is the runtime form of a Manifest Agent)

**Manifest Agent**:
An Agent declared in a Workflow Manifest, with Triggers, Emitted Events, Actions and a Tool Allow-list. It needs no TypeScript.
_Avoid_: declarative agent, workflow agent, JSON agent

**Code Agent**:
An Agent written as a TypeScript subclass of the base agent class and registered at import time.
_Avoid_: custom agent, programmatic agent, class agent

**Workflow Manifest**:
The set of Manifest Agents that make up one Tenant's workflow, in its checked-in or authored JSON form.
_Avoid_: workflow (bare: that is the authoring lane), manifest (bare), model, workflow.json

**Model Root**:
The checked-in directory holding one Tenant's Ontology and Workflow Manifest (workflow, actions, events, objects, rules), versioned by suffix.
_Avoid_: model, models dir, manifest dir, domain model

**Action**:
The authored unit inside an Agent Definition: ordered, typed (tool, logic, manual, condition, delay, subflow, invoke, foreach, emit, decision) and turned into one Step at runtime.
_Avoid_: step (the runtime name), task, node, Ontology Action (a different thing)

**Trigger**:
The inbound Event names an Agent listens for.
_Avoid_: subscription, listener, input event

**Emitted Event**:
An Event name an Agent declares it may publish; an emit Action may only emit one of them. Called an Output Port in an Agent Definition.
_Avoid_: emits, output, downstream event

**Agent Definition**:
The canonical, lossless, editor-facing document for one Agent: Ports, bindings, Actions, runtime and output configuration.
_Avoid_: V2 definition, spec (the Factory's internal form), agent JSON

**Port**:
A typed input an Agent asks for (prompt, value or file) or a typed output it publishes, as rendered by the portal. A binding maps a Port onto an Event field.
_Avoid_: field, parameter, argument

**Workflow Handoff**:
The connection contract that makes one Agent's named output available as another Agent's typed input, with its source and Run identifiable. A Handoff applies when its connection Event arrives; separate incoming Events start separate Runs.
_Avoid_: wire, shared memory, join

**Workflow Agent Harness**:
The shared execution boundary that supplies an Agent's validated inputs and upstream results, enforces its output contract, and prepares its downstream Handoffs. Both draft workflow tests and published Runs use the same contract.
_Avoid_: Codex Harness (the separate app-server integration), Conductor

**Workflow**:
The named authoring lane for a Tenant, under which immutable Workflow Versions are recorded.
_Avoid_: pipeline, flow, DAG (the derived layout, not the thing)

**Workflow Version**:
An immutable compiled snapshot of a Workflow. A Deployment makes one Workflow Version live.
_Avoid_: revision, build, release

**Deployment**:
The act, and the record, of making one Workflow Version live for a Tenant, with the prior version kept as a rollback point.
_Avoid_: release, rollout, publish (the Studio verb), promotion (the Factory verb that ends in a Deployment)

**Manifest Import**:
The two-phase validate-then-commit pipeline through which every Workflow Manifest, from any authoring surface, becomes a Deployment.
_Avoid_: upload, import wizard, deploy pipeline

**Conflict**:
A typed blocker found by Manifest Import (block or warn), sometimes with an auto-fix. An Issue is a plain validation diagnostic on a JSON path.
_Avoid_: error, lint finding, diagnostic (for a Conflict)

**Agent Studio**:
The per-Agent authoring surface: a mutable Draft, immutable Draft Revisions, published Agent Versions with diff and restore, and a Test Lab.
_Avoid_: editor, studio (bare), builder

**Draft**:
The mutable working copy of an Agent Definition in Agent Studio. A Factory Draft is a different thing.
_Avoid_: WIP, unpublished version, draft (bare, when the Factory is in scope)

**Test Lab**:
The Agent Studio surface that runs a pinned Draft or the live definition, optionally inside a Studio Session that carries prior turns.
_Avoid_: playground, tester, sandbox (reserved for Sandbox Tenants)

**Studio Session**:
A chat-like container grouping Test Lab runs and messages. A run is isolated by default and sees prior turns only when it opts into session context.
_Avoid_: session (bare), conversation, thread

**Archetype**:
A server-owned starting shape an operator picks when creating a new Agent.
_Avoid_: template (a Workflow Template is a whole-workflow starter), preset, blueprint

### Tasks and control

**Task**:
A durable human-in-the-loop pause: the Run parks until an operator approves, rejects or supplements. Rejecting is a resolution, not a Run failure.
_Avoid_: HITL gate (the Factory term), manual step, approval, ticket, todo, task (bare: see the flagged ambiguity)

**Hold**:
An operator pause of a Run (status paused) before its next Action, released by an explicit resume. Distinct from waiting, which is a Run parked on a Task.
_Avoid_: pause (as a noun), suspend, freeze

**Error Policy**:
An ordered, first-match ladder on an Action that maps an error to park, retry, terminal or continue.
_Avoid_: on_error, retry policy, fallback

**Decision Table**:
A data-only, machine-checkable matrix that picks an outcome, and the Event to emit, deterministically. Shared by authoring, runtime and regression generation.
_Avoid_: rules engine, switch, branching logic

**Rule Gate**:
A runtime obligation check around a Tool call: which server-authored Ontology Rules apply and whether each has a verdict that permits the call. Severity comes only from the rule, never from the Agent.
_Avoid_: guard, policy check, validation

**Side-Effect Mode**:
How far a Run may reach into the world: suppressed, safe or live on the Run; gated, live, mock or replay at Tool dispatch inside a Sandbox Tenant.
_Avoid_: dry run, simulation mode, tool policy (Studio's coarse safe/simulate/live)

**CodeAct**:
Generated handler code executed as an Agent inside an isolation kernel (worker thread, subprocess or container) with every capability crossing an RPC bridge. Production execution requires an exact code attestation.
_Avoid_: inline code, generated agent, script

### Tools and integrations

**Tool**:
A named capability an Agent may call, defined as a plain descriptor with a handler. Registration makes a Tool exist; only a Tool Allow-list makes it callable.
_Avoid_: function, plugin, action, skill

**Global Tool Registry**:
The registry of Tools callable by any Agent in any Tenant. Its JSON projection is the Tool Catalog.
_Avoid_: core tools, tool library, builtin tools

**Tenant Registry**:
A Tenant package's export of Tenant-specific Tools, prompts, MCP Servers, Skills and event adapter. A Tenant Tool shadows a global Tool of the same name.
_Avoid_: tenant package (the code package itself), tenant module, override registry

**Tool Allow-list**:
The Tools an Agent names in its definition. It is the trust boundary: a registered Tool the Agent does not name is not callable by that Agent.
_Avoid_: tool_use (the JSON key), permissions, tool grants

**Tool Config**:
Per-Tenant settings attached to one entry of a Tool Allow-list and handed to the Tool on every call, so one global Tool serves many Tenants.
_Avoid_: options, settings, parameters, env

**Tool Context**:
Everything a Tool handler receives on one call: the invoking Agent and Action, the Subject, the Event data, the Last Result, all prior results, loop locals, Tool Config and memory.
_Avoid_: ctx (in prose), request, environment

**Last Result**:
The previous Step's output, forwarded server-side to the next Tool so large payloads never round-trip through the model.
_Avoid_: previous output, pipe, chained input

**Execution Policy**:
A Tool's reviewed authorization triple: operation (read, compute, write, read*write), effect scope and sandbox policy. It, not the descriptive side-effect label, decides what a Sandbox Tenant may run.
\_Avoid*: side effect (the documentation label), risk level, permission

**Write Probe**:
A disposable synthetic record created, read back and cleaned up by trusted code to prove a write Tool actually writes.
_Avoid_: canary, smoke test, dry run

**Effect Read-back**:
A Tool's declared route for confirming a claimed write by reading it back. An undeclared write reconciles as not verified, never as a pass.
_Avoid_: verification, post-check, confirmation

**Integration**:
A Tenant's binding to one external service: base URL plus credentials, encrypted at rest, with only a masked fragment ever shown.
_Avoid_: connector, credential, connection, provider (reserved for model vendors)

**Integration Profile**:
The human-confirmed, non-secret configuration for one external system: which environment variable names and endpoints apply. It never holds a secret value.
_Avoid_: integration (the secret-bearing binding), config, settings

**System Profile**:
A Tenant's machine-readable declaration of one external platform: canonical id, aliases, capabilities, auth and governance posture. The single authority for system-name aliases.
_Avoid_: external system, connector profile

**MCP Server**:
An external Model Context Protocol process or endpoint whose Tools are folded into a Tenant Registry under a server-qualified name.
_Avoid_: plugin, extension, tool server

**Skill**:
A markdown skill document listed by its frontmatter at boot and loaded on demand by an Agent. A Factory Skill is different: a reusable prompt fragment the Factory authored and scores.
_Avoid_: prompt, instruction, playbook

### Models and usage

**Gateway**:
The single credentialed front door for every model call. One concrete gateway exists per Tenant credential scope behind one stable routing gateway.
_Avoid_: LLM client, provider client, proxy

**Provider**:
A model vendor from the closed catalog (Anthropic, OpenAI, Gemini, and so on), with presets, model catalog and pricing. A Provider is not a Gateway Instance.
_Avoid_: vendor, backend, integration provider (an unrelated id space)

**Gateway Instance**:
A configured model endpoint (direct, OpenRouter, NewAPI, OpenAI-compatible or mock) that serves models from one or more Providers.
_Avoid_: gateway (bare), endpoint, provider

**Model Route**:
The canonical "gateway instance / native model id" string naming exactly which endpoint serves which model.
_Avoid_: model (bare), route (bare), deployment (Azure's word)

**Task Class**:
A named workload bucket an Agent or Action declares instead of naming a model. A Routing Profile maps each Task Class to ordered Model Routes with fallbacks.
_Avoid_: task (bare, overloaded), task type, model profile

**Model Preference**:
A caller's ordered wish-list that may reorder the Model Routes Tenant policy already allows but can never widen them.
_Avoid_: tier, difficulty, override

**Usage Ledger**:
The append-only accounting of every model call, API call and Tool call, with cost in USD nanos and a mandatory Usage Attribution.
_Avoid_: billing, metrics, spend log, telemetry (a separate Factory-only stream)

**Usage Attribution**:
The dimensions that tie a charge to the Tenant, Agent, Run, product interaction and API request that caused it. An unattributable call is rejected when attribution is required.
_Avoid_: tags, labels, metadata

**Logical Call**:
One model call as the caller sees it, spanning every provider Attempt made for it (retries and route fallbacks).
_Avoid_: call (bare), request, turn

**Attempt**:
One provider request made for a Logical Call. Each Attempt is one Usage Ledger row.
_Avoid_: retry, try, call

**Budget Reservation**:
An atomic pre-call capacity claim against a Tenant budget that survives crashes until its lease expires.
_Avoid_: budget lease, quota hold, cap

### Agent Factory

**Agent Factory**:
The authoring plane that generates, verifies and promotes Agents from a business Ontology through a six-stage Conductor (read, plan, design, validate, sandbox, deliver).
_Avoid_: factory (bare, in docs), generator, builder

**Conductor**:
The Agent Factory's streaming reason-act loop that plans, calls Tools, observes and loops until the Acceptance Bar passes or the budget is spent. Its visible Tool roster is derived from the current stage.
_Avoid_: brain, orchestrator, harness, supervisor (a distinct module)

**Factory Draft**:
The durable, reviewable candidate a finished Factory run produces, stored off the live tables until Promotion.
_Avoid_: draft (bare; see the Studio Draft), spec, candidate (the OntoCode term), output

**Promotion**:
The additive, fail-closed transition of chosen Factory Drafts into the live Workflow Manifest through Manifest Import, guarded by roughly twenty gates including a signed isolated-runner receipt and a human review receipt.
_Avoid_: deploy, publish, go-live, release

**Sandbox Attempt**:
The nonce-bearing lifecycle record of one ephemeral Sandbox Tenant: create, commit, run, tear down. Terminal rows stay as audit evidence.
_Avoid_: sandbox run, attempt (bare), staging lane

**Sandbox Model Grant**:
A short-lived, atomically consumed authorization letting a sandbox workload make model calls without ever holding Provider credentials.
_Avoid_: service token, proxy token, key

**Cassette**:
A secret-free recorded request and response, keyed by deterministic hashes, shared by Factory recording, probes and runtime replay. Attested, it becomes Cassette Evidence.
_Avoid_: fixture, recording, replay stub, mock

**Cassette Evidence**:
A Cassette wrapped in an API-issued integrity attestation bound to Tenant, domain and config, so a valid fixture cannot be copied between profiles to fake evidence.
_Avoid_: signed fixture, attestation (bare), proof

**Tool Probe Receipt**:
A record, bound to a Tool's definition hash, that the Tool was verified live, by signed fixture or by runtime record. Only API-attested live probes count as production evidence.
_Avoid_: dispatch verification, health check, probe (bare)

**Acceptance Bar**:
The executable, domain-independent production standard a Factory run must pass: every Action covered, every Tool resolves, a non-simulated sandbox ran the chain to terminal, Rule Gates readable, every input and output typed from the Ontology.
_Avoid_: finish gate, definition of done, quality bar, verdict

**Blueprint**:
A deterministic, Ontology-grounded plan in which every phase and step cites an existing Ontology anchor; anything ungroundable is listed as unresolved rather than invented.
_Avoid_: plan, business flow, outline, design

**Reflection**:
A per-domain persisted lesson (failure, success or caveat) the next Factory run starts from.
_Avoid_: memory (Human Memory and Agent Memory are separate stores), lesson, note

### Ontology and OntoCode

**Ontology**:
A Tenant's business model: Objects, Actions, Events and Rules, plus the links between them, shipped in a Model Root or delivered as an Ontology Package.
_Avoid_: schema, data model, domain model, knowledge graph

**Ontology Action**:
An Action in the business Ontology (something the business does), which the Ontology Compiler turns into one Manifest Agent. Not an Agent Action.
_Avoid_: action (bare), operation, capability

**Ontology Rule**:
A server-authored business obligation in the Ontology whose verdicts Rule Gates check at runtime.
_Avoid_: rule (bare), policy, constraint, validation

**Ontology Package**:
An immutable, schema-validated upstream bundle of an Ontology plus transform maps and studio models. Admission validates and pins it; it is deliberately never compiled into a deployable Workflow Manifest.
_Avoid_: template package, bundle, model root, shadow candidate (its admission receipt)

**Overlay**:
A per-domain file supplying what the Ontology alone cannot: conditional emissions, Rule Gate policy, manual-step forms, extra Tool grants and write parameter mappings for the Ontology Compiler.
_Avoid_: config, patch, extension, declarative overlay (the runtime's Factory-tool overlay)

**Ontology Compiler**:
The deterministic mapping from an Ontology plus Overlay to a Workflow Manifest: one Manifest Agent per Ontology Action.
_Avoid_: generator, transpiler, codegen

**Business Ontology Domain**:
The registration binding one Tenant to one authoritative Ontology Domain, with a runtime binding mode and execution readiness. Its Ontology Domain id is the canonical upstream identity, never inferred from a slug.
_Avoid_: domain binding (the legacy single pointer), domain (bare), registration

**OntoCode**:
The conversational engineering workspace where a forward-deployed engineer and the model build and deploy Agents, layered as Project, Session, Command, Harness Job and Evidence.
_Avoid_: workbench, workspace (bare), chat

**OntoCode Project**:
The durable binding of a Tenant, a Business Ontology Domain and a Runtime Profile Version that owns OntoCode Sessions, artifacts, Evidence and Candidates.
_Avoid_: project (bare), workspace

**OntoCode Session**:
One engineer task thread with a phase, activity, autonomy mode and an immutable selected-Action scope, closed as completed or retired. Not a Studio Session.
_Avoid_: session (bare), thread, build session, conversation

**Command**:
A typed, risk-classified unit of intended work inside an OntoCode Session, idempotent per Session, mapped to a risk and budget by a server-owned policy.
_Avoid_: intent, turn action, request, instruction

**Harness Job**:
One replaceable delivery attempt executing a Command, leased and run by the harness worker. A follow-up or retry creates or re-leases a Job; the stable identity is the Build Execution.
_Avoid_: job (bare), build, run

**Build Execution**:
The stable OntoCode lifecycle record spanning the Harness Jobs and retries that execute one Command.
_Avoid_: execution (bare), engine run (a private adapter binding)

**Codex Harness**:
The fail-closed lifecycle and JSON-RPC adapter around the pinned Codex app-server that backs OntoCode's build engine.
_Avoid_: app server, engine, harness (bare)

**Change Set**:
A proposed, reviewable batch of semantic-path-addressed mutations to OntoCode workspace artifacts, committed as a unit.
_Avoid_: patch, diff, edit, commit

**Evidence Record**:
A typed, outcome-bearing proof about a subject, valid or stale, invalidated explicitly when a Change Set moves the ground beneath it.
_Avoid_: receipt (a wire response envelope), proof, attestation

**Candidate**:
A produced but not yet live Agent package: an immutable Package Version pointed to by the project's Candidate Head, with Candidate Blockers naming why it cannot ship yet.
_Avoid_: release candidate, head (bare), package, draft

**Configuration Task**:
A durable, secret-free continuation between an OntoCode recommendation and a real configuration surface, carrying identifiers and field shapes only.
_Avoid_: task (bare), config gap, setup task, todo

## Relationships

- A **Tenant** owns Workflows, Agents, Events, Runs, Tasks, Integrations, API Tokens and everything else user-visible.
- An **Event** triggers zero or more **Agents**; each firing is one **Run** about one **Subject**, sharing a **Correlation Id** with the chain it belongs to.
- A **Run** is made of **Steps**; each Step comes from one authored **Action**; a Run may park on a **Task** or be placed on **Hold**, and may end by publishing an **Emitted Event**.
- A **Manifest Agent** is declared in a **Workflow Manifest**; a **Deployment** makes one **Workflow Version** live; every path into a Deployment goes through **Manifest Import**.
- An **Agent** calls only Tools on its **Tool Allow-list**; a Tool resolves **Tenant Registry** first, then **Global Tool Registry**, then **MCP Server**.
- Every model call goes through the **Gateway**, is routed by **Task Class** to a **Model Route**, and lands in the **Usage Ledger** with a **Usage Attribution**.
- The **Agent Factory** turns an **Ontology** into **Factory Drafts**; a **Sandbox Attempt** produces the evidence; **Promotion** turns Drafts into a **Deployment**.
- **OntoCode** works on an **OntoCode Project** through **Sessions** of **Commands**, executed by **Harness Jobs** that leave **Evidence Records** and produce **Candidates**.

## Flagged ambiguities

- **task** names three things: a human-in-the-loop pause (**Task**), a model-routing bucket (**Task Class**) and an OntoCode continuation (**Configuration Task**). Never write "task" bare; pick one.
- **session** names a Studio chat container (**Studio Session**) and an OntoCode task thread (**OntoCode Session**). Always qualify.
- **draft** names the Studio working copy (**Draft**) and a Factory candidate (**Factory Draft**). Always qualify.
- **sandbox** is reserved for the isolated **Sandbox Tenant** lane; the Studio surface is the **Test Lab**, and a Run's reach is its **Side-Effect Mode**.
- **execution** is not a synonym for **Run**: agent executions are client-facing envelopes and Build Executions are OntoCode lifecycle records.
- **workspace** is not a domain term; it survives only in AI-settings and API-token scope strings. Say **Tenant**.
- **deploy / publish / promote / release**: Studio publishes an Agent Version, the Factory promotes Factory Drafts, and both end in a **Deployment**. "Release" is not used.
- **receipt** in contract names means a wire-shaped response envelope, not an **Evidence Record**.
- **ticket** belongs to the engineering skills' issue-tracker vocabulary only; it is never a **Task**.
