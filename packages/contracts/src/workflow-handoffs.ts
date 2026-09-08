import {
  normalizeAgentDefinition,
  type AgentDefinitionV2,
  type AgentInputPortV2,
  type JsonSchema,
} from "./agent-definition";

const RESERVED_EVENT_FIELDS = new Set([
  "source_agent",
  "source_run",
  "subject",
  "last_result",
  "_meta",
  "correlationId",
  "causationId",
  "producedBy",
  "sourceRun",
  "eventId",
  "event_type",
  "event_name",
  "event_id",
  "run_id",
  "request_id",
  "correlation_id",
  "causation_id",
  "prompt",
  "input",
  "__proto__",
  "prototype",
  "constructor",
]);

/** Stable, safe, bounded names even when source ids contain punctuation. */
function handoffId(sourceId: string, outputId: string, event: string): string {
  const identity = JSON.stringify([sourceId, outputId, event]);
  let hash = 2166136261;
  for (let i = 0; i < identity.length; i++) {
    hash = Math.imul(hash ^ identity.charCodeAt(i), 16777619);
  }
  const readable = `${sourceId}_${outputId}`
    .replace(/[^A-Za-z0-9_]/g, "_")
    .slice(0, 85);
  return `from_${readable}_${(hash >>> 0).toString(36)}`;
}

function schemaTypes(schema: JsonSchema): string[] {
  return typeof schema.type === "string"
    ? [schema.type]
    : Array.isArray(schema.type)
      ? schema.type.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
}

function incompatibleTypes(source: JsonSchema, target: JsonSchema): boolean {
  const offered = schemaTypes(source);
  const accepted = schemaTypes(target);
  return (
    offered.length > 0 &&
    accepted.length > 0 &&
    offered.some(
      (type) =>
        !accepted.includes(type) &&
        !(type === "integer" && accepted.includes("number")),
    )
  );
}

function normalizeConnectedAgent(input: unknown): AgentDefinitionV2 {
  const definition = structuredClone(normalizeAgentDefinition(input));
  const raw = input as Record<string, unknown>;
  const legacy = definition.extensions?.compatibility_mode === "v1";
  if (
    legacy &&
    !Array.isArray(definition.extensions?.workflow_legacy_emission_events)
  ) {
    definition.extensions = {
      ...definition.extensions,
      workflow_legacy_emission_events: [...definition.triggered_event],
    };
  }
  if (
    !Array.isArray(raw.outputs) ||
    (legacy &&
      definition.outputs.length === 1 &&
      definition.outputs[0]!.id === "result" &&
      Object.keys(definition.outputs[0]!.schema).length === 0)
  ) {
    // Legacy tools return the result itself, not a newly invented {result}
    // wrapper. Preserve that shape when adding an explicit port contract.
    definition.output_config.unwrap_single_output = true;
    definition.output_config.strict = false;
  }
  if (
    (!Array.isArray(raw.inputs) || legacy) &&
    definition.inputs.some((port) => port.id === "payload")
  ) {
    for (const event of definition.trigger) {
      const bindings = (definition.trigger_bindings ??= {});
      (bindings[event] ??= {}).payload ??= { path: "$" };
    }
  }
  definition.extensions = {
    ...definition.extensions,
    compatibility_mode: "v2",
  };
  return definition;
}

/**
 * Connecting is compilation: publish each source output as an event field and
 * bind it to a typed receiver input. Existing user mappings remain authoritative.
 * This pure compiler is shared by the canvas, API and non-UI authoring clients.
 */
