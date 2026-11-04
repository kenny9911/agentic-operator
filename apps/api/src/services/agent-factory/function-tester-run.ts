// #P2.5-Tester — 生成→真跑→验收 的执行装配(apps/api 同时依赖 agent-factory + runtime)。
// 把一个 GeneratedAgentSpec 渲染成 ts_function_module(交付形态)→ 变换成自包含测试模块 →
// 在 P0a 的 worker 隔离里【真执行它的 handler】→ 用 Tester 判据打分。这是"加一个真执行验证角色"
// (研究证据:AgentCoder/Self-Collab 的增益主要来自此,而非多派 leader)。

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import {
  renderTsFunctionModule,
  harnessTsModuleForTest,
  gradeFunctionTest,
  assertGeneratedSpecExecutionOwner,
  type GeneratedAgentSpec,
  type TsFunctionModuleOpts,
  type FunctionTestVerdict,
  type FunctionTestAssertions,
  type TestCase,
} from "@agentic/agent-factory";
import type { CanonicalCassetteDocument } from "@agentic/shared/cassette";
import { runGeneratedModule, runGeneratedModuleProcess, runGeneratedModuleContainer, runGeneratedCodeIsolated, GENERATED_CODE_ALLOWLIST, type ModuleRunResult, type RunModuleOpts, type RunGeneratedCodeOptions } from "@agentic/runtime";
import {
  verifyCassetteEvidenceAttestation,
  type ExpectedCassetteEvidenceBinding,
} from "./cassette-evidence-attestation";

/** Preserve declared rejection-event workflows without treating the final
 * success event as a failure outcome. An explicit case assertion wins. */
export function preliminaryFunctionExpectedEvent(
  spec: GeneratedAgentSpec,
  testCase?: Pick<TestCase, "kind" | "expectedEvent">,
): string | undefined {
  if (testCase?.expectedEvent) return testCase.expectedEvent;
  if (testCase?.kind === "reject") {
    const hasTerminalSuppression = (plan: NonNullable<GeneratedAgentSpec["plan"]>): boolean => plan.some((step) =>
      step.errorPolicy?.some((rule) => rule.suppressEmit === true && ("default" in rule ? rule.default : rule.do) === "terminal")
      || hasTerminalSuppression(step.body ?? []));
    // A caller must name an emitted branch explicitly when the source permits
    // terminal handling that suppresses its implicit failure event.
    if (hasTerminalSuppression(spec.plan ?? [])) return undefined;
    const rejectionEvents = [...new Set(spec.emit.filter((event) => /FAIL|REJECT|ERROR|CONFLICT|DENIED|FAILED/i.test(event)))];
    if (rejectionEvents.length > 1) {
      throw new Error(`多个拒绝事件 [${rejectionEvents.join("、")}] 需要明确的 expectedEvent；不能猜测业务分支`);
    }
    return rejectionEvents[0];
  }
  return testCase?.kind === "fault" ? spec.emit.at(-1) : spec.emit[0];
}

// #P6 — isolation tier for the Tester's real execution. Escalate via FACTORY_EXEC_TIER:
//   worker(default) → in-process worker_thread(fastest;时间/内存隔离,非安全边界)
//   process         → child process + scrubbed env(剥离密钥;更强)
//   container       → Docker(--network none/--read-only/caps dropped/非root;最强,不可用则回退子进程)
export type ExecTier = "worker" | "process" | "container";
export function execTier(): ExecTier {
  const t = (process.env.FACTORY_EXEC_TIER ?? "").trim().toLowerCase();
  return t === "process" || t === "container" ? t : "worker";
}
function runByTier(tier: ExecTier, code: string, opts: RunModuleOpts): Promise<ModuleRunResult> {
  if (tier === "container") return runGeneratedModuleContainer(code, opts);
  if (tier === "process") return runGeneratedModuleProcess(code, opts);
  return runGeneratedModule(code, opts);
}

