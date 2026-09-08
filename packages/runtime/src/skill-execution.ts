/** Host-owned Skill integration shared by execution adapters. A session must
 * come from the authorized immutable Run catalog, never from an event payload.
 * These operations read guidance; business Tool capabilities remain separate. */
import type { ChatMessage, ToolDef } from "@agentic/llm-gateway";
import {
  buildSessionSkillTools,
  type SkillSession,
  type SkillSessionSnapshot,
} from "@agentic/skills";

export const SKILL_INTRINSIC_NAMES = Object.freeze([
  "skills.list_skills",
  "skills.load_skill",
  "skills.list_resources",
  "skills.read_resource",
] as const);

export function isSkillIntrinsic(name: string): boolean {
  return (SKILL_INTRINSIC_NAMES as readonly string[]).includes(name);
}

export function skillToolDefinitions(session: SkillSession): ToolDef[] {
  return Object.values(buildSessionSkillTools(session)).map((tool) => ({
    name: tool.name,
    description: tool.description ?? tool.name,
    input_schema: structuredClone(tool.inputSchema!),
  }));
}

/** Rebuild guidance for each request, outside foldable assistant/tool history.
 * Bundle text occupies a user context message; it cannot replace host policy.
 * The original history and opaque provider reasoning are left intact. */
export async function prepareSkillMessages(
  history: readonly ChatMessage[],
  session?: SkillSession,
): Promise<ChatMessage[]> {
  if (!session) return [...history];
  const catalog = await session.list({ origin: "model" });
  const active = await session.renderActiveInstructions();
  if (!catalog.skills.length && !catalog.nextCursor && !active)
    return [...history];
  const discovery =
    catalog.skills.length || catalog.nextCursor
      ? "Available Skill metadata (guidance only; use skills.load_skill when relevant and skills.list_skills to paginate):\n" +
        JSON.stringify(catalog)
      : "";
  const guidance: ChatMessage = {
    role: "user",
    content: [
      discovery,
      active
        ? "The following Skill instructions are already active. Do not load them again. Use their exact id with skills.list_resources or skills.read_resource when a bundled reference is needed.\n" +
          active
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
  const firstNonSystem = history.findIndex(
    (message) => message.role !== "system",
  );
  const index = firstNonSystem === -1 ? history.length : firstNonSystem;
  return [...history.slice(0, index), guidance, ...history.slice(index)];
}

/** Per-Action durable carrier: the Run owns the catalog once; Action results
 * carry only its fingerprint, activation refs and cumulative consumption. */
export type SkillExecutionCheckpoint = Omit<SkillSessionSnapshot, "catalog">;

/** An invalid durable carrier is a replay integrity failure; authored
 * business on_error rules must not soften it into a successful Action. */
export class SkillCheckpointError extends Error {
  override readonly name = "SkillCheckpointError";
}

export async function captureSkillCheckpoint(
  session: SkillSession,
): Promise<SkillExecutionCheckpoint> {
  const { catalog: _catalog, ...checkpoint } = await session.snapshot();
  return checkpoint;
}

/** Only restore persisted host state into a fresh session resolved from the
 * same Run snapshot. This is never a client-provided resume operation. */
export async function restoreSkillCheckpoint(
  session: SkillSession,
  checkpoint: SkillExecutionCheckpoint,
): Promise<void> {
  const { catalog } = await session.snapshot();
  await session.restore({ ...checkpoint, catalog });
}

/** A memoized nested Action may have activated/read Skills without executing
 * again in this process. Advance state before running the next Action. */
export async function advanceSkillCheckpoint(
  session: SkillSession,
  checkpoint: SkillExecutionCheckpoint,
): Promise<void> {
  try {
    if (!checkpoint)
      throw new Error("Cached Action has no durable Skill state");
    const { catalog } = await session.snapshot();
    await session.advance({ ...checkpoint, catalog });
  } catch (cause) {
    throw new SkillCheckpointError("Cannot restore cached Action Skill state", {
      cause,
    });
  }
}
