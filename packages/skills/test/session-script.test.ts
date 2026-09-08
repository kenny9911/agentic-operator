import { describe, expect, it, vi } from "vitest";
import type { SkillBundle, SkillScriptInput } from "@agentic/contracts";
import { skillBundleDigest } from "../src/bundle";
import { SkillSession, type SkillSessionScriptExecution } from "../src/session";

const bundle: SkillBundle = { files: [{ path: "SKILL.md", encoding: "utf8", content: "---\nname: calculate\ndescription: Calculate supplied data using the included script.\n---\nUse scripts/main.js for the calculation.\n" }, { path: "scripts/main.js", encoding: "utf8", content: "process.stdout.write('done');" }] };
const entry = { id: "calculate", versionId: "v1", name: "calculate", description: "Calculate supplied data using the included script.", contentDigest: skillBundleDigest(bundle) };
const invocation: SkillScriptInput = { id: "calculate", scriptPath: "scripts/main.js", interpreter: "node" };
function capability(extra: Partial<SkillSessionScriptExecution> = {}): SkillSessionScriptExecution {
  return { policyDigest: "a".repeat(64), limits: { calls: 2, timeoutMs: 2000, inputBytes: 1024, outputBytes: 2000 }, reservation: { timeoutMs: 1000, outputBytes: 1000 }, execute: vi.fn(async () => ({ ok: true, stdout: "done" })), ...extra };
}
function session(scriptExecution?: SkillSessionScriptExecution, authorize?: () => boolean) { return new SkillSession({ catalog: [entry], readBundle: () => bundle, scriptExecution, authorize }); }

describe("Skill scripts as an independent bounded host capability", () => {
  it("requires both activation and a host capability", async () => {
    const noHost = session(); await noHost.activate("calculate", { origin: "model" }); await expect(noHost.runScript(invocation)).rejects.toThrow(/not enabled/);
    const cap = capability(); const active = session(cap); await expect(active.runScript(invocation)).rejects.toThrow(/Activate/); expect(cap.execute).not.toHaveBeenCalled();
    await active.activate("calculate", { origin: "model" }); expect(await active.runScript(invocation)).toEqual({ ok: true, stdout: "done" });
    expect(cap.execute).toHaveBeenCalledWith(expect.objectContaining({ skill: expect.objectContaining(entry), bundle, input: invocation }));
    expect(Object.isFrozen((vi.mocked(cap.execute).mock.calls[0]![0]).bundle.files)).toBe(true);
  });
  it("rejects foreign selectors, traversal, unbundled scripts and model-supplied authority", async () => {
    const cap = capability(); const active = session(cap); await active.activate("calculate", { origin: "model" });
    for (const input of [{ ...invocation, id: "foreign" }, { ...invocation, scriptPath: "scripts/../SKILL.md" }, { ...invocation, scriptPath: "scripts/missing.js" }]) await expect(active.runScript(input)).rejects.toThrow();
    expect(() => active.runScript({ ...invocation, image: "sha256:forged" } as never)).toThrow(); expect(cap.execute).not.toHaveBeenCalled();
  });
  it("reserves cumulative budgets even when the external attempt fails", async () => {
    const active = session(capability({ execute: async () => { throw new Error("executor unavailable"); } })); await active.activate("calculate", { origin: "model" });
    await expect(active.runScript(invocation)).rejects.toThrow(/unavailable/); await expect(active.runScript(invocation)).rejects.toThrow(/unavailable/);
    await expect(active.runScript(invocation)).rejects.toThrow(/scriptUsage.calls/);
    expect((await active.snapshot()).scriptUsage).toMatchObject({ calls: 2, timeoutMs: 2000, outputBytes: 2000 });
  });
  it("shares script reservations across independently activated forks without oversubscription", async () => {
    const cap = capability(); const parent = session(cap); const children = await Promise.all([parent.fork({ skillIds: [entry.id] }), parent.fork({ skillIds: [entry.id] }), parent.fork({ skillIds: [entry.id] })]);
    await Promise.all(children.map((child) => child.activate("calculate", { origin: "model" })));
    const results = await Promise.allSettled(children.map((child) => child.runScript(invocation)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2); expect(cap.execute).toHaveBeenCalledTimes(2);
    const saved = await parent.snapshot(); expect(saved.activations).toEqual([]); expect(saved.scriptUsage?.calls).toBe(2);
    await expect(parent.fork({ skillIds: [entry.id] }).then((child) => child.restore({ ...saved, scriptUsage: { calls: 0, timeoutMs: 0, outputBytes: 0, inputBytes: 0 } }))).rejects.toThrow(/unused/);
  });
  it("reconstructs script consumption and rejects missing, forged, changed-policy and rollback checkpoints atomically", async () => {
    const cap = capability(); const active = session(cap); await active.activate("calculate", { origin: "model" }); await active.runScript(invocation); const saved = await active.snapshot();
    const restored = session(cap); await restored.restore(saved); expect((await restored.snapshot()).scriptUsage).toEqual(saved.scriptUsage);
    await expect(restored.advance({ ...saved, scriptUsage: { calls: 0, timeoutMs: 0, inputBytes: 0, outputBytes: 0 } })).rejects.toThrow(/roll back/);
    for (const bad of [{ ...saved, scriptUsage: undefined }, { ...saved, scriptUsage: { ...saved.scriptUsage!, calls: 100 } }, { ...saved, scriptPolicyDigest: "b".repeat(64) }]) await expect(session(cap).restore(bad)).rejects.toThrow();
    await expect(session().restore(saved)).rejects.toThrow(/policy changed/);
    await restored.runScript(invocation); await expect(restored.runScript(invocation)).rejects.toThrow(/budget/);
  });
  it("rechecks live authorization and cancellation before dispatch and reserves UTF-8 input bytes", async () => {
    let allowed = true; const cap = capability(); const active = session(cap, () => allowed); await active.activate("calculate", { origin: "model" }); allowed = false;
    await expect(active.runScript(invocation)).rejects.toThrow(); allowed = true;
    await expect(active.runScript(invocation, AbortSignal.abort())).rejects.toThrow(/cancelled/);
    await expect(active.runScript({ ...invocation, stdin: "漢".repeat(400) })).rejects.toThrow(/inputBytes/);
    expect(cap.execute).not.toHaveBeenCalled(); expect((await active.snapshot()).scriptUsage?.calls).toBe(0);
  });
});
