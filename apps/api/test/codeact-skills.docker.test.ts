/** Opt-in real Docker/SDK checks. No model, database, remote executor or deployed
 * policy is used. Missing opt-in skips; a supplied invalid image/socket fails. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SkillScriptInputSchema, type SkillBundle } from "@agentic/contracts";
import {
  assertValidSkillBundle,
  SkillSession,
  type SkillSessionScriptExecution,
} from "@agentic/skills";
import {
  DockerSocketCodeActTransport,
  runGeneratedCodeIsolated,
  type RunGeneratedCodeOptions,
} from "@agentic/runtime";
import {
  DockerSocketSkillScriptTransport,
  SkillScriptRunner,
  type SkillScriptResult,
} from "@agentic/skill-runner";

const candidateImage = process.env.FACTORY_CODEACT_CANDIDATE_IMAGE;
const socketPath = process.env.FACTORY_CODEACT_DOCKER_SOCKET;
const runnerImage = process.env.SKILL_RUNNER_SMOKE_IMAGE;
const enabled =
  process.env.FACTORY_CODEACT_REAL_DOCKER === "1" &&
  Boolean(candidateImage && socketPath);
const live = it.skipIf(!enabled);
beforeEach(() => {
  vi.stubEnv("FACTORY_EXEC_GENERATED", "1");
  vi.stubEnv("FACTORY_SANDBOX_TOOL_MODE", "gated");
});
afterEach(() => vi.unstubAllEnvs());
const identity = {
  tenantId: "local-skills-probe",
  agentId: "native-sdk-probe",
  runId: "local-script-probe",
};
function skillSession(scriptExecution?: SkillSessionScriptExecution) {
  const bundle: SkillBundle = {
    files: [
      {
        path: "SKILL.md",
        encoding: "utf8",
        content:
          "---\nname: native-sdk-probe\ndescription: Inspect the supplied local probe input.\n---\nPreserve input identifiers and read the packaged reference.\n",
      },
      {
        path: "references/check.md",
        encoding: "utf8",
        content: "Inspect π units.",
      },
      { path: "assets/sample.bin", encoding: "base64", content: "AP+A" },
      {
        path: "scripts/check.js",
        encoding: "utf8",
        content:
          "const fs=require('node:fs');fs.writeFileSync(process.env.OUTPUT_DIR+'/binary.bin',Buffer.from([0,255,128]));console.log(JSON.stringify({uid:process.getuid(),stdin:fs.readFileSync(0,'utf8'),args:process.argv.slice(2)}));",
      },
    ],
  };
  const valid = assertValidSkillBundle(bundle);
  return new SkillSession({
    catalog: [
      {
        id: "skill-probe",
        versionId: "version-1",
        name: valid.metadata.name,
        description: valid.metadata.description,
        contentDigest: valid.digest,
      },
    ],
    readBundle: () => bundle,
    scriptExecution,
  });
}
async function run(body: string, options: RunGeneratedCodeOptions = {}) {
  return runGeneratedCodeIsolated(
    `import { defineAgent } from "@agentic/runtime"; export default defineAgent({ async handler(input,ctx) { ${body} } });`,
    {},
    {
      tenantSlug: "native-skills-probe-sb",
      agentName: "native-skills-probe",
      candidateImage: candidateImage!,
      containerTransport: new DockerSocketCodeActTransport({
        socketPath: socketPath!,
      }),
      timeoutMs: 15000,
      memoryMb: 128,
      ...options,
    },
  );
}

live(
  "uses the actual container SDK for discovery, activation and text/binary resource reads",
  async () => {
    const session = skillSession();
    const result = await run(
      `
    const list = await ctx.skills.list();
    const selector = {id:list.skills[0].id};
    const loaded = await ctx.skills.load(selector);
    const resources = await ctx.skills.listResources(selector);
    const text = await ctx.skills.readResource(selector,"references/check.md");
    const binary = await ctx.skills.readResource(selector,"assets/sample.bin");
    return {loaded,resources,text,binary,hasScriptMethod:typeof ctx.skills.runScript === "function"};
  `,
      { skillSession: session },
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.data.loaded).toMatchObject({
      id: "skill-probe",
      versionId: "version-1",
    });
    expect(
      result.data.resources.resources
        .map((resource: { path: string }) => resource.path)
        .sort(),
    ).toEqual([
      "SKILL.md",
      "assets/sample.bin",
      "references/check.md",
      "scripts/check.js",
    ]);
    expect(result.data.text).toMatchObject({
      content: "Inspect π units.",
      bytes: Buffer.byteLength("Inspect π units."),
    });
    expect(result.data.binary).toMatchObject({
      encoding: "base64",
      content: "AP+A",
      bytes: 3,
    });
    expect(result.data.hasScriptMethod).toBe(true);
    expect(
      result.skillAccesses.find(
        (access) => access.resourcePath === "assets/sample.bin",
      ),
    ).toMatchObject({
      skillId: "skill-probe",
      skillVersionId: "version-1",
      bytes: 3,
    });
    expect(result.toolDispatches).toEqual([]);
    expect(result.containerEvidence).toMatchObject({
      imageId: candidateImage,
      exitCode: 0,
      removed: true,
      absenceVerified: true,
    });
    expect((await session.snapshot()).activations[0]?.origin).toBe("model");
  },
);

live(
  "denies script execution without the business tool even when candidate code catches the error",
  async () => {
    const result = await run(
      'await ctx.skills.load({id:"skill-probe"}); try { await ctx.skills.runScript({id:"skill-probe",scriptPath:"scripts/check.js",interpreter:"node"}); } catch(error) {} return {claimedSuccess:true};',
      { skillSession: skillSession() },
    );
    expect(result).toMatchObject({
      ok: false,
      failure: "rpc_failed",
      error: expect.stringContaining("generated_tool_not_declared"),
      containerEvidence: { exitCode: 0, removed: true, absenceVerified: true },
    });
    expect(result.toolDispatches).toEqual([]);
  },
);

live(
  "still requires an independent host script capability when the business tool is allowed",
  async () => {
    const result = await run(
      'await ctx.skills.load({id:"skill-probe"}); return await ctx.skills.runScript({id:"skill-probe",scriptPath:"scripts/check.js",interpreter:"node"});',
      {
        skillSession: skillSession(),
        allowedTools: ["skills.run_script"],
        hostRuntime: {
          async tool(name, input, context) {
            expect(name).toBe("skills.run_script");
            if (!context?.skillSession)
              throw new Error("Missing trusted Skill session");
            return context.skillSession.runScript(
              SkillScriptInputSchema.parse(input),
            );
          },
        },
      },
    );
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("not enabled by the host"),
      containerEvidence: { removed: true, absenceVerified: true },
    });
  },
);

it.skipIf(!enabled || !runnerImage)(
  "runs the SDK script method through a separately approved real runner container and preserves binary artifacts",
  async () => {
    const runner = new SkillScriptRunner({
      image: runnerImage!,
      approvedImages: [runnerImage!],
      interpreters: ["node"],
      transport: new DockerSocketSkillScriptTransport({
        socketPath: socketPath!,
      }),
      limits: { timeoutMs: 5000, outputBytes: 16384 },
      authorize: (request) =>
        request.identity.tenantId === identity.tenantId &&
        request.identity.agentId === identity.agentId &&
        request.identity.runId === identity.runId &&
        request.skill.id === "skill-probe" &&
        request.scriptPath === "scripts/check.js",
    });
    const session = skillSession({
      policyDigest: "b".repeat(64),
      limits: {
        calls: 1,
        timeoutMs: 5000,
        inputBytes: 4096,
        outputBytes: 16384,
      },
      reservation: { timeoutMs: 5000, outputBytes: 16384 },
      execute: ({ skill, bundle, input, signal }) =>
        runner.run({ identity, skill, bundle, ...input, signal }),
    });
    const result = await run(
      'await ctx.skills.load({id:"skill-probe"}); return await ctx.skills.runScript({id:"skill-probe",scriptPath:"scripts/check.js",interpreter:"node",args:["literal;not-shell"],stdin:"native SDK input"});',
      {
        skillSession: session,
        allowedTools: ["skills.run_script"],
        hostRuntime: {
          async tool(name, input, context) {
            expect(name).toBe("skills.run_script");
            expect(context?.skillSession).toBe(session);
            return session.runScript(SkillScriptInputSchema.parse(input));
          },
        },
      },
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw new Error(result.error);
    const script = result.data as unknown as SkillScriptResult;
    expect(script.ok, JSON.stringify(script)).toBe(true);
    expect(JSON.parse(script.stdout)).toEqual({
      uid: 65532,
      stdin: "native SDK input",
      args: ["literal;not-shell"],
    });
    expect(script.artifacts).toHaveLength(1);
    expect(Buffer.from(script.artifacts[0]!.content, "base64")).toEqual(
      Buffer.from([0, 255, 128]),
    );
    expect(script.evidence).toMatchObject({
      identity,
      imageId: runnerImage,
      exitCode: 0,
      cleanup: {
        stagingContainerAbsent: true,
        executionContainerAbsent: true,
        volumeAbsent: true,
      },
    });
    expect(result.containerEvidence).toMatchObject({
      imageId: candidateImage,
      exitCode: 0,
      removed: true,
      absenceVerified: true,
    });
    expect(result.toolDispatches).toEqual([
      { tool: "skills.run_script", kind: "live" },
    ]);
    expect((await session.snapshot()).scriptUsage?.calls).toBe(1);
  },
);
