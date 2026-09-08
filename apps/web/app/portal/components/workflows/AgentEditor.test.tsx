import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PreferencesProvider } from "@/app/portal/lib/preferences-context";
import { translate } from "@/lib/i18n";
import { createAutomatedAgentDefinition } from "./draft";

vi.mock("@/lib/hooks/useModelFleet", () => ({
  useFleet: () => ({ data: [] }),
  useAvailableModels: () => ({ data: { models: [] } }),
}));
vi.mock("@/lib/hooks/useWorkflowAuthoring", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useGenerateWorkflowAgentPrompt: () => ({ isPending: false }),
}));
import {
  AgentEditor,
  editableTaskActions,
  patchTaskInstruction,
  parseHandoffBindings,
  workflowInputReferences,
  parseCompleteAgentDefinition,
  parseJsonArray,
  parseList,
  parseTypedPorts,
  summarizeAutomaticLinks,
  validateNumberInput,
} from "./AgentEditor";
import type { DagAgent } from "@/lib/hooks/useAgents";

describe("AgentEditor input parsing", () => {
  it("normalizes comma and whitespace-separated events without duplicates", () => {
    expect(parseList("READY, REVIEW\nREADY   COMPLETE")).toEqual([
      "READY",
      "REVIEW",
      "COMPLETE",
    ]);
  });

  it("accepts action and tool arrays while preserving nested extension data", () => {
    expect(
      parseJsonArray(
        '[{"type":"logic","extension":{"quality":"strict"}}]',
        "Actions",
      ),
    ).toEqual([{ type: "logic", extension: { quality: "strict" } }]);
  });

  it("rejects malformed JSON and non-array JSON", () => {
    expect(() => parseJsonArray("{", "Actions")).toThrow(
      "Actions must be valid JSON.",
    );
    expect(() => parseJsonArray('{"name":"meta.ping"}', "Tools")).toThrow(
      "Tools must be a JSON array.",
    );
  });

  it("validates typed input/output port JSON", () => {
    expect(
      parseTypedPorts(
        '[{"id":"request","kind":"value","schema":{"type":"object"}}]',
        "Inputs",
        "inputs",
      ),
    ).toHaveLength(1);
    expect(() =>
      parseTypedPorts(
        '[{"id":"request","schema":{"type":"object"}}]',
        "Inputs",
        "inputs",
      ),
    ).toThrow("Inputs[0].kind");
    expect(() =>
      parseTypedPorts('[{"id":"result"}]', "Outputs", "outputs"),
    ).toThrow("Outputs[0].schema");
  });

  it("reports malformed and out-of-range numeric values", () => {
    expect(
      validateNumberInput("0.5", "Temperature", { min: 0, max: 2 }),
    ).toBeNull();
    expect(validateNumberInput("2.5", "Temperature", { max: 2 })).toBe(
      "Temperature must be at most 2.",
    );
    expect(validateNumberInput("1.5", "Retries", { integer: true })).toBe(
      "Retries must be a whole number.",
    );
    expect(validateNumberInput("", "Stage", { required: true })).toBe(
      "Stage is required.",
    );
  });

  it("validates complete JSON without stripping extension fields", () => {
    const definition = parseCompleteAgentDefinition(
      JSON.stringify({
        id: "triage",
        name: "triage",
        actor: ["Agent"],
        trigger: ["CASE_OPENED"],
        actions: [],
        triggered_event: ["CASE_TRIAGED"],
        tenant_extension: { qualityGate: "strict" },
      }),
      "triage",
    );

    expect(definition.tenant_extension).toEqual({ qualityGate: "strict" });
    expect(() =>
      parseCompleteAgentDefinition(
        JSON.stringify({ ...definition, id: "different" }),
        "triage",
      ),
    ).toThrow('Agent id must remain "triage".');
    expect(() => parseCompleteAgentDefinition("{", "triage")).toThrow(
      "Agent definition must be valid JSON.",
    );
  });

  it("summarizes automatic upstream, downstream, and unmatched events", () => {
    const agents: DagAgent[] = [
      dagAgent("intake", [], ["CASE_OPENED"], "Intake"),
      dagAgent(
        "triage",
        ["CASE_OPENED", "MANUAL_REVIEW"],
        ["CASE_TRIAGED", "AUDIT_ONLY"],
        "Triage",
      ),
      dagAgent("assign", ["CASE_TRIAGED"], [], "Assignment"),
    ];

    expect(
      summarizeAutomaticLinks(
        "triage",
        agents,
        agents[1]!.triggers,
        agents[1]!.emits,
      ),
    ).toEqual({
      incoming: [
        { event: "CASE_OPENED", agentId: "intake", agentTitle: "Intake" },
      ],
      outgoing: [
        { event: "CASE_TRIAGED", agentId: "assign", agentTitle: "Assignment" },
      ],
      unmatchedTriggers: ["MANUAL_REVIEW"],
      unmatchedEmits: ["AUDIT_ONLY"],
      hasWorkflowContext: true,
    });
  });
});

function dagAgent(
  id: string,
  triggers: string[],
  emits: string[],
  title: string,
): DagAgent {
  return {
    id,
    kebabId: id,
    name: id,
    title,
    actor: "Agent",
    triggers,
    emits,
    stage: 0,
    recentRunCount: 0,
    isLive: false,
  };
}

