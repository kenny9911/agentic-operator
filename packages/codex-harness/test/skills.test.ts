import assert from "node:assert/strict";
import {
  chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { SkillMetadata, SkillsListParams, SkillsListResponse, SkillsConfigWriteParams } from "@agentic/codex-protocol";
import { assertValidSkillBundle, type SkillBundle } from "@agentic/skills";
import { AppServerClient } from "../src/app-server-client";
import { writeCodexHome } from "../src/codex-home";
import { assertCodexHarnessVersion, codexLaunch } from "../src/version";
import { CodexSkillError, materializeCodexSkills, type CodexSkillSource, type CodexSkillSet } from "../src/skills";

function source(name = "invoice-check"): CodexSkillSource {
  const bundle: SkillBundle = { files: [
    { path: "SKILL.md", encoding: "utf8", content: `---\nname: ${name}\ndescription: Check supplied invoices using the packaged reference.\n---\nRead [the rules](references/rules.md).\n` },
    { path: "references/rules.md", encoding: "utf8", content: "Preserve supplied identifiers.\n" },
    { path: "assets/fixture.bin", encoding: "base64", content: Buffer.from([0, 255, 1, 128]).toString("base64") },
  ] };
  const valid = assertValidSkillBundle(bundle);
  return { entry: { id: `skill-${name}`, versionId: "version-1", name, description: valid.metadata.description, contentDigest: valid.digest }, bundle };
}

function home() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "codex-skills-test-")));
  const codexHome = path.join(root, "codex");
  const cwd = path.join(root, "workspace");
  mkdirSync(cwd, { mode: 0o700 });
  writeCodexHome({ dir: codexHome, model: "gpt-5.4", sandboxMode: "read-only", approvalPolicy: "never", shellTool: false, mcpServers: [] });
  return { root, codexHome, cwd, close: () => rmSync(root, { recursive: true, force: true }) };
}

function metadata(set: CodexSkillSet, index = 0): SkillMetadata {
  const entry = set.catalog[index]!;
  return { name: entry.name, description: entry.description, path: path.join(set.root, entry.name, "SKILL.md"), scope: "user", enabled: true, pluginId: null };
}

function fakeClient(set: CodexSkillSet, cwd: string, skills = set.catalog.map((_, index) => metadata(set, index))) {
  const writes: SkillsConfigWriteParams[] = [];
  const lists: SkillsListParams[] = [];
  return {
    options: { codexHome: set.codexHome, cwd, env: { ...set.environment }, inheritEnv: false, requestTimeoutMs: 1000 },
    skills,
    writes,
    lists,
    async skillsList(params: SkillsListParams): Promise<SkillsListResponse> { lists.push(params); return { data: [{ cwd, skills, errors: [] }] }; },
    async skillsConfigWrite(params: SkillsConfigWriteParams) {
      writes.push(params);
      const skill = skills.find((entry) => entry.path === params.path)!;
      skill.enabled = params.enabled;
      return { effectiveEnabled: skill.enabled };
    },
  };
}

