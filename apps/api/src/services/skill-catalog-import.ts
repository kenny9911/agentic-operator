/** Operator-owned, pinned local catalogs enter the same managed Skill lifecycle
 * as UI imports. Source files are never rewritten and imported code never runs. */
import {
  constants,
  fstatSync,
  lstatSync,
  openSync,
  closeSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import {
  can,
  SkillFilePathSchema,
  SkillNameSchema,
  type SkillBundle,
  type SkillDetail,
} from "@agentic/contracts";
import {
  assertSafeSkillPath,
  assertValidSkillBundle,
  decodeSkillFile,
  encodeSkillFile,
  readSkillBundleFromDirectory,
  skillBundleDigest,
} from "@agentic/skills";
import type {
  SkillLibraryContext,
  SkillLibraryStore,
} from "./skill-library-store";

const CatalogEntrySchema = z
  .object({
    id: z.string().min(1).max(240),
    sourceId: SkillNameSchema,
    upstreamPath: SkillFilePathSchema,
    path: SkillFilePathSchema,
    upstreamName: SkillNameSchema,
    name: SkillNameSchema,
    sourceUrl: z
      .string()
      .url()
      .max(2000)
      .refine(
        (value) => new URL(value).protocol === "https:",
        "Source URLs must use HTTPS",
      ),
    revision: z.string().regex(/^(?:[a-f0-9]{40}|workspace)$/),
    license: z.string().trim().min(1).max(200),
    sourceDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    licenseFiles: z
      .array(
        z
          .object({
            path: SkillFilePathSchema,
            bundlePath: SkillFilePathSchema,
          })
          .strict(),
      )
      .max(8)
      .optional(),
  })
  .passthrough()
  .refine(
    (entry) => entry.revision !== "workspace" || entry.sourceId === "agentic",
    "Only platform-maintained Skills may use a workspace revision",
  );
export const SkillCatalogManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    skills: z.array(CatalogEntrySchema).max(1000),
  })
  .passthrough()
  .superRefine((catalog, ctx) => {
    for (const key of ["id", "name"] as const) {
      const values = new Set<string>();
      catalog.skills.forEach((entry, index) => {
        if (values.has(entry[key]))
          ctx.addIssue({
            code: "custom",
            path: ["skills", index, key],
            message: `Duplicate catalog ${key}`,
          });
        values.add(entry[key]);
      });
    }
  });
export type SkillCatalogEntry = z.infer<typeof CatalogEntrySchema>;
export type SkillCatalogManifest = z.infer<typeof SkillCatalogManifestSchema>;
type Awaitable<T> = T | Promise<T>;
type StoreMethod<K extends keyof SkillLibraryStore> =
  SkillLibraryStore[K] extends (...args: infer A) => infer R
    ? (...args: A) => Awaitable<R>
    : never;
/** HTTP adapters preserve the API's single-writer lease and RBAC checks. */
export interface SkillCatalogStore {
  list: StoreMethod<"list">;
  detail: StoreMethod<"detail">;
  create: StoreMethod<"create">;
  save: StoreMethod<"save">;
  publish: StoreMethod<"publish">;
}
export interface SkillCatalogImportResult {
  id: string;
  name: string;
  status:
    | "imported"
    | "updated"
    | "unchanged"
    | "would-import"
    | "would-update"
    | "blocked";
  skillId?: string;
  versionId?: string;
  sourceDigest?: string;
  contentDigest?: string;
  files?: number;
  bytes?: number;
  message?: string;
}

/** Configured roots are trusted, but neither entry traversal nor symlinked
 * intermediate directories may escape that root. */
function catalogPath(root: string, relative: string): string {
  assertSafeSkillPath(relative);
  const canonical = realpathSync(root);
  let current = root;
  for (const component of relative.split("/")) {
    current = join(current, component);
    if (lstatSync(current).isSymbolicLink())
      throw new Error("Catalog paths must not contain symbolic links");
  }
  const full = resolve(root, relative);
  if (realpathSync(full) !== join(canonical, ...relative.split("/")))
    throw new Error("Catalog path escaped its root");
  return full;
}

