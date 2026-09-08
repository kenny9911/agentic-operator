import { expect, it, vi } from "vitest";
import { assertValidSkillBundle, SkillSession } from "@agentic/skills";
import type { SkillBundle } from "@agentic/contracts";
import { createCodeActSkillDispatch } from "./codeact-skills";
import {
  activeProductionCodeActRpcContexts, executeProductionCodeActRemote, handleProductionCodeActRpc,
  productionCodeActMessageSignature, type ProductionCodeActExecuteCommand, type ProductionCodeActRpcRequest,
} from "./codeact-remote";

it("accepts only signed execution-bound Skill RPCs while retaining session authority in the host", async () => {
  const bundle: SkillBundle = { files: [
    { path: "SKILL.md", encoding: "utf8", content: "---\nname: scoped\ndescription: Use for scoped work.\n---\nPRIVATE-HOST-INSTRUCTIONS\n" },
    { path: "references/check.md", encoding: "utf8", content: "check" },
  ] };
  const parsed = assertValidSkillBundle(bundle);
  const session = new SkillSession({ catalog: [{ id: "skill-scoped", versionId: "v1", contentDigest: parsed.digest, name: "scoped", description: parsed.metadata.description }], readBundle: () => bundle });
  const dispatch = createCodeActSkillDispatch(session, () => {});
  const onRpc = vi.fn(dispatch.rpc);
  const secret = "local-test-secret-with-more-than-32-bytes";
  const image = `candidate@sha256:${"b".repeat(64)}`;
  const env = {
    PRODUCTION_CODEACT_EXECUTOR_ENABLED: "1", PRODUCTION_CODEACT_EXECUTOR_URL: "https://executor.example",
    PRODUCTION_CODEACT_EXECUTOR_TOKEN: secret, PRODUCTION_CODEACT_EXPECTED_EXECUTOR_ID: "test-executor",
    PRODUCTION_CODEACT_EXPECTED_BUILD_ID: "test-build", PRODUCTION_CODEACT_ALLOWED_CANDIDATE_REFS: JSON.stringify([image]),
    PRODUCTION_CODEACT_ALLOWED_CANDIDATE_IMAGE_IDS: JSON.stringify([`sha256:${"c".repeat(64)}`]),
  };
  const identity = { tenantId: "t1", tenantSlug: "tenant", runId: "r1", agentName: "agent", correlationId: "c1", promotionVersionId: "v1", regressionSuiteFingerprint: "regression-suite:v1:test", codeSha256: "a".repeat(64) };
  let original: ProductionCodeActRpcRequest | undefined;
  let checked = false;
  const fetchFn: typeof fetch = async (_url, init) => {
    const command = JSON.parse(String(init?.body)) as ProductionCodeActExecuteCommand;
    expect(JSON.stringify(command)).not.toMatch(/PRIVATE-HOST|readBundle|skillSession|contentDigest/);
    const request = (rpcId: string, method: ProductionCodeActRpcRequest["method"], args: unknown[]): ProductionCodeActRpcRequest => ({
      schema: "agentic-production-codeact-rpc/v1", executionId: command.executionId, identityHash: command.identityHash,
      codeSha256: command.identity.codeSha256, rpcId, method, args, issuedAt: new Date().toISOString(), expiresAt: command.expiresAt,
    });
    original = request("list", "skills.list", []);
    expect((await handleProductionCodeActRpc(original, "forged", env)).statusCode).toBe(401);
    const wrongIdentity = { ...original, identityHash: "outside" };
    expect((await handleProductionCodeActRpc(wrongIdentity, productionCodeActMessageSignature(wrongIdentity, secret), env)).statusCode).toBe(409);
    const responses = [];
    for (const body of [original, request("load", "skills.load", [{id: "skill-scoped"}]), request("paths", "skills.listResources", [{id: "skill-scoped"}]), request("read", "skills.readResource", [{id: "skill-scoped"}, "references/check.md"])]) {
      const response = await handleProductionCodeActRpc(body, productionCodeActMessageSignature(body, secret), env);
      expect(response.statusCode).toBe(200);
      responses.push(response.body);
    }
    expect(responses[3]).toMatchObject({ value: { content: "check", bytes: 5, skill: { versionId: "v1" } } });
    await handleProductionCodeActRpc(original, productionCodeActMessageSignature(original, secret), env);
    expect(onRpc).toHaveBeenCalledTimes(4);
    const unknown = { ...original, rpcId: "execute", method: "skills.execute" } as unknown as ProductionCodeActRpcRequest;
    expect((await handleProductionCodeActRpc(unknown, productionCodeActMessageSignature(unknown, secret), env)).statusCode).toBe(409);
    const terminal = {
      schema: "agentic-production-codeact-terminal/v1", executionId: command.executionId, identityHash: command.identityHash,
      codeSha256: identity.codeSha256, executorId: "test-executor", buildId: "test-build", completedAt: new Date().toISOString(),
      result: { ok: false, isolation: "isolated_container", failure: "candidate_failed", error: "intentional protocol-probe terminal", durationMs: 0, executorStarted: false, candidateImageDigest: null },
    };
    checked = true;
    return new Response(JSON.stringify(terminal), { status: 200, headers: { "x-agentic-codeact-signature": productionCodeActMessageSignature(terminal, secret) } });
  };
  const result = await executeProductionCodeActRemote({ code: "trusted test bytes", data: {}, identity, timeoutMs: 1000, memoryMb: 128, cpus: 1, pidsLimit: 64, onRpc, fetchFn, env });
  expect(result).toMatchObject({ ok: false, error: "intentional protocol-probe terminal" });
  expect(checked).toBe(true);
  expect(activeProductionCodeActRpcContexts()).toBe(0);
  expect((await handleProductionCodeActRpc(original!, productionCodeActMessageSignature(original!, secret), env)).statusCode).toBe(409);
});
