import { describe, expect, it } from "vitest";
import { normalizeAgentDefinition } from "./agent-definition";
import {
  connectWorkflowAgents,
  validateWorkflowHandoffs,
} from "./workflow-handoffs";

function agent(id: string, overrides: Record<string, unknown> = {}) {
  return normalizeAgentDefinition({
    id,
    name: id,
    actor: ["Agent"],
    trigger: ["REQUESTED"],
    triggered_event: [],
    inputs: [
      {
        id: "prompt",
        kind: "prompt",
        required: false,
        schema: { type: "string" },
        default: "Perform the task.",
      },
    ],
    outputs: [
      {
        id: "result",
        schema: {
          type: "object",
          properties: { score: { type: "number" } },
          required: ["score"],
        },
      },
    ],
    actions: [
      { order: "1", name: "execute", type: "logic", description: "Run task" },
    ],
    ...overrides,
  });
}

describe("workflow handoff compiler", () => {
  it("generates schema-preserving references, reuses existing emitted fields, and leaves callers untouched", () => {
    const source = agent("research", {
      output_bindings: {
        READY: { analysis: { output: "result" }, business: { constant: 42 } },
      },
    });
    const target = agent("review");
    const connected = connectWorkflowAgents(source, target, "READY");
    const port = connected.target.inputs.find(
      (input) => input.workflow_handoff,
    )!;
    expect(port.schema).toEqual(source.outputs[0]!.schema);
    expect(port.required).toBe(false);
    expect(port.workflow_handoff).toMatchObject({
      source_agent_id: "research",
      source_output_id: "result",
      event: "READY",
      required: true,
    });
    expect(connected.target.trigger_bindings?.READY?.[port.id]).toEqual({
      path: "$.analysis",
    });
    expect(connected.source.output_bindings?.READY?.business).toEqual({
      constant: 42,
    });
    expect(source.triggered_event).toEqual([]);
    expect(target.inputs).toHaveLength(1);
    expect(
      validateWorkflowHandoffs([connected.source, connected.target]),
    ).toEqual([]);
  });

  it("keeps custom constants and nested paths unchanged on reconnect", () => {
    const connected = connectWorkflowAgents(
      agent("research"),
      agent("review"),
      "READY",
    );
    const port = connected.target.inputs.find(
      (input) => input.workflow_handoff,
    )!;
    const field = Object.keys(connected.source.output_bindings!.READY!)[0]!;
    connected.source.output_bindings!.READY![field] = {
      constant: { score: 77 },
    };
    connected.target.trigger_bindings!.READY![port.id] = {
      path: `$.${field}.score`,
    };
    port.schema = { type: "number" };
    const again = connectWorkflowAgents(
      connected.source,
      connected.target,
      "READY",
    );
    expect(again).toEqual(connected);
  });

  it("handles fan-out and alternate incoming events with isolated optional input ports", () => {
    const first = connectWorkflowAgents(
      agent("research"),
      agent("review"),
      "RESEARCH_READY",
    );
    const second = connectWorkflowAgents(
      agent("score"),
      first.target,
      "SCORE_READY",
    );
    const other = connectWorkflowAgents(
      first.source,
      agent("archive"),
      "RESEARCH_READY",
    );
    const ports = second.target.inputs.filter(
      (input) => input.workflow_handoff,
    );
    expect(ports).toHaveLength(2);
    expect(ports.every((port) => !port.required)).toBe(true);
    expect(new Set(ports.map((port) => port.id)).size).toBe(2);
    expect(other.source.output_bindings).toEqual(first.source.output_bindings);
    expect(
      validateWorkflowHandoffs([
        first.source,
        second.source,
        second.target,
        other.target,
      ]),
    ).toEqual([]);
  });

  it("detects missing producers, disconnected events, removed fields and incompatible direct types", () => {
    const connected = connectWorkflowAgents(
      agent("research"),
      agent("review"),
      "READY",
    );
    expect(validateWorkflowHandoffs([connected.target])[0]?.code).toBe(
      "handoff_source_missing",
    );
    const port = connected.target.inputs.find(
      (input) => input.workflow_handoff,
    )!;
    port.schema = { type: "string" };
    expect(
      validateWorkflowHandoffs([connected.source, connected.target])[0]?.code,
    ).toBe("handoff_schema_incompatible");
    delete connected.source.output_bindings!.READY![
      Object.keys(connected.source.output_bindings!.READY!)[0]!
    ];
    expect(
      validateWorkflowHandoffs([connected.source, connected.target])[0]?.code,
    ).toBe("handoff_payload_missing");
    connected.source.triggered_event = [];
    expect(
      validateWorkflowHandoffs([connected.source, connected.target]).some(
        (issue) => issue.code === "handoff_event_disconnected",
      ),
    ).toBe(true);
  });

  it("preserves legacy raw output shape when introducing a named handoff", () => {
    const legacy = {
      id: "legacy",
      name: "legacy",
      actor: ["Agent"],
      trigger: ["REQUESTED"],
      triggered_event: [],
      actions: [],
    };
    const connected = connectWorkflowAgents(legacy, agent("review"), "READY");
    expect(connected.source.output_config.unwrap_single_output).toBe(true);
    expect(connected.source.output_config.strict).toBe(false);
    expect(connected.source.extensions?.compatibility_mode).toBe("v2");
    expect(
      connected.source.extensions?.workflow_legacy_emission_events,
    ).toEqual([]);
    expect(connected.source.trigger_bindings?.REQUESTED?.payload).toEqual({
      path: "$",
    });
  });

  it("provides an event-scoped task prompt for a receiver that otherwise requires interactive input", () => {
    const target = agent("review", {
      inputs: [
        {
          id: "prompt",
          kind: "prompt",
          required: true,
          schema: { type: "string" },
        },
      ],
    });
    const connected = connectWorkflowAgents(agent("research"), target, "READY");
    expect(connected.target.trigger_bindings?.READY?.prompt).toEqual({
      constant: "Carry out your task using the connected upstream results.",
    });
    expect(connected.target.inputs[0]!.required).toBe(true);
    expect(connected.target.trigger_bindings?.REQUESTED).toBeUndefined();
    target.trigger_bindings = {
      READY: { prompt: { constant: "My custom task" } },
    };
    expect(
      connectWorkflowAgents(agent("research"), target, "READY").target
        .trigger_bindings?.READY?.prompt,
    ).toEqual({ constant: "My custom task" });
  });

  it("uses bounded unique names for long and punctuation-differing source ids", () => {
    const first = connectWorkflowAgents(agent("a-b"), agent("review"), "READY");
    const second = connectWorkflowAgents(agent("a_b"), first.target, "READY");
    const long = connectWorkflowAgents(
      agent("a".repeat(160)),
      second.target,
      "READY",
    );
    const ids = long.target.inputs.map((input) => input.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.length <= 120)).toBe(true);
  });

  it("treats prototype-shaped event names as data", () => {
    const connected = connectWorkflowAgents(
      agent("source"),
      agent("target"),
      "__proto__",
    );
    expect(Object.hasOwn(connected.source.output_bindings!, "__proto__")).toBe(
      true,
    );
    expect(Object.keys(Object.prototype)).toEqual([]);
    expect(() =>
      connectWorkflowAgents(agent("same"), agent("same"), "READY"),
    ).toThrow("itself");
  });

  it("never binds business outputs to reserved runtime envelope fields", () => {
    const source = agent("source", {
      output_bindings: {
        READY: {
          source_agent: { output: "result" },
          source_run: { output: "result" },
        },
      },
    });
    const connected = connectWorkflowAgents(source, agent("target"), "READY");
    const port = connected.target.inputs.find(
      (input) => input.workflow_handoff,
    )!;
    expect(connected.target.trigger_bindings?.READY?.[port.id]).toEqual({
      path: expect.stringMatching(/^\$\.from_source_result_/),
    });
  });

  it("detects and repairs stale producer names without resetting advanced input mappings", () => {
    const connected = connectWorkflowAgents(
      agent("source"),
      agent("target"),
      "READY",
    );
    connected.source.name = "renamedSource";
    expect(
      validateWorkflowHandoffs([connected.source, connected.target])[0]?.code,
    ).toBe("handoff_source_name_changed");
    const repaired = connectWorkflowAgents(
      connected.source,
      connected.target,
      "READY",
    );
    expect(
      validateWorkflowHandoffs([repaired.source, repaired.target]),
    ).toEqual([]);
    expect(repaired.target.trigger_bindings).toEqual(
      connected.target.trigger_bindings,
    );
  });

  it("recognizes legacy definitions already normalized by the API", () => {
    const legacy = normalizeAgentDefinition({
      id: "legacy",
      name: "legacy",
      actor: ["Agent"],
      trigger: ["REQUESTED"],
      triggered_event: [],
      actions: [],
    });
    const connected = connectWorkflowAgents(legacy, agent("review"), "READY");
    expect(connected.source.output_config.unwrap_single_output).toBe(true);
    expect(connected.source.trigger_bindings?.REQUESTED?.payload).toEqual({
      path: "$",
    });
    expect(connected.source.extensions?.compatibility_mode).toBe("v2");
  });
});
