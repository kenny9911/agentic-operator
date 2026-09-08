/** Server-owned runtime authority. Library drafts and request payloads never enter a run catalog. */
import { createHash, randomBytes } from "node:crypto";
import { dirname } from "node:path";
import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  eventStore, getDb, managedSkills, runs, runSkillSnapshots,
  skillInvocationGrants, skillLegacyBundles, skillVersions, steps, tenants,
  type DB,
} from "@agentic/db";
import { SkillBindingsSchema, SkillBundleSchema, type SkillBindings, type SkillBundle } from "@agentic/contracts";
import {
  assertValidSkillBundle, decodeSkillFile, parseSkillDocument, readSkillBundleFromDirectory, SkillSession,
  type SkillCatalogEntry, type SkillDescriptor, type SkillSessionScriptExecution,
} from "@agentic/skills";
import type {
  CaptureRunSkillsInput, RunSkillScope, RunSkillSnapshotRef, RuntimeSkillHost,
} from "@agentic/runtime";

const SourceSchema = z.object({
  id: z.string().min(1).max(240), versionId: z.string().min(1).max(240),
  name: z.string().min(1).max(64), description: z.string().min(1).max(1024),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  source: z.enum(["managed", "legacy"]), ownerTenantId: z.string().min(1),
  invocationPolicy: z.object({ model: z.boolean().optional(), explicit: z.boolean().optional() }).strict().optional(),
}).strict();
type Source = z.infer<typeof SourceSchema>;
type Snapshot = typeof runSkillSnapshots.$inferSelect;
const CatalogSchema = z.array(SourceSchema).max(1000);
const ActivationsSchema = z.array(z.string().min(1)).max(8);
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const MAX_LEGACY_BYTES = 32 * 1024 * 1024;