export interface TestGeneratedFunctionResult {
  /** Exact reviewed CodeAct bytes, or the rendered declarative function module. */
  code: string;
  /** Tester 判据:跑通?发出期望事件? */
  verdict: FunctionTestVerdict;
  /** 实际用的隔离层(worker/process/container)。 */
  tier: ExecTier;
  /** `evidence` means at least one definition-bound cassette was supplied.
   * `scripted` is reserved for no-external-tool decision/invoke seams. */
  fixtureMode: "evidence" | "scripted" | "missing";
}

export interface ApprovedFunctionTestCassetteRef {
  toolName: string;
  cassettePath: string;
  definitionHash: string;
  schemaHash?: string;
  /** Required at the external sandbox boundary.  Standalone local function
   * tests may replay unsigned live recordings as diagnostics, but a fixture
   * that calls itself `signed-fixture` is never accepted without this exact
   * tenant/domain/config verification scope. */
  trustBinding?: ExpectedCassetteEvidenceBinding;
}

export type ApprovedFunctionTestCassetteLoad =
  | { document: CanonicalCassetteDocument; blockedReason?: never }
  | { document?: never; blockedReason: string };

/** Read one probe/record cassette without ever dispatching its tool. The
 * registry/profile caller supplies the expected definition identity; a file
 * that merely calls itself a cassette is not accepted as evidence. */
export function loadApprovedFunctionTestCassette(
  ref: ApprovedFunctionTestCassetteRef,
): ApprovedFunctionTestCassetteLoad {
  const toolLabel = `工具「${ref.toolName}」`;
  if (!ref.cassettePath.trim() || !ref.definitionHash.trim()) {
    return { blockedReason: `${toolLabel}没有完整的已验证 cassette 引用，本次函数测试不会伪造工具成功。` };
  }
  try {
    const parsed = JSON.parse(readFileSync(ref.cassettePath, "utf8")) as CanonicalCassetteDocument;
    const evidenceMode = parsed?.evidence?.mode;
    if (
      parsed?.version !== 1 ||
      !Array.isArray(parsed.entries) ||
      parsed.tool?.name !== ref.toolName ||
      parsed.tool?.definitionHash !== ref.definitionHash ||
      (ref.schemaHash !== undefined && parsed.tool?.schemaHash !== ref.schemaHash) ||
      !parsed.evidence?.recordedAt ||
      !["live-probe", "signed-fixture", "runtime-record"].includes(evidenceMode ?? "")
    ) {
      return { blockedReason: `${toolLabel}的 cassette 与当前工具定义/返回结构或 probe/record 身份不一致，已阻断回放。` };
    }
    if (evidenceMode === "signed-fixture" && !ref.trustBinding) {
      return { blockedReason: `${toolLabel}的 signed-fixture 没有 tenant/domain/config 验签范围，已阻断回放。` };
    }
    if (ref.trustBinding) {
      const verification = verifyCassetteEvidenceAttestation(parsed, ref.trustBinding);
      if (!verification.valid) {
        return {
          blockedReason: `${toolLabel}的 cassette API 签名、租户、domain、配置或有效期校验失败，已阻断回放：${verification.issues.slice(0, 3).join("；")}`,
        };
      }
    }
    const usable = parsed.entries.some((entry) =>
      entry?.request?.kind === "tool" &&
      entry.request.toolName === ref.toolName &&
      typeof entry.request.argsHash === "string" &&
      Boolean(entry.response) &&
      Object.prototype.hasOwnProperty.call(entry.response, "body"));
    if (!usable) {
      return { blockedReason: `${toolLabel}的 cassette 没有可用的工具请求/响应记录，已阻断回放。` };
    }
    return { document: parsed };
  } catch {
    return { blockedReason: `${toolLabel}的已验证 cassette 无法读取，已阻断函数测试；不会改用真实外部调用。` };
  }
}