test("materializes only supplied immutable bytes and resolves explicit inputs by catalog id", async () => {
  const context = home();
  try {
    const selected = source();
    const set = materializeCodexSkills({ codexHome: context.codexHome, skills: [selected] });
    assert.equal(readFileSync(path.join(set.root, selected.entry.name, "references/rules.md"), "utf8"), "Preserve supplied identifiers.\n");
    assert.deepEqual(readFileSync(path.join(set.root, selected.entry.name, "assets/fixture.bin")), Buffer.from([0, 255, 1, 128]));
    assert.throws(() => set.explicitInput(selected.entry.id), /Verify Codex Skill discovery/);
    const client = fakeClient(set, context.cwd);
    await set.prepareDiscovery(client, context.cwd);
    assert.deepEqual(set.explicitInput(selected.entry.id), { type: "skill", name: selected.entry.name, path: path.join(set.root, selected.entry.name, "SKILL.md") });
    assert.deepEqual(client.lists, [{ cwds: [context.cwd], forceReload: true }, { cwds: [context.cwd], forceReload: true }]);
    assert.equal(client.writes.length, 0);
    assert.throws(() => set.explicitInput("/tmp/model-provided/SKILL.md"), /immutable catalog/);
    assert.throws(() => set.explicitInput({ id: selected.entry.id, path: "/tmp/forged" } as unknown as string), /immutable catalog/);
    selected.bundle.files[0]!.content = "caller-mutated";
    set.verifyIntegrity();
    assert.equal(Object.isFrozen(set.catalog), true);
    assert.equal(Object.isFrozen(set.catalog[0]), true);
    if (process.platform !== "win32") {
      assert.equal(lstatSync(set.root).mode & 0o777, 0o700);
      assert.equal(lstatSync(path.join(set.root, selected.entry.name, "SKILL.md")).mode & 0o777, 0o400);
    }
  } finally { context.close(); }
});

test("rejects digest/metadata mismatches, collisions and traversal before writing", () => {
  const context = home();
  try {
    const valid = source();
    const cases: CodexSkillSource[][] = [
      [{ ...valid, entry: { ...valid.entry, contentDigest: "0".repeat(64) } }],
      [{ ...valid, entry: { ...valid.entry, name: "other-name" } }],
      [valid, { ...source("other-name"), entry: { ...source("other-name").entry, id: valid.entry.id } }],
      [valid, { ...valid, entry: { ...valid.entry, id: "other-id" } }],
      [{ ...valid, bundle: { files: [...valid.bundle.files, { path: "../escape", encoding: "utf8", content: "no" }] } }],
      [{ ...valid, bundle: { files: [...valid.bundle.files, { path: "references/RULES.md", encoding: "utf8", content: "collision" }] } }],
    ];
    for (const skills of cases) {
      assert.throws(() => materializeCodexSkills({ codexHome: context.codexHome, skills }));
      assert.equal(existsSync(path.join(context.codexHome, "skills")), false);
    }
  } finally { context.close(); }
});

test("reports restricted native invocation as unsupported without widening policy", () => {
  const context = home();
  try {
    const valid = source();
    const portable = structuredClone(valid);
    portable.bundle.files[0]!.content = portable.bundle.files[0]!.content.replace("name: invoice-check\n", "name: invoice-check\ndisable-model-invocation: true\n");
    const portableDigest = assertValidSkillBundle(portable.bundle).digest;
    const cases = [
      { ...valid, entry: { ...valid.entry, invocationPolicy: { model: false } } },
      { ...valid, entry: { ...valid.entry, invocationPolicy: { explicit: false } } },
      { ...portable, entry: { ...portable.entry, contentDigest: portableDigest } },
    ];
    for (const restricted of cases) {
      assert.throws(() => materializeCodexSkills({ codexHome: context.codexHome, skills: [restricted] }), (error: unknown) =>
        error instanceof CodexSkillError && error.code === "UNSUPPORTED_INVOCATION_POLICY" && /host SkillSession/.test(error.message));
      assert.equal(existsSync(path.join(context.codexHome, "skills")), false);
    }
  } finally { context.close(); }
});

test("refuses existing or linked roots without modifying their contents", () => {
  const context = home();
  try {
    const target = path.join(context.root, "other");
    mkdirSync(target, { mode: 0o700 });
    writeFileSync(path.join(target, "keep"), "untouched");
    symlinkSync(target, path.join(context.codexHome, "skills"), "dir");
    assert.throws(() => materializeCodexSkills({ codexHome: context.codexHome, skills: [source()] }));
    assert.equal(readFileSync(path.join(target, "keep"), "utf8"), "untouched");
    unlinkSync(path.join(context.codexHome, "skills"));
    mkdirSync(path.join(context.codexHome, "skills"));
    assert.throws(() => materializeCodexSkills({ codexHome: context.codexHome, skills: [] }));
    const linkedHome = path.join(context.root, "linked-home");
    symlinkSync(context.codexHome, linkedHome, "dir");
    assert.throws(() => materializeCodexSkills({ codexHome: linkedHome, skills: [] }), /must not be links/);
  } finally { context.close(); }
});