export class SkillRuntimeError extends Error {
  constructor(message: string) { super(message); this.name = "SkillRuntimeError"; }
}
function fail(message: string): never { throw new SkillRuntimeError(message); }
function entry(source: Source): SkillCatalogEntry {
  const { source: _kind, ownerTenantId: _owner, ...catalog } = source;
  return catalog;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function snapshotDigest(row: Pick<Snapshot, "tenantId" | "executionId" | "kind" | "agentId" | "parentSnapshotId" | "rootSnapshotId" | "catalogJson" | "activationsJson">): string {
  return digest([row.tenantId, row.executionId, row.kind, row.agentId, row.parentSnapshotId, row.rootSnapshotId, row.catalogJson, row.activationsJson]);
}
function checked(row: Snapshot): { catalog: Source[]; activations: string[] } {
  if (Buffer.byteLength(JSON.stringify([row.catalogJson, row.activationsJson])) > MAX_SNAPSHOT_BYTES) fail("Skill snapshot exceeds its size limit");
  if (snapshotDigest(row) !== row.contentDigest) fail("Skill snapshot integrity mismatch");
  const catalog = CatalogSchema.parse(row.catalogJson);
  const activations = ActivationsSchema.parse(row.activationsJson);
  if (new Set(catalog.map((s) => s.id)).size !== catalog.length || new Set(catalog.map((s) => s.name)).size !== catalog.length) fail("Duplicate Skill snapshot identity");
  if (new Set(activations).size !== activations.length || activations.some((id) => !catalog.some((s) => s.id === id))) fail("Invalid Skill snapshot activation");
  return { catalog, activations };
}
function narrow(catalog: Source[], bindings: SkillBindings | undefined): Source[] {
  if (!bindings || bindings.mode === "inherit") return catalog;
  if (bindings.mode === "disabled") return [];
  return bindings.skills.map((selection) => {
    const source = catalog.find((item) => item.id === selection.id);
    if (!source || (selection.versionId && source.versionId !== selection.versionId)) fail("Skill selection exceeds the inherited catalog or version ceiling");
    return source;
  });
}
/** A recipient workflow ceiling intersects an already narrowed parent. */
function workflowIntersection(catalog: Source[], bindings: SkillBindings | undefined): Source[] {
  if (!bindings || bindings.mode === "inherit") return catalog;
  if (bindings.mode === "disabled") return [];
  return catalog.filter((source) => bindings.skills.some((selection) => selection.id === source.id && (!selection.versionId || selection.versionId === source.versionId)));
}
function activated(catalog: Source[], ...bindings: Array<SkillBindings | undefined>): string[] {
  const ids = new Set<string>();
  for (const binding of bindings) if (binding?.mode === "selected") for (const selection of binding.skills) {
    if (selection.activate && catalog.some((s) => s.id === selection.id)) ids.add(selection.id);
  }
  return ActivationsSchema.parse([...ids].sort());
}

export interface SkillRuntimeOptions {
  db?: DB;
  /** Operator-configured compatibility descriptors; never accepts an HTTP path. */
  legacySkills?: (tenantSlug: string) => readonly SkillDescriptor[];
  scriptExecution?: (scope: RunSkillScope, authorize: (entry: SkillCatalogEntry) => boolean) => SkillSessionScriptExecution | undefined;
}

export class ManagedSkillRuntime implements RuntimeSkillHost {
  private readonly db: DB;
  private readonly legacy: NonNullable<SkillRuntimeOptions["legacySkills"]>;
  private readonly scripts: SkillRuntimeOptions["scriptExecution"];
  constructor(options: SkillRuntimeOptions = {}) {
    this.db = options.db ?? getDb();
    this.legacy = options.legacySkills ?? (() => []);
    this.scripts = options.scriptExecution;
  }

  private systemTenantId(): string | undefined {
    return this.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, "__system")).get()?.id;
  }
  private authorized(source: Source, tenantId: string): boolean {
    if (source.source === "legacy") {
      return source.ownerTenantId === tenantId && Boolean(this.db.select({ id: skillLegacyBundles.id }).from(skillLegacyBundles).where(and(eq(skillLegacyBundles.id, source.versionId), eq(skillLegacyBundles.tenantId, tenantId), eq(skillLegacyBundles.contentDigest, source.contentDigest))).get());
    }
    const systemId = this.systemTenantId();
    const row = this.db.select({ owner: managedSkills.tenantId, visibility: managedSkills.visibility, digest: skillVersions.contentDigest, name: skillVersions.name, description: skillVersions.description, versionOwner: skillVersions.tenantId }).from(managedSkills)
      .innerJoin(skillVersions, and(eq(skillVersions.skillId, managedSkills.id), eq(skillVersions.id, source.versionId)))
      .where(eq(managedSkills.id, source.id)).get();
    return Boolean(row && row.owner === source.ownerTenantId && row.versionOwner === row.owner && row.digest === source.contentDigest && row.name === source.name && row.description === source.description && (row.owner === tenantId || (row.owner === systemId && row.visibility === "shared")));
  }

  private managedCatalog(tenantId: string, pins: Map<string, string>): Source[] {
    const systemId = this.systemTenantId();
    const visible = this.db.select({ id: managedSkills.id, ownerTenantId: managedSkills.tenantId, latest: managedSkills.latestVersionId }).from(managedSkills).where(and(isNull(managedSkills.archivedAt), isNotNull(managedSkills.latestVersionId), systemId ? or(eq(managedSkills.tenantId, tenantId), and(eq(managedSkills.tenantId, systemId), eq(managedSkills.visibility, "shared"))) : eq(managedSkills.tenantId, tenantId))).limit(1001).all();
    if (visible.length > 1000) fail("Published Skill catalog exceeds 1000 entries");
    const result: Source[] = [];
    for (const skill of visible) {
      const versionId = pins.get(skill.id) ?? skill.latest;
      if (!versionId) continue;
      const version = this.db.select({ versionId: skillVersions.id, name: skillVersions.name, description: skillVersions.description, contentDigest: skillVersions.contentDigest,
        document: sql<string>`(SELECT value FROM json_each(${skillVersions.bundleJson}, '$.files') WHERE json_extract(value, '$.path') = 'SKILL.md' LIMIT 1)`,
      }).from(skillVersions).where(and(eq(skillVersions.id, versionId), eq(skillVersions.skillId, skill.id), eq(skillVersions.tenantId, skill.ownerTenantId))).get();
      if (!version) fail("Selected published Skill version is unavailable");
      if (!version.document || Buffer.byteLength(version.document) > 128 * 1024) fail("Published Skill instructions exceed their limit");
      const { frontmatter } = parseSkillDocument(decodeSkillFile(JSON.parse(version.document)).toString("utf8"));
      if (frontmatter.name !== version.name || frontmatter.description !== version.description) fail("Published Skill metadata integrity mismatch");
      const { document: _document, ...metadata } = version;
      result.push(SourceSchema.parse({ id: skill.id, ownerTenantId: skill.ownerTenantId, source: "managed", ...metadata, ...(frontmatter["disable-model-invocation"] === true ? { invocationPolicy: { model: false } } : {}) }));
    }
    return result;
  }
  private legacyCatalog(input: CaptureRunSkillsInput): Source[] {
    const descriptors = this.legacy(input.tenantSlug);
    if (descriptors.length > 1000) fail("Legacy Skill catalog exceeds 1000 entries");
    let bytes = 0;
    return descriptors.map((descriptor) => {
      const bundle = readSkillBundleFromDirectory(dirname(descriptor.path));
      const valid = assertValidSkillBundle(bundle);
      if (valid.metadata.name !== descriptor.name || valid.metadata.description !== descriptor.description) fail("Legacy Skill metadata changed since registration");
      if ((bytes += valid.totalBytes) > MAX_LEGACY_BYTES) fail("Legacy Skill snapshot exceeds its byte budget");
      const versionId = `slb-${digest([input.tenantId, valid.digest])}`;
      this.db.insert(skillLegacyBundles).values({ id: versionId, tenantId: input.tenantId, name: valid.metadata.name, description: valid.metadata.description, contentDigest: valid.digest, bundleJson: bundle }).onConflictDoNothing().run();
      return SourceSchema.parse({ id: `legacy:${descriptor.name}`, versionId, ownerTenantId: input.tenantId, name: valid.metadata.name, description: valid.metadata.description, contentDigest: valid.digest, source: "legacy", ...(valid.metadata["disable-model-invocation"] === true ? { invocationPolicy: { model: false } } : {}) });
    });
  }
  private getSnapshot(ref: RunSkillSnapshotRef, tenantId: string): Snapshot {
    const row = this.db.select().from(runSkillSnapshots).where(and(eq(runSkillSnapshots.id, ref.id), eq(runSkillSnapshots.tenantId, tenantId))).get();
    if (!row || row.contentDigest !== ref.contentDigest) fail("Skill snapshot is unavailable in this tenant");
    checked(row);
    return row;
  }
  private writeSnapshot(input: CaptureRunSkillsInput, kind: Snapshot["kind"], catalog: Source[], activations: string[], parent?: Snapshot, root?: Snapshot): Snapshot {
    catalog = [...catalog].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    CatalogSchema.parse(catalog);
    const fields = { tenantId: input.tenantId, executionId: input.executionId, kind, agentId: kind === "root" ? null : input.agentId, parentSnapshotId: parent?.id ?? null, rootSnapshotId: root?.id ?? null, catalogJson: catalog, activationsJson: activations };
    const row = { id: `ssn-${randomBytes(16).toString("hex")}`, ...fields, contentDigest: snapshotDigest(fields), createdAt: new Date() };
    checked(row);
    this.db.insert(runSkillSnapshots).values(row).run();
    return row;
  }
  private parent(input: CaptureRunSkillsInput): Snapshot | undefined {
    if (input.kind === "test" && input.parent) return this.getSnapshot(input.parent, input.tenantId);
    let parentId: string | undefined;
    if (input.invocationGrant) {
      const grant = this.db.select().from(skillInvocationGrants).where(and(eq(skillInvocationGrants.id, input.invocationGrant), eq(skillInvocationGrants.tenantId, input.tenantId), eq(skillInvocationGrants.recipient, input.agentName))).get();
      if (!grant) fail("Invalid internal Skill invocation receipt");
      parentId = grant.parentSnapshotId;
    } else if (input.kind !== "test") {
      const parentRunId = this.db.select({ parentRunId: runs.parentRunId }).from(runs).where(and(eq(runs.id, input.executionId), eq(runs.tenantId, input.tenantId))).get()?.parentRunId;
      if (parentRunId) {
        parentId = this.db.select({ id: runSkillSnapshots.id }).from(runSkillSnapshots).innerJoin(runs, and(eq(runs.id, runSkillSnapshots.executionId), eq(runs.tenantId, runSkillSnapshots.tenantId))).where(and(eq(runSkillSnapshots.executionId, parentRunId), eq(runSkillSnapshots.tenantId, input.tenantId), eq(runSkillSnapshots.kind, "run"))).get()?.id;
        if (!parentId) fail("Skill parent run snapshot is unavailable");
      }
    }
    if (!parentId && input.delivery?.eventId) {
      const emitted = this.db.select({ sourceRunId: eventStore.sourceRunId, name: eventStore.name }).from(eventStore).where(and(eq(eventStore.id, input.delivery.eventId), eq(eventStore.tenantId, input.tenantId))).get();
      if (emitted?.sourceRunId) {
        if (input.delivery.eventName !== emitted.name && input.delivery.eventName !== `${input.tenantSlug}/${emitted.name}`) fail("Skill lineage delivery name mismatch");
        const parentRun = this.db.select({ id: runs.id }).from(runs).where(and(eq(runs.id, emitted.sourceRunId), eq(runs.tenantId, input.tenantId))).get();
        if (!parentRun) fail("Skill lineage parent run is unavailable");
        parentId = this.db.select({ id: runSkillSnapshots.id }).from(runSkillSnapshots).where(and(eq(runSkillSnapshots.executionId, parentRun.id), eq(runSkillSnapshots.kind, "run"), eq(runSkillSnapshots.tenantId, input.tenantId))).get()?.id;
        if (!parentId) fail("Skill lineage parent snapshot is unavailable");
      }
    }
    if (!parentId) return undefined;
    const row = this.db.select().from(runSkillSnapshots).where(and(eq(runSkillSnapshots.id, parentId), eq(runSkillSnapshots.tenantId, input.tenantId))).get();
    if (!row) fail("Skill parent snapshot is unavailable");
    checked(row);
    return row;
  }

  capture(rawInput: CaptureRunSkillsInput): RunSkillSnapshotRef {
    const input = { ...rawInput, workflowSkills: rawInput.workflowSkills === undefined ? undefined : SkillBindingsSchema.parse(rawInput.workflowSkills), agentSkills: rawInput.agentSkills === undefined ? undefined : SkillBindingsSchema.parse(rawInput.agentSkills) };
    return this.db.transaction(() => {
      const kind = input.kind ?? "run";
      if (kind === "run") {
        const run = this.db.select({ id: runs.id }).from(runs).where(and(eq(runs.id, input.executionId), eq(runs.tenantId, input.tenantId), eq(runs.agentId, input.agentId))).get();
        if (!run) fail("Skill runtime scope does not identify its durable run");
      }
      const existing = this.db.select().from(runSkillSnapshots).where(and(eq(runSkillSnapshots.tenantId, input.tenantId), eq(runSkillSnapshots.executionId, input.executionId), eq(runSkillSnapshots.kind, kind))).get();
      if (existing) {
        if (existing.agentId !== input.agentId) fail("Skill snapshot belongs to another agent");
        checked(existing);
        return { id: existing.id, contentDigest: existing.contentDigest };
      }
      const parent = this.parent(input);
      let root: Snapshot;
      let available: Source[];
      if (parent) {
        root = parent.rootSnapshotId ? this.db.select().from(runSkillSnapshots).where(and(eq(runSkillSnapshots.id, parent.rootSnapshotId), eq(runSkillSnapshots.tenantId, input.tenantId))).get() ?? fail("Skill root snapshot unavailable") : parent;
        checked(root);
        available = workflowIntersection(checked(parent).catalog, input.workflowSkills);
      } else {
        const pins = new Map<string, string>();
        for (const binding of [input.workflowSkills, input.agentSkills]) if (binding?.mode === "selected") for (const selection of binding.skills) if (selection.versionId) {
          if (pins.has(selection.id) && pins.get(selection.id) !== selection.versionId) fail("Agent pin exceeds the workflow version ceiling");
          pins.set(selection.id, selection.versionId);
        }
        const sources = input.workflowSkills?.mode === "disabled" ? [] : [...this.managedCatalog(input.tenantId, pins), ...this.legacyCatalog(input)];
        const explicitlySelected = new Set(input.agentSkills?.mode === "selected" && input.workflowSkills?.mode !== "selected" ? input.agentSkills.skills.map((selection) => selection.id) : []);
        // Explicit selections may choose shared IDs; inherited names resolve tenant first.
        const prioritized = sources.sort((a, b) => Number(explicitlySelected.has(b.id)) - Number(explicitlySelected.has(a.id)) || Number(b.ownerTenantId === input.tenantId) - Number(a.ownerTenantId === input.tenantId) || Number(a.source === "legacy") - Number(b.source === "legacy") || a.id.localeCompare(b.id));
        const seen = new Set<string>();
        const inherited = prioritized.filter((source) => !seen.has(source.name) && Boolean(seen.add(source.name)));
        available = input.workflowSkills?.mode === "selected" ? narrow(sources, input.workflowSkills) : narrow(inherited, input.workflowSkills);
        root = this.writeSnapshot(input, "root", available, []);
      }
      const catalog = narrow(available, input.agentSkills);
      for (const source of catalog) if (!this.authorized(source, input.tenantId)) fail("Skill source is no longer authorized");
      const snapshot = this.writeSnapshot(input, kind, catalog, activated(catalog, input.workflowSkills, input.agentSkills), parent, root);
      return { id: snapshot.id, contentDigest: snapshot.contentDigest };
    });
  }

  async restore(ref: RunSkillSnapshotRef, scope: RunSkillScope): Promise<SkillSession> {
    const row = this.getSnapshot(ref, scope.tenantId);
    if (row.kind === "root" || row.executionId !== scope.executionId || row.agentId !== scope.agentId) fail("Skill snapshot scope mismatch");
    const { catalog, activations } = checked(row);
    const sourceById = new Map(catalog.map((source) => [source.id, source]));
    const authorizeSource = (selected: SkillCatalogEntry) => {
      const source = sourceById.get(selected.id);
      return Boolean(source && source.versionId === selected.versionId && source.contentDigest === selected.contentDigest && this.authorized(source, scope.tenantId));
    };
    const session = new SkillSession({
      catalog: catalog.map(entry),
      scriptExecution: row.kind === "run" ? this.scripts?.(scope, authorizeSource) : undefined,
      authorize: (selected) => {
        const source = sourceById.get(selected.id);
        return Boolean(source && this.authorized(source, scope.tenantId));
      },
      readBundle: (selected) => {
        const source = sourceById.get(selected.id);
        if (!source || !this.authorized(source, scope.tenantId)) fail("Skill source is no longer authorized");
        const table = source.source === "managed" ? skillVersions : skillLegacyBundles;
        const stored = this.db.select({ bundle: table.bundleJson }).from(table).where(and(eq(table.id, source.versionId), eq(table.tenantId, source.ownerTenantId))).get();
        if (!stored) fail("Immutable Skill bundle unavailable");
        return SkillBundleSchema.parse(stored.bundle);
      },
    });
    for (const id of activations) await session.activate({ id }, { origin: "explicit" });
    return session;
  }

  /** Native harness preparation is host-only and consumes no model resource reads.
   * Every exact bundle is revalidated and the complete export is bounded. */
  async materializationSources(ref: RunSkillSnapshotRef, scope: RunSkillScope): Promise<{ sources: readonly { entry: SkillCatalogEntry; bundle: SkillBundle }[]; activationIds: readonly string[] }> {
    const row = this.getSnapshot(ref, scope.tenantId);
    if (row.kind === "root" || row.executionId !== scope.executionId || row.agentId !== scope.agentId) fail("Skill snapshot scope mismatch");
    const { catalog, activations } = checked(row);
    let totalBytes = 0;
    const sources = catalog.map((source) => {
      if (!this.authorized(source, scope.tenantId)) fail("Skill source is no longer authorized");
      const table = source.source === "managed" ? skillVersions : skillLegacyBundles;
      const stored = this.db.select({ bundle: table.bundleJson }).from(table).where(and(eq(table.id, source.versionId), eq(table.tenantId, source.ownerTenantId))).get();
      if (!stored) fail("Immutable Skill bundle unavailable");
      const bundle = SkillBundleSchema.parse(stored.bundle);
      const valid = assertValidSkillBundle(bundle);
      if (valid.digest !== source.contentDigest || valid.metadata.name !== source.name || valid.metadata.description !== source.description) fail("Immutable Skill bundle integrity mismatch");
      if ((totalBytes += valid.totalBytes) > MAX_LEGACY_BYTES) fail("Native Skill materialization exceeds its byte budget");
      for (const file of bundle.files) Object.freeze(file);
      Object.freeze(bundle.files); Object.freeze(bundle);
      return Object.freeze({ entry: Object.freeze(entry(source)), bundle });
    });
    return Object.freeze({ sources: Object.freeze(sources), activationIds: Object.freeze([...activations]) });
  }

  issueInvocation(input: RunSkillScope & { stepId: string; recipient: string }): string {
    return this.db.transaction(() => {
      const parent = this.db.select({ snapshot: runSkillSnapshots }).from(runSkillSnapshots).innerJoin(runs, and(eq(runs.id, runSkillSnapshots.executionId), eq(runs.tenantId, runSkillSnapshots.tenantId))).innerJoin(steps, and(eq(steps.runId, runs.id), eq(steps.id, input.stepId))).where(and(eq(runs.id, input.executionId), eq(runs.tenantId, input.tenantId), eq(runs.agentId, input.agentId), eq(runSkillSnapshots.kind, "run"))).get()?.snapshot;
      if (!parent) fail("Skill invocation requires a durable parent run and step");
      checked(parent);
      const previous = this.db.select({ id: skillInvocationGrants.id }).from(skillInvocationGrants).where(and(eq(skillInvocationGrants.tenantId, input.tenantId), eq(skillInvocationGrants.stepId, input.stepId), eq(skillInvocationGrants.recipient, input.recipient))).get();
      if (previous) return previous.id;
      const id = `sig-${randomBytes(32).toString("hex")}`;
      this.db.insert(skillInvocationGrants).values({ id, tenantId: input.tenantId, parentRunId: input.executionId, parentSnapshotId: parent.id, stepId: input.stepId, recipient: input.recipient }).run();
      return id;
    });
  }
}