function boundedFile(file: string, maximum: number): Buffer {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size > maximum)
      throw new Error(
        "Catalog file must be a bounded regular file without links",
      );
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (
      bytes.length !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    )
      throw new Error("Catalog file changed while being read");
    return bytes;
  } finally {
    closeSync(fd);
  }
}

export function readSkillCatalog(file: string): {
  root: string;
  catalog: SkillCatalogManifest;
} {
  const absolute = resolve(file);
  return {
    root: dirname(absolute),
    catalog: SkillCatalogManifestSchema.parse(
      JSON.parse(boundedFile(absolute, 4 * 1024 * 1024).toString("utf8")),
    ),
  };
}

export function prepareCatalogSkill(root: string, input: SkillCatalogEntry) {
  const entry = CatalogEntrySchema.parse(input);
  const source = readSkillBundleFromDirectory(catalogPath(root, entry.path));
  const original = assertValidSkillBundle(source);
  if (original.metadata.name !== entry.upstreamName)
    throw new Error("Declared upstream name differs from the source Skill");
  if (entry.sourceDigest && entry.sourceDigest !== original.digest)
    throw new Error("Source bundle digest differs from the pinned catalog");
  const metadata = {
    ...original.metadata,
    name: entry.name,
    metadata: {
      ...original.metadata.metadata,
      "agentic-import-format": "catalog-v1",
      "agentic-catalog-id": entry.id,
      "agentic-source-id": entry.sourceId,
      "agentic-source-url": entry.sourceUrl,
      "agentic-source-revision": entry.revision,
      "agentic-source-digest": original.digest,
      "agentic-upstream-name": entry.upstreamName,
      "agentic-upstream-path": entry.upstreamPath,
      "agentic-source-license": entry.license,
    },
  };
  // JSON scalar/collection syntax is valid YAML. Only the frontmatter is
  // adapted; instructions and every supporting file retain their exact bytes.
  const document = `---\n# Modified by Agentic Operator: namespaced name and added source provenance.\n${Object.entries(
    metadata,
  )
    .map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`)
    .join("\n")}\n---\n${original.body}`;
  const bundle: SkillBundle = {
    files: source.files.map((file) =>
      file.path === "SKILL.md"
        ? encodeSkillFile(file.path, Buffer.from(document))
        : { ...file },
    ),
  };
  for (const license of entry.licenseFiles ?? []) {
    const bytes = boundedFile(catalogPath(root, license.path), 1024 * 1024);
    const existing = bundle.files.find(
      (file) => file.path === license.bundlePath,
    );
    if (existing) {
      if (!decodeSkillFile(existing).equals(bytes))
        throw new Error(
          "Added license collides with an existing bundle resource",
        );
    } else bundle.files.push(encodeSkillFile(license.bundlePath, bytes));
  }
  const validation = assertValidSkillBundle(bundle);
  return { bundle, validation, sourceDigest: original.digest };
}

function ownedImport(detail: SkillDetail, entry: SkillCatalogEntry): void {
  if (
    detail.skill.visibility !== "shared" ||
    !detail.skill.canEdit ||
    !detail.draft
  )
    throw new Error(
      "An existing Skill with this name is not an editable shared import",
    );
  if (detail.skill.archivedAt !== null)
    throw new Error(
      "This catalog Skill was archived; restore it explicitly before importing",
    );
  for (const bundle of [
    detail.draft.bundle,
    ...(detail.latestVersion ? [detail.latestVersion.bundle] : []),
  ]) {
    const meta = assertValidSkillBundle(bundle).metadata.metadata;
    if (
      meta?.["agentic-import-format"] !== "catalog-v1" ||
      meta["agentic-catalog-id"] !== entry.id ||
      meta["agentic-source-id"] !== entry.sourceId ||
      meta["agentic-upstream-path"] !== entry.upstreamPath ||
      meta["agentic-upstream-name"] !== entry.upstreamName
    )
      throw new Error(
        "Existing Skill provenance belongs to another source; no changes were made",
      );
  }
}

/** Idempotent across retries. Never replaces a manually edited draft, archived
 * Skill, or unrelated record. Each store mutation retains its own CAS + audit. */
export async function importSkillCatalog(options: {
  root: string;
  catalog: SkillCatalogManifest;
  store: SkillCatalogStore;
  ctx: SkillLibraryContext;
  apply?: boolean;
}): Promise<{
  apply: boolean;
  results: SkillCatalogImportResult[];
  blocked: number;
}> {
  const { root, store, ctx } = options;
  if (
    ctx.platformRole !== "superadmin" ||
    !can(ctx.role, ctx.platformRole, "skills.write") ||
    !can(ctx.role, ctx.platformRole, "skills.publish")
  )
    throw new Error(
      "Shared catalog import requires an authorized platform superadmin",
    );
  const catalog = SkillCatalogManifestSchema.parse(options.catalog);
  const summaries = [];
  for (const archived of [false, true]) {
    let offset: number | null = 0;
    while (offset !== null) {
      const page = await store.list(ctx, {
        scope: "available",
        archived,
        offset,
        limit: 100,
      });
      summaries.push(...page.skills);
      if (summaries.length > 2000)
        throw new Error("Managed library inventory exceeds the import limit");
      offset = page.nextOffset;
    }
  }
  const results: SkillCatalogImportResult[] = [];
  for (const entry of catalog.skills) {
    const result: SkillCatalogImportResult = {
      id: entry.id,
      name: entry.name,
      status: "blocked",
    };
    try {
      const prepared = prepareCatalogSkill(root, entry);
      Object.assign(result, {
        sourceDigest: prepared.sourceDigest,
        contentDigest: prepared.validation.digest,
        files: prepared.bundle.files.length,
        bytes: prepared.validation.totalBytes,
      });
      const matches = summaries.filter((skill) => skill.name === entry.name);
      if (matches.length > 1)
        throw new Error("More than one available Skill has this import name");
      const match = matches[0];
      let detail: SkillDetail;
      if (!match) {
        if (!options.apply) {
          result.status = "would-import";
          results.push(result);
          continue;
        }
        detail = await store.create(
          ctx,
          { bundle: prepared.bundle, visibility: "shared" },
          "import",
        );
        result.skillId = detail.skill.id;
        detail = await store.publish(
          ctx,
          detail.skill.id,
          detail.draft!.revision,
        );
        result.status = "imported";
      } else {
        result.skillId = match.id;
        detail = await store.detail(ctx, match.id);
        ownedImport(detail, entry);
        const draftDigest = skillBundleDigest(detail.draft!.bundle);
        const latestDigest = detail.latestVersion?.contentDigest;
        if (
          draftDigest === prepared.validation.digest &&
          latestDigest === prepared.validation.digest
        ) {
          result.status = "unchanged";
        } else {
          // A saved-but-unpublished import can be resumed only when its exact
          // current draft is this import. Otherwise require a pristine version.
          if (
            latestDigest
              ? draftDigest !== latestDigest &&
                draftDigest !== prepared.validation.digest
              : draftDigest !== prepared.validation.digest
          )
            throw new Error(
              "Existing draft has unpublished edits; preserve or publish them before importing",
            );
          if (!options.apply) {
            result.status = "would-update";
            results.push(result);
            continue;
          }
          if (draftDigest !== prepared.validation.digest)
            detail = await store.save(
              ctx,
              match.id,
              detail.draft!.revision,
              prepared.bundle,
            );
          detail = await store.publish(ctx, match.id, detail.draft!.revision);
          result.status = "updated";
        }
      }
      result.skillId = detail.skill.id;
      result.versionId = detail.latestVersion?.id;
    } catch (error) {
      result.message =
        error instanceof Error
          ? error.message
          : "Catalog Skill could not be imported";
    }
    results.push(result);
  }
  return {
    apply: options.apply === true,
    results,
    blocked: results.filter((entry) => entry.status === "blocked").length,
  };
}