/** Execute and grade the selected execution owner. Invalid CodeAct identity
 * throws before execution; the deployer records it as a blocked function test. */
export async function testGeneratedFunction(
  spec: GeneratedAgentSpec,
  opts: {
    testEvent?: unknown;
    /** 期望它 emit 的事件之一(缺省=只要 handler 跑通即算通过)。 */
    expectEmits?: string[];
    /** Machine-readable assertions over the complete execution observation. A
     * singleton expected event defaults to exact-set checking; callers may
     * override that with assertions.exactEmits. */
    assertions?: FunctionTestAssertions;
    /** Explicit caller expectation; only reject with no expected event may
     * accept a terminal handler rejection without any emission. */
    caseKind?: "pass" | "reject" | "edge" | "fault";
    render?: TsFunctionModuleOpts;
    /** Execute an already-persisted generated module verbatim. Regression
     * replay uses this so promotion tests the reviewed artifact on disk, not a
     * freshly rendered look-alike. */
    code?: string;
    timeoutMs?: number;
    /** 若给,必须是 -sb 沙箱租户(隔离不变量)。 */
    tenantSlug?: string;
    tenantId?: string;
    factoryExecutionScope?: RunGeneratedCodeOptions["factoryExecutionScope"];
    /** 隔离层覆盖(缺省从 FACTORY_EXEC_TIER 读:worker/process/container)。 */
    tier?: ExecTier;
    /** Explicit, serializable dependency responses. There are deliberately no implicit
     * success defaults: missing tool/reason fixtures fail the test closed. */
    fixture?: {
      /** Legacy artifacts may still contain this field. It is deliberately
       * ignored for tool calls: a static object is not probe/record evidence. */
      toolResults?: Record<string, unknown>;
      /** Definition-bound probe/runtime cassettes. The harness matches the
       * actual call arguments; it never chooses the first response by name. */
      toolCassettes?: Record<string, CanonicalCassetteDocument>;
      /** Evidence-loading failures keyed by tool. They are raised only if the
       * generated function actually calls that tool. */
      blockedToolReasons?: Record<string, string>;
      reasonResult?: Record<string, unknown>;
      invokeResults?: Record<string, unknown>;
      /** Only an explicitly approved fault case may treat a recorded non-2xx
       * response as test data instead of incomplete success evidence. */
      allowEvidenceFailures?: boolean;
    };
  } = {},
): Promise<TestGeneratedFunctionResult> {
  if (spec.codeExecuted === true) {
    assertGeneratedSpecExecutionOwner(spec);
    const code = spec.generatedCode;
    if (!code?.trim() || (opts.code !== undefined && opts.code !== code)) {
      throw new Error("CodeAct function test requires the exact reviewed generatedCode bytes");
    }
    if (!opts.tenantId || !opts.tenantSlug || opts.factoryExecutionScope?.kind !== "sandbox") {
      throw new Error("CodeAct function test requires the active sandbox tenant and attempt scope");
    }
    const event = opts.testEvent && typeof opts.testEvent === "object" && !Array.isArray(opts.testEvent)
      ? opts.testEvent as Record<string, unknown>
      : {};
    const input = event.data && typeof event.data === "object" && !Array.isArray(event.data)
      ? event.data as Record<string, unknown>
      : {};
    const fixtureErrors: string[] = [];
    const forbiddenCapability = async (): Promise<never> => {
      const error = "pure CodeAct preliminary test attempted an undeclared runtime capability";
      fixtureErrors.push(error);
      throw new Error(error);
    };
    const expectedHash = createHash("sha256").update(code, "utf8").digest("hex");
    // The same one-shot container kernel owns both this preliminary execution
    // and the later broker run. Never test a rendered look-alike for CodeAct.
    const run = await runGeneratedCodeIsolated(code, input, {
      tenantId: opts.tenantId,
      tenantSlug: opts.tenantSlug,
      agentName: spec.short || spec.nameZh,
      correlationId: `function-test:${spec.slug}`,
      factoryExecutionScope: opts.factoryExecutionScope,
      timeoutMs: opts.timeoutMs ?? 30_000,
      allowedTools: [],
      hostRuntimeKind: "fixture",
      memory: {
        get: forbiddenCapability,
        put: forbiddenCapability,
        delete: forbiddenCapability,
        search: forbiddenCapability,
      },
      hostRuntime: {
        reason: forbiddenCapability,
        tool: forbiddenCapability,
        invoke: forbiddenCapability,
        spawn: forbiddenCapability,
      },
    });
    const exactExecution = run.executorStarted
      && run.handlerStarted === true
      && run.isolation === "isolated_container"
      && run.codeSha256 === expectedHash
      && run.containerEvidence?.codeSha256 === expectedHash
      && run.containerEvidence.attemptId === opts.factoryExecutionScope.attempt_id
      && run.containerEvidence.isolation === "isolated_container"
      && run.containerEvidence.removed === true
      && run.containerEvidence.absenceVerified === true;
    // The kernel publishes buffered emits only on a successful handler return.
    // A candidate_failed terminal response therefore has no committed events;
    // timeout, protocol, RPC and container failures never count as rejection.
    const candidateFailure = !run.ok && run.failure === "candidate_failed";
    const observation = {
      ran: run.ok && exactExecution,
      handlerStarted: exactExecution,
      terminalFailure: candidateFailure && run.failureStage === "handler" && /^\[terminal\](?:\s|$)/.test(run.error),
      ...(run.ok ? { result: run.data } : { error: run.error }),
      emitNames: run.ok ? run.emitted.map((entry) => entry.event) : [],
      emits: run.ok ? run.emitted.map((entry) => ({ name: entry.event, data: entry.payload })) : [],
      fixtureErrors,
    };
    const verdict = gradeFunctionTest({
      ok: exactExecution && (run.ok || candidateFailure),
      result: observation,
      ...(!run.ok ? { error: run.error } : {}),
      ...(!exactExecution ? { error: "CodeAct handler-start, exact code or verified container cleanup evidence missing" } : {}),
    }, { expectEmits: opts.expectEmits, assertions: opts.assertions, caseKind: opts.caseKind });
    return { code, verdict, tier: "container", fixtureMode: "scripted" };
  }
  const code = opts.code ?? renderTsFunctionModule(spec, opts.render);
  const harnessed = harnessTsModuleForTest(code);
  const tier = opts.tier ?? execTier();
  const run = await runByTier(tier, harnessed, {
    entryName: "__run",
    call: true,
    args: [opts.testEvent ?? { data: { payload: {} } }, opts.fixture ?? {}],
    // container startup is slower — give it more headroom by default.
    timeoutMs: opts.timeoutMs ?? (tier === "container" ? 30000 : 8000),
    tenantSlug: opts.tenantSlug,
    // Curated safe stdlib modules (crypto/url/querystring) resolve for REAL inside the
    // isolate; everything else still stubs to {} (no fs / net / child_process reach).
    allowlist: [...GENERATED_CODE_ALLOWLIST],
  });
  const verdict = gradeFunctionTest(run, { expectEmits: opts.expectEmits, assertions: opts.assertions, caseKind: opts.caseKind });
  const hasEvidence = Object.keys(opts.fixture?.toolCassettes ?? {}).length > 0;
  const hasStructuralFixture = Boolean(opts.fixture?.reasonResult) ||
    Object.keys(opts.fixture?.invokeResults ?? {}).length > 0;
  const fixtureMode = hasEvidence ? "evidence" : hasStructuralFixture ? "scripted" : "missing";
  // Report the boundary that really ran. In particular, a requested Docker
  // container may explicitly degrade to the scrubbed child-process runner;
  // presenting that as "container" made the acceptance UI overstate proof.
  const actualTier = run.isolationTier ?? tier;
  return { code, verdict, tier: actualTier, fixtureMode };
}
