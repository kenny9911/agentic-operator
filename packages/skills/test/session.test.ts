import { describe, expect, it, vi } from "vitest";
import type { SkillBundle, SkillFile } from "@agentic/contracts";
import { assertValidSkillBundle } from "../src/bundle";
import {
  DEFAULT_SKILL_SESSION_LIMITS,
  SkillSession,
  type SkillCatalogEntry,
  type SkillSessionLimits,
  type SkillSessionOptions,
  type SkillSessionSnapshot,
} from "../src/session";

function fixture(name = "sample", options: { body?: string; description?: string; extraHeader?: string; files?: SkillFile[] } = {}) {
  const body = options.body ?? `Follow the ${name} procedure. Verify the result.`;
  const description = options.description ?? `Use for ${name} tasks.`;
  const bundle: SkillBundle = { files: [
    { path: "SKILL.md", content: `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n${options.extraHeader ?? ""}---\n${body}\n`, encoding: "utf8" },
    ...(options.files ?? []),
  ] };
  const validated = assertValidSkillBundle(bundle);
  const entry: SkillCatalogEntry = {
    id: `skill-${name}`, versionId: `version-${name}-1`, contentDigest: validated.digest,
    name, description: validated.metadata.description,
    invocationPolicy: { model: validated.metadata["disable-model-invocation"] !== true, explicit: true },
  };
  return { entry, bundle, body: validated.body };
}

const reference: SkillFile = { path: "references/checklist.md", content: "Inspect three checks.", encoding: "utf8" };

function makeSession(items = [fixture()], options: Partial<SkillSessionOptions> = {}) {
  const readBundle = vi.fn((entry: SkillCatalogEntry) => {
    const item = items.find((candidate) => candidate.entry.id === entry.id && candidate.entry.versionId === entry.versionId);
    if (!item) throw new Error("Provider was asked for an unknown version");
    return item.bundle;
  });
  const session = new SkillSession({ catalog: items.map((item) => item.entry), readBundle, ...options });
  return { session, readBundle, items };
}

describe("SkillSession durable checkpoint advancement", () => {
  it("advances monotonically and idempotently without forgetting active guidance or resource budgets", async () => {
    const items = [fixture("alpha", { files: [reference] }), fixture("beta")];
    const { session: source } = makeSession(items);
    await source.activate("alpha", { origin: "explicit" });
    const first = await source.snapshot();
    await source.readResource("alpha", reference.path);
    await source.activate("beta", { origin: "model" });
    const second = await source.snapshot();
    const { session: target, readBundle } = makeSession(items);
    await target.advance(first);
    await target.advance(second);
    await target.advance(second);
    expect(await target.snapshot()).toEqual(second);
    expect(readBundle).toHaveBeenCalledTimes(2);
    await expect(target.advance(first)).rejects.toMatchObject({ code: "INVALID_SNAPSHOT" });
    expect(await target.snapshot()).toEqual(second);
  });

  it("does not partially change state after an invalid or unauthorized replay checkpoint", async () => {
    const items = [fixture("alpha"), fixture("beta")];
    const { session: source } = makeSession(items);
    await source.activate("alpha", { origin: "model" });
    const first = await source.snapshot();
    await source.activate("beta", { origin: "explicit" });
    const second = await source.snapshot();
    let allow = true;
    const { session: target } = makeSession(items, { authorize: () => allow });
    await target.advance(first);
    const bad = structuredClone(second) as any;
    bad.activations[1].contentDigest = "f".repeat(64);
    await expect(target.advance(bad)).rejects.toMatchObject({ code: "INVALID_SNAPSHOT" });
    expect(await target.snapshot()).toEqual(first);
    allow = false;
    await expect(target.advance(second)).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    allow = true;
    expect(await target.snapshot()).toEqual(first);
  });
});

