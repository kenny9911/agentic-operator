import type { DagAgent } from "@/lib/hooks/useAgents";
import {
  applyDraft,
  mergeAgentDefinitionIntoDraft,
  type CompleteAgentDefinition,
  type WorkflowDraft,
} from "./draft";

/** Remove a canvas node and its generated receiver inputs in one draft edit.
 * Event declarations and user-authored mappings remain independent contracts.
 */
export function removeWorkflowAgent(
  draft: WorkflowDraft,
  effectiveAgents: DagAgent[],
  agentId: string,
): WorkflowDraft {
  const effective = applyDraft(effectiveAgents, draft);
  const agents = { ...draft.agents };
  delete agents[agentId];
  const added = new Set(draft.added);
  const wasAdded = added.delete(agentId);
  const removed = new Set(draft.removed);
  if (!wasAdded) removed.add(agentId);
  let next: WorkflowDraft = { ...draft, agents, added, removed };

  for (const agent of effective) {
    if (agent.kebabId === agentId || !agent.definition) continue;
    const definition = agent.definition;
    const detached = (definition.inputs ?? []).filter(
      (input) => input.workflow_handoff?.source_agent_id === agentId,
    );
    if (detached.length === 0) continue;
    const detachedIds = new Set(detached.map((input) => input.id));
    // Remove every binding for the removed generated port, including an
    // advanced override on a different event. Leave other input ids intact.
    const triggerBindings = definition.trigger_bindings
      ? Object.fromEntries(
          Object.entries(definition.trigger_bindings).map(
            ([event, bindings]) => [
              event,
              Object.fromEntries(
                Object.entries(bindings).filter(
                  ([inputId]) => !detachedIds.has(inputId),
                ),
              ),
            ],
          ),
        )
      : undefined;
    const updated: CompleteAgentDefinition = {
      ...definition,
      inputs: definition.inputs?.filter((input) => !detachedIds.has(input.id)),
      ...(triggerBindings ? { trigger_bindings: triggerBindings } : {}),
    };
    // Rebase the sparse editor patch so an older `draft.inputs` array cannot
    // restore deleted ports on the next render or save.
    next = mergeAgentDefinitionIntoDraft(next, updated);
  }
  return next;
}
