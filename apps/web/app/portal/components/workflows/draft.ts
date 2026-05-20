/**
 * Workflow editor draft state (P3-FE-01).
 *
 * The DAG canvas reads its agents from `useRaasData()` — a read-only
 * bootstrap snapshot. To support editing without round-tripping to the
 * server on every keystroke, we maintain an in-memory `WorkflowDraft`:
 *
 *   - `agents`  : map of agent.id → mutable `DraftAgent` (overrides bootstrap)
 *   - `removed` : ids deleted in this session
 *   - `added`   : ids inserted in this session
 *
 * Pure helpers exposed here so the unit tests pin behavior:
 *
 *   - `applyDraft(agents, draft)` — merge view: returns the agents list
 *      with overrides applied + removed entries filtered out.
 *   - `toManifest(applied)`       — convert the agents list to a
 *      WorkflowManifest payload acceptable to `POST /v1/agents`.
 *
 * The save endpoint is the existing `POST /v1/agents` (ManifestUploadBody).
 * It persists a new `workflow_version` row keyed by manifest hash — the
 * server returns `{ workflow_version_id, version, diff, note }`.
 */

import type { RaasAgent } from "@/lib/hooks/data-context";

/**
 * A subset of the AgentSpec fields the editor can mutate. Other fields
 * (id, actor, actions, description) are preserved verbatim from the
 * bootstrap snapshot in `toManifest()`.
 */
export interface DraftAgent {
  id: string;
  title?: string;
  name?: string;
  /** Events this agent listens for (mirrors `trigger` in the manifest). */
  triggers?: string[];
  /** Events this agent emits on success (mirrors `triggered_event`). */
  emits?: string[];
}

export interface WorkflowDraft {
  agents: Record<string, DraftAgent>;
  added: Set<string>;
  removed: Set<string>;
}

export function emptyDraft(): WorkflowDraft {
  return { agents: {}, added: new Set(), removed: new Set() };
}

/**
 * Apply a draft to a base agent list. Returns the new effective list.
 * Pure — order-stable for unchanged entries.
 */
export function applyDraft(
  base: RaasAgent[],
  draft: WorkflowDraft,
): RaasAgent[] {
  const out: RaasAgent[] = [];
  for (const a of base) {
    if (draft.removed.has(a.id)) continue;
    const d = draft.agents[a.id];
    if (d) {
      out.push({
        ...a,
        title: d.title ?? a.title,
        name: d.name ?? a.name,
        triggers: d.triggers ?? a.triggers,
        emits: d.emits ?? a.emits,
      });
    } else {
      out.push(a);
    }
  }
  // New agents (not in `base`) appended at the end.
  for (const id of draft.added) {
    const d = draft.agents[id];
    if (!d) continue;
    if (base.some((b) => b.id === id)) continue; // already present
    out.push({
      id,
      name: d.name ?? id,
      title: d.title ?? id,
      description: "",
      actor: "Agent",
      stage: 0,
      triggers: d.triggers ?? [],
      emits: d.emits ?? [],
      steps: [],
      tools: [],
      model: "",
      input_data: {},
      ontology_instructions: "",
      tool_use: undefined,
      typescript_code: "",
    });
  }
  return out;
}

/**
 * Build the WorkflowManifest body for `POST /v1/agents`.
 *
 * The manifest is an array of AgentSpec entries. The contract requires
 * `actions: ActionSpec[]` — we synthesize a one-element placeholder action
 * for added nodes so the schema parse succeeds. For existing nodes the
 * client doesn't ship their actions (it doesn't read them from the
 * bootstrap snapshot in v1), so the action set is reduced to a stub. A
 * follow-up will round-trip the full action set once the API surfaces
 * `actions` on `GET /v1/agents/:kebab`.
 */
export function toManifest(
  applied: RaasAgent[],
): Array<{
  id: string;
  name: string;
  title: string;
  description: string;
  actor: ["Agent" | "Human"];
  trigger: string[];
  actions: Array<{ order: string; name: string; description: string; type: "logic" }>;
  triggered_event: string[];
}> {
  return applied.map((a) => ({
    id: a.id,
    name: a.name,
    title: a.title,
    description: a.description ?? "",
    actor: [a.actor],
    trigger: a.triggers,
    actions: [
      {
        order: "1",
        name: "default",
        description: "placeholder action — round-tripped by editor",
        type: "logic" as const,
      },
    ],
    triggered_event: a.emits,
  }));
}

export interface DraftCounts {
  added: number;
  modified: number;
  removed: number;
}

export function countDraftChanges(draft: WorkflowDraft): DraftCounts {
  return {
    added: draft.added.size,
    modified: Object.keys(draft.agents).filter(
      (id) => !draft.added.has(id) && !draft.removed.has(id),
    ).length,
    removed: draft.removed.size,
  };
}
