import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import {
  AppServerClient,
  assertCodexHarnessVersion,
  codexLaunch,
  writeCodexHome,
  type CodexSkillSource,
} from "@agentic/codex-harness";
import { assertValidSkillBundle } from "@agentic/skills";
import {
  materializeRunCodexSkills,
  type CodexRunSkillHost,
  type RunCodexSkills,
} from "../src/services/codex-skill-runtime";

const ref = { id: "sks-snapshot", contentDigest: "a".repeat(64) };
const scope = {
  tenantId: "tenant-a",
  executionId: "run-a",
  agentId: "agent-a",
};
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function home() {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "run-codex-skills-")),
  );
  roots.push(root);
  const cwd = path.join(root, "workspace");
  mkdirSync(cwd, { mode: 0o700 });
  const codexHome = path.join(root, "codex");
  writeCodexHome({
    dir: codexHome,
    model: "gpt-5.4",
    sandboxMode: "read-only",
    approvalPolicy: "never",
    shellTool: false,
    mcpServers: [],
  });
  return { cwd, codexHome };
}
function source(name = "invoice-check"): CodexSkillSource {
  const bundle = {
    files: [
      {
        path: "SKILL.md",
        encoding: "utf8" as const,
        content: `---\nname: ${name}\ndescription: Check supplied invoices against documented rules.\n---\nRead [the rules](references/rules.md).\n`,
      },
      {
        path: "references/rules.md",
        encoding: "utf8" as const,
        content: "Preserve supplied identifiers.\n",
      },
      {
        path: "assets/fixture.bin",
        encoding: "base64" as const,
        content: Buffer.from([0, 255, 128, 1]).toString("base64"),
      },
    ],
  };
  const valid = assertValidSkillBundle(bundle);
  return {
    entry: {
      id: `skl-${name}`,
      versionId: "skv-immutable",
      contentDigest: valid.digest,
      name,
      description: valid.metadata.description,
    },
    bundle,
  };
}
function host(sources = [source()], activationIds = [sources[0]!.entry.id]) {
  let authorized = true;
  const read = vi.fn<CodexRunSkillHost["materializationSources"]>(
    async (snapshot, execution) => {
      if (
        !authorized ||
        JSON.stringify(snapshot) !== JSON.stringify(ref) ||
        JSON.stringify(execution) !== JSON.stringify(scope)
      )
        throw new Error("Snapshot is not authorized in this execution");
      return { sources, activationIds };
    },
  );
  return {
    materializationSources: read,
    revoke: () => {
      authorized = false;
    },
  };
}
function client(set: RunCodexSkills, cwd: string) {
  const skills = set.catalog.map((entry) => ({
    name: entry.name,
    description: entry.description,
    path: path.join(set.root, entry.name, "SKILL.md"),
    scope: "user" as const,
    enabled: true,
    pluginId: null,
  }));
  return {
    options: {
      codexHome: set.codexHome,
      cwd,
      env: { ...set.environment },
      inheritEnv: false,
      requestTimeoutMs: 1000,
    },
    skillsList: vi.fn(async () => ({ data: [{ cwd, skills, errors: [] }] })),
    skillsConfigWrite: vi.fn(async () => ({ effectiveEnabled: false })),
  };
}

it("copies trusted identity, materializes all discovery bytes, and returns only frozen explicit activations", async () => {
  const context = home();
  const reader = host([source(), source("optional-check")]);
  const mutableRef = { ...ref },
    mutableScope = { ...scope };
  const preparing = materializeRunCodexSkills(
    reader,
    mutableRef,
    mutableScope,
    context,
  );
  mutableRef.id = "forged";
  mutableScope.tenantId = "tenant-b";
  const set = await preparing;
  expect(set.snapshot).toEqual(ref);
  expect(set.scope).toEqual(scope);
  expect(set.catalog).toHaveLength(2);
  expect(Object.isFrozen(set)).toBe(true);
  const native = client(set, context.cwd);
  await set.prepareDiscovery(native, context.cwd);
  const inputs = await set.explicitInputs(native, context.cwd);
  expect(inputs).toEqual([
    {
      type: "skill",
      name: "invoice-check",
      path: path.join(set.root, "invoice-check", "SKILL.md"),
    },
  ]);
  expect(Object.isFrozen(inputs)).toBe(true);
  expect(
    readFileSync(path.join(set.root, "optional-check", "assets/fixture.bin")),
  ).toEqual(Buffer.from([0, 255, 128, 1]));
  expect(reader.materializationSources).toHaveBeenCalledTimes(3);
  expect(native.skillsList).toHaveBeenCalledTimes(3);
});