test("detects changed content, extra resources, symlinks and hardlinks before invoking", async () => {
  for (const mutation of ["content", "extra", "symlink", "hardlink"] as const) {
    const context = home();
    try {
      const selected = source();
      const set = materializeCodexSkills({ codexHome: context.codexHome, skills: [selected] });
      await set.prepareDiscovery(fakeClient(set, context.cwd), context.cwd);
      const resource = path.join(set.root, selected.entry.name, "references/rules.md");
      if (mutation === "content") { chmodSync(resource, 0o600); writeFileSync(resource, "mutated"); }
      if (mutation === "extra") writeFileSync(path.join(set.root, selected.entry.name, "extra.txt"), "extra");
      if (mutation === "symlink" || mutation === "hardlink") {
        const target = path.join(context.root, "outside-reference");
        writeFileSync(target, "Preserve supplied identifiers.\n");
        unlinkSync(resource);
        if (mutation === "symlink") symlinkSync(target, resource); else linkSync(target, resource);
      }
      assert.throws(() => set.explicitInput(selected.entry.id));
    } finally { context.close(); }
  }
});

test("disables only native system skills under its own root and verifies the authorized catalog", async () => {
  const context = home();
  try {
    const set = materializeCodexSkills({ codexHome: context.codexHome, skills: [source()] });
    const system = path.join(set.root, ".system", "native-fixture", "SKILL.md");
    mkdirSync(path.dirname(system), { recursive: true });
    writeFileSync(system, "native fixture");
    const native: SkillMetadata = { name: "native-fixture", description: "Native fixture", path: system, scope: "system", enabled: true, pluginId: null };
    const client = fakeClient(set, context.cwd, [metadata(set), native]);
    await assert.rejects(set.verifyDiscovery(client, context.cwd), /not in the authorized snapshot/);
    assert.deepEqual(await set.prepareDiscovery(client, context.cwd), set.catalog);
    assert.deepEqual(client.writes, [{ path: system, enabled: false }]);
    assert.equal(set.explicitInput(set.catalog[0]!.id).name, set.catalog[0]!.name);
    client.skills[0]!.description = "changed";
    await assert.rejects(set.verifyDiscovery(client, context.cwd), /differs from/);
    assert.throws(() => set.explicitInput(set.catalog[0]!.id), /Verify Codex Skill discovery/);
  } finally { context.close(); }
});

test("rejects ambient discovery, missing/disabled skills, unsafe environment and response errors", async () => {
  const context = home();
  try {
    const set = materializeCodexSkills({ codexHome: context.codexHome, skills: [source()] });
    const ambient: SkillMetadata = { ...metadata(set), path: path.join(context.cwd, ".agents/skills/other/SKILL.md"), scope: "repo", enabled: false };
    const outside = fakeClient(set, context.cwd, [metadata(set), ambient]);
    await assert.rejects(set.prepareDiscovery(outside, context.cwd), /outside the authorized/);
    assert.equal(outside.writes.length, 0);
    await assert.rejects(set.verifyDiscovery(fakeClient(set, context.cwd, []), context.cwd), /every authorized Skill/);
    await assert.rejects(set.verifyDiscovery(fakeClient(set, context.cwd, [{ ...metadata(set), enabled: false }]), context.cwd), /differs from/);
    const inherited = fakeClient(set, context.cwd);
    inherited.options.inheritEnv = true;
    await assert.rejects(set.verifyDiscovery(inherited, context.cwd), /no inherited environment/);
    const wrongHome = fakeClient(set, context.cwd);
    wrongHome.options.env.HOME = context.root;
    await assert.rejects(set.verifyDiscovery(wrongHome, context.cwd), /private user environment/);
    const wrongCwd = fakeClient(set, context.cwd);
    wrongCwd.options.cwd = context.root;
    await assert.rejects(set.verifyDiscovery(wrongCwd, context.cwd), /explicitly configured working directory/);
    const incomplete = fakeClient(set, context.cwd);
    incomplete.skillsList = async () => ({ data: [{ cwd: context.cwd, skills: [metadata(set)], errors: [{ path: "bad", message: "unreadable" }] }] });
    await assert.rejects(set.verifyDiscovery(incomplete, context.cwd), /incomplete or reported errors/);
  } finally { context.close(); }
});

