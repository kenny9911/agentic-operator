import { describe, expect, it } from "vitest";
import { validateWorkflowHandoffs } from "@agentic/contracts";
import {
  addAgentToDraft,
  applyDraft,
  connectAgents,
  createAutomatedAgentDefinition,
  emptyDraft,
  toManifest,
  type CompleteAgentDefinition,
  type WorkflowDagAgent,
} from "./draft";
import { removeWorkflowAgent } from "./workflow-handoff-draft";

function agent(id: string): WorkflowDagAgent {
  const definition = createAutomatedAgentDefinition({ id });
  return {
    id,
    kebabId: id,
    name: definition.name,
    title: definition.title ?? id,
    actor: "Agent",
    stage: 0,
    triggers: definition.trigger,
    emits: definition.triggered_event,
    recentRunCount: 0,
    isLive: false,
    definition,
  };
}

function savedAgent(definition: CompleteAgentDefinition): WorkflowDagAgent {
  return {
    ...agent(definition.id),
    definition,
    triggers: definition.trigger,
    emits: definition.triggered_event,
  };
}

describe("removing workflow agents with generated handoffs", () => {
  it("removes only the deleted producer's generated ports and bindings, including sparse editor patches", () => {
    const base = [agent("research"), agent("score"), agent("review")];
    let draft = connectAgents(
      emptyDraft(),
      base,
      "research",
      "review",
      "READY",
    );
    draft = connectAgents(
      draft,
      applyDraft(base, draft),
      "score",
      "review",
      "READY",
    );
    const receiver = toManifest(applyDraft(base, draft)).find(
      (entry) => entry.id === "review",
    )!;
    const researchPort = receiver.inputs!.find(
      (input) => input.workflow_handoff?.source_agent_id === "research",
    )!;
    const scorePort = receiver.inputs!.find(
      (input) => input.workflow_handoff?.source_agent_id === "score",
    )!;
    receiver.trigger_bindings = {
      ...receiver.trigger_bindings,
      MANUAL: {
        prompt: { constant: "Manual review" },
        [researchPort.id]: { constant: "custom override" },
      },
    };
    receiver.extensions = {
      ...receiver.extensions,
      tenant_owned: { audit: true },
    };
    draft.agents.review = {
      ...draft.agents.review!,
      definition: receiver,
      inputs: receiver.inputs,
      title: "My reviewer",
    };
    const before = JSON.stringify(draft.agents);

    const removed = removeWorkflowAgent(
      draft,
      applyDraft(base, draft),
      "research",
    );
    const result = toManifest(applyDraft(base, removed));
    const review = result.find((entry) => entry.id === "review")!;
    expect(result.map((entry) => entry.id)).toEqual(["score", "review"]);
    expect(review.inputs?.some((input) => input.id === researchPort.id)).toBe(
      false,
    );
    expect(review.inputs?.some((input) => input.id === scorePort.id)).toBe(
      true,
    );
    expect(review.trigger_bindings?.READY?.[researchPort.id]).toBeUndefined();
    expect(review.trigger_bindings?.MANUAL).toEqual({
      prompt: { constant: "Manual review" },
    });
    expect(review.trigger_bindings?.READY?.[scorePort.id]).toEqual(
      receiver.trigger_bindings.READY?.[scorePort.id],
    );
    expect(review.trigger).toEqual(receiver.trigger);
    expect(review.extensions).toEqual(receiver.extensions);
    expect(review.title).toBe("My reviewer");
    expect(validateWorkflowHandoffs(result)).toEqual([]);
    expect(JSON.stringify(draft.agents)).toBe(before);
  });

  it("deletes a newly added producer without adding a server removal, retaining the receiver addition", () => {
    let draft = addAgentToDraft(
      emptyDraft(),
      createAutomatedAgentDefinition({ id: "new-source" }),
    );
    draft = addAgentToDraft(
      draft,
      createAutomatedAgentDefinition({ id: "new-target" }),
    );
    draft = connectAgents(
      draft,
      applyDraft([], draft),
      "new-source",
      "new-target",
      "READY",
    );
    const removed = removeWorkflowAgent(
      draft,
      applyDraft([], draft),
      "new-source",
    );
    expect([...removed.added]).toEqual(["new-target"]);
    expect(removed.removed.size).toBe(0);
    expect(removed.agents["new-source"]).toBeUndefined();
    const [target] = toManifest(applyDraft([], removed));
    expect(target?.inputs?.some((input) => input.workflow_handoff)).toBe(false);
  });

  it("preserves the producer and its other fan-out connection when a receiver is removed", () => {
    const initial = [agent("source"), agent("archive"), agent("review")];
    let draft = connectAgents(
      emptyDraft(),
      initial,
      "source",
      "archive",
      "READY",
    );
    draft = connectAgents(
      draft,
      applyDraft(initial, draft),
      "source",
      "review",
      "READY",
    );
    const saved = toManifest(applyDraft(initial, draft));
    const base = saved.map(savedAgent);
    const removed = removeWorkflowAgent(emptyDraft(), base, "archive");
    const after = toManifest(applyDraft(base, removed));
    expect(after.find((entry) => entry.id === "source")).toEqual(
      saved.find((entry) => entry.id === "source"),
    );
    expect(after.find((entry) => entry.id === "review")).toEqual(
      saved.find((entry) => entry.id === "review"),
    );
    expect(removed.agents).toEqual({});
    expect(validateWorkflowHandoffs(after)).toEqual([]);
  });
});
