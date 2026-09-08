import crypto from "node:crypto";
import { canonicalEvidenceJson } from "@agentic/shared";

export interface StoredWorkflowVersionContent {
  manifestJson: unknown;
  actionsJson: unknown;
}

/** Full content identity used by all newly written workflow versions. */
export function workflowVersionContentSha256(
  manifest: unknown,
  actions: unknown,
): string {
  // Content identity covers agents and authored workflow Skill bindings. A manifest persisted as
  // the V2 envelope ({ $schemaVersion, agents, extensions }) and its bare
  // agents array MUST produce the same id, otherwise a commit that stores the
  // envelope and a bootstrap that re-derives the bare on-disk form disagree on
  // the version (assertDeploymentOwnsLiveLane then 500s). Normalizing here keeps
  // bare-array ids byte-identical to before (bareAgentsForIdentity is a no-op on
  // an array) while unifying the envelope with its bare form.
  return crypto
    .createHash("sha256")
    .update(
      canonicalEvidenceJson({
        manifest: bareAgentsForIdentity(manifest),
        actions: actions ?? [],
      }),
      "utf8",
    )
    .digest("hex");
}

export function canonicalWorkflowVersionId(
  manifest: unknown,
  actions: unknown,
): string {
  return `auto-${workflowVersionContentSha256(manifest, actions)}`;
}

/** Historical identity retained only for exact-content backwards compatibility. */
export function legacyWorkflowVersionId(manifest: unknown): string {
  const short = crypto
    .createHash("sha256")
    .update(JSON.stringify(manifest))
    .digest("hex")
    .slice(0, 8);
  return `auto-${short}`;
}

/**
 * A stored or on-disk manifest may be persisted either as the bare canonical
 * agents array (the runtime shape) or as the envelope-preserving V2 object
 * (`{ $schemaVersion, agents, extensions }`) that authoring/import writes so
 * top-level metadata survives publication. Content identity is defined over the
 * agents and Skill bindings; metadata-only envelopes keep historical array identity.
 */
function bareAgentsForIdentity(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as { agents?: unknown }).agents)
  ) {
    const envelope = value as { agents: unknown; skills?: unknown };
    // Skill bindings affect execution authority and must change version identity.
    // Preserve historical hashes for envelopes without this runtime field.
    return envelope.skills === undefined ? envelope.agents : { agents: envelope.agents, skills: envelope.skills };
  }
  return value;
}

export function workflowVersionContentMatches(
  row: StoredWorkflowVersionContent,
  manifest: unknown,
  actions: unknown,
): boolean {
  return (
    canonicalEvidenceJson(bareAgentsForIdentity(row.manifestJson)) ===
      canonicalEvidenceJson(bareAgentsForIdentity(manifest)) &&
    canonicalEvidenceJson(row.actionsJson ?? []) ===
      canonicalEvidenceJson(actions ?? [])
  );
}

/**
 * Same comparison, but treating a stored row that RECORDS NO ACTIONS
 * (`actions_json` null/absent) as compatible with whatever actions the caller
 * loaded, instead of as a contradiction.
 *
 * `workflow_versions.actions_json` means "the actions this publish authored".
 * A workflow-only publish authors none, while the runtime still pairs the new
 * manifest with the tenant's existing `actions_v*.json` — so such a row is
 * legitimately null next to a non-empty on-disk actions set, and the strict
 * comparison reads that as a digest collision. Version identity already covers
 * both halves (`workflowVersionContentSha256` hashes manifest AND actions), so
 * for a row whose id matched, the actions are implied; this guard exists to
 * catch a genuine hash collision, which the manifest comparison still does.
 */
export function workflowVersionContentCompatible(
  row: StoredWorkflowVersionContent,
  manifest: unknown,
  actions: unknown,
): boolean {
  if (row.actionsJson == null) {
    return (
      canonicalEvidenceJson(bareAgentsForIdentity(row.manifestJson)) ===
      canonicalEvidenceJson(bareAgentsForIdentity(manifest))
    );
  }
  return workflowVersionContentMatches(row, manifest, actions);
}

/**
 * Validate a stored version identifier against its exact manifest+actions
 * bytes. Legacy short ids are accepted only when their old manifest-only hash
 * matches; callers reusing another row must additionally call
 * workflowVersionContentMatches against the desired content.
 */
export function workflowVersionIdentityKind(
  version: string,
  manifest: unknown,
  actions: unknown,
): "full" | "legacy" | null {
  if (version === canonicalWorkflowVersionId(manifest, actions)) return "full";
  if (version === legacyWorkflowVersionId(manifest)) return "legacy";
  return null;
}
