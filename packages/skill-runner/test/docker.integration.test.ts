import { expect, it } from "vitest";
import { assertValidSkillBundle } from "@agentic/skills";
import { DockerSocketSkillScriptTransport, SkillScriptRunner, type SkillScriptInterpreter, type SkillScriptLimits } from "../src/index";

// Opt-in because this requires an operator-approved built image and live
// Linux Docker daemon. Setting both variables makes daemon/image failures fail.
const image = process.env.SKILL_RUNNER_SMOKE_IMAGE;
const socketPath = process.env.SKILL_RUNNER_DOCKER_SOCKET;
const live = it.skipIf(!image || !socketPath);

async function execute(code: string, interpreter: SkillScriptInterpreter = "node", limits?: Partial<SkillScriptLimits>, extraFiles: Array<{ path: string; content: string; encoding: "utf8" }> = []) {
  const scriptPath = `scripts/probe.${interpreter === "node" ? "js" : "py"}`;
  const bundle = { files: [
    { path: "SKILL.md", content: "---\nname: runner-probe\ndescription: Verify isolated script execution\n---\nRun the packaged probe.\n", encoding: "utf8" as const },
    { path: scriptPath, content: code, encoding: "utf8" as const },
    ...extraFiles,
  ] };
  const runner = new SkillScriptRunner({ image: image!, approvedImages: [image!], interpreters: ["node", "python"], authorize: () => true, transport: new DockerSocketSkillScriptTransport({ socketPath: socketPath! }), limits });
  return runner.run({ identity: { tenantId: "integration-tenant", agentId: "integration-agent", runId: "integration-run" }, skill: { id: "probe", versionId: "fixture-v1", name: "runner-probe", contentDigest: assertValidSkillBundle(bundle).digest }, bundle, scriptPath, interpreter, args: ["literal;not-shell"], stdin: "probe input" });
}

live("runs Node with read-only bundle/root, non-root identity and binary scratch artifacts", async () => {
  const result = await execute(`const fs=require('node:fs'); let bundleReadonly=false,rootReadonly=false;
try { fs.chmodSync('/skill/SKILL.md',0o644); } catch(e) { bundleReadonly=e.code==='EROFS'; }
try { fs.writeFileSync('/host-write','x'); } catch(e) { rootReadonly=['EROFS','EACCES'].includes(e.code); }
fs.writeFileSync(process.env.OUTPUT_DIR+'/binary.bin',Buffer.from([0,255,128]));
console.log(JSON.stringify({uid:process.getuid(),bundleReadonly,rootReadonly,args:process.argv.slice(2),stdin:fs.readFileSync(0,'utf8'),env:Object.keys(process.env).sort()}));`);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(JSON.parse(result.stdout)).toMatchObject({ uid: 65532, bundleReadonly: true, rootReadonly: true, args: ["literal;not-shell"], stdin: "probe input" });
  expect(Buffer.from(result.artifacts[0]!.content, "base64")).toEqual(Buffer.from([0, 255, 128]));
  expect(Object.values(result.evidence!.cleanup)).toEqual([true, true, true]);
}, 60_000);

live("runs Python with ordinary sibling-resource access and stdin", async () => {
  const result = await execute("import os,sys,json,helper\nprint(json.dumps({'uid':os.getuid(),'input':sys.stdin.read(),'args':sys.argv[1:],'helper':helper.VALUE}))\n", "python", undefined, [{ path: "scripts/helper.py", content: "VALUE = 'verified'\n", encoding: "utf8" }]);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(JSON.parse(result.stdout)).toEqual({ uid: 65532, input: "probe input", args: ["literal;not-shell"], helper: "verified" });
}, 60_000);

live("denies outbound networking", async () => {
  const result = await execute("fetch('https://example.com',{signal:AbortSignal.timeout(750)}).then(()=>console.log('connected'),()=>console.log('blocked'));\n");
  expect(result.ok, JSON.stringify(result)).toBe(true); expect(result.stdout.trim()).toBe("blocked");
}, 60_000);

live("kills runaway execution and verifies cleanup", async () => {
  const result = await execute("while(true) {}", "node", { timeoutMs: 1500 });
  expect(result.failure, JSON.stringify(result)).toBe("timeout");
  expect(Object.values(result.evidence!.cleanup)).toEqual([true, true, true]);
}, 60_000);

live("bounds script output", async () => {
  const result = await execute("console.log('x'.repeat(65536));", "node", { outputBytes: 128 });
  expect(result.failure, JSON.stringify(result)).toBe("output_limit");
  expect(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(128);
}, 60_000);

live("bounds generated artifact count", async () => {
  const result = await execute("const fs=require('node:fs');fs.writeFileSync(process.env.OUTPUT_DIR+'/one','1');fs.writeFileSync(process.env.OUTPUT_DIR+'/two','2');", "node", { artifactCount: 1 });
  expect(result.failure, JSON.stringify(result)).toBe("artifact_limit"); expect(result.artifacts).toEqual([]);
}, 60_000);

live("keeps supervisor debugging disabled and preserves a child's nonzero exit", async () => {
  const result = await execute("const fs=require('node:fs'); console.log(JSON.stringify({debugSignalDisabled:fs.readFileSync('/proc/1/cmdline','utf8').split('\\0').includes('--disable-sigusr1')})); process.exitCode=17;");
  expect(result.ok, JSON.stringify(result)).toBe(false);
  expect(result.failure).toBe("script_failed");
  expect(result.exitCode).toBe(17);
  expect(JSON.parse(result.stdout)).toEqual({ debugSignalDisabled: true });
  expect(Object.values(result.evidence!.cleanup)).toEqual([true, true, true]);
}, 60_000);