describe("guided workflow authoring", () => {
  it("changes task instructions without losing tools, conditions, or action extensions", () => {
    const actions = [
      {
        type: "tool",
        name: "fetch",
        tool: "meta.ping",
        config: { region: "sg" },
      },
      {
        type: "logic",
        name: "review",
        action_prompt: "Before",
        condition: "approved",
        extension: { enabled: true },
      },
    ];
    expect(editableTaskActions(actions).map((entry) => entry.index)).toEqual([
      1,
    ]);
    const next = patchTaskInstruction(
      actions,
      1,
      "Review {{inputs.previous}} and give a decision.",
    );
    expect(next[0]).toBe(actions[0]);
    expect(next[1]).toEqual({
      ...actions[1],
      action_prompt: "Review {{inputs.previous}} and give a decision.",
    });
    expect(actions[1]?.action_prompt).toBe("Before");
  });

  it("shows the source result, usable reference, and advanced binding override", () => {
    const receiver = createAutomatedAgentDefinition({ id: "review" });
    receiver.inputs = [
      {
        id: "from_research_result",
        kind: "value",
        required: false,
        schema: { type: "string" },
        sensitivity: "none",
        workflow_handoff: {
          source_agent_id: "research",
          source_agent_name: "researchAgent",
          source_output_id: "result",
          event: "RESEARCH_DONE",
          required: true,
        },
      },
    ];
    receiver.trigger = ["RESEARCH_DONE"];
    receiver.trigger_bindings = {
      RESEARCH_DONE: { from_research_result: { path: "event.data.corrected" } },
    };
    const references = workflowInputReferences(receiver, [
      dagAgent("research", [], ["RESEARCH_DONE"], "Research evidence"),
    ]);
    expect(references).toEqual([
      {
        inputId: "from_research_result",
        sourceAgentId: "research",
        sourceTitle: "Research evidence",
        outputId: "result",
        event: "RESEARCH_DONE",
        reference: "{{inputs.from_research_result}}",
        binding: '{"path":"event.data.corrected"}',
      },
    ]);
    receiver.trigger = [];
    expect(workflowInputReferences(receiver, [])).toEqual([]);
  });

  it("validates mapping overrides and preserves tenant extension fields", () => {
    expect(
      parseHandoffBindings(
        '{"DONE":{"summary":{"path":"event.data.result","extension":true}}}',
        "trigger_bindings",
      ),
    ).toEqual({
      DONE: { summary: { path: "event.data.result", extension: true } },
    });
    expect(
      parseHandoffBindings(
        '{"DONE":{"summary":{"output":"result"}}}',
        "output_bindings",
      ),
    ).toEqual({ DONE: { summary: { output: "result" } } });
    expect(() => parseHandoffBindings("[]", "trigger_bindings")).toThrow();
    expect(() =>
      parseHandoffBindings(
        '{"DONE":{"summary":{"output":"result"}}}',
        "trigger_bindings",
      ),
    ).toThrow();
  });

  it("keeps task instructions before collapsed advanced JSON controls", () => {
    const definition = createAutomatedAgentDefinition({
      id: "review",
      actionPrompt: "Review the previous result.",
    });
    const agent = {
      ...dagAgent(
        "review",
        definition.trigger,
        definition.triggered_event,
        "Review",
      ),
      definition,
    };
    const html = renderToStaticMarkup(
      <PreferencesProvider>
        <AgentEditor
          agent={agent}
          workflowAgents={[agent]}
          events={[]}
          draft={undefined}
          onChange={() => {}}
          onToggleWidth={() => {}}
          isWide={false}
          canResize={true}
          onRemove={() => {}}
          onClose={() => {}}
        />
      </PreferencesProvider>,
    );
    expect(html).toContain("Review the previous result.");
    const advanced = html.indexOf("<details");
    expect(advanced).toBeGreaterThan(
      html.indexOf("Review the previous result."),
    );
    expect(html.indexOf('aria-label="Actions JSON"')).toBeGreaterThan(advanced);
    expect(html.slice(advanced, html.indexOf(">", advanced))).not.toContain(
      "open",
    );
  });

  it("shows repaired default text from the resolved definition without restoring stale sparse values", () => {
    const definition = createAutomatedAgentDefinition({ id: "review" });
    const agent = {
      ...dagAgent(
        "review",
        definition.trigger,
        definition.triggered_event,
        "Review",
      ),
      definition,
    };
    const renderDraft = (draft: Parameters<typeof AgentEditor>[0]["draft"]) =>
      renderToStaticMarkup(
        <PreferencesProvider>
          <AgentEditor
            agent={agent}
            workflowAgents={[agent]}
            events={[]}
            draft={draft}
            onChange={() => {}}
            onToggleWidth={() => {}}
            isWide={false}
            canResize={true}
            onRemove={() => {}}
            onClose={() => {}}
          />
        </PreferencesProvider>,
      );
    const html = renderDraft({
      id: "review",
      title: "workflowPage.newNodeDefaults.automatedTitle",
      description: "workflowPage.newNodeDefaults.automatedDescription",
      ontology_instructions:
        "workflowPage.newNodeDefaults.automatedOntologyInstructions",
      actions: [
        {
          ...definition.actions[0],
          action_prompt: "workflowPage.newNodeDefaults.automatedActionPrompt",
        },
      ],
    });
    expect(html).not.toContain("workflowPage.newNodeDefaults.");
    expect(html).toContain("New automated step");
    const cleared = renderDraft({
      id: "review",
      description: null,
      ontology_instructions: null,
    });
    expect(cleared).not.toContain(definition.description);
    expect(cleared).not.toContain(definition.ontology_instructions!);
  });

  it("resolves persisted starter text in both UI languages", () => {
    for (const language of ["en", "zh"] as const) {
      for (const field of [
        "automatedTitle",
        "automatedActionDescription",
        "automatedActionPrompt",
        "automatedOntologyInstructions",
        "humanTitle",
      ]) {
        const key = `inspectors.newNodeDefaults.${field}`;
        expect(translate(language, key, { title: "Review" })).not.toBe(key);
      }
    }
  });
});
