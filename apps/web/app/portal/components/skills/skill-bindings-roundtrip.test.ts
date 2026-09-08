import { describe, expect, it } from "vitest";
import { normalizeWorkflowManifest, normalizeAgentDefinition, PatchAgentDraftBodySchema, SaveWorkflowBodySchema, WorkflowTestRunBodySchema, type SkillBindings } from "@agentic/contracts";
import { normalizeStudioDefinition } from "../agent-studio/model";
import { prepareDefinition } from "@/lib/hooks/useAgentStudio";
import { addAgentToDraft, applyDraft, countDraftChanges, createAutomatedAgentDefinition, deserializeDraft, emptyDraft, mergeAgentDefinitionIntoDraft, mergeWorkflowManifest, moveAgent, serializeDraft, toManifest, tryReadSerializedDraft, type CompleteAgentDefinition } from "../workflows/draft";
import { removeWorkflowAgent } from "../workflows/workflow-handoff-draft";

const selected: SkillBindings = { mode: "selected", skills: [{ id: "tenant-skill", versionId: "version-3", activate: true }, { id: "shared-skill" }] };
const source = createAutomatedAgentDefinition({ id: "triage", name: "triage", title: "Triage", triggers: ["TICKET_OPENED"], emits: ["TRIAGED"] });

describe("Skill binding round trips through real authoring carriers", () => {
  it.each([selected, { mode: "disabled" } as SkillBindings, { mode: "inherit", skills: selected.skills } as SkillBindings])("retains agent bindings through Studio normalization, draft request and reloading", (skills) => {
    const normalized = normalizeAgentDefinition({ ...source, skills });
    const studio = normalizeStudioDefinition(normalized);
    const saved = PatchAgentDraftBodySchema.parse({ definition: prepareDefinition({ ...studio, title: "Edited unrelated title" }) });
    const reloaded = normalizeStudioDefinition(saved.definition);
    expect(reloaded.skills).toEqual(skills);
    expect(reloaded.title).toBe("Edited unrelated title");
  });

  it("retains Workflow and Agent bindings through canvas edits, browser recovery, save, export/import and Test Run input", () => {
    const normalized = normalizeWorkflowManifest({ $schemaVersion: 2, skills: selected, extension: { audit: "preserve" }, agents: [{ ...source, skills: { mode: "disabled" } }] });
    let draft = { ...emptyDraft(), skills: selected };
    draft = addAgentToDraft(draft, normalized.agents[0] as CompleteAgentDefinition) as typeof draft;
    draft = moveAgent(draft, "triage", { x: 40, y: 70 }) as typeof draft;
    const recovered = deserializeDraft(tryReadSerializedDraft(JSON.stringify(serializeDraft(draft, "workflow-version-1")))!);
    expect(recovered.skills).toEqual(selected);
    const editedAgents = toManifest(applyDraft([], recovered));
    const envelope = mergeWorkflowManifest(normalized, editedAgents, recovered);
    const saveRequest = SaveWorkflowBodySchema.parse({ baseVersionId: "workflow-version-1", manifest: envelope });
    const imported = normalizeWorkflowManifest(JSON.parse(JSON.stringify(saveRequest.manifest)));
    expect(imported.skills).toEqual(selected);
    expect(imported.agents[0]?.skills).toEqual({ mode: "disabled" });
    expect(imported.extension).toEqual({ audit: "preserve" });
    // The test console sends the complete authored envelope in its request.
    const request = WorkflowTestRunBodySchema.parse({ target: "draft", manifest: imported, triggerEvent: "TICKET_OPENED", inputs: {} });
    expect((request.manifest as typeof imported).skills).toEqual(selected);
  });

  it("keeps workflow selections when adding, replacing or removing a node", () => {
    const start = { ...emptyDraft(), skills: selected };
    const added = addAgentToDraft(start, source);
    const replaced = mergeAgentDefinitionIntoDraft(added, { ...source, title: "Changed" });
    const removed = removeWorkflowAgent(replaced, applyDraft([], replaced), source.id);
    expect(added.skills).toEqual(selected); expect(replaced.skills).toEqual(selected); expect(removed.skills).toEqual(selected);
    expect(countDraftChanges(start).modified).toBe(1);
  });

  it("preserves inherited defaults and refuses an incomplete source envelope", () => {
    const normalized = normalizeWorkflowManifest([source]);
    expect(mergeWorkflowManifest(normalized, [source], emptyDraft())).not.toHaveProperty("skills");
    expect(() => mergeWorkflowManifest({}, [source], emptyDraft())).toThrow(/complete workflow/);
  });
});
