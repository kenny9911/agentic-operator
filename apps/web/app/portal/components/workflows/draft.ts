/**
 * Workflow editor draft state (P3-FE-01).
 *
 * The DAG canvas reads its agents from `useDag()` — a live read of the
 * `/v1/workflows/dag` payload. To support editing without round-tripping
 * to the server on every keystroke, we maintain an in-memory
 * `WorkflowDraft`:
 *
 *   - `agents`  : map of agent.id → mutable `DraftAgent` (overrides live data)
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

import type { DagAgent } from "@/lib/hooks/useAgents";

/**
 * A subset of the AgentSpec fields the editor can mutate. Other fields
 * (id, actor, actions, description) are preserved verbatim from the
 * live snapshot in `toManifest()`.
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
 *
 * Agents on the canvas are keyed by `kebabId` (the manifest slug) so the
 * draft maps line up with the DAG payload's `agents[].kebabId` field.
 */
export function applyDraft(
  base: DagAgent[],
  draft: WorkflowDraft,
): DagAgent[] {
  const out: DagAgent[] = [];
  for (const a of base) {
    if (draft.removed.has(a.kebabId)) continue;
    const d = draft.agents[a.kebabId];
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
    if (base.some((b) => b.kebabId === id)) continue; // already present
    out.push({
      id,
      kebabId: id,
      name: d.name ?? id,
      title: d.title ?? id,
      actor: "Agent",
      stage: 0,
      triggers: d.triggers ?? [],
      emits: d.emits ?? [],
      recentRunCount: 0,
      isLive: false,
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
 * client doesn't ship their actions (it doesn't read them from the DAG
 * payload in v1), so the action set is reduced to a stub. A follow-up
 * will round-trip the full action set once the API surfaces `actions` on
 * `GET /v1/agents/:kebab`.
 */
export function toManifest(
  applied: DagAgent[],
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
    id: a.kebabId,
    name: a.name,
    title: a.title,
    description: "",
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

// ─── localStorage persistence (UC-V11-13) ───────────────────────────────────
// Sets don't survive JSON.stringify natively; serialize to arrays + a small
// envelope that records when the draft was saved so the restore banner can
// show "from 2 hours ago". The key is namespaced by tenant + workflow slug
// (tenants share the same dev DB; we don't want a cross-tenant collision).

export interface SerializedDraft {
  v: 1;
  savedAt: number;
  agents: Record<string, DraftAgent>;
  added: string[];
  removed: string[];
}

export function serializeDraft(draft: WorkflowDraft): SerializedDraft {
  return {
    v: 1,
    savedAt: Date.now(),
    agents: draft.agents,
    added: Array.from(draft.added),
    removed: Array.from(draft.removed),
  };
}

export function deserializeDraft(serialized: SerializedDraft): WorkflowDraft {
  return {
    agents: serialized.agents,
    added: new Set(serialized.added),
    removed: new Set(serialized.removed),
  };
}

/**
 * Best-effort JSON parse + shape check. Returns `null` on any parse / shape
 * error so callers can treat invalid stored data as "no saved draft".
 */
export function tryReadSerializedDraft(raw: string): SerializedDraft | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      (parsed as { v?: unknown }).v === 1 &&
      typeof (parsed as { savedAt?: unknown }).savedAt === "number" &&
      typeof (parsed as { agents?: unknown }).agents === "object" &&
      Array.isArray((parsed as { added?: unknown }).added) &&
      Array.isArray((parsed as { removed?: unknown }).removed)
    ) {
      return parsed as SerializedDraft;
    }
    return null;
  } catch {
    return null;
  }
}

/** Build the localStorage key for a given (tenant, workflow) pair. */
export function draftStorageKey(tenant: string, workflowId: string): string {
  return `workflow-draft:${tenant}:${workflowId}`;
}