describe("SkillSession discovery and authority", () => {
  it("paginates a deterministic metadata catalog without loading bundles", async () => {
    const { session, readBundle } = makeSession([fixture("zeta"), fixture("alpha"), fixture("beta")]);
    const first = await session.list({ limit: 1 });
    const second = await session.list({ limit: 1, cursor: first.nextCursor });
    const third = await session.list({ limit: 1, cursor: second.nextCursor });
    expect([first.skills[0]?.name, second.skills[0]?.name, third.skills[0]?.name]).toEqual(["alpha", "beta", "zeta"]);
    expect(third.nextCursor).toBeUndefined();
    expect(readBundle).not.toHaveBeenCalled();
    expect(JSON.stringify(first)).not.toContain("Follow the");
  });

  it("filters inaccessible entries and fails closed on authorizer errors", async () => {
    const authorize = vi.fn((entry: SkillCatalogEntry) => entry.name !== "private");
    const { session } = makeSession([fixture("visible"), fixture("private")], { authorize });
    expect((await session.list()).skills.map((entry) => entry.name)).toEqual(["visible"]);
    await expect(session.activate("private", { origin: "explicit" })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    authorize.mockImplementation(() => { throw new Error("Authorization unavailable"); });
    await expect(session.list()).rejects.toThrow("Authorization unavailable");
  });

  it("never invokes the provider or authorizer for selectors outside the snapshot", async () => {
    const authorize = vi.fn(() => true);
    const { session, readBundle } = makeSession(undefined, { authorize });
    await expect(session.activate({ id: "other-tenant-skill" }, { origin: "explicit" })).rejects.toMatchObject({ code: "UNKNOWN_SKILL" });
    await expect(session.listResources("other-tenant-skill")).rejects.toMatchObject({ code: "UNKNOWN_SKILL" });
    await expect(session.readResource("other-tenant-skill", "SKILL.md")).rejects.toMatchObject({ code: "UNKNOWN_SKILL" });
    expect(readBundle).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });

  it("does not interpret a bare string as an ID", async () => {
    const { session } = makeSession();
    await expect(session.activate("skill-sample", { origin: "explicit" })).rejects.toMatchObject({ code: "UNKNOWN_SKILL" });
    expect((await session.activate({ id: "skill-sample" }, { origin: "explicit" })).name).toBe("sample");
  });

  it("rejects ambiguous catalog names and IDs before use", () => {
    const first = fixture();
    expect(() => makeSession([first, first])).toThrow("unique");
    expect(() => makeSession([first, { ...fixture("other"), entry: { ...first.entry, name: "other" } }])).toThrow("unique");
    expect(() => makeSession([first], { catalog: [{ ...first.entry, name: "../private" }] })).toThrow("portable skill name");
  });

  it("requires explicit host activation for model-disabled skills and prevents resource bypass", async () => {
    const item = fixture("manual", { extraHeader: "disable-model-invocation: true\n", files: [reference] });
    const { session, readBundle } = makeSession([item]);
    expect((await session.list()).skills).toEqual([]);
    expect((await session.list({ origin: "explicit" })).skills[0]?.name).toBe("manual");
    await expect(session.activate("manual", { origin: "model" })).rejects.toMatchObject({ code: "INVOCATION_DENIED" });
    await expect(session.readResource("manual", reference.path)).rejects.toMatchObject({ code: "SKILL_NOT_ACTIVE" });
    await expect(session.listResources("manual")).rejects.toMatchObject({ code: "SKILL_NOT_ACTIVE" });
    expect(readBundle).not.toHaveBeenCalled();
    await session.activate("manual", { origin: "explicit" });
    expect((await session.readResource("manual", reference.path)).content).toBe(reference.content);
    await expect(session.activate("manual", { origin: "model" })).rejects.toMatchObject({ code: "INVOCATION_DENIED" });
  });

  it("cannot override bundle model policy through permissive catalog metadata", async () => {
    const item = fixture("manual", { extraHeader: "disable-model-invocation: true\n" });
    const { session } = makeSession([item], { catalog: [{ ...item.entry, invocationPolicy: { model: true } }] });
    await expect(session.activate("manual", { origin: "model" })).rejects.toMatchObject({ code: "INVOCATION_DENIED" });
    expect(await session.activeInstructions()).toEqual([]);
    await session.activate("manual", { origin: "explicit" });
  });

  it("does not convert user-invocable menu metadata into an authority denial", async () => {
    const item = fixture("background", { extraHeader: "user-invocable: false\n" });
    const { session } = makeSession([item]);
    expect((await session.activate("background", { origin: "explicit" })).name).toBe("background");
  });

  it("respects narrower host invocation policy", async () => {
    const item = fixture();
    const { session } = makeSession([item], { catalog: [{ ...item.entry, invocationPolicy: { explicit: false } }] });
    await expect(session.activate("sample", { origin: "explicit" })).rejects.toMatchObject({ code: "INVOCATION_DENIED" });
    expect((await session.activate("sample", { origin: "model" })).origin).toBe("model");
  });

  it("rechecks revocation for cached activation, resource access, prompts, snapshots and child scopes", async () => {
    let allowed = true;
    const { session } = makeSession([fixture("sample", { files: [reference] })], { authorize: () => allowed });
    await session.activate("sample", { origin: "model" });
    const child = await session.fork({ skillIds: ["skill-sample"] });
    await child.activate("sample", { origin: "model" });
    allowed = false;
    expect((await session.list()).skills).toEqual([]);
    for (const operation of [
      session.activate("sample", { origin: "model" }),
      session.listResources("sample"), session.readResource("sample", reference.path),
      session.activeInstructions(), session.renderActiveInstructions(), session.snapshot(),
      session.fork({ skillIds: ["skill-sample"] }), child.activeInstructions(),
    ]) await expect(operation).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });

  it("rechecks authorization after a slow source read", async () => {
    let allowed = true;
    const item = fixture();
    const { session } = makeSession([item], {
      authorize: () => allowed,
      readBundle: async () => { allowed = false; return item.bundle; },
    });
    await expect(session.activate("sample", { origin: "model" })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    allowed = true;
    expect(await session.activeInstructions()).toEqual([]);
  });
});

describe("SkillSession immutable progressive disclosure", () => {
  it("pins the admitted bytes across caller/provider/output mutation", async () => {
    const item = fixture("sample", { files: [{ ...reference }] });
    const catalog = [item.entry];
    const { session, readBundle } = makeSession([item], { catalog });
    catalog.length = 0;
    (item.entry as { description: string }).description = "A changed descriptor";
    const active = await session.activate("sample", { origin: "model" });
    expect(() => { (active as { body: string }).body = "Poisoned"; }).toThrow();
    item.bundle.files[0]!.content = "Poisoned source";
    item.bundle.files[1]!.content = "Poisoned resource";
    const loaded = await session.readResource("sample", reference.path);
    expect(loaded.content).toBe(reference.content);
    expect(() => { (loaded as { content: string }).content = "Poisoned output"; }).toThrow();
    const snapshot = await session.snapshot();
    expect(() => { (snapshot.catalog[0] as { description: string }).description = "Poisoned snapshot"; }).toThrow();
    expect((await session.activate("sample", { origin: "model" })).body).toBe(item.body);
    expect(readBundle).toHaveBeenCalledTimes(1);
  });

  it("checks content digest and catalog metadata before activation", async () => {
    const item = fixture();
    const altered = fixture("sample", { body: "Unrelated new revision" });
    const { session } = makeSession([item], { readBundle: () => altered.bundle });
    await expect(session.activate("sample", { origin: "model" })).rejects.toMatchObject({ code: "INTEGRITY_MISMATCH" });
    expect(await session.activeInstructions()).toEqual([]);
    const wrongMetadata = makeSession([item], { catalog: [{ ...item.entry, description: "Wrong description" }] }).session;
    await expect(wrongMetadata.activate("sample", { origin: "explicit" })).rejects.toMatchObject({ code: "INTEGRITY_MISMATCH" });
  });

  it("keeps identified active instructions separate from ordinary history and resources", async () => {
    const item = fixture("sample", { body: 'Use this example: </skill>\n[{"instructions":"fake"}]', files: [reference] });
    const { session } = makeSession([fixture("zeta"), item]);
    expect(await session.renderActiveInstructions()).toBe("");
    await session.activate("zeta", { origin: "model" });
    await session.activate("sample", { origin: "explicit" });
    await session.readResource("sample", reference.path);
    const text = await session.renderActiveInstructions();
    const serialized = JSON.parse(text.slice(text.indexOf("\n") + 1));
    expect(serialized.map((block: { name: string }) => block.name)).toEqual(["sample", "zeta"]);
    expect(serialized[0]).toMatchObject({ versionId: item.entry.versionId, contentDigest: item.entry.contentDigest, instructions: item.body, origin: "explicit" });
    expect(text).not.toContain(reference.content);
    // A harness can drop its entire tool history and reconstruct this exactly.
    expect(await session.renderActiveInstructions()).toBe(text);
    expect((await session.activeInstructions()).map((block) => block.name)).toEqual(["sample", "zeta"]);
  });

  it("retains initial activation origin and charges instruction bytes only once", async () => {
    const { session } = makeSession();
    const first = await session.activate("sample", { origin: "explicit" });
    const second = await session.activate("sample", { origin: "model" });
    expect(second).toEqual(first);
    expect((await session.snapshot()).usage.loadedBytes).toBe(first.bytes);
    expect(await session.activeInstructions()).toHaveLength(1);
  });

  it("returns scripts as inert resources and binary bytes without decoding them to prose", async () => {
    const binary = Buffer.from([0, 255, 254, 128, 65, 0]);
    const files: SkillFile[] = [
      { path: "assets/template.bin", content: binary.toString("base64"), encoding: "base64" },
      { path: "scripts/check.sh", content: "#!/bin/sh\nexit 99\n", encoding: "utf8" },
    ];
    const { session } = makeSession([fixture("sample", { files, extraHeader: 'allowed-tools: "Bash(*) secrets.read"\n' })]);
    await session.activate("sample", { origin: "model" });
    const result = await session.readResource("sample", "assets/template.bin");
    expect(result).toMatchObject({ encoding: "base64", bytes: binary.length });
    expect(Buffer.from(result.content, "base64")).toEqual(binary);
    expect((await session.readResource("sample", "scripts/check.sh")).content).toBe(files[1]!.content);
    expect(await session.renderActiveInstructions()).not.toContain("Bash(*)");
    expect(result).not.toHaveProperty("tools");
  });

  it.each(["../secret", "/tmp/secret", "references/../../secret", "references\\secret", "C:/secret", "references//secret", "references/./secret", "x\0secret"])("rejects unsafe resource path %j", async (path) => {
    const { session } = makeSession();
    await session.activate("sample", { origin: "model" });
    await expect(session.readResource("sample", path)).rejects.toThrow();
    expect((await session.snapshot()).usage.resourceReads).toBe(0);
  });

  it("uses exact case-sensitive resource paths without URL decoding or host fallback", async () => {
    const { session } = makeSession([fixture("sample", { files: [reference] })]);
    await session.activate("sample", { origin: "model" });
    for (const path of ["references/Checklist.md", "%2e%2e/secret", "https%3A%2F%2Fexample.test", "missing.md"]) {
      await expect(session.readResource("sample", path)).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    }
  });

  it("paginates resource metadata without consuming content-read budgets", async () => {
    const { session } = makeSession([fixture("sample", { files: [reference, { path: "assets/a.txt", content: "A", encoding: "utf8" }] })]);
    await session.activate("sample", { origin: "model" });
    const first = await session.listResources("sample", { limit: 1 });
    const second = await session.listResources("sample", { limit: 1, cursor: first.nextCursor });
    const third = await session.listResources("sample", { limit: 1, cursor: second.nextCursor });
    expect([first.resources[0]?.path, second.resources[0]?.path, third.resources[0]?.path]).toEqual(["SKILL.md", "assets/a.txt", reference.path]);
    expect(third.nextCursor).toBeUndefined();
    expect((await session.snapshot()).usage.resourceReads).toBe(0);
  });
});

describe("SkillSession limits and concurrency", () => {
  it("rejects an oversized catalog before copying entries or calling a provider", () => {
    const catalog = [fixture("alpha").entry, fixture("beta").entry];
    Object.defineProperty(catalog, "0", { get() { throw new Error("Should not inspect oversized catalog entries"); } });
    expect(() => makeSession([], { catalog, limits: { maxCatalogEntries: 1 } })).toThrow("maxCatalogEntries");
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid limits %s", (value) => {
    for (const key of Object.keys(DEFAULT_SKILL_SESSION_LIMITS) as (keyof SkillSessionLimits)[]) {
      expect(() => makeSession(undefined, { limits: { [key]: value } })).toThrow("positive safe integer");
    }
  });

  it("bounds concurrent activations without partially installing an over-budget skill", async () => {
    const { session, readBundle } = makeSession([fixture("alpha"), fixture("beta")], { limits: { maxActiveSkills: 1 } });
    const result = await Promise.allSettled([
      session.activate("alpha", { origin: "model" }), session.activate("beta", { origin: "model" }),
    ]);
    expect(result.map((item) => item.status)).toEqual(["fulfilled", "rejected"]);
    expect((result[1] as PromiseRejectedResult).reason.code).toBe("LIMIT_EXCEEDED");
    expect((await session.activeInstructions()).map((item) => item.name)).toEqual(["alpha"]);
    expect(readBundle).toHaveBeenCalledTimes(1);
  });

  it("does not retain bundles after failed instruction or invocation checks", async () => {
    const item = fixture("sample", { files: [reference] });
    const { session, readBundle } = makeSession([item], { limits: { maxActiveContextBytes: 1 } });
    await expect(session.activate("sample", { origin: "model" })).rejects.toThrow("maxActiveContextBytes");
    await expect(session.activate("sample", { origin: "model" })).rejects.toThrow("maxActiveContextBytes");
    expect(readBundle).toHaveBeenCalledTimes(2);
    const manual = fixture("manual", { extraHeader: "disable-model-invocation: true\n" });
    const policy = makeSession([manual], { catalog: [{ ...manual.entry, invocationPolicy: { model: true } }] });
    await expect(policy.session.activate("manual", { origin: "model" })).rejects.toThrow("does not permit model invocation");
    await expect(policy.session.activate("manual", { origin: "model" })).rejects.toThrow("does not permit model invocation");
    expect(policy.readBundle).toHaveBeenCalledTimes(2);
  });

  it("bounds cached complete bundles independently of small instruction bodies", async () => {
    const items = [fixture("alpha", { files: [reference] }), fixture("beta", { files: [reference] })];
    const fullBytes = items.reduce((sum, item) => sum + assertValidSkillBundle(item.bundle).totalBytes, 0);
    const { session, readBundle } = makeSession(items, { limits: { maxBundleCacheBytes: fullBytes - 1 } });
    await session.activate("alpha", { origin: "model" });
    await expect(session.activate("beta", { origin: "model" })).rejects.toThrow("maxBundleCacheBytes");
    await expect(session.activate("beta", { origin: "model" })).rejects.toThrow("maxBundleCacheBytes");
    expect(readBundle).toHaveBeenCalledTimes(3);
    expect((await session.activeInstructions()).map((item) => item.name)).toEqual(["alpha"]);
    expect((await session.snapshot()).usage.loadedBytes).toBe(Buffer.byteLength(items[0]!.body));
  });

  it("bounds the complete rendered context including identifiers and escaped Unicode", async () => {
    const item = fixture("sample", { body: "Verify 多语言 \"quoted\" output.\n" });
    const baseline = makeSession([item]).session;
    await baseline.activate("sample", { origin: "model" });
    const exactBytes = Buffer.byteLength(await baseline.renderActiveInstructions(), "utf8");
    const fits = makeSession([item], { limits: { maxActiveContextBytes: exactBytes } }).session;
    await fits.activate("sample", { origin: "model" });
    const exceeds = makeSession([item], { limits: { maxActiveContextBytes: exactBytes - 1 } }).session;
    await expect(exceeds.activate("sample", { origin: "model" })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect((await exceeds.snapshot()).usage.loadedBytes).toBe(0);
    expect(await exceeds.activeInstructions()).toEqual([]);
  });

  it("counts repeated resource delivery against cumulative byte and read limits", async () => {
    const item = fixture("sample", { files: [{ path: "assets/four.txt", content: "1234", encoding: "utf8" }] });
    const { session } = makeSession([item], { limits: { maxResourceBytes: 7 } });
    await session.activate("sample", { origin: "model" });
    const results = await Promise.allSettled([session.readResource("sample", "assets/four.txt"), session.readResource("sample", "assets/four.txt")]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect((await session.snapshot()).usage).toEqual({ resourceReads: 1, resourceBytes: 4, loadedBytes: Buffer.byteLength(item.body) + 4 });
    const countLimited = makeSession([item], { limits: { maxResourceReads: 1 } }).session;
    await countLimited.activate("sample", { origin: "model" });
    await countLimited.readResource("sample", "assets/four.txt");
    await expect(countLimited.readResource("sample", "assets/four.txt")).rejects.toThrow("maxResourceReads");
  });

  it("enforces individual resource size and combined instruction/resource delivery budgets", async () => {
    const item = fixture("sample", { files: [{ ...reference }] });
    const perRead = makeSession([item], { limits: { maxResourceReadBytes: 1 } }).session;
    await perRead.activate("sample", { origin: "model" });
    await expect(perRead.readResource("sample", reference.path)).rejects.toThrow("maxResourceReadBytes");
    const cumulative = makeSession([item], { limits: { maxLoadedBytes: Buffer.byteLength(item.body) + 1 } }).session;
    await cumulative.activate("sample", { origin: "model" });
    await expect(cumulative.readResource("sample", reference.path)).rejects.toThrow("maxLoadedBytes");
    const instruction = makeSession([item], { limits: { maxLoadedBytes: Buffer.byteLength(item.body) - 1 } }).session;
    await expect(instruction.activate("sample", { origin: "model" })).rejects.toThrow("maxLoadedBytes");
  });

  it("bounds metadata pages and rejects unusably small budgets rather than skipping entries", async () => {
    const { session } = makeSession([fixture("alpha"), fixture("beta")], { limits: { maxCatalogPageBytes: 500, maxCatalogPageSize: 1 } });
    const page = await session.list({ limit: 100 });
    expect(page.skills).toHaveLength(1);
    expect(page.nextCursor).toBeDefined();
    const tooSmall = makeSession(undefined, { limits: { maxCatalogPageBytes: 1 } }).session;
    await expect(tooSmall.list()).rejects.toThrow("maxCatalogPageBytes");
    const resourceSmall = makeSession(undefined, { limits: { maxResourcePageBytes: 1 } }).session;
    await resourceSmall.activate("sample", { origin: "model" });
    await expect(resourceSmall.listResources("sample")).rejects.toThrow("maxResourcePageBytes");
  });

  it("rejects cursors from another catalog, origin or resource listing", async () => {
    const { session } = makeSession([fixture("alpha", { files: [reference] }), fixture("beta", { files: [reference] })]);
    const page = await session.list({ limit: 1 });
    await expect(session.list({ cursor: page.nextCursor, origin: "explicit" })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(makeSession().session.list({ cursor: page.nextCursor })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await session.activate("alpha", { origin: "model" });
    await session.activate("beta", { origin: "model" });
    const resources = await session.listResources("alpha", { limit: 1 });
    await expect(session.listResources("beta", { cursor: resources.nextCursor })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(session.list({ cursor: "%%%" })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(session.list({ limit: NaN })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });
});

describe("SkillSession durable reconstruction and child narrowing", () => {
  it("reconstructs exact active instructions and usage from a body-free serializable snapshot", async () => {
    const items = [fixture("beta"), fixture("alpha", { files: [reference] })];
    const { session } = makeSession(items);
    await session.activate("beta", { origin: "model" });
    await session.activate("alpha", { origin: "explicit" });
    await session.readResource("alpha", reference.path);
    const snapshot = await session.snapshot();
    expect(JSON.stringify(snapshot)).not.toContain("Follow the");
    expect(JSON.stringify(snapshot)).not.toContain(reference.content);
    const restored = makeSession([...items].reverse()).session;
    await restored.restore(JSON.parse(JSON.stringify(snapshot)));
    expect(await restored.renderActiveInstructions()).toBe(await session.renderActiveInstructions());
    expect(await restored.snapshot()).toEqual(snapshot);
    await expect(restored.restore(snapshot)).rejects.toThrow("unused");
  });

  it("restores consumed resource budgets instead of resetting them", async () => {
    const item = fixture("sample", { files: [reference] });
    const options = { limits: { maxResourceReads: 1 } };
    const { session } = makeSession([item], options);
    await session.activate("sample", { origin: "model" });
    await session.readResource("sample", reference.path);
    const restored = makeSession([item], options).session;
    await restored.restore(await session.snapshot());
    await expect(restored.readResource("sample", reference.path)).rejects.toThrow("maxResourceReads");
  });

  it("rejects a changed version, widened catalog, altered body or forged activation", async () => {
    const item = fixture();
    const { session } = makeSession([item]);
    await session.activate("sample", { origin: "model" });
    const snapshot = await session.snapshot();
    const changedVersion = makeSession([item], { catalog: [{ ...item.entry, versionId: "version-new" }] }).session;
    await expect(changedVersion.restore(snapshot)).rejects.toMatchObject({ code: "INVALID_SNAPSHOT" });
    const broader = makeSession([item, fixture("private")]).session;
    await expect(broader.restore(snapshot)).rejects.toMatchObject({ code: "INVALID_SNAPSHOT" });
    const changedBody = makeSession([item], { readBundle: () => fixture("sample", { body: "Changed" }).bundle }).session;
    await expect(changedBody.restore(snapshot)).rejects.toMatchObject({ code: "INTEGRITY_MISMATCH" });
    const forged = structuredClone(snapshot) as { activations: Array<{ id: string }> };
    forged.activations[0]!.id = "private";
    await expect(makeSession([item]).session.restore(forged as SkillSessionSnapshot)).rejects.toMatchObject({ code: "INVALID_SNAPSHOT" });
  });

  it("leaves no partial activation or usage after a later restore failure", async () => {
    const items = [fixture("alpha"), fixture("beta")];
    const original = makeSession(items).session;
    await original.activate("alpha", { origin: "model" });
    await original.activate("beta", { origin: "model" });
    const snapshot = await original.snapshot();
    let reads = 0;
    const restored = makeSession(items, { readBundle: (entry) => {
      reads++;
      if (entry.name === "beta") throw new Error("Storage temporarily unavailable");
      return items[0]!.bundle;
    } }).session;
    await expect(restored.restore(snapshot)).rejects.toThrow("Storage temporarily unavailable");
    expect(await restored.activeInstructions()).toEqual([]);
    expect((await restored.snapshot()).usage).toEqual({ loadedBytes: 0, resourceReads: 0, resourceBytes: 0 });
    await restored.activate("alpha", { origin: "model" });
    expect(reads).toBe(3); // Failed restore did not commit even its staged cache.
  });

  it("bounds the staged restore cache and inherited child caches", async () => {
    const items = [fixture("alpha", { files: [reference] }), fixture("beta", { files: [reference] })];
    const parent = makeSession(items).session;
    await parent.activate("alpha", { origin: "model" });
    await parent.activate("beta", { origin: "model" });
    const oneBundleBytes = assertValidSkillBundle(items[0]!.bundle).totalBytes;
    const { session: restored, readBundle } = makeSession(items, { limits: { maxBundleCacheBytes: oneBundleBytes } });
    await expect(restored.restore(await parent.snapshot())).rejects.toThrow("maxBundleCacheBytes");
    expect(await restored.activeInstructions()).toEqual([]);
    await restored.activate("alpha", { origin: "model" });
    expect(readBundle).toHaveBeenCalledTimes(3);
    await expect(parent.fork({ skillIds: ["skill-alpha", "skill-beta"], limits: { maxBundleCacheBytes: oneBundleBytes } })).rejects.toThrow("maxBundleCacheBytes");
    const narrowed = await parent.fork({ skillIds: ["skill-alpha"], limits: { maxBundleCacheBytes: oneBundleBytes } });
    await narrowed.activate("alpha", { origin: "model" });
    expect(await narrowed.activeInstructions()).toHaveLength(1);
  });

  it("validates snapshot counters, duplicate activations and current authorization", async () => {
    const item = fixture();
    const { session } = makeSession([item]);
    await session.activate("sample", { origin: "model" });
    const snapshot = await session.snapshot();
    for (const usage of [
      { ...snapshot.usage, loadedBytes: 0 }, { ...snapshot.usage, resourceReads: -1 },
      { ...snapshot.usage, resourceBytes: Infinity },
    ]) await expect(makeSession([item]).session.restore({ ...snapshot, usage })).rejects.toMatchObject({ code: "INVALID_SNAPSHOT" });
    await expect(makeSession([item]).session.restore({ ...snapshot, activations: [...snapshot.activations, ...snapshot.activations] })).rejects.toMatchObject({ code: "INVALID_SNAPSHOT" });
    await expect(makeSession([item], { authorize: () => false }).session.restore(snapshot)).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });

  it("copies the restore request immediately so mutations while queued cannot grant activation", async () => {
    const item = fixture();
    const original = makeSession([item]).session;
    const snapshot = structuredClone(await original.snapshot()) as { activations: unknown[] };
    const restored = makeSession([item]).session;
    const restoring = restored.restore(snapshot as SkillSessionSnapshot);
    snapshot.activations.push({ id: item.entry.id, versionId: item.entry.versionId, contentDigest: item.entry.contentDigest, origin: "explicit" });
    await restoring;
    expect(await restored.activeInstructions()).toEqual([]);
  });

  it("narrows child catalogs and retains snapshot sources with independent activation", async () => {
    const alpha = fixture("alpha", { files: [{ ...reference }] });
    const { session, readBundle } = makeSession([alpha, fixture("beta")]);
    await session.activate("alpha", { origin: "model" });
    const child = await session.fork({ skillIds: ["skill-alpha"] });
    expect((await child.list()).skills.map((entry) => entry.name)).toEqual(["alpha"]);
    expect(await child.activeInstructions()).toEqual([]);
    await expect(child.activate("beta", { origin: "explicit" })).rejects.toMatchObject({ code: "UNKNOWN_SKILL" });
    alpha.bundle.files[0]!.content = "Changed after the parent's activation";
    alpha.bundle.files[1]!.content = "Changed resource";
    await child.activate("alpha", { origin: "explicit" });
    expect((await child.readResource("alpha", reference.path)).content).toBe(reference.content);
    expect((await session.activeInstructions())[0]?.origin).toBe("model");
    expect((await child.activeInstructions())[0]?.origin).toBe("explicit");
    expect((await session.snapshot()).usage.resourceReads).toBe(0);
    expect(readBundle).toHaveBeenCalledTimes(1);
    const grandchild = await child.fork({ skillIds: [] });
    await expect(grandchild.fork({ skillIds: ["skill-alpha"] })).rejects.toMatchObject({ code: "UNKNOWN_SKILL" });
  });

  it("cannot expand child authority or raise any parent limit", async () => {
    const { session } = makeSession();
    await expect(session.fork({ skillIds: ["private"] })).rejects.toMatchObject({ code: "UNKNOWN_SKILL" });
    await expect(session.fork({ skillIds: ["skill-sample", "skill-sample"] })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    for (const key of Object.keys(DEFAULT_SKILL_SESSION_LIMITS) as (keyof SkillSessionLimits)[]) {
      await expect(session.fork({ skillIds: ["skill-sample"], limits: { [key]: DEFAULT_SKILL_SESSION_LIMITS[key] + 1 } })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    }
    const narrowed = await session.fork({ skillIds: ["skill-sample"], limits: { maxLoadedBytes: 1 } });
    await expect(narrowed.activate("sample", { origin: "explicit" })).rejects.toThrow("maxLoadedBytes");
  });
});