const packagedCommand = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../deploy/codex/node_modules/@openai/codex/bin/codex.js");

test("pinned binary discovers scoped bundles without a model call and reveals repository-root exposure", { skip: !existsSync(packagedCommand) }, async () => {
  const context = home();
  const outgoing: string[] = [];
  let client: AppServerClient | undefined;
  try {
    assert.equal(assertCodexHarnessVersion(packagedCommand), "0.150.1");
    const multiline = source("multiline-invoice");
    multiline.bundle.files[0]!.content = multiline.bundle.files[0]!.content.replace(
      "description: Check supplied invoices using the packaged reference.",
      "description: |\n  Check supplied invoices using the packaged reference.\n  Apply the documented invoice rules.",
    );
    const blockMetadata = assertValidSkillBundle(multiline.bundle);
    const set = materializeCodexSkills({ codexHome: context.codexHome, skills: [source(), {
      ...multiline, entry: { ...multiline.entry, description: blockMetadata.metadata.description, contentDigest: blockMetadata.digest },
    }] });
    client = new AppServerClient({ ...codexLaunch(packagedCommand), codexHome: set.codexHome, cwd: context.cwd, inheritEnv: false, env: { PATH: process.env.PATH, ...set.environment }, requestTimeoutMs: 15000, onRawLine: (direction, line) => { if (direction === "out") outgoing.push(JSON.parse(line).method as string); } });
    await client.start({ clientInfo: { name: "agentic-skills-test", title: "Skills test", version: "0.1.0" }, capabilities: null });
    assert.deepEqual(await set.prepareDiscovery(client, context.cwd), set.catalog);
    const input = set.explicitInput(set.catalog[0]!.id);
    assert.equal(readFileSync(path.join(path.dirname(input.path), "references/rules.md"), "utf8"), "Preserve supplied identifiers.\n");
    assert.deepEqual(readFileSync(path.join(path.dirname(input.path), "assets/fixture.bin")), Buffer.from([0, 255, 1, 128]));
    const discovered = await client.skillsList({ cwds: [context.cwd], forceReload: true });
    assert.deepEqual(discovered.data[0]!.skills.filter((skill) => skill.enabled).map((skill) => skill.path).sort(), set.catalog.map((skill) => path.join(set.root, skill.name, "SKILL.md")).sort());

    // A private CODEX_HOME is not a filesystem sandbox: the pinned runtime
    // still discovers repository skills. The adapter must refuse that catalog.
    const ambientDirectory = path.join(context.cwd, ".agents", "skills", "outside-snapshot");
    mkdirSync(ambientDirectory, { recursive: true });
    writeFileSync(path.join(ambientDirectory, "SKILL.md"), "---\nname: outside-snapshot\ndescription: Synthetic repository discovery fixture.\n---\nDo nothing.\n");
    const withRepository = await client.skillsList({ cwds: [context.cwd], forceReload: true });
    assert.ok(withRepository.data[0]!.skills.some((skill) => skill.name === "outside-snapshot"));
    await assert.rejects(set.verifyDiscovery(client, context.cwd), /outside the authorized/);
    assert.ok(outgoing.every((method) => ["initialize", "initialized", "skills/list", "skills/config/write"].includes(method)), "probe must never start a thread/turn or make a model request");
  } finally { await client?.close(); context.close(); }
});