export function connectWorkflowAgents(
  sourceInput: unknown,
  targetInput: unknown,
  eventName: string,
): {
  source: AgentDefinitionV2;
  target: AgentDefinitionV2;
} {
  const event = eventName.trim();
  if (!event || event.length > 160)
    throw new Error("A connection requires an event name of 1–160 characters.");
  const source = normalizeConnectedAgent(sourceInput);
  const target = normalizeConnectedAgent(targetInput);
  if (source.id === target.id)
    throw new Error("An agent cannot connect to itself.");
  source.triggered_event = [...new Set([...source.triggered_event, event])];
  target.trigger = [...new Set([...target.trigger, event])];
  const outgoing: NonNullable<AgentDefinitionV2["output_bindings"]> =
    (source.output_bindings = Object.assign(
      Object.create(null),
      source.output_bindings,
    ));
  const sourceBindings: NonNullable<
    AgentDefinitionV2["output_bindings"]
  >[string] = (outgoing[event] = Object.assign(
    Object.create(null),
    outgoing[event],
  ));
  const incoming: NonNullable<AgentDefinitionV2["trigger_bindings"]> =
    (target.trigger_bindings = Object.assign(
      Object.create(null),
      target.trigger_bindings,
    ));
  const targetBindings: NonNullable<
    AgentDefinitionV2["trigger_bindings"]
  >[string] = (incoming[event] = Object.assign(
    Object.create(null),
    incoming[event],
  ));
  const prompt = target.inputs.find((port) => port.kind === "prompt");
  if (prompt && !Object.hasOwn(targetBindings, prompt.id)) {
    targetBindings[prompt.id] = {
      constant:
        typeof prompt.default === "string"
          ? prompt.default
          : "Carry out your task using the connected upstream results.",
    };
  }

  for (const output of source.outputs) {
    const existing = target.inputs.find(
      (port) =>
        port.workflow_handoff?.source_agent_id === source.id &&
        port.workflow_handoff.source_output_id === output.id &&
        port.workflow_handoff.event === event,
    );
    // Reconnecting an existing link must not reset an operator's schema,
    // constant, nested path, or intentionally removed binding.
    if (existing) {
      existing.workflow_handoff!.source_agent_name = source.name;
      continue;
    }
    let id = handoffId(source.id, output.id, event);
    const baseId = id;
    let inputSuffix = 2;
    while (target.inputs.some((port) => port.id === id))
      id = `${baseId}_${inputSuffix++}`;
    // Reuse an already authored direct mapping for this output when possible.
    // Otherwise use a reserved-looking, collision-free ordinary payload field.
    let field = Object.entries(sourceBindings).find(
      ([key, binding]) =>
        !RESERVED_EVENT_FIELDS.has(key) &&
        "output" in binding &&
        binding.output === output.id &&
        !binding.path,
    )?.[0];
    if (!field || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(field)) {
      field = handoffId(source.id, output.id, event);
      const base = field;
      let suffix = 2;
      while (Object.hasOwn(sourceBindings, field))
        field = `${base}_${suffix++}`;
      sourceBindings[field] = { output: output.id };
    }
    const port: AgentInputPortV2 = {
      id,
      label: `${source.title ?? source.name} · ${output.label ?? output.id}`,
      description:
        output.description ??
        `Output ${output.id} from ${source.title ?? source.name}. Reference as {{json inputs.${id}}}.`,
      kind: "value",
      // Requirements are scoped to the triggering connection, so another
      // upstream event or the workflow's external entry can run independently.
      required: false,
      schema: structuredClone(output.schema),
      sensitivity: output.sensitivity,
      workflow_handoff: {
        source_agent_id: source.id,
        source_agent_name: source.name,
        source_output_id: output.id,
        event,
        required: output.required,
      },
    };
    target.inputs.push(port);
    targetBindings[id] ??= { path: `$.${field}` };
    // Existing explicitly declared ports with the same id are useful semantic
    // matches. Only auto-bind identical schemas (or unconstrained receivers).
    const matching = target.inputs.find(
      (port) =>
        port.id === output.id &&
        port.kind === "value" &&
        !port.workflow_handoff,
    );
    if (
      matching &&
      (Object.keys(matching.schema).length === 0 ||
        JSON.stringify(matching.schema) === JSON.stringify(output.schema))
    ) {
      targetBindings[matching.id] ??= { path: `$.${field}` };
    }
  }
  return { source, target };
}

export interface WorkflowHandoffIssue {
  path: string;
  code: string;
  severity: "error" | "warning";
  message: string;
}

/** Check graph references without inventing schema compatibility for complex JSON Schema. */
export function validateWorkflowHandoffs(
  definitions: unknown[],
): WorkflowHandoffIssue[] {
  const agents = definitions.map(normalizeAgentDefinition);
  const issues: WorkflowHandoffIssue[] = [];
  agents.forEach((target, agentIndex) =>
    target.inputs.forEach((input, inputIndex) => {
      const link = input.workflow_handoff;
      if (!link) return;
      const path = `/agents/${agentIndex}/inputs/${inputIndex}`;
      const error = (code: string, message: string) =>
        issues.push({ path, code, severity: "error", message });
      const source = agents.find((agent) => agent.id === link.source_agent_id);
      if (!source) {
        error(
          "handoff_source_missing",
          `Connected agent '${link.source_agent_id}' no longer exists. Remove or reconnect this input.`,
        );
        return;
      }
      if (source.name !== link.source_agent_name) {
        error(
          "handoff_source_name_changed",
          `Agent '${source.id}' was renamed to '${source.name}'. Reconnect it to update the input reference.`,
        );
      }
      const output = source.outputs.find(
        (port) => port.id === link.source_output_id,
      );
      if (!output) {
        error(
          "handoff_output_missing",
          `Agent '${source.name}' no longer declares output '${link.source_output_id}'. Reconnect or choose another output.`,
        );
        return;
      }
      if (
        !source.triggered_event.includes(link.event) ||
        !target.trigger.includes(link.event)
      ) {
        error(
          "handoff_event_disconnected",
          `Both agents must declare the connection event '${link.event}'.`,
        );
      }
      const binding = target.trigger_bindings?.[link.event]?.[input.id];
      if (!binding) {
        error(
          "handoff_binding_missing",
          `Input '${input.id}' has no mapping for '${link.event}'.`,
        );
        return;
      }
      if ("path" in binding && typeof binding.path === "string") {
        const simpleField = binding.path.match(
          /^\$\.([A-Za-z_][A-Za-z0-9_-]*)$/,
        )?.[1];
        const outgoing = simpleField
          ? source.output_bindings?.[link.event]?.[simpleField]
          : undefined;
        if (simpleField && !outgoing && source.output_bindings?.[link.event]) {
          error(
            "handoff_payload_missing",
            `Agent '${source.name}' does not emit field '${simpleField}'. Update the input mapping.`,
          );
        } else if (outgoing && "output" in outgoing && !outgoing.path) {
          const actual = source.outputs.find(
            (port) => port.id === outgoing.output,
          );
          if (!actual) {
            error(
              "handoff_output_binding_missing",
              `Output mapping references '${String(outgoing.output)}', which '${source.name}' does not declare.`,
            );
          } else if (incompatibleTypes(actual.schema, input.schema)) {
            error(
              "handoff_schema_incompatible",
              `Output '${actual.id}' is incompatible with input '${input.id}'. Update the schema or mapping.`,
            );
          }
        }
      }
    }),
  );
  return issues;
}
