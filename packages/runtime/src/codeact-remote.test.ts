import { afterEach, describe, expect, it } from "vitest";
import type { CodeActContainerResult } from "./codeact-container";
import {
  activeProductionCodeActRpcContexts,
  executeProductionCodeActRemote,
  productionCodeActMessageSignature,
  type ProductionCodeActExecuteCommand,
} from "./codeact-remote";

const SECRET = "test-production-executor-secret-longer-than-32-bytes";
const IMAGE = `candidate@sha256:${"a".repeat(64)}`;
const IMAGE_ID = `sha256:${"b".repeat(64)}`;
const CODE_HASH = "c".repeat(64);
const env = {
  PRODUCTION_CODEACT_EXECUTOR_ENABLED: "1",
  PRODUCTION_CODEACT_EXECUTOR_URL: "https://executor.example",
  PRODUCTION_CODEACT_EXECUTOR_TOKEN: SECRET,
  PRODUCTION_CODEACT_EXPECTED_EXECUTOR_ID: "expected-executor",
  PRODUCTION_CODEACT_EXPECTED_BUILD_ID: "expected-build",
  PRODUCTION_CODEACT_ALLOWED_CANDIDATE_REFS: JSON.stringify([IMAGE]),
  PRODUCTION_CODEACT_ALLOWED_CANDIDATE_IMAGE_IDS: JSON.stringify([IMAGE_ID]),
};

function executedResult(ok = false): CodeActContainerResult {
  const base = {
    isolation: "isolated_container" as const,
    durationMs: 1,
    executorStarted: true,
    handlerStarted: true,
    candidateImageDigest: IMAGE,
    evidence: {
      schema: "agentic-codeact-container-execution/v1" as const,
      containerIdHash: "d".repeat(64),
      codeSha256: CODE_HASH,
      candidateImageDigest: IMAGE,
      imageId: IMAGE_ID,
      policyHash: "e".repeat(64),
      isolation: "isolated_container" as const,
      startedAt: "2026-09-10T12:00:00.000Z",
      completedAt: "2026-09-10T12:00:00.001Z",
      removedAt: "2026-09-10T12:00:00.002Z",
      exitCode: ok ? 0 : 1,
      oomKilled: false,
      rpcCount: 0,
      removed: true as const,
      absenceVerified: true as const,
    },
  };
  return ok
    ? { ...base, ok: true, result: { accepted: true }, emitted: [] }
    : { ...base, ok: false, failure: "candidate_failed", failureStage: "handler", error: "[terminal] invalid_input" };
}

async function receiveSignedResult(result: CodeActContainerResult) {
  // The expected executor signs the exact execution-bound envelope. A valid
  // signature must not excuse configuration drift in its candidate image.
  const fetchFn: typeof fetch = async (_url, init) => {
    const command = JSON.parse(String(init?.body)) as ProductionCodeActExecuteCommand;
    const terminal = {
      schema: "agentic-production-codeact-terminal/v1",
      executionId: command.executionId,
      identityHash: command.identityHash,
      codeSha256: CODE_HASH,
      executorId: "expected-executor",
      buildId: "expected-build",
      completedAt: new Date().toISOString(),
      result,
    };
    return new Response(JSON.stringify(terminal), {
      status: 200,
      headers: { "x-agentic-codeact-signature": productionCodeActMessageSignature(terminal, SECRET) },
    });
  };
  return executeProductionCodeActRemote({
    code: "reviewed source bytes",
    data: {},
    identity: {
      tenantId: "owner-domain-runtime",
      tenantSlug: "domain-runtime",
      runId: "run-regression",
      agentName: "validated-agent",
      correlationId: "regression:reject-case",
      promotionVersionId: "candidate-version",
      regressionSuiteFingerprint: "regression-suite:v1:test",
      codeSha256: CODE_HASH,
    },
    timeoutMs: 1000,
    memoryMb: 128,
    cpus: 1,
    pidsLimit: 64,
    onRpc: async () => { throw new Error("unexpected RPC"); },
    fetchFn,
    env,
  });
}

afterEach(() => expect(activeProductionCodeActRpcContexts()).toBe(0));

describe("production CodeAct execution evidence", () => {
  it.each([false, true])("preserves a fully pinned signed execution (ok=%s)", async (ok) => {
    const signed = executedResult(ok);
    expect(await receiveSignedResult(signed)).toEqual(signed);
  });

  it.each([
    ["result candidate reference", { candidateImageDigest: `other@sha256:${"f".repeat(64)}` }],
    ["evidence candidate reference", { evidence: { ...executedResult().evidence!, candidateImageDigest: `other@sha256:${"f".repeat(64)}` } }],
    ["actual candidate image ID", { evidence: { ...executedResult().evidence!, imageId: `sha256:${"f".repeat(64)}` } }],
    ["executed code hash", { evidence: { ...executedResult().evidence!, codeSha256: "f".repeat(64) } }],
    ["cleanup removal", { evidence: { ...executedResult().evidence!, removed: false } }],
    ["cleanup absence", { evidence: { ...executedResult().evidence!, absenceVerified: false } }],
    ["missing evidence", { evidence: undefined }],
  ])("does not expose a rejection as candidate_failed with invalid %s", async (_label, mutation) => {
    const signed = { ...executedResult(), ...mutation } as CodeActContainerResult;
    const result = await receiveSignedResult(signed);
    // Replay may accept candidate_failed as an expected rejection. Invalid
    // provenance must instead become an infrastructure failure without proof.
    expect(result).toMatchObject({ ok: false, failure: "production_executor_unavailable", executorStarted: false });
    expect(result).not.toHaveProperty("evidence");
    expect(result).not.toHaveProperty("handlerStarted");
  });

  it("preserves signed infrastructure failures that have no candidate evidence", async () => {
    const signed: CodeActContainerResult = {
      ok: false,
      isolation: "isolated_container",
      failure: "container_create_failed",
      error: "Docker is unavailable",
      durationMs: 1,
      executorStarted: false,
      candidateImageDigest: IMAGE,
    };
    expect(await receiveSignedResult(signed)).toEqual(signed);
  });
});
