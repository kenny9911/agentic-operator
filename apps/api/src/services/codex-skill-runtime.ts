/**
 * Host-only bridge from a durable Run snapshot to native Codex discovery.
 * This module does not launch Codex, start model turns, or enable a production
 * execution path. The caller owns the private process boundary and gateway.
 */
import {
  CodexSkillError,
  materializeCodexSkills,
  type AppServerClient,
  type CodexSkillInput,
  type CodexSkillSet,
} from "@agentic/codex-harness";
import type { RunSkillScope, RunSkillSnapshotRef } from "@agentic/runtime";
import type { SkillCatalogEntry } from "@agentic/skills";
import type { ManagedSkillRuntime } from "./skill-runtime";

/** An in-process, authorized reader. Never hydrate this port from request JSON. */
export type CodexRunSkillHost = Pick<
  ManagedSkillRuntime,
  "materializationSources"
>;
type Sources = Awaited<ReturnType<CodexRunSkillHost["materializationSources"]>>;
type DiscoveryClient = Pick<
  AppServerClient,
  "options" | "skillsList" | "skillsConfigWrite"
>;

export interface RunCodexSkills {
  readonly snapshot: Readonly<RunSkillSnapshotRef>;
  readonly scope: Readonly<RunSkillScope>;
  readonly codexHome: string;
  readonly root: string;
  readonly catalog: readonly SkillCatalogEntry[];
  readonly activationIds: readonly string[];
  readonly environment: CodexSkillSet["environment"];
  /** Authorize again, disable native private built-ins, and verify exact discovery. */
  prepareDiscovery(
    client: DiscoveryClient,
    cwd: string,
  ): Promise<readonly SkillCatalogEntry[]>;
  /** Recheck current authorization and exact native discovery before a later turn. */
  verifyDiscovery(
    client: DiscoveryClient,
    cwd: string,
  ): Promise<readonly SkillCatalogEntry[]>;
  /** Recheck before returning only the immutable snapshot's explicit activations. */
  explicitInputs(
    client: DiscoveryClient,
    cwd: string,
  ): Promise<readonly CodexSkillInput[]>;
}

function identity(value: Sources): string {
  const ids = new Set(value.sources.map(({ entry }) => entry.id));
  if (
    new Set(value.activationIds).size !== value.activationIds.length ||
    value.activationIds.some((id) => !ids.has(id))
  ) {
    throw new CodexSkillError(
      "INTEGRITY_MISMATCH",
      "Run Skill activations do not belong to the frozen catalog",
    );
  }
  return JSON.stringify([
    value.sources.map(({ entry }) => [
      entry.id,
      entry.versionId,
      entry.contentDigest,
      entry.name,
      entry.description,
      entry.invocationPolicy?.model ?? null,
      entry.invocationPolicy?.explicit ?? null,
    ]),
    value.activationIds,
  ]);
}

/**
 * The ref and scope must come from the durable host execution, never event.data.
 * The reader enforces tenant/run/agent identity, current source authorization,
 * immutable bytes and aggregate limits before any materialization occurs.
 */
export async function materializeRunCodexSkills(
  host: CodexRunSkillHost,
  ref: RunSkillSnapshotRef,
  scope: RunSkillScope,
  options: { readonly codexHome: string },
): Promise<RunCodexSkills> {
  if (!host || typeof host.materializationSources !== "function") {
    throw new TypeError(
      "Run Codex Skills require a trusted in-process snapshot reader",
    );
  }
  // Copy before the await: callers cannot retarget later authorization checks.
  const snapshot = Object.freeze({
    id: ref.id,
    contentDigest: ref.contentDigest,
  });
  const execution = Object.freeze({
    tenantId: scope.tenantId,
    executionId: scope.executionId,
    agentId: scope.agentId,
  });
  const read = host.materializationSources.bind(host);
  const initial = await read(snapshot, execution);
  const expectedIdentity = identity(initial);
  const activationIds = Object.freeze([...initial.activationIds]);
  const set = materializeCodexSkills({
    codexHome: options.codexHome,
    skills: initial.sources,
  });

  // Serialize native discovery/config operations so concurrent callers cannot
  // mistake another check's success for their own authorization result.
  let pending: Promise<unknown> = Promise.resolve();
  function checked<T>(operation: () => Promise<T>): Promise<T> {
    const next = pending.then(async () => {
      const current = await read(snapshot, execution);
      if (identity(current) !== expectedIdentity) {
        throw new CodexSkillError(
          "INTEGRITY_MISMATCH",
          "The Run Skill snapshot changed after materialization",
        );
      }
      return operation();
    });
    pending = next.catch(() => undefined);
    return next;
  }

  return Object.freeze({
    snapshot,
    scope: execution,
    codexHome: set.codexHome,
    root: set.root,
    catalog: set.catalog,
    activationIds,
    environment: set.environment,
    prepareDiscovery: (client: DiscoveryClient, cwd: string) =>
      checked(() => set.prepareDiscovery(client, cwd)),
    verifyDiscovery: (client: DiscoveryClient, cwd: string) =>
      checked(() => set.verifyDiscovery(client, cwd)),
    explicitInputs: (client: DiscoveryClient, cwd: string) =>
      checked(async () => {
        await set.verifyDiscovery(client, cwd);
        return Object.freeze(
          activationIds.map((id) => Object.freeze(set.explicitInput(id))),
        );
      }),
  });
}
