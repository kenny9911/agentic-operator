/** Retire only identified upstream imports. Keep immutable history and authored skills. */
import { z } from "zod";
import {
  decodeSkillFile,
  parseSkillDocument,
  skillBundleDigest,
} from "@agentic/skills";
import type {
  SkillBundle,
  SkillDetail,
  ManagedSkillSummary,
} from "@agentic/contracts";

export const RetiredCatalogEntrySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    sourceId: z.string().min(1),
    upstreamPath: z.string().min(1),
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    expectedImportedDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .passthrough();
export const SkillCurationSchema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z.literal("business-ontology-agentic-tools"),
    removed: z.array(RetiredCatalogEntrySchema).max(1000),
  })
  .passthrough();
type RetirementEntry = z.infer<typeof RetiredCatalogEntrySchema>;
type Awaitable<T> = T | Promise<T>;
export interface SkillRetirementStore {
  list(query: {
    scope: "shared";
    archived: boolean;
    offset: number;
    limit: number;
  }): Awaitable<{ skills: ManagedSkillSummary[]; nextOffset: number | null }>;
  detail(id: string): Awaitable<SkillDetail>;
  setEnabled(
    id: string,
    input: {
      enabled: boolean;
      expectedEnabled: boolean;
      expectedRevision: number;
      expectedLatestVersionId: string | null;
    },
  ): Awaitable<SkillDetail>;
  archive(
    id: string,
    input: {
      archived: boolean;
      expectedRevision: number;
      expectedLatestVersionId: string | null;
    },
  ): Awaitable<SkillDetail>;
}
function bundleProvenance(bundle: SkillBundle | undefined) {
  const file = bundle?.files.find((f) => f.path === "SKILL.md");
  // Editable drafts may intentionally contain invalid YAML. An unrelated draft
  // must not prevent retirement of other, fully identified imports.
  try {
    return file
      ? parseSkillDocument(decodeSkillFile(file).toString("utf8")).frontmatter
          .metadata
      : undefined;
  } catch {
    return undefined;
  }
}
function provenance(detail: SkillDetail) {
  return bundleProvenance(detail.latestVersion?.bundle ?? detail.draft?.bundle);
}
function identified(detail: SkillDetail, entry: RetirementEntry) {
  if (
    !detail.skill.canEdit ||
    detail.skill.visibility !== "shared" ||
    !detail.draft ||
    detail.skill.name !== entry.name
  ) {
    throw new Error(
      "Skill is not an editable shared import matching the reviewed source identity; left unchanged",
    );
  }
  for (const bundle of [
    detail.draft.bundle,
    ...(detail.latestVersion ? [detail.latestVersion.bundle] : []),
  ]) {
    const metadata = bundleProvenance(bundle);
    if (
      metadata?.["agentic-import-format"] !== "catalog-v1" ||
      metadata?.["agentic-catalog-id"] !== entry.id ||
      metadata?.["agentic-source-id"] !== entry.sourceId ||
      metadata?.["agentic-upstream-path"] !== entry.upstreamPath ||
      metadata?.["agentic-source-digest"] !== entry.sourceDigest
    ) {
      throw new Error(
        "Skill is not an editable shared import matching the reviewed source identity; left unchanged",
      );
    }
  }
  if (
    detail.latestVersion &&
    skillBundleDigest(detail.draft.bundle) !==
      detail.latestVersion.contentDigest
  )
    throw new Error(
      "Skill has unpublished edits; preserve customizations and review them separately before retirement; left unchanged",
    );
  if (
    skillBundleDigest(detail.draft.bundle) !== entry.expectedImportedDigest ||
    (detail.latestVersion &&
      (detail.latestVersion.contentDigest !== entry.expectedImportedDigest ||
        skillBundleDigest(detail.latestVersion.bundle) !==
          entry.expectedImportedDigest))
  )
    throw new Error(
      "Skill content differs from the reviewed imported bundle; preserve customizations before retirement; left unchanged",
    );
}

export async function retireSkillCatalog(options: {
  entries: RetirementEntry[];
  store: SkillRetirementStore;
  apply?: boolean;
}) {
  const entries = options.entries.map((e) =>
    RetiredCatalogEntrySchema.parse(e),
  );
  if (
    new Set(entries.map((e) => e.id)).size !== entries.length ||
    new Set(entries.map((e) => e.name)).size !== entries.length
  )
    throw new Error("Curation entries must have unique identities and names");
  const byId = new Map(entries.map((e) => [e.id, e]));
  const byName = new Map(entries.map((e) => [e.name, e]));
  // Snapshot both management lists before mutation; archiving must not shift pagination.
  const summaries = new Map<string, ManagedSkillSummary>();
  for (const archived of [false, true]) {
    let offset = 0;
    for (;;) {
      const page = await options.store.list({
        scope: "shared",
        archived,
        offset,
        limit: 100,
      });
      for (const skill of page.skills) summaries.set(skill.id, skill);
      if (page.nextOffset === null) break;
      if (page.nextOffset <= offset || summaries.size > 10000)
        throw new Error("Invalid Skill pagination");
      offset = page.nextOffset;
    }
  }
  const seen = new Set<string>();
  const results: Array<{
    catalogId: string;
    name: string;
    skillId?: string;
    status: "planned" | "retired" | "already-retired" | "absent" | "blocked";
    reason?: string;
  }> = [];
  for (const summary of summaries.values()) {
    let target = byName.get(summary.name);
    try {
      let detail = await options.store.detail(summary.id);
      const importedId = provenance(detail)?.["agentic-catalog-id"];
      target ??=
        typeof importedId === "string" ? byId.get(importedId) : undefined;
      if (!target) continue;
      seen.add(target.id);
      identified(detail, target);
      const already = !detail.skill.enabled && detail.skill.archivedAt !== null;
      if (options.apply && !already) {
        // Disable first: a later archive failure must not leave a retired source usable.
        if (detail.skill.enabled)
          detail = await options.store.setEnabled(summary.id, {
            enabled: false,
            expectedEnabled: detail.skill.enabled,
            expectedRevision: detail.draft!.revision,
            expectedLatestVersionId: detail.skill.latestVersionId,
          });
        if (detail.skill.archivedAt === null)
          detail = await options.store.archive(summary.id, {
            archived: true,
            expectedRevision: detail.draft!.revision,
            expectedLatestVersionId: detail.skill.latestVersionId,
          });
        detail = await options.store.detail(summary.id);
        identified(detail, target);
        if (detail.skill.enabled || detail.skill.archivedAt === null)
          throw new Error(
            "Skill availability changed during retirement; reload before retrying",
          );
      }
      results.push({
        catalogId: target.id,
        name: target.name,
        skillId: summary.id,
        status: already
          ? "already-retired"
          : options.apply
            ? "retired"
            : "planned",
      });
    } catch (error) {
      if (!target) throw error;
      seen.add(target.id);
      results.push({
        catalogId: target.id,
        name: target.name,
        skillId: summary.id,
        status: "blocked",
        reason: error instanceof Error ? error.message : "Retirement failed",
      });
    }
  }
  for (const entry of entries)
    if (!seen.has(entry.id))
      results.push({ catalogId: entry.id, name: entry.name, status: "absent" });
  return {
    apply: Boolean(options.apply),
    considered: entries.length,
    retired: results.filter((r) => r.status === "retired").length,
    alreadyRetired: results.filter((r) => r.status === "already-retired")
      .length,
    blocked: results.filter((r) => r.status === "blocked").length,
    results,
  };
}