it.each(["tenantId", "executionId", "agentId"] as const)(
  "rejects the wrong %s before creating a Skill root",
  async (field) => {
    const context = home();
    await expect(
      materializeRunCodexSkills(
        host(),
        ref,
        { ...scope, [field]: "other" },
        context,
      ),
    ).rejects.toThrow("not authorized");
    expect(existsSync(path.join(context.codexHome, "skills"))).toBe(false);
  },
);

it("cannot hydrate the reader from JSON or accept activation paths outside the frozen catalog", async () => {
  const context = home();
  await expect(
    materializeRunCodexSkills(
      { materializationSources: {} } as unknown as CodexRunSkillHost,
      ref,
      scope,
      context,
    ),
  ).rejects.toThrow("trusted in-process");
  await expect(
    materializeRunCodexSkills(
      host([source()], ["/tmp/forged/SKILL.md"]),
      ref,
      scope,
      context,
    ),
  ).rejects.toThrow("frozen catalog");
  expect(existsSync(path.join(context.codexHome, "skills"))).toBe(false);
});

it("rechecks authorization before explicit inputs even after native discovery succeeded", async () => {
  const context = home(),
    reader = host();
  const set = await materializeRunCodexSkills(reader, ref, scope, context);
  const native = client(set, context.cwd);
  await set.prepareDiscovery(native, context.cwd);
  reader.revoke();
  await expect(set.explicitInputs(native, context.cwd)).rejects.toThrow(
    "not authorized",
  );
  await expect(set.verifyDiscovery(native, context.cwd)).rejects.toThrow(
    "not authorized",
  );
  expect(native.skillsList).toHaveBeenCalledTimes(2);
});

it("rejects a changed frozen catalog and does not reuse an earlier successful result", async () => {
  const context = home(),
    reader = host();
  const set = await materializeRunCodexSkills(reader, ref, scope, context);
  const native = client(set, context.cwd);
  await set.prepareDiscovery(native, context.cwd);
  reader.materializationSources.mockResolvedValue({
    sources: [source("replacement")],
    activationIds: [],
  });
  await expect(set.explicitInputs(native, context.cwd)).rejects.toThrow(
    "snapshot changed",
  );
  expect(native.skillsList).toHaveBeenCalledTimes(2);
});

it("rejects changed materialized bytes before returning inputs", async () => {
  const context = home();
  const set = await materializeRunCodexSkills(host(), ref, scope, context);
  const native = client(set, context.cwd);
  await set.prepareDiscovery(native, context.cwd);
  const resource = path.join(set.root, "invoice-check", "references/rules.md");
  chmodSync(resource, 0o600);
  writeFileSync(resource, "Changed outside the immutable snapshot.");
  await expect(set.explicitInputs(native, context.cwd)).rejects.toThrow(
    "immutable version",
  );
});

const packagedCommand = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../deploy/codex/node_modules/@openai/codex/bin/codex.js",
);
it.skipIf(!existsSync(packagedCommand))(
  "connects the trusted snapshot to the pinned native runtime without a model call",
  async () => {
    expect(assertCodexHarnessVersion(packagedCommand)).toBe("0.150.1");
    const context = home();
    const set = await materializeRunCodexSkills(
      host([source(), source("optional-check")]),
      ref,
      scope,
      context,
    );
    const outgoing: string[] = [];
    const native = new AppServerClient({
      ...codexLaunch(packagedCommand),
      codexHome: set.codexHome,
      cwd: context.cwd,
      inheritEnv: false,
      env: { PATH: process.env.PATH, ...set.environment },
      requestTimeoutMs: 15000,
      onRawLine: (direction, line) => {
        if (direction === "out")
          outgoing.push(JSON.parse(line).method as string);
      },
    });
    try {
      await native.start({
        clientInfo: {
          name: "run-skills-bridge-test",
          title: "Run Skills bridge test",
          version: "0.1.0",
        },
        capabilities: null,
      });
      expect(await set.prepareDiscovery(native, context.cwd)).toEqual(
        set.catalog,
      );
      const inputs = await set.explicitInputs(native, context.cwd);
      expect(inputs.map((input) => input.name)).toEqual(["invoice-check"]);
      expect(
        readFileSync(
          path.join(path.dirname(inputs[0]!.path), "assets/fixture.bin"),
        ),
      ).toEqual(Buffer.from([0, 255, 128, 1]));
      expect(outgoing).toContain("skills/list");
      expect(
        outgoing.every((method) =>
          [
            "initialize",
            "initialized",
            "skills/list",
            "skills/config/write",
          ].includes(method),
        ),
      ).toBe(true);
    } finally {
      await native.close();
    }
  },
);
